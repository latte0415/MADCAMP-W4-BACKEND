#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Dict, List

import cv2
import mediapipe as mp
import numpy as np
import tempfile
from tqdm import tqdm


def to_numpy(x):
    if x is None:
        return None
    if hasattr(x, "cpu"):
        return x.cpu().numpy()
    return x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out_json", default="outputs/object_events.json")
    ap.add_argument("--out_video", default="", help="optional overlay video path")

    ap.add_argument("--model", default="sam3.pt", help="SAM3 checkpoint path")
    ap.add_argument("--prompt", default="object")
    ap.add_argument("--target_fps", type=float, default=5.0)
    ap.add_argument("--source_fps", type=float, default=0.0, help="override source fps")
    ap.add_argument("--writer_fps", type=float, default=0.0, help="override output video fps")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--min_hits", type=int, default=2)
    ap.add_argument("--vanish_gap_s", type=float, default=1.0)
    ap.add_argument("--person_crop", action="store_true")
    ap.add_argument("--crop_margin", type=float, default=0.25)
    ap.add_argument("--crop_margin_x", type=float, default=0.6, help="extra horizontal margin ratio")
    ap.add_argument("--crop_margin_y", type=float, default=0.08, help="extra vertical margin ratio")
    ap.add_argument("--min_visibility", type=float, default=0.2)
    ap.add_argument("--hand_filter", action="store_true", help="keep only boxes near wrists")
    ap.add_argument("--hand_radius_px", type=int, default=80, help="radius in pixels around wrist centers")
    ap.add_argument("--fixed_crop_seconds", type=float, default=5.0)
    ap.add_argument("--max_fraction", type=float, default=1.0, help="0.5 = first half of video")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    try:
        from ultralytics.models.sam import SAM3VideoSemanticPredictor
    except Exception as exc:
        raise RuntimeError(
            "SAM3VideoSemanticPredictor import failed. "
            "Need ultralytics>=8.3.237 and SAM3-enabled build."
        ) from exc

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if args.source_fps and args.source_fps > 0:
        fps = float(args.source_fps)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()

    stride = max(1, int(round(fps / max(args.target_fps, 0.1))))
    # Output video fps should match target_fps unless explicitly overridden.
    sampled_fps = float(args.target_fps)
    if args.writer_fps and args.writer_fps > 0:
        sampled_fps = float(args.writer_fps)
    vanish_gap_frames = max(1, int(round(args.vanish_gap_s * fps)))

    overrides = dict(
        conf=args.conf,
        task="segment",
        mode="track",
        imgsz=args.imgsz,
        model=args.model,
        device=args.device,
        verbose=False,
    )
    predictor = SAM3VideoSemanticPredictor(overrides=overrides)
    # Avoid Ultralytics result.verbose index errors for open-vocab outputs
    try:
        predictor.model.names = ["object"]
    except Exception:
        pass
    try:
        predictor.args.verbose = False
        predictor.args.save = False
        predictor.args.show = False
    except Exception:
        pass

    max_fraction = max(0.0, min(1.0, float(args.max_fraction)))
    # Only clamp by frame count when max_fraction < 1.0.
    # Some codecs report incorrect total_frames, which can truncate full-length runs.
    if total_frames and max_fraction < 0.999:
        max_frames = int(total_frames * max_fraction)
    else:
        max_frames = 0
    max_sampled = int(max_frames / stride) if max_frames else 0

    source_path = args.video
    temp_video = None
    pose_filter = None
    stream_stride = stride
    if args.person_crop:
        cap = cv2.VideoCapture(args.video)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {args.video}")
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        mp_pose = mp.solutions.pose
        pose = mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        fixed_frames = int(max(0.0, args.fixed_crop_seconds) * fps)
        fixed_bbox = None
        if fixed_frames > 0:
            bxs = []
            frame_idx = 0
            stride_crop = stride
            total_for_crop = min(max_frames, fixed_frames) if max_frames else fixed_frames
            pbar_est = tqdm(total=(total_for_crop // max(1, stride_crop)), desc="Crop-estimate", unit="frame")
            try:
                while True:
                    ok, frame = cap.read()
                    if not ok:
                        break
                    if frame_idx >= fixed_frames:
                        break
                    if max_frames and frame_idx >= max_frames:
                        break
                    if frame_idx % stride_crop != 0:
                        frame_idx += 1
                        continue

                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    res = pose.process(rgb)
                    if res.pose_landmarks:
                        xs, ys = [], []
                        for lm in res.pose_landmarks.landmark:
                            vis = getattr(lm, "visibility", 1.0)
                            if vis < args.min_visibility:
                                continue
                            xs.append(lm.x * w)
                            ys.append(lm.y * h)
                        if xs and ys:
                            x1 = int(max(0, min(xs)))
                            y1 = int(max(0, min(ys)))
                            x2 = int(min(w - 1, max(xs)))
                            y2 = int(min(h - 1, max(ys)))
                            if x2 > x1 and y2 > y1:
                                bxs.append((x1, y1, x2, y2))

                    frame_idx += 1
                    pbar_est.update(1)
            finally:
                pbar_est.close()

            if bxs:
                x1 = min(b[0] for b in bxs)
                y1 = min(b[1] for b in bxs)
                x2 = max(b[2] for b in bxs)
                y2 = max(b[3] for b in bxs)
                bw = max(1, x2 - x1)
                bh = max(1, y2 - y1)
                pad_w = int(bw * max(args.crop_margin, args.crop_margin_x))
                pad_h = int(bh * max(args.crop_margin * 0.5, args.crop_margin_y))
                x1 = max(0, x1 - pad_w)
                y1 = max(0, y1 - pad_h)
                x2 = min(w - 1, x2 + pad_w)
                y2 = min(h - 1, y2 + pad_h)
                fixed_bbox = (x1, y1, x2, y2)

        cap.release()
        pose.close()

        if fixed_bbox is None:
            fixed_bbox = (0, 0, w - 1, h - 1)

        cap = cv2.VideoCapture(args.video)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {args.video}")

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        temp_video = tmp.name
        tmp.close()
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        x1, y1, x2, y2 = fixed_bbox
        crop_w = max(1, x2 - x1)
        crop_h = max(1, y2 - y1)
        # Write sampled frames at target_fps to preserve original video duration
        writer_crop = cv2.VideoWriter(temp_video, fourcc, float(args.target_fps), (crop_w, crop_h))

        frame_idx = 0
        stride_crop = stride
        total_for_crop = max_frames if max_frames else total_frames
        pbar_crop = tqdm(total=(total_for_crop // max(1, stride_crop)) if total_for_crop else None, desc="Person-crop", unit="frame")
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if max_frames and frame_idx >= max_frames:
                    break
                if frame_idx % stride_crop != 0:
                    frame_idx += 1
                    continue

                x1, y1, x2, y2 = fixed_bbox
                frame = frame[y1:y2, x1:x2]

                writer_crop.write(frame)
                frame_idx += 1
                pbar_crop.update(1)
        finally:
            cap.release()
            try:
                pose.close()
            except ValueError:
                pass
            writer_crop.release()
            pbar_crop.close()

        source_path = temp_video
        # Already downsampled by stride during crop; do not stride again in predictor
        stream_stride = 1
    elif args.target_fps and fps and args.target_fps < fps:
        # No crop, but still need to downsample to target_fps to avoid duration mismatch
        cap = cv2.VideoCapture(args.video)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {args.video}")
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        temp_video = tmp.name
        tmp.close()
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer_ds = cv2.VideoWriter(temp_video, fourcc, float(args.target_fps), (w, h))
        frame_idx = 0
        total_for_ds = max_frames if max_frames else total_frames
        pbar_ds = tqdm(total=(total_for_ds // max(1, stride)) if total_for_ds else None, desc="Downsample", unit="frame")
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if max_frames and frame_idx >= max_frames:
                    break
                if frame_idx % stride != 0:
                    frame_idx += 1
                    continue
                writer_ds.write(frame)
                frame_idx += 1
                pbar_ds.update(1)
        finally:
            cap.release()
            writer_ds.release()
            pbar_ds.close()
        source_path = temp_video
        stream_stride = 1

    stream = predictor(source=source_path, text=[args.prompt], stream=True, vid_stride=stream_stride)

    writer = None
    if args.out_video:
        if args.person_crop:
            out_w, out_h = crop_w, crop_h
        else:
            probe = cv2.VideoCapture(args.video)
            out_w = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            out_h = int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            probe.release()
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(args.out_video, fourcc, sampled_fps, (out_w, out_h))

    tracks: Dict[int, Dict] = {}
    events: List[Dict] = []

    pbar_total = max_sampled if max_sampled else (total_frames // stride if total_frames else None)
    pbar = tqdm(total=pbar_total, desc="Detecting(SAM3-PCS)", unit="frame")

    sampled_idx = 0
    try:
        for r in stream:
            frame_idx = sampled_idx * stride
            event_tags: List[str] = []

            boxes_xyxy = to_numpy(getattr(getattr(r, "boxes", None), "xyxy", None))
            ids = to_numpy(getattr(getattr(r, "boxes", None), "id", None))
            confs = to_numpy(getattr(getattr(r, "boxes", None), "conf", None))

            if boxes_xyxy is None or len(boxes_xyxy) == 0:
                seen_now = set()
            else:
                if ids is None:
                    # Fallback: no IDs available from predictor; use per-frame temp IDs.
                    ids = list(range(1_000_000 + sampled_idx * len(boxes_xyxy), 1_000_000 + sampled_idx * len(boxes_xyxy) + len(boxes_xyxy)))
                else:
                    ids = [int(x) for x in ids.tolist()]

                # Optional hand-filtering: keep only boxes near wrists
                if args.hand_filter:
                    if pose_filter is None:
                        mp_pose = mp.solutions.pose
                        pose_filter = mp_pose.Pose(
                            static_image_mode=False,
                            model_complexity=1,
                            enable_segmentation=False,
                            min_detection_confidence=0.5,
                            min_tracking_confidence=0.5,
                        )
                    img = getattr(r, "orig_img", None)
                    if img is None:
                        img = getattr(r, "img", None)
                    wrist_pts = []
                    if img is not None:
                        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                        res = pose_filter.process(rgb)
                        if res.pose_landmarks:
                            h, w = rgb.shape[:2]
                            for idx in (15, 16):  # left/right wrist
                                lm = res.pose_landmarks.landmark[idx]
                                if getattr(lm, "visibility", 1.0) >= args.min_visibility:
                                    wrist_pts.append((lm.x * w, lm.y * h))

                    if wrist_pts:
                        keep = []
                        for i, b in enumerate(boxes_xyxy):
                            cx = (b[0] + b[2]) * 0.5
                            cy = (b[1] + b[3]) * 0.5
                            ok = False
                            for wx, wy in wrist_pts:
                                if (cx - wx) ** 2 + (cy - wy) ** 2 <= args.hand_radius_px ** 2:
                                    ok = True
                                    break
                            if ok:
                                keep.append(i)
                        if keep:
                            boxes_xyxy = boxes_xyxy[keep]
                            ids = [ids[i] for i in keep]
                            confs = confs[keep] if confs is not None else confs
                        else:
                            boxes_xyxy = []
                            ids = []
                            confs = []
                    else:
                        boxes_xyxy = []
                        ids = []
                        confs = []

                seen_now = set(ids)
                for i, tid in enumerate(ids):
                    if tid not in tracks:
                        tracks[tid] = {
                            "first_seen": frame_idx,
                            "last_seen": frame_idx,
                            "hits": 1,
                            "appeared": False,
                            "vanished": False,
                            "bbox": boxes_xyxy[i].tolist(),
                        }
                    else:
                        tr = tracks[tid]
                        tr["last_seen"] = frame_idx
                        tr["hits"] += 1
                        tr["bbox"] = boxes_xyxy[i].tolist()

                    tr = tracks[tid]
                    if (not tr["appeared"]) and tr["hits"] >= args.min_hits:
                        tr["appeared"] = True
                        events.append(
                            {
                                "type": "appear",
                                "frame": int(tr["first_seen"]),
                                "t": round(float(tr["first_seen"] / fps), 4),
                                "track_id": int(tid),
                            }
                        )
                        event_tags.append(f"appear#{tid}")

            for tid, tr in tracks.items():
                if tid in seen_now:
                    continue
                if tr["vanished"]:
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
                base = getattr(r, "orig_img", None)
                if base is None:
                    base = getattr(r, "img", None)
                if base is None:
                    sampled_idx += 1
                    pbar.update(1)
                    continue
                vis = base.copy()
                draw_boxes = boxes_xyxy if boxes_xyxy is not None else []
                draw_ids = ids if ids is not None else None
                draw_confs = confs if confs is not None else None
                for i, b in enumerate(draw_boxes):
                    x1, y1, x2, y2 = [int(v) for v in b]
                    tid = int(draw_ids[i]) if draw_ids is not None else -1
                    score = float(draw_confs[i]) if draw_confs is not None else 0.0
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

            sampled_idx += 1
            pbar.update(1)
            if max_sampled and sampled_idx >= max_sampled:
                break

    finally:
        pbar.close()
        if writer is not None:
            writer.release()
        if temp_video is not None:
            Path(temp_video).unlink(missing_ok=True)
        if pose_filter is not None:
            try:
                pose_filter.close()
            except ValueError:
                pass

    events = sorted(events, key=lambda x: x["t"])

    out = {
        "video": args.video,
        "fps": float(fps),
        "target_fps": float(args.target_fps),
        "stride": int(stride),
        "sampled_fps": float(sampled_fps),
        "model": args.model,
        "prompt": args.prompt,
        "events": events,
    }

    out_path = Path(args.out_json)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] wrote: {out_path} (events={len(events)})")


if __name__ == "__main__":
    main()
