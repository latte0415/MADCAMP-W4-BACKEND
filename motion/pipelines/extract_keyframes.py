import os, json, argparse
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

def main(video, motion_json, out_root):
    events = load_events(motion_json)

    hit_frames = [e["frame"] for e in events if e["type"] == "hit"]
    hold_start_frames = [e["start_frame"] for e in events if e["type"] == "hold"]

    extract_frames(video, hit_frames, os.path.join(out_root, "hit"), "hit")
    extract_frames(video, hold_start_frames, os.path.join(out_root, "hold"), "hold")

    print(f"Saved hit frames: {len(hit_frames)}")
    print(f"Saved hold(start) frames: {len(hold_start_frames)}")
    print(f"Output dir: {out_root}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--json", required=True)
    p.add_argument("--out_dir", default="outputs/keyframes")
    args = p.parse_args()

    main(args.video, args.json, args.out_dir)
