"""
베이스 키포인트 v4: madmom onset 기반 (Dual Onset Track).
bass.wav → madmom RNN onset 검출 → onset 간격을 노트 세그먼트로 → pyin 피치 + 에너지 + superflux → build_bass_output.

Track A (구조용): RNNOnsetProcessor + OnsetPeakPickingProcessor → note boundaries
Track B (밀도/연결용): SpectralOnsetProcessor(superflux) → activation curve (no peak picking)
Step C: 각 세그먼트에 pyin 피치 + band-pass Hilbert 에너지 + superflux_mean/var
Step D: render_type, groove_confidence 판별
Step E: build_bass_output(notes) 형식으로 반환
"""
from __future__ import annotations

import collections
from pathlib import Path
from typing import Any

import librosa
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import butter, hilbert, sosfiltfilt

from audio_engine.engine.bass.export import build_bass_output
from audio_engine.engine.utils import hz_to_midi

# Python 3.10+ 호환: madmom이 collections.MutableSequence를 사용하므로 패치
if not hasattr(collections, "MutableSequence"):
    import collections.abc

    collections.MutableSequence = collections.abc.MutableSequence  # type: ignore

# NumPy 2.0+ 호환: madmom이 deprecated np.float, np.int 등 사용
for _attr, _val in [("float", np.float64), ("int", np.int64), ("bool", np.bool_), ("complex", np.complex128)]:
    if not hasattr(np, _attr):
        setattr(np, _attr, _val)

# -----------------------------------------------------------------------------
# 상수
# -----------------------------------------------------------------------------
BAND_LOW_HZ = 30.0
BAND_HIGH_HZ = 250.0
BAND_ORDER = 4

MIN_NOTE_DURATION_SEC = 0.04   # 더 짧은 노트도 허용
MAX_NOTE_DURATION_SEC = 0.6
ENERGY_MEAN_MIN = 0.12         # 약한 노트도 포함 (예민하게)

PYIN_FMIN = 50.0
PYIN_FMAX = 250.0
PYIN_FRAME_LENGTH = 2048
PYIN_HOP = 256
DEFAULT_PITCH_HZ = 80.0

HOP_SEC = 0.01  # 에너지 그리드

# 밀집 곡선 (붓질/그루브용): 노트 구간을 고정 hop으로 나눔
DENSE_HOP_SEC = 0.025  # 25ms

# 그루브 밀도 곡선: 임펄스 + Gaussian smoothing
GROOVE_CURVE_NUM_SAMPLES = 2000
GROOVE_CURVE_SIGMA_SEC = 0.05  # 대략 50ms 스무딩

# render_type / groove_confidence 판별
D_SHORT_SEC = 0.08       # 이보다 길면 선 성향
SUPERFLUX_VAR_TH = 0.02  # var < 이 값이면 sustain/groove
CONTINUOUS_GAP_SEC = 0.15   # 다음 노트와 gap 이하면 연결로 간주
PITCH_SAME_SEMITONE = 0.5   # 같은 피치 판별 (MIDI 반음 이내)


def _bandpass(y: np.ndarray, sr: float, low: float, high: float, order: int) -> np.ndarray:
    """Band-pass 30~250 Hz. Returns filtered waveform."""
    nyq = 0.5 * sr
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    sos = butter(order, [low_n, high_n], btype="band", output="sos")
    return sosfiltfilt(sos, y)


def _madmom_bass_onsets(audio_path: Path | str) -> np.ndarray:
    """
    bass.wav에서 madmom RNN onset 검출.
    Returns: onset_times_sec (1D array)
    """
    from madmom.features.onsets import RNNOnsetProcessor, OnsetPeakPickingProcessor

    fps = 100
    proc_onset = RNNOnsetProcessor()
    proc_peak = OnsetPeakPickingProcessor(
        threshold=0.25,   # 낮출수록 더 많은 onset 검출 (예민)
        smooth=0.0,
        pre_avg=0.0,
        post_avg=0.0,
        pre_max=0.015,    # 인접 피크 병합 창 축소 → 더 촘촘한 onset
        post_max=0.015,
        combine=0.02,     # 더 가까운 onset도 분리 유지
        fps=fps,
    )
    activations = proc_onset(str(audio_path))
    onset_times = proc_peak(activations)
    return np.asarray(onset_times).flatten()


def _madmom_superflux_activation(audio_path: Path | str) -> np.ndarray:
    """
    bass.wav에서 madmom superflux activation (peak picking 없음).
    Returns: activation array (fps ~100 균일)
    """
    from madmom.features.onsets import SpectralOnsetProcessor
    from madmom.audio.filters import LogarithmicFilterbank

    superflux_proc = SpectralOnsetProcessor(
        onset_method="superflux",
        filterbank=LogarithmicFilterbank,
        num_bands=24,
    )
    activation = superflux_proc(str(audio_path))
    return np.asarray(activation, dtype=np.float64).flatten()


def _sample_superflux_in_segment(
    activation: np.ndarray,
    duration: float,
    t_start: float,
    t_end: float,
) -> tuple[float, float]:
    """세그먼트 [t_start, t_end] 구간에서 superflux mean, var 반환."""
    if duration <= 0 or len(activation) == 0:
        return 0.0, 0.0
    fps = len(activation) / duration
    start_idx = int(t_start * fps)
    end_idx = int(t_end * fps)
    start_idx = max(0, min(start_idx, len(activation) - 1))
    end_idx = max(start_idx, min(end_idx, len(activation)))
    if start_idx >= end_idx:
        return 0.0, 0.0
    seg = activation[start_idx:end_idx].astype(np.float64)
    seg = seg[np.isfinite(seg) & (seg >= 0)]
    if len(seg) == 0:
        return 0.0, 0.0
    mean_val = float(np.mean(seg))
    var_val = float(np.var(seg))
    return mean_val, var_val


def _onset_times_to_segments(
    onset_times: np.ndarray,
    duration: float,
    min_dur_sec: float = MIN_NOTE_DURATION_SEC,
    max_dur_sec: float = MAX_NOTE_DURATION_SEC,
) -> list[tuple[float, float]]:
    """
    onset_times와 duration으로 세그먼트 (start, end) 리스트 생성.
    세그먼트 i: [onset[i], onset[i+1]), 마지막: [onset[-1], duration].
    min_dur 미만은 제거, max_dur 초과는 end를 start+max_dur로 자름.
    """
    if len(onset_times) == 0:
        return []
    segments: list[tuple[float, float]] = []
    for i in range(len(onset_times)):
        start = float(onset_times[i])
        end = duration if i == len(onset_times) - 1 else float(onset_times[i + 1])
        if end > start + max_dur_sec:
            end = start + max_dur_sec
        if end - start < min_dur_sec:
            continue
        segments.append((start, end))
    return segments


def _pitch_for_segment(y: np.ndarray, sr: int, t_start: float, t_end: float) -> float:
    """세그먼트 [t_start, t_end]에 대해 pyin 피치. 실패 시 DEFAULT_PITCH_HZ."""
    start_samp = int(t_start * sr)
    end_samp = int(t_end * sr)
    if start_samp >= end_samp or end_samp > len(y):
        return DEFAULT_PITCH_HZ
    seg = y[start_samp:end_samp]
    if len(seg) < PYIN_FRAME_LENGTH // 2:
        return DEFAULT_PITCH_HZ
    try:
        hop_len = max(1, min(PYIN_HOP, len(seg) // 4))
        f0, *_ = librosa.pyin(
            seg,
            fmin=PYIN_FMIN,
            fmax=PYIN_FMAX,
            sr=sr,
            hop_length=hop_len,
            frame_length=min(PYIN_FRAME_LENGTH, len(seg)),
            fill_na=np.nan,
            center=True,
        )
        if f0 is None or f0.size == 0:
            return DEFAULT_PITCH_HZ
        f0_flat = np.asarray(f0).flatten()
        valid = f0_flat[np.isfinite(f0_flat) & (f0_flat > 0)]
        if valid.size == 0:
            return DEFAULT_PITCH_HZ
        return float(np.median(valid))
    except Exception:
        return DEFAULT_PITCH_HZ


def _energy_for_segment(
    y_band: np.ndarray,
    envelope: np.ndarray,
    sr: int,
    t_start: float,
    t_end: float,
    hop_sec: float = HOP_SEC,
) -> tuple[float, float]:
    """세그먼트 구간에서 envelope 기반 energy_peak, energy_mean. (band-pass된 y 기준 envelope)."""
    start_samp = int(t_start * sr)
    end_samp = int(t_end * sr)
    if start_samp >= end_samp or end_samp > len(envelope):
        return 0.0, 0.0
    seg_env = envelope[start_samp:end_samp]
    if len(seg_env) == 0:
        return 0.0, 0.0
    peak = float(np.max(seg_env))
    mean = float(np.mean(seg_env))
    return peak, mean


def _dense_curves_for_segment(
    envelope: np.ndarray,
    sr: int,
    t_start: float,
    t_end: float,
    pitch_hz: float,
    hop_sec: float = DENSE_HOP_SEC,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """
    세그먼트 [t_start, t_end]를 고정 hop으로 나누어 pitch_curve, energy_curve, decay_ratio 생성.
    Returns: (times, pitches, energies, decay_ratio)
    - times: [t0, t1, ...], pitches: 동일 길이 (구간 pyin 1개 반복), energies: hop 구간별 envelope 평균
    - decay_ratio: 구간 끝 envelope / 구간 peak (0~1, 붓이 떼지는 정도)
    """
    dur = t_end - t_start
    if dur <= 0 or sr <= 0 or len(envelope) == 0:
        t_seg = np.array([t_start, t_end], dtype=np.float64)
        p_seg = np.array([pitch_hz, pitch_hz], dtype=np.float64)
        e_seg = np.array([0.0, 0.0], dtype=np.float64)
        return t_seg, p_seg, e_seg, 1.0

    # 시간 그리드: t_start, t_start+hop, ... , t_end (최소 2점)
    n_hop = max(1, int(dur / hop_sec))
    times = np.linspace(t_start, t_end, n_hop + 1, dtype=np.float64)
    pitches = np.full_like(times, pitch_hz)

    # 구간별 envelope 평균 → energy_curve
    energies = np.zeros_like(times)
    start_samp = int(t_start * sr)
    end_samp = int(t_end * sr)
    seg_env = envelope[max(0, start_samp) : min(end_samp, len(envelope))]
    if len(seg_env) == 0:
        energies[:] = 0.0
        decay_ratio = 1.0
        return times, pitches, energies, decay_ratio

    peak = float(np.max(seg_env))
    for i, t in enumerate(times):
        t_next = times[i + 1] if i + 1 < len(times) else t_end
        a = int(t * sr)
        b = int(t_next * sr)
        a = max(start_samp, min(a, len(envelope) - 1))
        b = max(a, min(b, len(envelope)))
        if b > a:
            energies[i] = float(np.mean(envelope[a:b]))
        else:
            energies[i] = float(envelope[a]) if a < len(envelope) else 0.0

    # decay_ratio: 구간 끝 쪽 에너지 / peak
    tail_len = max(1, len(seg_env) // 10)
    tail_mean = float(np.mean(seg_env[-tail_len:]))
    decay_ratio = (tail_mean / peak) if peak > 0 else 1.0
    decay_ratio = float(np.clip(decay_ratio, 0.0, 1.0))

    return times, pitches, energies, decay_ratio


def _compute_groove_confidence(
    superflux_mean: float,
    superflux_var: float,
    duration: float,
) -> float:
    """0~1 그루브 신뢰도. mean↑, var↓, duration↑ → groove↑"""
    # 정규화: mean은 0~1 스케일(대략), var는 낮을수록 sustain
    m = min(1.0, max(0.0, superflux_mean * 2.0))  # 대략 스케일
    v = max(0.0, 1.0 - superflux_var * 20.0)  # var 낮을수록 좋음
    d = min(1.0, duration / 0.3)  # 0.3초 이상이면 충분히 길다
    return float(np.clip((m * 0.3 + v * 0.4 + d * 0.3), 0.0, 1.0))


def _segments_to_notes(
    segments: list[tuple[float, float]],
    y: np.ndarray,
    y_band: np.ndarray,
    envelope: np.ndarray,
    sr: int,
    superflux_activation: np.ndarray | None = None,
    duration_sec: float = 0.0,
) -> list[dict[str, Any]]:
    """세그먼트 리스트 → build_bass_output 호환 note dict 리스트. superflux 있으면 render_type, groove_confidence 추가."""
    notes: list[dict[str, Any]] = []
    for i, (t0, t_end) in enumerate(segments):
        dur = t_end - t0
        pitch_hz = _pitch_for_segment(y, sr, t0, t_end)
        pitch_midi = hz_to_midi(pitch_hz) if np.isfinite(hz_to_midi(pitch_hz)) else 0.0
        energy_peak, energy_mean = _energy_for_segment(y_band, envelope, sr, t0, t_end)
        # 밀집 곡선: 고정 hop으로 pitch_curve, energy_curve, decay_ratio
        t_seg, p_seg, energy_curve, decay_ratio = _dense_curves_for_segment(
            envelope, sr, t0, t_end, pitch_hz, hop_sec=DENSE_HOP_SEC
        )
        note: dict[str, Any] = {
            "start": t0,
            "end": t_end,
            "duration": dur,
            "pitch_curve": (t_seg, p_seg),
            "energy_curve": energy_curve,
            "decay_ratio": decay_ratio,
            "pitch_center": pitch_midi,
            "pitch_median": pitch_midi,
            "energy_peak": energy_peak,
            "energy_mean": energy_mean,
            "attack_time": 0.0,
            "decay_time": 0.0,
        }

        if superflux_activation is not None and duration_sec > 0 and len(superflux_activation) > 0:
            sf_mean, sf_var = _sample_superflux_in_segment(
                superflux_activation, duration_sec, t0, t_end
            )
            note["superflux_mean"] = sf_mean
            note["superflux_var"] = sf_var

            var_low = sf_var < SUPERFLUX_VAR_TH
            duration_long = dur >= D_SHORT_SEC

            next_start = float(segments[i + 1][0]) if i + 1 < len(segments) else None
            gap_to_next = (next_start - t_end) if next_start is not None else float("inf")
            next_pitch_midi = (
                hz_to_midi(_pitch_for_segment(y, sr, segments[i + 1][0], segments[i + 1][1]))
                if i + 1 < len(segments)
                else None
            )
            pitch_same = (
                next_pitch_midi is not None
                and abs(pitch_midi - next_pitch_midi) <= PITCH_SAME_SEMITONE
            )
            is_continuous = (
                gap_to_next <= CONTINUOUS_GAP_SEC
                and (pitch_same or (next_pitch_midi is not None and abs(pitch_midi - next_pitch_midi) <= 2.0))
            )

            is_line = duration_long or is_continuous or var_low
            note["render_type"] = "line" if is_line else "point"
            note["groove_confidence"] = _compute_groove_confidence(sf_mean, sf_var, dur)

        notes.append(note)
    return notes


def _compute_groove_curve(
    notes: list[dict[str, Any]],
    duration: float,
    num_samples: int = GROOVE_CURVE_NUM_SAMPLES,
    sigma_sec: float = GROOVE_CURVE_SIGMA_SEC,
) -> list[tuple[float, float]]:
    """
    점(onset) + 세기(energy) → 임펄스 신호 → Gaussian smoothing → 정규화 곡선.
    곡선 = 점들의 밀도·에너지 흐름(envelope), polyline이 아님.
    """
    if duration <= 0 or not notes:
        return []
    t_dense = np.linspace(0, duration, num_samples, dtype=np.float64)
    signal = np.zeros(num_samples, dtype=np.float64)
    for n in notes:
        t = float(n["start"])
        w = float(n.get("energy_peak", n.get("energy_mean", 0.0)) or 0.0)
        if w < 0:
            w = 0.0
        idx = int(np.argmin(np.abs(t_dense - t)))
        idx = max(0, min(idx, num_samples - 1))
        signal[idx] += w
    sigma_samples = max(1.0, sigma_sec * (num_samples / duration))
    smooth = gaussian_filter1d(signal, sigma=float(sigma_samples), mode="constant", cval=0.0)
    smooth = np.asarray(smooth, dtype=np.float64)
    peak = float(np.max(smooth))
    if peak > 0:
        smooth = smooth / peak
    return list(zip(t_dense.tolist(), smooth.tolist()))


def run_bass_v4(bass_wav_path: Path | str, sr: int | None = None) -> dict[str, Any]:
    """
    v4: madmom Dual Onset Track → RNN onset(구조) + superflux(밀도/연결) → pyin 피치 + 에너지 + render_type, groove_confidence.

    Returns:
        {"notes": [...], "render": {...}} — build_bass_output 형식.
    """
    path = Path(bass_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"bass wav 없음: {path}")

    # Track A: madmom RNN onset 검출 (madmom은 내부적으로 파일 로드)
    onset_times = _madmom_bass_onsets(path)

    # 동일 파일 로드 → 세그먼트별 피치/에너지 계산
    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load
    duration = len(y) / sr
    y_band = _bandpass(y, float(sr), BAND_LOW_HZ, BAND_HIGH_HZ, BAND_ORDER)
    envelope = np.abs(hilbert(y_band))

    # Track B: superflux activation (peak picking 없음)
    superflux_activation = _madmom_superflux_activation(path)

    segments = _onset_times_to_segments(
        onset_times,
        duration,
        min_dur_sec=MIN_NOTE_DURATION_SEC,
        max_dur_sec=MAX_NOTE_DURATION_SEC,
    )
    notes = _segments_to_notes(
        segments,
        y,
        y_band,
        envelope,
        sr,
        superflux_activation=superflux_activation,
        duration_sec=duration,
    )
    notes = [n for n in notes if n.get("energy_mean", 0.0) >= ENERGY_MEAN_MIN]
    groove_curve = _compute_groove_curve(notes, duration)
    return build_bass_output(notes, groove_curve=groove_curve)
