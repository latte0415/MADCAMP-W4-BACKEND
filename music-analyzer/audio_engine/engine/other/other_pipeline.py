"""
Other 스템: 리듬(onset density 곡선) + 패드(RMS 기반 유지 구간) 추출.
리듬적: window 내 onset density → other_curve.
패드: RMS + 구간 병합 → other_regions (반투명 밴드용).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np

# -----------------------------------------------------------------------------
# 상수
# -----------------------------------------------------------------------------
HOP_LENGTH = 512
WINDOW_SEC = 0.5          # density window
MIN_REGION_SEC = 0.3      # 패드 최소 구간
RMS_PERCENTILE = 25       # 이 백분위 이상 = 유지 구간 후보
RMS_HOP = 512


def _onset_density_curve(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """onset_detect → window별 onset 개수(density). 반환: times (window 중심), density (0~1 정규화)."""
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
    onset_times = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=HOP_LENGTH,
        backtrack=True,
        units="time",
    )
    onset_times = np.asarray(onset_times)
    if onset_times.ndim > 1:
        onset_times = onset_times.flatten()
    # 공통 그리드: WINDOW_SEC 간격
    duration = len(y) / sr
    n_windows = max(1, int(duration / WINDOW_SEC))
    times = np.linspace(WINDOW_SEC / 2, duration - WINDOW_SEC / 2, n_windows, endpoint=True)
    density = np.zeros(n_windows)
    for i, t_center in enumerate(times):
        lo = max(0.0, t_center - WINDOW_SEC / 2)
        hi = min(duration, t_center + WINDOW_SEC / 2)
        count = np.sum((onset_times >= lo) & (onset_times < hi))
        density[i] = float(count)
    if np.max(density) > np.min(density):
        density = (density - np.min(density)) / (np.max(density) - np.min(density))
    return times, density


def _rms_regions(y: np.ndarray, sr: int) -> list[dict[str, Any]]:
    """RMS 기반 유지 구간: RMS가 하위 백분위 이상인 연속 구간을 병합 → other_regions."""
    rms = librosa.feature.rms(y=y, hop_length=RMS_HOP)[0]
    times = librosa.times_like(rms, sr=sr, hop_length=RMS_HOP)
    th = np.percentile(rms, RMS_PERCENTILE)
    above = rms >= th
    # 연속 True 구간
    regions: list[dict[str, Any]] = []
    i = 0
    while i < len(above):
        if not above[i]:
            i += 1
            continue
        start_t = times[i]
        start_i = i
        while i < len(above) and above[i]:
            i += 1
        end_i = i - 1
        end_t = times[end_i] if end_i >= 0 else start_t
        dur = end_t - start_t
        if dur >= MIN_REGION_SEC:
            intensity = float(np.mean(rms[start_i : end_i + 1]))
            regions.append({
                "start": round(start_t, 4),
                "end": round(end_t, 4),
                "intensity": round(intensity, 4),
            })
        i += 1
    return regions


def run_other_pipeline(other_wav_path: Path | str, sr: int | None = None) -> dict[str, Any]:
    """
    other.wav 한 파일에 대해 리듬 density 곡선 + 패드 영역 추출.

    Returns:
        {
          "other_curve": [{ t, density }, ...],
          "other_keypoints": [] (선택, 리듬 peak 시점 등),
          "other_regions": [{ start, end, intensity }, ...],
          "other_meta": {},
        }
    """
    path = Path(other_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"other wav 없음: {path}")
    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load

    times, density = _onset_density_curve(y, sr)
    other_curve: list[dict[str, Any]] = []
    for i in range(len(times)):
        other_curve.append({
            "t": round(float(times[i]), 4),
            "density": round(float(density[i]), 4),
        })

    regions = _rms_regions(y, sr)

    return {
        "other_curve": other_curve,
        "other_keypoints": [],
        "other_regions": regions,
        "other_meta": {},
    }
