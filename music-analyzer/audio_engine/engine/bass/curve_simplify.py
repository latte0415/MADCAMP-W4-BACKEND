"""
곡선 단순화 (Ramer–Douglas–Peucker).
pitch 축을 semitone 단위로 두고 epsilon도 semitone 기준.
"""
from __future__ import annotations

import numpy as np

from audio_engine.engine.bass.constants import RDP_EPSILON_SEMITONE
from audio_engine.engine.utils import hz_to_midi


def _point_to_line_dist_semitone(
    t0: float, p0: float,
    t1: float, p1: float,
    tq: float, pq: float,
) -> float:
    """점 (tq, pq)와 선분 (t0,p0)-(t1,p1) 사이의 semitone 거리. p는 이미 MIDI."""
    if t1 <= t0:
        return abs(pq - p0)
    # 선분 위 투영
    u = (tq - t0) / (t1 - t0)
    u = max(0.0, min(1.0, u))
    p_line = p0 + u * (p1 - p0)
    return abs(pq - p_line)


def _rdp_semitone(
    times: np.ndarray,
    pitch_midi: np.ndarray,
    epsilon_semitone: float,
    start: int,
    end: int,
    keep: list[int],
) -> None:
    """RDP: semitone 거리 기준. keep에 유지할 인덱스 추가."""
    if end <= start + 1:
        if start not in keep:
            keep.append(start)
        if end != start and end not in keep:
            keep.append(end)
        return
    t0, p0 = times[start], pitch_midi[start]
    t1, p1 = times[end], pitch_midi[end]
    if not np.isfinite(p0):
        p0 = np.nanmean(pitch_midi[start:end + 1])
    if not np.isfinite(p1):
        p1 = np.nanmean(pitch_midi[start:end + 1])
    max_d = 0.0
    max_i = start
    for i in range(start + 1, end):
        if not np.isfinite(pitch_midi[i]):
            continue
        d = _point_to_line_dist_semitone(
            t0, p0, t1, p1,
            times[i], pitch_midi[i],
        )
        if d > max_d:
            max_d = d
            max_i = i
    if max_d <= epsilon_semitone:
        if start not in keep:
            keep.append(start)
        if end not in keep:
            keep.append(end)
        return
    _rdp_semitone(times, pitch_midi, epsilon_semitone, start, max_i, keep)
    _rdp_semitone(times, pitch_midi, epsilon_semitone, max_i, end, keep)


def simplify_curve_rdp(
    times: np.ndarray,
    pitch_hz: np.ndarray,
    *,
    epsilon_semitone: float = RDP_EPSILON_SEMITONE,
) -> tuple[np.ndarray, np.ndarray]:
    """
    RDP로 (time, pitch) 곡선 단순화. pitch는 Hz 입력 → 내부에서 MIDI로 변환해 epsilon(semitone) 적용.

    Returns:
        times_simple: 유지된 시간 배열
        pitch_hz_simple: 유지된 pitch (Hz)
    """
    valid = np.isfinite(pitch_hz) & (pitch_hz > 0)
    if np.sum(valid) < 2:
        return times.copy(), pitch_hz.copy()
    pitch_midi = np.array([hz_to_midi(float(p)) if v else np.nan for p, v in zip(pitch_hz, valid)])
    # 유효한 구간만 사용 (연속된 구간에서 RDP)
    n = len(times)
    keep: list[int] = []
    _rdp_semitone(times, pitch_midi, epsilon_semitone, 0, n - 1, keep)
    keep = sorted(set(keep))
    t_out = times[keep]
    p_out = pitch_hz[keep]
    return t_out, p_out
