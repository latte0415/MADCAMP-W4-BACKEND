import json
import os
import argparse
import numpy as np
import matplotlib.pyplot as plt
from typing import Optional

def load_result(json_path: str):
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


def visualize_features(result: dict, out_png: str, max_seconds: Optional[float] = None):
    fps = float(result["fps"])
    accel = np.array(result["features"]["joint_accel"], dtype=float)
    energy = np.array(result["features"]["energy"], dtype=float)
    T = len(accel)

    t = np.arange(T) / fps

    # Optional trim for long videos
    if max_seconds is not None:
        keep = t <= max_seconds
        t = t[keep]
        accel = accel[keep]
        energy = energy[keep]

    # Collect events
    hit_times = []
    hold_spans = []
    for ev in result["events"]:
        if ev["type"] == "hit":
            hit_times.append(ev["frame"] / fps)
        elif ev["type"] == "hold":
            hold_spans.append((ev["start_frame"] / fps, ev["end_frame"] / fps))

    fig = plt.figure(figsize=(14, 7))

    # --- Plot 1: joint_accel
    ax1 = fig.add_subplot(2, 1, 1)
    ax1.plot(t, accel)
    ax1.set_title("Motion Feature: joint_accel (aggregated)")
    ax1.set_xlabel("time (s)")
    ax1.set_ylabel("accel magnitude")

    # Holds (shaded)
    for (s, e) in hold_spans:
        if max_seconds is not None and s > max_seconds:
            continue
        ax1.axvspan(s, min(e, max_seconds) if max_seconds is not None else e, alpha=0.2)

    # Hits (vertical lines)
    for ht in hit_times:
        if max_seconds is not None and ht > max_seconds:
            continue
        ax1.axvline(ht, linestyle="--", linewidth=1)

    # --- Plot 2: energy
    ax2 = fig.add_subplot(2, 1, 2)
    ax2.plot(t, energy)
    ax2.set_title("Motion Feature: energy (whole-body mean speed)")
    ax2.set_xlabel("time (s)")
    ax2.set_ylabel("energy")

    for (s, e) in hold_spans:
        if max_seconds is not None and s > max_seconds:
            continue
        ax2.axvspan(s, min(e, max_seconds) if max_seconds is not None else e, alpha=0.2)

    for ht in hit_times:
        if max_seconds is not None and ht > max_seconds:
            continue
        ax2.axvline(ht, linestyle="--", linewidth=1)

    fig.tight_layout()

    os.makedirs(os.path.dirname(out_png) or ".", exist_ok=True)
    fig.savefig(out_png, dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", required=True, help="Path to motion_result.json")
    parser.add_argument("--out", default="outputs/motion_features.png", help="Output PNG path")
    parser.add_argument("--max_seconds", type=float, default=None, help="Trim visualization to first N seconds")
    args = parser.parse_args()

    result = load_result(args.json)
    visualize_features(result, args.out, args.max_seconds)
    print(f"Saved: {args.out}")
