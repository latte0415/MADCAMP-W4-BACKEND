#!/usr/bin/env python3
import argparse, json, os, subprocess, shlex
from pathlib import Path
from tqdm import tqdm

def run(cmd: list[str]) -> None:
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"Command failed:\n{' '.join(shlex.quote(c) for c in cmd)}\n\nSTDERR:\n{p.stderr}")

def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def ffprobe_fps(video_path: str) -> float:
    # Try to read r_frame_rate and compute fps
    cmd = [
        "ffprobe","-v","error",
        "-select_streams","v:0",
        "-show_entries","stream=r_frame_rate",
        "-of","default=nk=1:nw=1",
        video_path
    ]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    s = p.stdout.strip()
    if not s or "/" not in s:
        return 0.0
    num, den = s.split("/", 1)
    try:
        return float(num) / float(den)
    except:
        return 0.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="input video path")
    ap.add_argument("--segments", required=True, help="outputs/motion_segments.json")
    ap.add_argument("--out_dir", required=True, help="output folder for clips")
    ap.add_argument("--prefix", default="seg", help="filename prefix")
    ap.add_argument("--use_time", action="store_true",
                    help="use start_time/end_time fields instead of frame indices")
    ap.add_argument("--reencode", action="store_true",
                    help="re-encode (slower) but more compatible. default is stream copy.")
    ap.add_argument("--crf", type=int, default=18, help="CRF for re-encode")
    ap.add_argument("--preset", default="veryfast", help="x264 preset for re-encode")
    ap.add_argument("--max_workers", type=int, default=1, help="kept for future, currently sequential")
    args = ap.parse_args()

    video = args.video
    seg_path = args.segments
    out_dir = Path(args.out_dir)
    ensure_dir(out_dir)

    data = json.load(open(seg_path, "r", encoding="utf-8"))
    segs = data.get("segments", [])
    if not segs:
        raise ValueError("No segments found in segments json")

    # fps priority: segments.json -> ffprobe -> fallback 30
    fps = float(data.get("fps", 0.0) or 0.0)
    if fps <= 0:
        fps = ffprobe_fps(video)
    if fps <= 0:
        fps = 30.0

    # pick extractor mode
    use_time = args.use_time

    # ffmpeg settings
    # -accurate_seek with re-encode, stream-copy uses fast seek + copy
    # For best cut precision, use --reencode
    for s in tqdm(segs, desc="Exporting segments", unit="seg"):
        sid = s.get("id", 0)
        if use_time:
            t0 = float(s["start_time"])
            t1 = float(s["end_time"])
        else:
            f0 = int(s["start_frame"])
            f1 = int(s["end_frame"])
            t0 = f0 / fps
            # include end frame; add 1 frame duration
            t1 = (f1 + 1) / fps

        # Sanity
        if t1 <= t0:
            continue

        seg_type = s.get("type", "seg")
        out_name = f"{args.prefix}_{sid:03d}_{seg_type}_{t0:.2f}-{t1:.2f}.mp4"
        out_path = out_dir / out_name

        if args.reencode:
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{t0:.6f}",
                "-to", f"{t1:.6f}",
                "-i", video,
                "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf),
                "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart",
                str(out_path)
            ]
        else:
            # stream copy (fast). Note: cuts may be GOP-aligned (less exact)
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{t0:.6f}",
                "-to", f"{t1:.6f}",
                "-i", video,
                "-c", "copy",
                str(out_path)
            ]

        run(cmd)

    print(f"[OK] wrote clips to: {out_dir}")

if __name__ == "__main__":
    main()