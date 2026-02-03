#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import List, Dict


def load_events(path: Path, offset_s: float) -> List[Dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    events = data.get("events", [])
    out = []
    for ev in events:
        ev2 = dict(ev)
        # prefer time if present
        if "t" in ev2:
            ev2["t"] = float(ev2["t"]) + offset_s
        else:
            # fallback to frame time if available
            pass
        if "frame" in ev2 and "fps" in data:
            # recompute frame from adjusted time
            ev2["frame"] = int(round(ev2.get("t", 0.0) * float(data["fps"])))
        out.append(ev2)
    return out


def dedupe(events: List[Dict], window_s: float) -> List[Dict]:
    events = sorted(events, key=lambda x: x.get("t", 0.0))
    kept = []
    for ev in events:
        t = float(ev.get("t", 0.0))
        etype = ev.get("type")
        if kept and etype == kept[-1].get("type") and abs(t - float(kept[-1].get("t", 0.0))) <= window_s:
            continue
        kept.append(ev)
    return kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", nargs="+", required=True, help="event json files in order")
    ap.add_argument("--offsets", nargs="+", required=True, help="offset seconds per input")
    ap.add_argument("--out", required=True)
    ap.add_argument("--dedupe_window", type=float, default=0.4)
    ap.add_argument("--fps", type=float, default=30.0)
    args = ap.parse_args()

    if len(args.inputs) != len(args.offsets):
        raise ValueError("inputs and offsets must match length")

    all_events = []
    for p, off in zip(args.inputs, args.offsets):
        all_events.extend(load_events(Path(p), float(off)))

    merged = dedupe(all_events, args.dedupe_window)
    out = {
        "fps": args.fps,
        "events": merged,
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] wrote: {args.out} (events={len(merged)})")


if __name__ == "__main__":
    main()
