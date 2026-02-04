"""
Vocal 연속 곡선: pyin + envelope (+ optional centroid) → 공통 그리드 vocal_curve.
madmom RNN onset activation으로 "활동" 마스크를 적용해 무음/노이즈 구간은 amp=0으로 게이팅.
"""
from __future__ import annotations

import collections
from pathlib import Path
from typing import Any

import librosa
import numpy as np
from scipy.signal import hilbert
from scipy.interpolate import interp1d

from audio_engine.engine.utils import hz_to_midi, log_norm_01

# Python 3.10+ / NumPy 2.0+ 호환 (madmom)
if not hasattr(collections, "MutableSequence"):
    import collections.abc
    collections.MutableSequence = collections.abc.MutableSequence  # type: ignore
for _attr, _val in [("float", np.float64), ("int", np.int64), ("bool", np.bool_), ("complex", np.complex128)]:
    if not hasattr(np, _attr):
        setattr(np, _attr, _val)

# -----------------------------------------------------------------------------
# 상수 (vocal 범위)
# -----------------------------------------------------------------------------
HOP_SEC = 0.01
PYIN_HOP = 256
PYIN_FMIN = 80.0
PYIN_FMAX = 1000.0
PYIN_FRAME_LENGTH = 2048
INTERP_GAP_MAX_SEC = 0.08
LOG_AMP_K = 100.0

# Activity 게이팅: 이 값 미만이면 amp=0 (무음/비활성)
AMP_VOICE_MIN = 0.04
MADMOM_ACT_THRESHOLD = 0.15
MADMOM_FPS = 100


def _hilbert_envelope(y: np.ndarray) -> np.ndarray:
    """Hilbert envelope: amplitude = |analytic signal|."""
    analytic = hilbert(y)
    return np.abs(analytic)


def _envelope_to_frames(y: np.ndarray, sr: int, hop: int) -> tuple[np.ndarray, np.ndarray]:
    """전체 오디오에 Hilbert 적용 후 hop별로 프레임 평균."""
    envelope = _hilbert_envelope(y)
    n_frames = 1 + (len(envelope) - 1) // hop
    times = np.arange(n_frames, dtype=np.float64) * hop / sr
    amp_per_frame = np.zeros(n_frames, dtype=np.float64)
    for i in range(n_frames):
        start = i * hop
        end = min(start + hop, len(envelope))
        amp_per_frame[i] = np.mean(envelope[start:end])
    return times, amp_per_frame


def _log_norm(amp: np.ndarray, k: float = LOG_AMP_K) -> np.ndarray:
    """log(1 + k*x) 후 0~1 정규화."""
    return log_norm_01(amp, k=k)


def _pyin_times_pitch(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """librosa pyin으로 times, pitch_hz (NaN = unvoiced). Vocal 범위."""
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=PYIN_FMIN,
        fmax=PYIN_FMAX,
        sr=sr,
        hop_length=PYIN_HOP,
        frame_length=PYIN_FRAME_LENGTH,
        fill_na=np.nan,
        center=True,
    )
    if f0.ndim > 1:
        f0 = f0.squeeze()
    times = librosa.times_like(f0, sr=sr, hop_length=PYIN_HOP)
    pitch_hz = np.asarray(f0, dtype=np.float64)
    return times, pitch_hz


def _interpolate_pitch_aggressive(times: np.ndarray, pitch_hz: np.ndarray) -> np.ndarray:
    """NaN 구간: 짧으면 선형 보간, 길면 forward fill."""
    out = np.array(pitch_hz, copy=True)
    n = len(out)
    i = 0
    while i < n:
        if np.isfinite(out[i]):
            i += 1
            continue
        j = i
        while j < n and not np.isfinite(out[j]):
            j += 1
        gap_sec = times[j - 1] - times[i] if j > i else 0.0
        if j < n and i > 0:
            t_lo, t_hi = times[i - 1], times[j]
            p_lo, p_hi = out[i - 1], out[j]
            if gap_sec <= INTERP_GAP_MAX_SEC and np.isfinite(p_lo) and np.isfinite(p_hi) and t_hi > t_lo:
                for k in range(i, j):
                    frac = (times[k] - t_lo) / (t_hi - t_lo)
                    out[k] = p_lo + frac * (p_hi - p_lo)
            else:
                for k in range(i, j):
                    out[k] = p_lo
        elif i > 0:
            p_lo = out[i - 1]
            for k in range(i, j):
                out[k] = p_lo
        elif j < n:
            p_hi = out[j]
            for k in range(i, j):
                out[k] = p_hi
        i = j
    return out


def _pitch_hz_to_midi(pitch_hz: np.ndarray) -> np.ndarray:
    """Hz → MIDI. 0/NaN → nan."""
    midi = np.empty_like(pitch_hz)
    for i in range(len(pitch_hz)):
        midi[i] = hz_to_midi(float(pitch_hz[i]))
    return midi


def _resample_to_grid(
    t_out: np.ndarray,
    t_amp: np.ndarray,
    amp: np.ndarray,
    t_pitch: np.ndarray,
    pitch_midi: np.ndarray,
    t_centroid: np.ndarray | None = None,
    centroid: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    """공통 그리드 t_out에 amp, pitch_midi, (선택) centroid 보간."""
    amp_out = np.zeros_like(t_out)
    pitch_out = np.full_like(t_out, np.nan)
    if len(t_amp) >= 2:
        f_amp = interp1d(t_amp, amp, kind="linear", bounds_error=False, fill_value=(amp[0], amp[-1]))
        amp_out = f_amp(t_out)
    elif len(t_amp) == 1:
        amp_out[:] = amp[0]
    valid = np.isfinite(pitch_midi)
    if len(t_pitch) >= 2 and np.any(valid):
        t_p = t_pitch[valid]
        p_p = pitch_midi[valid]
        f_pitch = interp1d(t_p, p_p, kind="linear", bounds_error=False, fill_value=(p_p[0], p_p[-1]))
        pitch_out = f_pitch(t_out)
    elif len(t_pitch) == 1 and np.isfinite(pitch_midi[0]):
        pitch_out[:] = pitch_midi[0]

    centroid_out: np.ndarray | None = None
    if t_centroid is not None and centroid is not None and len(t_centroid) >= 2 and np.any(np.isfinite(centroid)):
        valid_c = np.isfinite(centroid)
        if np.any(valid_c):
            t_c = t_centroid[valid_c]
            c_c = centroid[valid_c]
            f_c = interp1d(t_c, c_c, kind="linear", bounds_error=False, fill_value=(c_c[0], c_c[-1]))
            centroid_out = f_c(t_out)

    return amp_out, pitch_out, centroid_out


def _madmom_activation_curve(audio_path: Path | str) -> tuple[np.ndarray, np.ndarray]:
    """
    madmom RNN onset activation (peak picking 없음). t_out 그리드에 리샘플링·정규화한 곡선 반환.
    Returns: (t_out, activation_out) — activation_out은 0~1 정규화.
    """
    from madmom.features.onsets import RNNOnsetProcessor

    proc = RNNOnsetProcessor()
    activations = proc(str(audio_path))
    act = np.asarray(activations, dtype=np.float64).flatten()
    fps = getattr(activations, "fps", MADMOM_FPS)
    n = len(act)
    if n == 0:
        return np.array([0.0], dtype=np.float64), np.array([0.0], dtype=np.float64)
    times_act = np.arange(n, dtype=np.float64) / fps
    # 0~1 정규화 (percentile로 이상치 완화)
    p1, p99 = np.percentile(act, [1, 99])
    if p99 > p1:
        act_norm = (act - p1) / (p99 - p1)
        act_norm = np.clip(act_norm, 0.0, 1.0)
    else:
        act_norm = np.zeros_like(act)
    return times_act, act_norm


def _resample_activation_to_grid(
    t_out: np.ndarray,
    times_act: np.ndarray,
    activation: np.ndarray,
) -> np.ndarray:
    """activation을 t_out 그리드에 리샘플링. 경계 밖은 0."""
    if len(times_act) < 2 or len(activation) != len(times_act):
        return np.zeros_like(t_out)
    f = interp1d(
        times_act,
        activation,
        kind="linear",
        bounds_error=False,
        fill_value=0.0,
    )
    return f(t_out).astype(np.float64)


def run_vocal_curve(
    vocal_wav_path: Path | str,
    sr: int | None = None,
    include_centroid: bool = True,
) -> dict[str, Any]:
    """
    vocals.wav 한 파일에 대해 vocal 연속 곡선 파이프라인 실행.

    Returns:
        {"vocal_curve": [{ t, pitch, amp, centroid? }, ...], "vocal_curve_meta": {...}}
    """
    path = Path(vocal_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"vocals wav 없음: {path}")
    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load

    duration = len(y) / sr

    # Step A — 진폭 (Hilbert envelope)
    hop = PYIN_HOP
    times_amp, amp_frames = _envelope_to_frames(y, sr, hop)
    amp_frames = _log_norm(amp_frames)

    # Step B — 피치 (pyin + interpolation)
    times_pitch, pitch_hz = _pyin_times_pitch(y, sr)
    pitch_hz_filled = _interpolate_pitch_aggressive(times_pitch, pitch_hz)
    pitch_midi = _pitch_hz_to_midi(pitch_hz_filled)

    # Step C — (선택) spectral centroid
    t_centroid = None
    centroid = None
    if include_centroid:
        cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
        t_centroid = librosa.times_like(cent, sr=sr, hop_length=hop)
        centroid = np.asarray(cent, dtype=np.float64)
        mx, mn = np.nanmax(centroid), np.nanmin(centroid)
        if mx > mn:
            centroid = (centroid - mn) / (mx - mn)
        else:
            centroid = np.zeros_like(centroid)

    # Step D — 공통 시간 그리드
    t_out = np.arange(0.0, duration, HOP_SEC, dtype=np.float64)
    if t_out[-1] < duration - 1e-6:
        t_out = np.append(t_out, duration)
    amp_out, pitch_out, centroid_out = _resample_to_grid(
        t_out, times_amp, amp_frames, times_pitch, pitch_midi, t_centroid, centroid
    )

    # Step D2 — madmom RNN onset activation으로 활동 마스크, amp 게이팅
    activation_out = None
    try:
        times_act, act_norm = _madmom_activation_curve(path)
        activation_out = _resample_activation_to_grid(t_out, times_act, act_norm)
        mask = (amp_out >= AMP_VOICE_MIN) & (activation_out >= MADMOM_ACT_THRESHOLD)
        amp_out = np.where(mask, amp_out, 0.0)
    except Exception:
        # madmom 실패 시 envelope만 사용 (기존 동작)
        amp_out = np.where(amp_out >= AMP_VOICE_MIN, amp_out, 0.0)

    # Step E — 출력 (vocal_activation은 phrase boundary OR 조건용으로 전달)
    vocal_curve_list: list[dict[str, Any]] = []
    for i in range(len(t_out)):
        p = float(pitch_out[i]) if np.isfinite(pitch_out[i]) else 0.0
        pt = {"t": round(float(t_out[i]), 4), "pitch": round(p, 4), "amp": round(float(amp_out[i]), 4)}
        if centroid_out is not None and np.isfinite(centroid_out[i]):
            pt["centroid"] = round(float(centroid_out[i]), 4)
        vocal_curve_list.append(pt)
    meta = {
        "pitch_unit": "midi",
        "amp": "hilbert_envelope_masked_by_madmom_activity",
        "y_axis_hint": "pitch",
        "activity_gate": "madmom_rnn_onset",
    }
    out: dict[str, Any] = {"vocal_curve": vocal_curve_list, "vocal_curve_meta": meta}
    if activation_out is not None:
        out["vocal_activation"] = [round(float(x), 4) for x in activation_out]
    return out
