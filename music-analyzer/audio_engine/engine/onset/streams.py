"""
스트림 생성: band별 onset 시퀀스를 IOI·시간 연속성 기준으로 리듬 스트림으로 묶음.
dt_s = t_i - stream.last_event_time 기준 적합도로 활성 스트림에 할당.
"""
from __future__ import annotations

from collections import deque
from typing import Any

import numpy as np

from audio_engine.engine.onset.constants import (
    GAP_BREAK_FACTOR,
    IOI_MIN_SEC,
    IOI_TOLERANCE_RATIO,
    MIN_EVENTS_PER_STREAM,
    MIN_SEPARATION_SEC,
    MIN_STREAM_DURATION_SEC,
    STREAM_CONSECUTIVE_MISSES_FOR_BREAK,
    STREAM_RUNNING_IOI_WINDOW,
)


def _refine_band_events(
    times: np.ndarray,
    strengths: np.ndarray | None,
    min_separation_sec: float,
    strength_floor: float,
) -> tuple[np.ndarray, np.ndarray]:
    """min_separation_sec 적용: 너무 가까운 onset 하나만 유지. strength_floor 미만 제거(선택)."""
    if len(times) == 0:
        return times, np.array([]) if strengths is None else strengths
    order = np.argsort(times)
    times = np.asarray(times)[order]
    if strengths is not None:
        strengths = np.asarray(strengths)[order]
    keep = [0]
    for i in range(1, len(times)):
        if times[i] - times[keep[-1]] >= min_separation_sec:
            if strength_floor <= 0 or (strengths is not None and strengths[i] >= strength_floor):
                keep.append(i)
        # else: skip (too close; keep previous)
    out_times = times[keep]
    out_strengths = np.asarray(strengths)[keep] if strengths is not None else np.array([])
    return out_times, out_strengths


def _running_median_ioi(dt_deque: deque) -> float | None:
    if len(dt_deque) == 0:
        return None
    arr = np.array(dt_deque)
    return float(np.median(arr))


def build_streams(
    band_onsets: dict[str, np.ndarray],
    band_strengths: dict[str, np.ndarray] | None = None,
    *,
    min_separation_sec: float = MIN_SEPARATION_SEC,
    strength_floor: float = 0.0,
    ioi_min_sec: float = IOI_MIN_SEC,
    gap_break_factor: float = GAP_BREAK_FACTOR,
    ioi_tolerance_ratio: float = IOI_TOLERANCE_RATIO,
    min_events_per_stream: int = MIN_EVENTS_PER_STREAM,
    min_stream_duration: float = MIN_STREAM_DURATION_SEC,
    consecutive_misses_for_break: int = STREAM_CONSECUTIVE_MISSES_FOR_BREAK,
    running_ioi_window: int = STREAM_RUNNING_IOI_WINDOW,
) -> list[dict[str, Any]]:
    """
    band별 onset 시퀀스 → 스트림 목록.
    dt_s = t_i - stream.last_event_time 기준으로 각 활성 스트림과 적합도 계산 후 가장 좋은 스트림에 할당.
    """
    band_names = [b for b in ("low", "mid", "high") if b in band_onsets]
    if not band_names:
        return []

    all_streams: list[dict[str, Any]] = []
    stream_id_counter: dict[str, int] = {}

    for band in band_names:
        times = np.asarray(band_onsets[band], dtype=float)
        strengths = None
        if band_strengths and band in band_strengths:
            strengths = np.asarray(band_strengths[band], dtype=float)
            if len(strengths) != len(times):
                strengths = None
        times, strengths = _refine_band_events(
            times, strengths, min_separation_sec, strength_floor
        )
        if len(times) == 0:
            continue

        # Active stream state: events, last_event_time, running_ioi_deque, median_ioi, consecutive_misses
        class ActiveStream:
            def __init__(self, first_t: float, first_strength: float = 0.0):
                self.events: list[float] = [first_t]
                self.strengths: list[float] = [first_strength]
                self.last_event_time = first_t
                self.ioi_deque: deque = deque(maxlen=running_ioi_window)
                self.median_ioi: float | None = None
                self.consecutive_misses = 0

            def try_append(self, t_i: float, strength_i: float) -> tuple[bool, float]:
                """(fits, score). score = |dt_s - m|/m, smaller is better. Fits if within tolerance and not gap."""
                dt_s = t_i - self.last_event_time
                if dt_s <= 0:
                    return False, float("inf")
                m = self.median_ioi
                if m is None:
                    return True, 0.0
                if dt_s > gap_break_factor * m:
                    return False, float("inf")
                dev = abs(dt_s - m)
                if dev > 2 * ioi_tolerance_ratio * m:
                    return False, dev / m
                if dev <= ioi_tolerance_ratio * m:
                    return True, dev / m
                return False, dev / m

            def append(self, t_i: float, strength_i: float) -> None:
                dt_s = t_i - self.last_event_time
                self.events.append(t_i)
                self.strengths.append(strength_i)
                self.last_event_time = t_i
                if dt_s >= ioi_min_sec:
                    self.ioi_deque.append(dt_s)
                self.median_ioi = _running_median_ioi(self.ioi_deque)
                self.consecutive_misses = 0

            def record_miss(self) -> None:
                self.consecutive_misses += 1

            def to_final(self, sid: str) -> dict[str, Any]:
                ev = self.events
                if len(ev) < 2:
                    ioi_std = 0.0
                    median_ioi = 0.0
                else:
                    dts = np.diff(ev)
                    dts = dts[dts >= ioi_min_sec]
                    median_ioi = float(np.median(dts)) if len(dts) else 0.0
                    ioi_std = float(np.std(dts)) if len(dts) > 1 else 0.0
                duration = ev[-1] - ev[0] if len(ev) >= 2 else 0.0
                density = len(ev) / duration if duration > 0 else 0.0
                str_med = float(np.median(self.strengths)) if self.strengths else 0.0
                return {
                    "id": sid,
                    "band": band,
                    "start": ev[0],
                    "end": ev[-1],
                    "events": ev,
                    "strengths": self.strengths,
                    "median_ioi": round(median_ioi, 4),
                    "ioi_std": round(ioi_std, 4),
                    "density": round(density, 4),
                    "strength_median": round(str_med, 4),
                    "accents": [],
                }

        active: list[ActiveStream] = []
        finished: list[ActiveStream] = []

        for idx in range(len(times)):
            t_i = float(times[idx])
            strength_i = float(strengths[idx]) if strengths is not None and len(strengths) > idx else 0.0

            # Inactivate streams that have been silent too long (gap)
            still_active = []
            for s in active:
                dt_s = t_i - s.last_event_time
                m = s.median_ioi
                if m is not None and dt_s > gap_break_factor * m:
                    finished.append(s)
                else:
                    still_active.append(s)
            active = still_active

            best_stream: ActiveStream | None = None
            best_score = float("inf")
            best_soft_stream: ActiveStream | None = None
            best_soft_score = float("inf")
            for s in active:
                fits, score = s.try_append(t_i, strength_i)
                if fits and score < best_score:
                    best_score = score
                    best_stream = s
                elif not fits and score != float("inf"):
                    s.record_miss()
                    if score < best_soft_score:
                        best_soft_score = score
                        best_soft_stream = s

            # Close streams that have consecutive_misses >= consecutive_misses_for_break
            still_active = []
            for s in active:
                if s.consecutive_misses >= consecutive_misses_for_break:
                    finished.append(s)
                else:
                    still_active.append(s)
            active = still_active
            if best_stream is not None and best_stream not in active:
                best_stream = None
            if best_soft_stream is not None and best_soft_stream not in active:
                best_soft_stream = None

            # fits인 스트림이 없으면, 2*tolerance 이내인 스트림 중 가장 좋은 것에 할당(파편화 감소)
            if best_stream is None and best_soft_stream is not None:
                best_stream = best_soft_stream

            if best_stream is not None:
                best_stream.append(t_i, strength_i)
            else:
                new_s = ActiveStream(t_i, strength_i)
                active.append(new_s)

        for s in active:
            finished.append(s)

        # Deferred drop: only drop if events < min_events AND duration < min_stream_duration
        for s in finished:
            n_ev = len(s.events)
            duration = s.events[-1] - s.events[0] if n_ev >= 2 else 0.0
            if n_ev < min_events_per_stream and duration < min_stream_duration:
                continue
            sid = f"{band}_{stream_id_counter.get(band, 0)}"
            stream_id_counter[band] = stream_id_counter.get(band, 0) + 1
            all_streams.append(s.to_final(sid))

    return all_streams
