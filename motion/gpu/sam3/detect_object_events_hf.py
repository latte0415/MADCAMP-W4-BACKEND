#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Dict, List

import cv2
import numpy as np
import torch
from tqdm import tqdm

from transformers import Sam3VideoModel, Sam3VideoProcessor


def to_numpy(x):
    if x is None:
        return None
    if hasattr(x, "cpu"):
        return x.cpu().numpy()
    return np.asarray(x)


def ensure_frame_uint8(frame):
    arr = np.asarray(frame)
    if arr.dtype != np.uint8:
        if arr.max() <= 1.0:
            arr = (arr * 255.0).clip(0, 255).astype(np.uint8)
        else:
            arr = arr.clip(0, 255).astype(np.uint8)
    return arr


def draw_overlay(frame_rgb, boxes, scores, object_ids, masks=None):
    vis = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)

    if masks is not None and len(masks) > 0:
        masks_np = to_numpy(masks)
        for i, m in enumerate(masks_np):
            if m.ndim == 3:
                m = m[0]
            m = (m > 0.5).astype(np.uint8)
            if m.shape[:2] != vis.shape[:2]:
                m = cv2.resize(m, (vis.shape[1], vis.shape[0]), interpolation=cv2.INTER_NEAREST)
            color = np.array([(37 * (i + 1)) % 255, (97 * (i + 3)) % 255, (157 * (i + 5)) % 255], dtype=np.uint8)
            overlay = np.zeros_like(vis, dtype=np.uint8)
            overlay[:, :] = color
            alpha = 0.25
            vis[m > 0] = (vis[m > 0] * (1 - alpha) + overlay[m > 0] * alpha).astype(np.uint8)

    for i, b in enumerate(boxes):
        x1, y1, x2, y2 = [int(v) for v in b]
        tid = int(object_ids[i]) if object_ids is not None else -1
        score = float(scores[i]) if scores is not None else 0.0
        cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 220, 120), 2)
        cv2.putText(
            vis,
            f"id:{tid} s:{score:.2f}",
            (x1, max(18, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 220, 120),
            2,
            cv2.LINE_AA,
        )

    return vis


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out_json", default="outputs/object_events_hf.json")
    ap.add_argument("--out_video", default="", help="optional overlay video")
    ap.add_argument("--model_id", default="facebook/sam3")
    ap.add_argument("--prompt", default="object")
    ap.add_argument("--target_fps", type=float, default=5.0)
    ap.add_argument("--min_hits", type=int, default=2)
    ap.add_argument("--vanish_gap_s", type=float, default=1.2)
    ap.add_argument("--max_frames", type=int, default=0, help="0 means all frames")
    ap.add_argument("--device", default="cuda:0")
    args = ap.parse_args()

    device = args.device if torch.cuda.is_available() and args.device.startswith("cuda") else "cpu"
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {args.video}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    stride = max(1, int(round(fps / max(args.target_fps, 0.1))))
    sampled_fps = fps / stride
    vanish_gap_frames = max(1, int(round(args.vanish_gap_s * fps)))

    model = Sam3VideoModel.from_pretrained(args.model_id).to(device, dtype=dtype)
    processor = Sam3VideoProcessor.from_pretrained(args.model_id)

    # Streaming inference session
    session = processor.init_video_session(
        inference_device=device,
        dtype=dtype,
    )
    session = processor.add_text_prompt(
        inference_session=session,
        text=args.prompt,
    )

    writer = None
    if args.out_video:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(args.out_video, fourcc, sampled_fps, (w, h))

    tracks: Dict[int, Dict] = {}
    events: List[Dict] = []

    pbar_total = total_frames // stride if total_frames else None
    pbar = tqdm(total=pbar_total, desc="Detecting(HF-SAM3-stream)", unit="frame")

    frame_idx = 0
    sampled_idx = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_idx % stride != 0:
                frame_idx += 1
                continue

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame_rgb = ensure_frame_uint8(frame_rgb)

            # prepare frame for streaming
            inputs = processor(images=frame_rgb, device=device, return_tensors="pt")
            # Streaming mode: pass a single frame tensor
            outputs = model(
                inference_session=session,
                frame=inputs.pixel_values[0],
                reverse=False,
            )
            processed = processor.postprocess_outputs(
                session,
                outputs,
                original_sizes=inputs.original_sizes,
            )

            object_ids = to_numpy(processed.get("object_ids"))
            boxes = to_numpy(processed.get("boxes"))
            scores = to_numpy(processed.get("scores"))
            masks = processed.get("masks")

            if object_ids is None:
                object_ids = np.array([], dtype=np.int32)
            if boxes is None:
                boxes = np.zeros((0, 4), dtype=np.float32)
            if scores is None:
                scores = np.zeros((len(object_ids),), dtype=np.float32)

            seen_now = set(int(x) for x in object_ids.tolist())
            event_tags: List[str] = []

            for i, tid in enumerate(object_ids.tolist()):
                tid = int(tid)
                if tid not in tracks:
                    tracks[tid] = {
                        "first_seen": frame_idx,
                        "last_seen": frame_idx,
                        "hits": 1,
                        "appeared": False,
                        "vanished": False,
                    }
                else:
                    tracks[tid]["last_seen"] = frame_idx
                    tracks[tid]["hits"] += 1

                tr = tracks[tid]
                if (not tr["appeared"]) and tr["hits"] >= args.min_hits:
                    tr["appeared"] = True
                    events.append(
                        {
                            "type": "appear",
                            "frame": int(tr["first_seen"]),
                            "t": round(float(tr["first_seen"] / fps), 4),
                            "track_id": tid,
                        }
                    )
                    event_tags.append(f"appear#{tid}")

            for tid, tr in tracks.items():
                if tid in seen_now or tr["vanished"]:
                    continue
                if frame_idx - tr["last_seen"] >= vanish_gap_frames:
                    if tr["appeared"]:
                        tr["vanished"] = True
                        events.append(
                            {
                                "type": "vanish",
                                "frame": int(tr["last_seen"]),
                                "t": round(float(tr["last_seen"] / fps), 4),
                                "track_id": int(tid),
                            }
                        )
                        event_tags.append(f"vanish#{tid}")

            if writer is not None:
                vis = draw_overlay(frame_rgb, boxes, scores, object_ids, masks=masks)
                cv2.putText(
                    vis,
                    f"f:{frame_idx} t:{frame_idx/fps:.2f}s sampled:{sampled_idx}",
                    (12, 24),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.62,
                    (240, 240, 240),
                    2,
                    cv2.LINE_AA,
                )
                if event_tags:
                    cv2.putText(
                        vis,
                        " | ".join(event_tags[:4]),
                        (12, 50),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (90, 180, 255),
                        2,
                        cv2.LINE_AA,
                    )
                writer.write(vis)

            frame_idx += 1
            sampled_idx += 1
            pbar.update(1)

            if args.max_frames and sampled_idx >= args.max_frames:
                break

    finally:
        pbar.close()
        cap.release()
        if writer is not None:
            writer.release()

    events = sorted(events, key=lambda x: x["t"])

    out = {
        "video": args.video,
        "fps": fps,
        "target_fps": float(args.target_fps),
        "stride": stride,
        "sampled_fps": sampled_fps,
        "model_id": args.model_id,
        "prompt": args.prompt,
        "events": events,
    }

    out_path = Path(args.out_json)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] wrote: {out_path} (events={len(events)})")


if __name__ == "__main__":
    main()
