"""
섹션(파트) 구분: 윈도우별 스트림 상태 벡터 V_k를 만들고, 벡터 변화점에서 파트 경계 탐지.
V_k에 band_presence_mask / dominant_band 포함으로 드럼 브레이크·하이햇 드롭·킥 온오프 구분.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from audio_engine.engine.onset.constants import (
    MIN_SECTION_SEC,
    SECTION_ACTIVE_THRESHOLD,
    SECTION_CHANGE_THRESHOLD,
    SECTION_DEBOUNCE_WINDOWS,
    SECTION_HOP_SEC,
    SECTION_MERGE_NEAR_SEC,
    SECTION_WINDOW_SEC,
)


def _vector_from_streams_in_window(
    streams: list[dict],
    window_start: float,
    window_end: float,
    active_threshold: int,
) -> dict[str, float | int]:
    """한 윈도우 [window_start, window_end]에 걸친 스트림 상태: n_streams, density, band_mask, dominant_band."""
    n_streams_low = 0
    n_streams_mid = 0
    n_streams_high = 0
    events_low = 0
    events_mid = 0
    events_high = 0
    accent_low = 0
    accent_mid = 0
    accent_high = 0
    total_low = 0
    total_mid = 0
    total_high = 0

    for s in streams:
        ev = s.get("events") or []
        band = s.get("band", "")
        start, end = s.get("start", 0), s.get("end", 0)
        if end < window_start or start > window_end:
            continue
        in_window = [t for t in ev if window_start <= t <= window_end]
        n = len(in_window)
        if n < active_threshold:
            continue
        if band == "low":
            n_streams_low += 1
            events_low += n
            total_low += len(ev)
            accent_low += len(s.get("accents") or [])
        elif band == "mid":
            n_streams_mid += 1
            events_mid += n
            total_mid += len(ev)
            accent_mid += len(s.get("accents") or [])
        elif band == "high":
            n_streams_high += 1
            events_high += n
            total_high += len(ev)
            accent_high += len(s.get("accents") or [])

    window_sec = window_end - window_start
    if window_sec <= 0:
        window_sec = 1.0
    density_low = events_low / window_sec
    density_mid = events_mid / window_sec
    density_high = events_high / window_sec

    low_active = 1 if (n_streams_low > 0 or events_low >= active_threshold) else 0
    mid_active = 1 if (n_streams_mid > 0 or events_mid >= active_threshold) else 0
    high_active = 1 if (n_streams_high > 0 or events_high >= active_threshold) else 0
    band_presence_mask = [low_active, mid_active, high_active]
    dens = [density_low, density_mid, density_high]
    dominant_band_idx = int(np.argmax(dens))
    dominant_band = ["low", "mid", "high"][dominant_band_idx]

    accent_ratio_low = accent_low / total_low if total_low > 0 else 0.0
    accent_ratio_mid = accent_mid / total_mid if total_mid > 0 else 0.0
    accent_ratio_high = accent_high / total_high if total_high > 0 else 0.0

    return {
        "n_streams_low": n_streams_low,
        "n_streams_mid": n_streams_mid,
        "n_streams_high": n_streams_high,
        "density_low": density_low,
        "density_mid": density_mid,
        "density_high": density_high,
        "band_presence_mask": band_presence_mask,
        "dominant_band_idx": dominant_band_idx,
        "dominant_band": dominant_band,
        "accent_ratio_low": accent_ratio_low,
        "accent_ratio_mid": accent_ratio_mid,
        "accent_ratio_high": accent_ratio_high,
    }


def _vec_to_array(v: dict) -> np.ndarray:
    """벡터 dict → flat array for distance (numeric only)."""
    return np.array([
        v["n_streams_low"],
        v["n_streams_mid"],
        v["n_streams_high"],
        v["density_low"],
        v["density_mid"],
        v["density_high"],
        float(v["dominant_band_idx"]),
        v["accent_ratio_low"],
        v["accent_ratio_mid"],
        v["accent_ratio_high"],
    ], dtype=float)


def segment_sections(
    streams: list[dict[str, Any]],
    duration_sec: float,
    *,
    window_sec: float = SECTION_WINDOW_SEC,
    hop_sec: float = SECTION_HOP_SEC,
    active_threshold: int = SECTION_ACTIVE_THRESHOLD,
    change_threshold: float | None = None,
    min_section_sec: float = MIN_SECTION_SEC,
    debounce_windows: int = SECTION_DEBOUNCE_WINDOWS,
    merge_near_sec: float = SECTION_MERGE_NEAR_SEC,
) -> list[dict[str, Any]]:
    """
    스트림 목록과 길이로부터 윈도우별 V_k 계산 → dist(V_k, V_{k-1}) → 경계 후보 → debounce·병합 → sections.
    """
    if duration_sec <= 0 or not streams:
        return [{"id": 0, "start": 0.0, "end": duration_sec, "active_stream_ids": [], "summary": {}}]

    k = 0
    vecs: list[dict] = []
    window_starts: list[float] = []
    while True:
        w_start = k * hop_sec
        w_end = min(w_start + window_sec, duration_sec)
        if w_start >= duration_sec:
            break
        vec = _vector_from_streams_in_window(streams, w_start, w_end, active_threshold)
        vecs.append(vec)
        window_starts.append(w_start)
        k += 1
        if w_end >= duration_sec:
            break

    if len(vecs) < 2:
        active_ids = [s["id"] for s in streams]
        summary = vecs[0] if vecs else {}
        if isinstance(summary, dict):
            summary = {k: v for k, v in summary.items() if k in ("density_low", "density_mid", "density_high", "dominant_band", "n_streams_low", "n_streams_mid", "n_streams_high")}
        return [{"id": 0, "start": 0.0, "end": duration_sec, "active_stream_ids": active_ids, "summary": summary or {}}]

    arrs = [_vec_to_array(v) for v in vecs]
    dists = []
    for i in range(1, len(arrs)):
        d = float(np.linalg.norm(arrs[i] - arrs[i - 1], ord=1))
        dists.append(d)
    dists = np.array(dists)
    thr = change_threshold
    if thr is None:
        med = float(np.median(dists))
        mad = float(np.median(np.abs(dists - med))) or 1e-6
        thr = med + 3 * mad
    thr = max(thr, SECTION_CHANGE_THRESHOLD)

    boundary_candidates = []
    for i in range(len(dists)):
        if dists[i] > thr:
            boundary_candidates.append((i + 1, window_starts[i + 1] if i + 1 < len(window_starts) else window_starts[-1] + hop_sec))

    if not boundary_candidates:
        active_ids = [s["id"] for s in streams]
        s0 = vecs[0]
        summary = {k: s0[k] for k in ("density_low", "density_mid", "density_high", "dominant_band") if k in s0}
        return [{"id": 0, "start": 0.0, "end": duration_sec, "active_stream_ids": active_ids, "summary": summary}]

    candidate_indices = set(idx for idx, _ in boundary_candidates)
    debounced = []
    for i in range(1, len(dists) + 1):
        if i in candidate_indices and (i - 1) in candidate_indices:
            t = next(t for idx, t in boundary_candidates if idx == i)
            debounced.append(t)
    boundary_times = sorted(set(debounced))
    boundary_times = [0.0] + boundary_times + [duration_sec]
    merged = []
    i = 0
    while i < len(boundary_times) - 1:
        start = boundary_times[i]
        end = boundary_times[i + 1]
        if end - start < min_section_sec and i > 0 and i < len(boundary_times) - 2:
            next_start = boundary_times[i + 2]
            if next_start - start < merge_near_sec * 2:
                merged.append((start, next_start))
                i += 2
                continue
        merged.append((start, end))
        i += 1
    boundary_times = [merged[0][0]] + [m[1] for m in merged]

    for i in range(len(boundary_times) - 1):
        if boundary_times[i + 1] - boundary_times[i] < merge_near_sec and i + 2 < len(boundary_times):
            boundary_times[i + 1] = boundary_times[i + 2]
            boundary_times.pop(i + 2)
            break
    boundary_times = sorted(set(boundary_times))
    if boundary_times[0] != 0:
        boundary_times.insert(0, 0.0)
    if boundary_times[-1] != duration_sec:
        boundary_times.append(duration_sec)

    sections_out = []
    for idx in range(len(boundary_times) - 1):
        start = boundary_times[idx]
        end = boundary_times[idx + 1]
        mid = (start + end) / 2
        vec_idx = min(int(mid / hop_sec), len(vecs) - 1)
        vec = vecs[vec_idx]
        active_in_range = [s["id"] for s in streams if s.get("start", 0) < end and s.get("end", 0) > start]
        summary = {k: vec[k] for k in ("density_low", "density_mid", "density_high", "dominant_band", "n_streams_low", "n_streams_mid", "n_streams_high") if k in vec}
        sections_out.append({
            "id": idx,
            "start": round(start, 4),
            "end": round(end, 4),
            "active_stream_ids": active_in_range,
            "summary": summary,
        })
    return sections_out
