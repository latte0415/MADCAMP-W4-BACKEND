"""
mid/high 대역 burst → block 압축.
연속 onset 간 IOI < burst_ioi_sec 가 K개 이상 지속되면 burst로 묶어 하나의 texture block으로 출력.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from audio_engine.engine.onset.constants import (
    BURST_IOI_SEC,
    MIN_ONSETS_IN_BURST,
)


def merge_texture_blocks_by_band(
    band_onset_times: dict[str, np.ndarray],
    band_strengths: dict[str, np.ndarray],
    *,
    burst_ioi_sec: float = BURST_IOI_SEC,
    min_onsets_in_burst: int = MIN_ONSETS_IN_BURST,
    bands: tuple[str, ...] = ("mid", "high"),
) -> dict[str, list[dict[str, Any]]]:
    """
    mid/high band onset 시퀀스에서 burst 구간을 찾아 block으로 압축.

    Burst: 연속 (K-1)개 IOI가 모두 < burst_ioi_sec 이면 onset K개가 한 burst.
    Block: start, end, representative_time(strength 가중 평균), intensity(max), density, count.

    Returns:
        texture_blocks_by_band: {"mid": [{start, end, representative_time, intensity, density, count}, ...], "high": [...]}
    """
    out: dict[str, list[dict[str, Any]]] = {}
    for band in bands:
        if band not in band_onset_times:
            out[band] = []
            continue
        times = np.asarray(band_onset_times[band], dtype=float)
        strengths = band_strengths.get(band)
        if strengths is None or len(strengths) != len(times):
            strengths = np.ones(len(times))
        strengths = np.asarray(strengths, dtype=float)
        if len(times) < min_onsets_in_burst:
            out[band] = []
            continue
        order = np.argsort(times)
        times = times[order]
        strengths = strengths[order]
        blocks: list[dict[str, Any]] = []
        i = 0
        while i < len(times):
            run_start = i
            run_end = i + 1
            j = i + 1
            while j < len(times):
                if times[j] - times[j - 1] < burst_ioi_sec:
                    run_end = j + 1
                    j += 1
                else:
                    break
            n_run = run_end - run_start
            if n_run >= min_onsets_in_burst:
                t_run = times[run_start:run_end]
                s_run = strengths[run_start:run_end]
                start = float(t_run[0])
                end = float(t_run[-1])
                dur = end - start
                if np.sum(s_run) > 1e-12:
                    rep_time = float(np.average(t_run, weights=s_run))
                else:
                    rep_time = float(np.mean(t_run))
                intensity = float(np.max(s_run))
                density = n_run / dur if dur > 0 else 0.0
                blocks.append({
                    "start": round(start, 4),
                    "end": round(end, 4),
                    "representative_time": round(rep_time, 4),
                    "intensity": round(intensity, 4),
                    "density": round(density, 4),
                    "count": n_run,
                })
            i = run_end
        out[band] = blocks
    return out
