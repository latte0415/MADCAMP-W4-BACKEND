import argparse
import json
import math
from dataclasses import dataclass
from typing import List, Tuple, Dict, Any

@dataclass
class Event:
    t: float
    weight: float
    kind: str

DEFAULT_WEIGHTS = {
    "music_low": 0.6,
    "music_mid": 0.8,
    "music_high": 1.0,
    "hit": 1.0,
    "hold": 0.7,
    "appear": 0.8,
    "vanish": 0.8,
}


def gaussian_score(dt: float, sigma: float) -> float:
    return math.exp(-(dt * dt) / (2 * sigma * sigma))


def load_music_events(music_json: Dict[str, Any]) -> List[Event]:
    events: List[Event] = []
    kpb = music_json.get("keypoints_by_band")
    if isinstance(kpb, dict):
        for band, w in (("low", DEFAULT_WEIGHTS["music_low"]), ("mid", DEFAULT_WEIGHTS["music_mid"]), ("high", DEFAULT_WEIGHTS["music_high"])):
            for item in kpb.get(band, []) or []:
                t = float(item.get("t") or item.get("time") or 0.0)
                events.append(Event(t=t, weight=w, kind=f"music_{band}"))
        return sorted(events, key=lambda e: e.t)

    for item in music_json.get("keypoints", []) or []:
        band = item.get("frequency") or item.get("band") or "mid"
        w = DEFAULT_WEIGHTS.get(f"music_{band}", 0.8)
        t = float(item.get("t") or item.get("time") or 0.0)
        events.append(Event(t=t, weight=w, kind=f"music_{band}"))
    return sorted(events, key=lambda e: e.t)


def load_motion_events(motion_json: Dict[str, Any]) -> List[Event]:
    events: List[Event] = []
    for item in motion_json.get("events", []) or []:
        kind = item.get("type") or item.get("kind")
        if kind == "hold":
            t = float(item.get("t_start") or item.get("start") or item.get("t") or 0.0)
        else:
            t = float(item.get("t") or item.get("time") or 0.0)
        w = DEFAULT_WEIGHTS.get(kind, 0.7)
        events.append(Event(t=t, weight=w, kind=kind))
    return sorted(events, key=lambda e: e.t)


def nearest_match_score(music: List[Event], motion: List[Event], sigma: float, tau: float) -> Tuple[float, List[float]]:
    if not music or not motion:
        return 0.0, []

    scores = []
    for m in music:
        best_dt = min(abs(m.t - d.t) for d in motion)
        if best_dt > tau:
            scores.append(0.0)
        else:
            scores.append(m.weight * gaussian_score(best_dt, sigma))
    base = sum(scores) / max(1, sum(m.weight for m in music))
    return base, scores


def weighted_coverage_score(a: List[Event], b: List[Event], tau: float) -> float:
    if not a:
        return 0.0
    b_times = [e.t for e in b]
    total = 0.0
    for e in a:
        if not b_times:
            break
        best_dt = min(abs(e.t - t) for t in b_times)
        if best_dt <= tau:
            # Linear decay: 1.0 at 0s, 0.0 at tau
            total += max(0.0, 1.0 - (best_dt / tau))
    return total / len(a)


def sigmoid_score(x: float, k: float = 10.0, x0: float = 0.5) -> float:
    # Maps 0..1 -> 0..1, pushing low lower and high higher
    return 1.0 / (1.0 + math.exp(-k * (x - x0)))


def window_scores(music: List[Event], motion: List[Event], sigma: float, tau: float, window: float, step: float) -> List[Tuple[float, float]]:
    if not music:
        return []
    start = min(e.t for e in music)
    end = max(e.t for e in music)
    out = []
    t = start
    while t <= end:
        music_w = [e for e in music if t <= e.t < t + window]
        motion_w = [e for e in motion if t <= e.t < t + window]
        score, _ = nearest_match_score(music_w, motion_w, sigma, tau)
        out.append((t, score))
        t += step
    return out


def final_score(
    music: List[Event],
    motion: List[Event],
    sigma: float,
    tau: float,
    window: float,
    step: float,
    penalty_weight: float,
) -> Tuple[int, Dict[str, Any]]:
    base, scores = nearest_match_score(music, motion, sigma, tau)
    win = window_scores(music, motion, sigma, tau, window=window, step=step)
    if win:
        weakest = sorted(win, key=lambda x: x[1])[:2]
        penalty = sum(w for _, w in weakest) / len(weakest)
    else:
        penalty = 0.0
    raw = max(0.0, base - penalty_weight * penalty)
    score_100 = int(round(raw * 100))
    details = {
        "base": base,
        "penalty": penalty,
        "weak_windows": weakest if win else [],
    }
    return score_100, details


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--music_json", required=True)
    parser.add_argument("--motion_json", required=True)
    parser.add_argument("--sigma", type=float, default=0.1)
    parser.add_argument("--tau", type=float, default=0.22)
    parser.add_argument("--window", type=float, default=6.0)
    parser.add_argument("--step", type=float, default=3.0)
    parser.add_argument("--penalty_weight", type=float, default=0.3)
    parser.add_argument("--mode", choices=["gaussian", "coverage"], default="gaussian")
    parser.add_argument("--sigmoid", action="store_true")
    parser.add_argument("--sigmoid_k", type=float, default=10.0)
    parser.add_argument("--sigmoid_x0", type=float, default=0.5)
    args = parser.parse_args()

    with open(args.music_json, "r", encoding="utf-8") as f:
        music_json = json.load(f)
    with open(args.motion_json, "r", encoding="utf-8") as f:
        motion_json = json.load(f)

    music = load_music_events(music_json)
    motion = load_motion_events(motion_json)

    if args.mode == "coverage":
        d2m = weighted_coverage_score(motion, music, args.tau)
        raw = d2m
        if args.sigmoid:
            raw = sigmoid_score(d2m, args.sigmoid_k, args.sigmoid_x0)
        score = int(round(raw * 100))
        print(json.dumps({"score": score, "motion_to_music": d2m, "score_raw": raw}, ensure_ascii=False, indent=2))
    else:
        score, details = final_score(
            music,
            motion,
            args.sigma,
            args.tau,
            args.window,
            args.step,
            args.penalty_weight,
        )
        print(json.dumps({"score": score, **details}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
