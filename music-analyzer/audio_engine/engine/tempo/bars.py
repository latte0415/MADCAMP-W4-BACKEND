"""
BPM 기준 마디(measure) 경계 생성.
"""
from __future__ import annotations

import numpy as np

from audio_engine.engine.tempo.constants import BEATS_PER_BAR


def bars_from_bpm(
    bpm: float,
    duration_sec: float,
    *,
    first_beat_time: float = 0.0,
    beats_per_bar: int = BEATS_PER_BAR,
) -> list[dict]:
    """
    BPM과 구간 길이로 마디 경계 리스트 생성.
    4/4 기준: 한 마디 = 4비트 = 4 * (60/bpm) 초.

    Args:
        bpm: 분당 비트 수.
        duration_sec: 오디오 길이(초).
        first_beat_time: 첫 번째 비트(1박) 시각(초). 0이면 0초가 1박.
        beats_per_bar: 한 마디당 비트 수 (기본 4).

    Returns:
        [{"bar": 0, "start": 0.0, "end": ...}, ...]
    """
    if bpm <= 0:
        return []
    beat_duration = 60.0 / bpm
    bar_duration = beat_duration * beats_per_bar

    bars = []
    t = first_beat_time
    bar_index = 0
    while t < duration_sec:
        end = min(t + bar_duration, duration_sec)
        bars.append({
            "bar": bar_index,
            "start": round(float(t), 4),
            "end": round(float(end), 4),
        })
        bar_index += 1
        t += bar_duration
    return bars


def bars_from_beat_times(
    beat_times: np.ndarray,
    duration_sec: float,
    *,
    beats_per_bar: int = BEATS_PER_BAR,
) -> list[dict]:
    """
    비트 시각 배열에서 마디 경계 추출.
    beat_times[0]을 1박으로 보고, beats_per_bar마다 새 마디 시작.

    Returns:
        [{"bar": 0, "start": ..., "end": ...}, ...]
    """
    if len(beat_times) < beats_per_bar:
        # 비트가 부족하면 BPM 추정 불가; 빈 리스트 또는 0~duration 한 마디
        return [{"bar": 0, "start": 0.0, "end": round(float(duration_sec), 4)}]

    bars = []
    for i in range(0, len(beat_times), beats_per_bar):
        start = float(beat_times[i])
        if start >= duration_sec:
            break
        end_idx = min(i + beats_per_bar, len(beat_times))
        if end_idx < len(beat_times):
            end = float(beat_times[end_idx])
        else:
            end = duration_sec
        end = min(end, duration_sec)
        bars.append({
            "bar": len(bars),
            "start": round(start, 4),
            "end": round(end, 4),
        })
    return bars
