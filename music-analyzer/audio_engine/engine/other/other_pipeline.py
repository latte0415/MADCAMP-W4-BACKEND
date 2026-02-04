"""
Other 스템: 멜로디(피치 곡선) + 멜로디 이벤트(키포인트) + 멜로디 활성 구간 추출.
- 멜로디 곡선: harmonic 성분 → f0 추정(pyin / torchcrepe) → pitch curve
- 키포인트: phrase_start / pitch_turn / accent
- regions: voiced 구간 병합 (멜로디 활성 밴드)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np
from scipy.signal import find_peaks, medfilt

# -----------------------------------------------------------------------------
# 상수
# -----------------------------------------------------------------------------
HOP_LENGTH = 256

MELODY_FMIN_HZ = librosa.note_to_hz("C2")
MELODY_FMAX_HZ = librosa.note_to_hz("C7")
MELODY_VOICED_PROB_TH = 0.3
MELODY_HARMONIC_MARGIN = 8.0
PITCH_SMOOTH_SEC = 0.2

PHRASE_MIN_SEC = 0.5
PITCH_TURN_MIN_SEMITONE = 1.0
PITCH_TURN_MIN_DISTANCE_SEC = 0.6
ACCENT_MIN_AMP = 0.45
ACCENT_MIN_DISTANCE_SEC = 0.5
KEYPOINT_MERGE_MIN_DISTANCE_SEC = 0.25

REGION_MIN_SEC = 0.4


# -----------------------------------------------------------------------------
# 유틸
# -----------------------------------------------------------------------------

def _safe_median_filter(values: np.ndarray, kernel: int) -> np.ndarray:
    if kernel <= 1 or len(values) < kernel:
        return values
    if kernel % 2 == 0:
        kernel += 1
    return medfilt(values, kernel_size=kernel)


def _smooth_pitch_by_segments(pitch_midi: np.ndarray, voiced: np.ndarray, sr: int) -> np.ndarray:
    if len(pitch_midi) == 0:
        return pitch_midi
    smooth = pitch_midi.copy()
    kernel = max(1, int(round(PITCH_SMOOTH_SEC * sr / HOP_LENGTH)))
    if kernel % 2 == 0:
        kernel += 1
    i = 0
    while i < len(voiced):
        if not voiced[i]:
            i += 1
            continue
        start = i
        while i < len(voiced) and voiced[i]:
            i += 1
        end = i
        seg = smooth[start:end]
        if len(seg) >= kernel and kernel >= 3:
            smooth[start:end] = _safe_median_filter(seg, kernel)
    return smooth


def _estimate_f0(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray, str]:
    """f0 추정. torchcrepe가 있으면 GPU 우선, 없으면 librosa.pyin 사용."""
    # torchcrepe (optional)
    try:
        import torch  # type: ignore
        import torchcrepe  # type: ignore

        device = "cuda" if torch.cuda.is_available() else "cpu"
        audio = torch.from_numpy(y).float().unsqueeze(0).to(device)
        f0, periodicity = torchcrepe.predict(
            audio,
            sr,
            HOP_LENGTH,
            MELODY_FMIN_HZ,
            MELODY_FMAX_HZ,
            model="full",
            batch_size=1024,
            device=device,
            return_periodicity=True,
        )
        f0_hz = f0.squeeze(0).detach().cpu().numpy()
        periodicity = periodicity.squeeze(0).detach().cpu().numpy()
        voiced = periodicity >= MELODY_VOICED_PROB_TH
        f0_hz = np.where(voiced, f0_hz, np.nan)
        return f0_hz, voiced, "torchcrepe"
    except Exception:
        pass

    # librosa pyin (fallback)
    f0_hz, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=MELODY_FMIN_HZ,
        fmax=MELODY_FMAX_HZ,
        sr=sr,
        hop_length=HOP_LENGTH,
    )
    voiced = (voiced_prob >= MELODY_VOICED_PROB_TH) & voiced_flag
    f0_hz = np.where(voiced, f0_hz, np.nan)
    return f0_hz, voiced, "pyin"


def _extract_melody_curve(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    y_harm = librosa.effects.harmonic(y, margin=MELODY_HARMONIC_MARGIN)
    f0_hz, voiced, source = _estimate_f0(y_harm, sr)
    times = librosa.times_like(f0_hz, sr=sr, hop_length=HOP_LENGTH)

    rms = librosa.feature.rms(y=y_harm, hop_length=HOP_LENGTH)[0]
    if len(rms) == 0:
        rms = np.zeros_like(f0_hz)
    if len(rms) != len(f0_hz):
        n = min(len(rms), len(f0_hz))
        rms = rms[:n]
        f0_hz = f0_hz[:n]
        voiced = voiced[:n]
        times = times[:n]
    amp = rms / (np.max(rms) + 1e-8)

    pitch_midi = librosa.hz_to_midi(f0_hz)
    pitch_midi = np.where(np.isfinite(pitch_midi), pitch_midi, np.nan)
    pitch_midi = _smooth_pitch_by_segments(pitch_midi, voiced, sr)

    meta = {
        "mode": "melody",
        "pitch_unit": "midi",
        "f0_source": source,
        "fmin_hz": MELODY_FMIN_HZ,
        "fmax_hz": MELODY_FMAX_HZ,
        "hop_length": HOP_LENGTH,
    }
    return times, pitch_midi, amp, voiced, meta


def _merge_keypoints(keypoints: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not keypoints:
        return []
    keypoints = sorted(keypoints, key=lambda x: x["t"])
    merged: list[dict[str, Any]] = [keypoints[0]]
    for kp in keypoints[1:]:
        prev = merged[-1]
        if abs(kp["t"] - prev["t"]) < KEYPOINT_MERGE_MIN_DISTANCE_SEC:
            if kp.get("score", 0) > prev.get("score", 0):
                merged[-1] = kp
            continue
        merged.append(kp)
    return merged


def _melody_keypoints(
    times: np.ndarray,
    pitch_midi: np.ndarray,
    amp: np.ndarray,
    voiced: np.ndarray,
) -> list[dict[str, Any]]:
    if len(times) == 0:
        return []

    keypoints: list[dict[str, Any]] = []

    # phrase_start: voiced 구간 시작
    i = 0
    while i < len(voiced):
        if not voiced[i]:
            i += 1
            continue
        start = i
        while i < len(voiced) and voiced[i]:
            i += 1
        end = i - 1
        dur = times[end] - times[start]
        if dur >= PHRASE_MIN_SEC:
            keypoints.append({
                "t": round(float(times[start]), 4),
                "type": "phrase_start",
                "score": round(float(np.mean(amp[start:end + 1])), 4),
            })
    # pitch_turn + accent: voiced 구간 단위로 처리
    dt = (times[1] - times[0]) if len(times) > 1 else 0.02
    pitch_min_dist_frames = max(1, int(round(PITCH_TURN_MIN_DISTANCE_SEC / (dt + 1e-8))))
    accent_min_dist_frames = max(1, int(round(ACCENT_MIN_DISTANCE_SEC / (dt + 1e-8))))

    i = 0
    while i < len(voiced):
        if not voiced[i]:
            i += 1
            continue
        start = i
        while i < len(voiced) and voiced[i]:
            i += 1
        end = i
        seg_pitch = pitch_midi[start:end]
        seg_amp = amp[start:end]

        if len(seg_pitch) >= 3 and np.any(np.isfinite(seg_pitch)):
            peaks, _ = find_peaks(
                seg_pitch,
                distance=pitch_min_dist_frames,
                prominence=PITCH_TURN_MIN_SEMITONE,
            )
            valleys, _ = find_peaks(
                -seg_pitch,
                distance=pitch_min_dist_frames,
                prominence=PITCH_TURN_MIN_SEMITONE,
            )
            for idx in peaks:
                gidx = start + idx
                keypoints.append({
                    "t": round(float(times[gidx]), 4),
                    "type": "pitch_turn",
                    "score": round(float(seg_amp[idx]), 4),
                    "direction": "up_to_down",
                })
            for idx in valleys:
                gidx = start + idx
                keypoints.append({
                    "t": round(float(times[gidx]), 4),
                    "type": "pitch_turn",
                    "score": round(float(seg_amp[idx]), 4),
                    "direction": "down_to_up",
                })

        if len(seg_amp) >= 3:
            amp_peaks, _ = find_peaks(
                seg_amp,
                height=ACCENT_MIN_AMP,
                distance=accent_min_dist_frames,
            )
            for idx in amp_peaks:
                gidx = start + idx
                keypoints.append({
                    "t": round(float(times[gidx]), 4),
                    "type": "accent",
                    "score": round(float(seg_amp[idx]), 4),
                })

    return _merge_keypoints(keypoints)


def _melody_regions(
    times: np.ndarray,
    pitch_midi: np.ndarray,
    amp: np.ndarray,
    voiced: np.ndarray,
) -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []
    i = 0
    while i < len(voiced):
        if not voiced[i]:
            i += 1
            continue
        start = i
        while i < len(voiced) and voiced[i]:
            i += 1
        end = i - 1
        start_t = float(times[start])
        end_t = float(times[end])
        if end_t - start_t < REGION_MIN_SEC:
            continue
        seg_pitch = pitch_midi[start:end + 1]
        seg_pitch = seg_pitch[np.isfinite(seg_pitch)]
        pitch_mean = float(np.mean(seg_pitch)) if len(seg_pitch) else 0.0
        intensity = float(np.mean(amp[start:end + 1]))
        regions.append({
            "start": round(start_t, 4),
            "end": round(end_t, 4),
            "intensity": round(intensity, 4),
            "pitch_mean": round(pitch_mean, 2),
        })
    return regions


# -----------------------------------------------------------------------------
# 엔트리
# -----------------------------------------------------------------------------

def run_other_pipeline(other_wav_path: Path | str, sr: int | None = None) -> dict[str, Any]:
    """
    other.wav 한 파일에 대해 멜로디 곡선 + 키포인트 + 멜로디 활성 영역 추출.

    Returns:
        {
          "other_curve": [{ t, pitch, amp, voiced }, ...],
          "other_keypoints": [{ t, type, score, ... }, ...],
          "other_regions": [{ start, end, intensity, pitch_mean }, ...],
          "other_meta": {...},
        }
    """
    path = Path(other_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"other wav 없음: {path}")
    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load

    times, pitch_midi, amp, voiced, meta = _extract_melody_curve(y, sr)
    other_curve: list[dict[str, Any]] = []
    for i in range(len(times)):
        p = pitch_midi[i]
        other_curve.append({
            "t": round(float(times[i]), 4),
            "pitch": None if not np.isfinite(p) else round(float(p), 3),
            "amp": round(float(amp[i]), 4),
            "voiced": bool(voiced[i]),
        })

    keypoints = _melody_keypoints(times, pitch_midi, amp, voiced)
    regions = _melody_regions(times, pitch_midi, amp, voiced)

    return {
        "other_curve": other_curve,
        "other_keypoints": keypoints,
        "other_regions": regions,
        "other_meta": meta,
    }
