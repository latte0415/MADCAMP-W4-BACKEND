import os
import json
import argparse
import cv2


def load_events(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)["events"]


def extract_frames(video_path, frames, out_dir, prefix):
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    for fidx in frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(fidx))
        ok, frame = cap.read()
        if not ok:
            print("skip frame", fidx)
            continue
        out_path = os.path.join(out_dir, f"{prefix}_{int(fidx):06d}.png")
        cv2.imwrite(out_path, frame)
    cap.release()


def main(video, events_json, out_root):
    events = load_events(events_json)

    appear_frames = [e["frame"] for e in events if e["type"] == "appear"]
    vanish_frames = [e["frame"] for e in events if e["type"] == "vanish"]

    extract_frames(video, appear_frames, os.path.join(out_root, "appear"), "appear")
    extract_frames(video, vanish_frames, os.path.join(out_root, "vanish"), "vanish")

    print(f"Saved appear frames: {len(appear_frames)}")
    print(f"Saved vanish frames: {len(vanish_frames)}")
    print(f"Output dir: {out_root}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--json", required=True)
    p.add_argument("--out_dir", default="outputs/object_keyframes")
    args = p.parse_args()

    main(args.video, args.json, args.out_dir)
