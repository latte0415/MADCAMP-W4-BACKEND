"""
쉐이커/클랩 스트림 Temporal Pooling.
high-density mid/high 스트림의 과다 이벤트를 '질감 블록' 단위로 압축.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from audio_engine.engine.onset.constants import (
    POOL_WINDOW_SEC,
    POOL_DENSITY_THRESHOLD,
    MIN_IOI_SEC,
)


def _temporal_pool_events(
    times: np.ndarray,
    strengths: np.ndarray | None,
    window_sec: float,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Sliding window로 여러 onset을 하나의 대표 이벤트로 압축.
    대표 시간: 에너지 가중 평균 (또는 단순 평균)
    대표 strength: max

    Returns:
        (pooled_times, pooled_strengths)
    """
    if len(times) == 0:
        return np.array([]), np.array([])
    times = np.asarray(times, dtype=float)
    if strengths is None or len(strengths) != len(times):
        strengths = np.ones(len(times))
    strengths = np.asarray(strengths, dtype=float)

    pooled_t: list[float] = []
    pooled_s: list[float] = []
    i = 0
    while i < len(times):
        t0 = times[i]
        cluster = [i]
        j = i + 1
        while j < len(times) and times[j] - t0 <= window_sec:
            cluster.append(j)
            j += 1
        t_cluster = times[cluster]
        s_cluster = strengths[cluster]
        if np.sum(s_cluster) > 1e-12:
            t_rep = float(np.average(t_cluster, weights=s_cluster))
        else:
            t_rep = float(np.mean(t_cluster))
        s_rep = float(np.max(s_cluster))
        pooled_t.append(t_rep)
        pooled_s.append(s_rep)
        i = j
    return np.array(pooled_t), np.array(pooled_s)


def simplify_shaker_clap_streams(
    streams: list[dict[str, Any]],
    *,
    window_sec: float = POOL_WINDOW_SEC,
    density_threshold: float = POOL_DENSITY_THRESHOLD,
    bands: tuple[str, ...] = ("mid", "high"),
) -> list[dict[str, Any]]:
    """
    high-density mid/high 스트림에 temporal pooling 적용.
    킥/스네어(low)는 절대 적용하지 않음.

    Returns:
        수정된 streams (in-place 수정 후 동일 리스트 반환)
    """
    for s in streams:
        band = s.get("band", "")
        if band not in bands:
            continue
        density = s.get("density") or 0
        if density < density_threshold:
            continue
        ev = s.get("events") or []
        if len(ev) < 4:
            continue
        st = s.get("strengths")
        if st is not None and len(st) != len(ev):
            st = None
        pooled_t, pooled_s = _temporal_pool_events(
            np.array(ev), np.array(st) if st else None, window_sec
        )
        if len(pooled_t) >= len(ev):
            continue
        s["events"] = pooled_t.tolist()
        s["strengths"] = pooled_s.tolist()
        s["start"] = float(pooled_t[0])
        s["end"] = float(pooled_t[-1])
        dur = s["end"] - s["start"]
        s["density"] = round(len(pooled_t) / dur, 4) if dur > 0 else 0
        s["strength_median"] = round(float(np.median(pooled_s)), 4)
        if len(pooled_t) >= 2:
            dts = np.diff(pooled_t)
            dts = dts[dts >= MIN_IOI_SEC]
            s["median_ioi"] = round(float(np.median(dts)), 4) if len(dts) else 0
            s["ioi_std"] = round(float(np.std(dts)), 4) if len(dts) > 1 else 0
        else:
            s["median_ioi"] = 0
            s["ioi_std"] = 0
    return streams
