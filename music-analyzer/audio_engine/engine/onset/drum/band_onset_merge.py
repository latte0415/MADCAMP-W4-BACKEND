"""
mid/high 대역 쉐이커·클랩 과검출 억제용 병합 단계.
min_separation_sec 내에 있는 onset들을 하나로 합침. strength가 가장 높은 시점을 대표로 사용.
클랩/쉐이커만 남기기: 트랜지언트(어택 후/전 에너지 비율) 필터.
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import numpy as np

from audio_engine.engine.onset.constants import (
    MERGE_CLOSE_SEC_LOW,
    MERGE_CLOSE_SEC_MID,
    MERGE_CLOSE_SEC_HIGH,
    STRENGTH_FLOOR_BAND_ONSET,
    CLAP_SHAKER_TRANSIENT_WINDOW_SEC,
    CLAP_SHAKER_TRANSIENT_RATIO_MIN,
)


def filter_by_strength(
    times: np.ndarray,
    strengths: np.ndarray,
    strength_floor: float,
) -> tuple[np.ndarray, np.ndarray]:
    """
    strength_floor 미만인 onset 제거.
    Returns:
        (filtered_times, filtered_strengths)
    """
    if strength_floor <= 0 or len(times) == 0:
        return times.copy(), strengths.copy() if len(strengths) == len(times) else np.array([])
    if len(strengths) != len(times):
        strengths = np.zeros(len(times))
    mask = np.asarray(strengths, dtype=float) >= strength_floor
    return times[mask].copy(), np.asarray(strengths, dtype=float)[mask]


def merge_close_onsets(
    times: np.ndarray,
    strengths: np.ndarray,
    min_separation_sec: float,
    *,
    keep: Literal["strongest", "first"] = "strongest",
) -> tuple[np.ndarray, np.ndarray]:
    """
    min_separation_sec 내에 있는 onset들을 하나로 병합.
    체인 클러스터링: 각 onset은 직전 onset과의 간격만 검사하여, 연속된 근접 피크(쉐이커/클랩 롤)를 한 덩어리로 묶음.

    keep="strongest": 클러스터 내 strength 최대인 onset 시점·strength 사용
    keep="first": 클러스터 내 첫 onset 시점, 해당 strength 사용

    Returns:
        (merged_times, merged_strengths)
    """
    if len(times) == 0:
        return times.copy(), strengths.copy() if len(strengths) else np.array([])
    order = np.argsort(times)
    times = np.asarray(times, dtype=float)[order]
    if len(strengths) == len(times):
        strengths = np.asarray(strengths, dtype=float)[order]
    else:
        strengths = np.zeros(len(times))

    merged_t: list[float] = []
    merged_s: list[float] = []
    i = 0
    while i < len(times):
        cluster = [i]
        j = i + 1
        # 체인 클러스터링: 이전 onset과의 간격만 검사 (쉐이커/롤처럼 연속된 피크를 한 덩어리로)
        while j < len(times) and times[j] - times[cluster[-1]] <= min_separation_sec:
            cluster.append(j)
            j += 1
        if keep == "strongest":
            best = max(cluster, key=lambda k: strengths[k])
            merged_t.append(float(times[best]))
            merged_s.append(float(strengths[best]))
        else:
            merged_t.append(float(times[cluster[0]]))
            merged_s.append(float(strengths[cluster[0]]))
        i = j
    return np.array(merged_t), np.array(merged_s)


def merge_close_band_onsets(
    band_onsets: dict[str, np.ndarray],
    band_strengths: dict[str, np.ndarray],
    *,
    low_sec: float = MERGE_CLOSE_SEC_LOW,
    mid_sec: float = MERGE_CLOSE_SEC_MID,
    high_sec: float = MERGE_CLOSE_SEC_HIGH,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """
    band별로 가까운 onset 병합. mid/high는 더 넓은 윈도우로 쉐이커·클랩 과검출 억제.

    Returns:
        (merged_band_onsets, merged_band_strengths)
    """
    sec_per_band = {"low": low_sec, "mid": mid_sec, "high": high_sec}
    out_onsets: dict[str, np.ndarray] = {}
    out_strengths: dict[str, np.ndarray] = {}
    for band in ("low", "mid", "high"):
        if band not in band_onsets:
            continue
        times = band_onsets[band]
        strengths = band_strengths.get(band)
        if strengths is None or len(strengths) != len(times):
            strengths = np.zeros(len(times))
        merged_t, merged_s = merge_close_onsets(
            times,
            strengths,
            sec_per_band[band],
            keep="strongest",
        )
        out_onsets[band] = merged_t
        out_strengths[band] = merged_s
    return out_onsets, out_strengths


def filter_transient_mid_high(
    band_onsets: dict[str, np.ndarray],
    band_strengths: dict[str, np.ndarray],
    band_audio_paths: dict[str, Path],
    sr: int,
    *,
    window_sec: float = CLAP_SHAKER_TRANSIENT_WINDOW_SEC,
    ratio_min: float = CLAP_SHAKER_TRANSIENT_RATIO_MIN,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """
    mid/high 대역만 트랜지언트(어택) 비율로 필터: 클랩·쉐이커처럼
    어택 후 에너지가 어택 전보다 충분히 큰 onset만 유지. low는 변경 없음.

    band_audio_paths: {"mid": Path, "high": Path} (해당 band만 있으면 됨)
    ratio_min: post_energy / (pre_energy + eps) >= ratio_min 인 onset만 유지.
    """
    import librosa

    out_onsets = dict(band_onsets)
    out_strengths = dict(band_strengths)

    for band in ("mid", "high"):
        if band not in band_onsets or band not in band_audio_paths:
            continue
        times = band_onsets[band]
        strengths = band_strengths.get(band)
        if strengths is None or len(strengths) != len(times):
            strengths = np.ones(len(times))
        if len(times) == 0:
            continue

        y, _ = librosa.load(band_audio_paths[band], sr=sr, mono=True)
        n = len(y)
        w = int(round(window_sec * sr))
        w = max(1, min(w, n // 4))
        eps = 1e-10

        keep_mask = np.ones(len(times), dtype=bool)
        for i, t in enumerate(times):
            c = int(round(t * sr))
            start_pre = max(0, c - w)
            end_pre = c
            start_post = c
            end_post = min(n, c + w)
            seg_pre = y[start_pre:end_pre]
            seg_post = y[start_post:end_post]
            if len(seg_pre) < 2 or len(seg_post) < 2:
                keep_mask[i] = False
                continue
            pre_rms = float(np.sqrt(np.mean(seg_pre ** 2))) + eps
            post_rms = float(np.sqrt(np.mean(seg_post ** 2))) + eps
            if post_rms / pre_rms < ratio_min:
                keep_mask[i] = False

        out_onsets[band] = times[keep_mask].copy()
        out_strengths[band] = np.asarray(strengths, dtype=float)[keep_mask].copy()

    return out_onsets, out_strengths
