"""
베이스 v3: 연속 곡선 (노트 분할 없음).
bass.wav → Hilbert envelope + pyin 피치(보간) → 공통 시간 그리드 → bass_curve_v3.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np
from scipy.signal import hilbert
from scipy.interpolate import interp1d

from audio_engine.engine.utils import hz_to_midi

# -----------------------------------------------------------------------------
# 상수
# -----------------------------------------------------------------------------
HOP_MS = 10
HOP_SEC = 0.01
PYIN_HOP = 256
PYIN_FMIN = 50.0
PYIN_FMAX = 250.0
PYIN_FRAME_LENGTH = 2048
INTERP_GAP_MAX_SEC = 0.08
LOG_AMP_K = 100.0


def _hilbert_envelope(y: np.ndarray) -> np.ndarray:
    """Hilbert envelope: amplitude = |analytic signal|."""
    analytic = hilbert(y)
    return np.abs(analytic)


def _envelope_to_frames(y: np.ndarray, sr: int, hop: int) -> tuple[np.ndarray, np.ndarray]:
    """전체 오디오에 Hilbert 적용 후 hop별로 프레임 평균. 반환: times, amp_per_frame."""
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
    out = np.log1p(k * np.maximum(amp, 0))
    mx = np.nanmax(out)
    mn = np.nanmin(out)
    if mx > mn:
        out = (out - mn) / (mx - mn)
    else:
        out = np.zeros_like(out)
    return out


def _pyin_times_pitch(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """librosa pyin으로 times, pitch_hz (NaN = unvoiced)."""
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
    """
    NaN 구간: 길이 ≤ INTERP_GAP_MAX_SEC → 선형 보간.
    더 긴 구간 → 이전 유효값 유지 (forward fill).
    """
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
    """벡터용 Hz → MIDI. 0/NaN → nan."""
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
) -> tuple[np.ndarray, np.ndarray]:
    """공통 그리드 t_out에 amplitude와 pitch_midi를 보간."""
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
    return amp_out, pitch_out


def run_bass_v3(bass_wav_path: Path | str, sr: int | None = None) -> dict[str, Any]:
    """
    bass.wav 한 파일에 대해 v3 연속 곡선 파이프라인 실행.

    Returns:
        {"bass_curve_v3": [{ t, pitch, amp }, ...], "bass_curve_v3_meta": { pitch_unit, amp }}
    """
    path = Path(bass_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"bass wav 없음: {path}")
    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load

    duration = len(y) / sr

    # Step A — 진폭 (Hilbert envelope)
    times_amp, amp_frames = _envelope_to_frames(y, sr, PYIN_HOP)
    amp_frames = _log_norm(amp_frames)

    # Step B — 피치 (pyin + aggressive interpolation)
    times_pitch, pitch_hz = _pyin_times_pitch(y, sr)
    pitch_hz_filled = _interpolate_pitch_aggressive(times_pitch, pitch_hz)
    pitch_midi = _pitch_hz_to_midi(pitch_hz_filled)

    # Step C — 공통 시간 그리드
    t_out = np.arange(0.0, duration, HOP_SEC, dtype=np.float64)
    if t_out[-1] < duration - 1e-6:
        t_out = np.append(t_out, duration)
    amp_out, pitch_out = _resample_to_grid(t_out, times_amp, amp_frames, times_pitch, pitch_midi)

    # Step D — 출력
    bass_curve_v3: list[dict[str, Any]] = []
    for i in range(len(t_out)):
        p = float(pitch_out[i]) if np.isfinite(pitch_out[i]) else 0.0
        bass_curve_v3.append({
            "t": round(float(t_out[i]), 4),
            "pitch": round(p, 4),
            "amp": round(float(amp_out[i]), 4),
        })
    meta = {"pitch_unit": "midi", "amp": "hilbert_envelope"}
    return {"bass_curve_v3": bass_curve_v3, "bass_curve_v3_meta": meta}
