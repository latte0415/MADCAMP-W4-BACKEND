from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class Event:
    t: float
    weight: float


def _sigmoid(x: float, k: float, x0: float) -> float:
    return 1.0 / (1.0 + math.exp(-k * (x - x0)))


def _weighted_coverage(events_a: List[Event], events_b: List[Event], tau: float) -> float:
    if not events_a:
        return 0.0
    b_times = [e.t for e in events_b]
    total = 0.0
    for e in events_a:
        if not b_times:
            break
        best_dt = min(abs(e.t - t) for t in b_times)
        if best_dt <= tau:
            total += max(0.0, 1.0 - (best_dt / tau)) * e.weight
    denom = sum(e.weight for e in events_a) or 1.0
    return total / denom


def _load_music_events(music_json: Dict[str, Any]) -> List[Event]:
    out: List[Event] = []
    kpb = music_json.get("keypoints_by_band")
    if isinstance(kpb, dict):
        for band, weight in (("low", 0.7), ("mid", 0.9), ("high", 1.0)):
            for item in kpb.get(band, []) or []:
                t = float(item.get("t") or item.get("time") or 0.0)
                out.append(Event(t=t, weight=weight))
        return out

    for item in music_json.get("keypoints", []) or []:
        band = item.get("frequency") or item.get("band") or "mid"
        weight = {"low": 0.7, "mid": 0.9, "high": 1.0}.get(band, 0.8)
        t = float(item.get("t") or item.get("time") or 0.0)
        out.append(Event(t=t, weight=weight))
    return out


def _load_motion_events(motion_json: Dict[str, Any]) -> List[Event]:
    out: List[Event] = []
    for item in motion_json.get("events", []) or []:
        kind = item.get("type") or item.get("kind")
        if kind == "hold":
            t = float(item.get("t_start") or item.get("start") or item.get("t") or 0.0)
            weight = 0.8
        else:
            t = float(item.get("t") or item.get("time") or 0.0)
            weight = 1.0
        out.append(Event(t=t, weight=weight))
    return out


def compute_match_score(
    music_json: Dict[str, Any],
    motion_json: Dict[str, Any],
    tau: float = 0.3,
    sigmoid_k: float = 12.0,
    sigmoid_x0: float = 0.55,
) -> Dict[str, Any]:
    music_events = _load_music_events(music_json)
    motion_events = _load_motion_events(motion_json)
    motion_to_music = _weighted_coverage(motion_events, music_events, tau)
    score_raw = _sigmoid(motion_to_music, sigmoid_k, sigmoid_x0)
    score = int(round(score_raw * 100))
    return {
        "score": score,
        "motion_to_music": motion_to_music,
        "tau": tau,
        "sigmoid_k": sigmoid_k,
        "sigmoid_x0": sigmoid_x0,
        "score_raw": score_raw,
    }
