import json
import os
import cv2
import argparse
from glob import glob


def load_events(json_path):
    with open(json_path, "r") as f:
        data = json.load(f)
    return data.get("events", [])


def build_event_map(events):
    """
    frame_idx -> list of event labels
    """
    fmap = {}

    for ev in events:
        if ev["type"] == "hit":
            f = ev["frame"]
            fmap.setdefault(f, []).append("HIT")

        elif ev["type"] == "hold":
            for f in range(ev["start_frame"], ev["end_frame"] + 1):
                fmap.setdefault(f, []).append("HOLD")

    return fmap


def extract_frame_idx(filename):
    digits = "".join(c for c in filename if c.isdigit())
    return int(digits) if digits else None


def overlay_text(img, labels):
    y = 40
    for label in labels:
        color = (0, 0, 255) if label == "HIT" else (255, 0, 0)
        cv2.putText(
            img,
            label,
            (30, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.2,
            color,
            3,
            cv2.LINE_AA,
        )
        y += 45
    return img


def main(args):
    events = load_events(args.motion_json)
    event_map = build_event_map(events)

    os.makedirs(args.out_dir, exist_ok=True)
    images = sorted(glob(os.path.join(args.image_dir, "*")))

    count = 0
    for img_path in images:
        fname = os.path.basename(img_path)
        frame_idx = extract_frame_idx(fname)
        if frame_idx is None:
            continue

        if frame_idx not in event_map:
            continue

        img = cv2.imread(img_path)
        if img is None:
            continue

        img = overlay_text(img, event_map[frame_idx])

        out_path = os.path.join(args.out_dir, fname)
        cv2.imwrite(out_path, img)
        count += 1

    print(f"[OK] event overlays saved: {count} frames → {args.out_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--motion_json", required=True)
    parser.add_argument("--image_dir", required=True)
    parser.add_argument("--out_dir", required=True)
    args = parser.parse_args()
    main(args)