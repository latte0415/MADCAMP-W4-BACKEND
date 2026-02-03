import json
import argparse
import numpy as np
import matplotlib.pyplot as plt
from typing import Optional


def visualize_part_features(
    json_path: str,
    out_png: str,
    fps: float,
    max_seconds: Optional[float] = None
):
    with open(json_path, "r") as f:
        data = json.load(f)

    accel = np.array(data["features"]["joint_accel"])
    energy = np.array(data["features"]["energy"])

    T = len(accel)
    t = np.arange(T) / fps

    if max_seconds is not None:
        keep = t <= max_seconds
        t = t[keep]
        accel = accel[keep]
        energy = energy[keep]

    hit_times = [
        ev["frame"] / fps
        for ev in data["events"]
        if ev["type"] == "hit"
    ]

    fig, axs = plt.subplots(2, 1, figsize=(14, 7), sharex=True)

    axs[0].plot(t, accel)
    axs[0].set_title("Joint acceleration (aggregated)")

    axs[1].plot(t, energy)
    axs[1].set_title("Whole-body energy")

    for ax in axs:
        for ht in hit_times:
            ax.axvline(ht, linestyle="--")
        ax.set_ylabel("value")

    axs[-1].set_xlabel("time (s)")
    fig.tight_layout()
    fig.savefig(out_png, dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--fps", type=float, required=True)
    parser.add_argument("--max_seconds", type=float, default=None)
    args = parser.parse_args()

    visualize_part_features(
        args.json,
        args.out,
        args.fps,
        args.max_seconds
    )
    print(f"Saved feature plot to {args.out}")
