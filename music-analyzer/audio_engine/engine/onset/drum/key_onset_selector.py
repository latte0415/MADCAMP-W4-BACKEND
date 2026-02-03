"""
대역별 핵심 타격(key onsets) 선택.
에너지/ODF strength 상위 percentile + min_sep 억제로 keypoints_by_band 생성.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from audio_engine.engine.onset.drum.band_onset_merge import merge_close_onsets
from audio_engine.engine.onset.constants import (
    KEY_ONSET_MIN_SEP_SEC,
    ENERGY_PERCENTILE_THRESHOLD,
    ENERGY_PERCENTILE_THRESHOLD_LOW,
    ENERGY_PERCENTILE_THRESHOLD_MID_HIGH,
)
from audio_engine.engine.onset.drum.drum_band_energy import compute_band_onset_energies
from audio_engine.engine.onset.features.clarity import compute_clarity_scores_for_times


def select_key_onsets_by_band(
    band_onset_times: dict[str, np.ndarray],
    band_strengths: dict[str, np.ndarray],
    duration: float,
    sr: int,
    *,
    band_audio_paths: dict[str, Path] | None = None,
    energy_percentile_threshold: float = ENERGY_PERCENTILE_THRESHOLD,
    energy_percentile_threshold_low: float = ENERGY_PERCENTILE_THRESHOLD_LOW,
    energy_percentile_threshold_mid_high: float = ENERGY_PERCENTILE_THRESHOLD_MID_HIGH,
    min_sep_sec: float = KEY_ONSET_MIN_SEP_SEC,
    use_clarity: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    """
    각 band에서 "크게 들리는" onset만 남겨 keypoints_by_band 생성.

    1차 게이트: energy_score(또는 strength) >= percentile threshold.
    2차 억제: min_sep_sec 내 중복은 가장 강한 1개만 유지.
    3차(선택): use_clarity=True이고 band_audio_paths 있으면 clarity 낮은 것 제외.

    Returns:
        keypoints_by_band: {"low": [{"time": float, "score": float}, ...], "mid": ..., "high": ...}
    """
    import librosa

    keypoints_by_band: dict[str, list[dict[str, Any]]] = {}
    for band in ("low", "mid", "high"):
        if band not in band_onset_times:
            continue
        times = np.asarray(band_onset_times[band], dtype=float)
        strengths = band_strengths.get(band)
        if strengths is None or len(strengths) != len(times):
            strengths = np.ones(len(times))
        strengths = np.asarray(strengths, dtype=float)
        if len(times) == 0:
            keypoints_by_band[band] = []
            continue

        # 1차: 스코어 결정 (band wav 있으면 에너지, 없으면 ODF strength)
        if band_audio_paths and band in band_audio_paths:
            path = band_audio_paths[band]
            if path.exists():
                scores = compute_band_onset_energies(times, path, sr, duration)
            else:
                scores = strengths.copy()
        else:
            scores = strengths.copy()
        if len(scores) != len(times):
            scores = strengths.copy()

        # 1차 게이트: percentile 이상만 유지 (low 관대, mid/high는 진폭 기준 더 걸러 고스트 제거)
        if band == "low":
            pct = energy_percentile_threshold_low
        elif band in ("mid", "high"):
            pct = energy_percentile_threshold_mid_high
        else:
            pct = energy_percentile_threshold
        th = np.percentile(scores, pct)
        mask = scores >= th
        if np.sum(mask) == 0:
            mask = np.ones(len(times), dtype=bool)
        t_gate = times[mask]
        s_gate = scores[mask]

        # 3차(선택): clarity 낮은 것 제외
        if use_clarity and band_audio_paths and band in band_audio_paths:
            path = band_audio_paths[band]
            if path.exists() and len(t_gate) > 0:
                y, _ = librosa.load(str(path), sr=sr, mono=True)
                clarity = compute_clarity_scores_for_times(y, t_gate, s_gate, sr)
                clarity_th = np.percentile(clarity, 25)
                keep = clarity >= clarity_th
                t_gate = t_gate[keep]
                s_gate = s_gate[keep]

        # 2차: min_sep 내 중복은 가장 강한 1개만
        t_out, s_out = merge_close_onsets(
            t_gate, s_gate, min_sep_sec, keep="strongest"
        )
        keypoints_by_band[band] = [
            {"time": round(float(t), 4), "score": round(float(s), 4)}
            for t, s in zip(t_out, s_out)
        ]
    return keypoints_by_band
