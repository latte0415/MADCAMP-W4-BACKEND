import os
import json
import argparse
from typing import List, Dict, Tuple

import numpy as np
import cv2
import mediapipe as mp
from tqdm import tqdm

mp_pose = mp.solutions.pose


def soft_mask(seg01: np.ndarray) -> np.ndarray:
    """MediaPipe segmentation mask(0..1)을 부드럽게."""
    m = np.clip(seg01.astype(np.float32), 0.0, 1.0)
    m = cv2.GaussianBlur(m, (0, 0), 3)
    m = np.power(m, 1.2)
    return np.clip(m, 0.0, 1.0)


def dilate_mask01(mask01: np.ndarray, dilate_px: int) -> np.ndarray:
    """0..1 마스크를 팽창(dilate). 사람 누출 방지용."""
    if dilate_px <= 0:
        return mask01
    m = (mask01 * 255).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_px, dilate_px))
    m = cv2.dilate(m, k, iterations=1)
    return (m.astype(np.float32) / 255.0)


def robust_zscores(values: np.ndarray) -> np.ndarray:
    """스파이크에 강한 z-score (median/MAD)."""
    v = values.astype(np.float32)
    med = np.median(v)
    mad = np.median(np.abs(v - med)) + 1e-6
    return (v - med) / (1.4826 * mad)


def pick_top_k_with_gap(items: List[Dict], top_k: int, min_gap_frames: int) -> List[Dict]:
    picked = []
    for it in items:
        if len(picked) >= top_k:
            break
        if all(abs(it["frame"] - p["frame"]) >= min_gap_frames for p in picked):
            picked.append(it)
    return picked


def save_frames(video_path: str, picked: List[Dict], out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for saving frames: {video_path}")

    for it in picked:
        fidx = int(it["frame"])
        cap.set(cv2.CAP_PROP_POS_FRAMES, fidx)
        ok, frame = cap.read()
        if not ok:
            continue
        out_path = os.path.join(out_dir, f"bg_change_{fidx:06d}_r{it['ratio']:.2f}_z{it['z']:.2f}.png")
        cv2.imwrite(out_path, frame)

    cap.release()


def main(
    video_path: str,
    out_json: str,
    out_dir: str,
    top_k: int,
    stride: int,
    min_gap_sec: float,
    bg_mode: str,
    seg_threshold: float,
    dilate_px: int,
    ratio_thresh: float,
    bg_abs_thresh: float,
    person_abs_thresh: float,
):
    os.makedirs(os.path.dirname(out_json) or ".", exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    if total_frames <= 0:
        total_frames = None

    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    prev_gray = None

    # 각 프레임의 (S_bg, S_person, ratio) 저장
    series: List[Tuple[int, float, float, float]] = []  # (frame, bg, person, ratio)

    if total_frames is None:
        pbar = tqdm(desc="Processing frames (unknown length)", unit="frame")
        total_proc = None
    else:
        total_proc = (total_frames + stride - 1) // stride
        pbar = tqdm(total=total_proc, desc="Processing frames", unit="frame")

    frame_idx = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_idx % stride != 0:
                frame_idx += 1
                continue

            # speed option
            if bg_mode == "small" and w and h:
                frame_proc = cv2.resize(frame, (w // 2, h // 2))
            else:
                frame_proc = frame

            rgb = cv2.cvtColor(frame_proc, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)

            gray = cv2.cvtColor(frame_proc, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0

            if res.segmentation_mask is None:
                person = np.zeros_like(gray, dtype=np.float32)  # person unknown => treat as none
            else:
                person = soft_mask(res.segmentation_mask)

            # (선택) segmentation harden
            if seg_threshold > 0:
                person = (person >= seg_threshold).astype(np.float32)

            # dilate to prevent leakage
            person_dil = dilate_mask01(person, dilate_px=dilate_px)

            bg = 1.0 - person_dil
            bg = np.clip(bg, 0.0, 1.0)

            if prev_gray is not None:
                diff = np.abs(gray - prev_gray)

                # 평균 변화량
                s_bg = float((diff * bg).mean())
                s_person = float((diff * person_dil).mean())

                ratio = float(s_bg / (s_person + 1e-6))

                series.append((frame_idx, s_bg, s_person, ratio))

            prev_gray = gray

            pbar.update(1)
            frame_idx += 1

    finally:
        pbar.close()
        cap.release()
        pose.close()

    # series -> candidates with gating
    if not series:
        raise RuntimeError("No scores computed (video too short or unreadable).")

    frames = np.array([f for f, _, _, _ in series], dtype=np.int32)
    bg_vals = np.array([b for _, b, _, _ in series], dtype=np.float32)
    person_vals = np.array([p for _, _, p, _ in series], dtype=np.float32)
    ratios = np.array([r for _, _, _, r in series], dtype=np.float32)

    # 후보 게이팅:
    # - bg 절대 변화량이 충분히 큼
    # - ratio가 충분히 큼 (bg가 사람 대비 비정상적)
    # - (선택) person 변화가 너무 크면 제외 (그냥 춤에서 걸러짐)
    gate = (bg_vals >= bg_abs_thresh) & (ratios >= ratio_thresh)
    if person_abs_thresh > 0:
        gate = gate & (person_vals <= person_abs_thresh)

    gated_idx = np.where(gate)[0]

    # 후보가 없으면 "0개"가 정상 출력
    if gated_idx.size == 0:
        out = {
            "video": video_path,
            "fps": float(fps),
            "stride": int(stride),
            "min_gap_seconds": float(min_gap_sec),
            "top_k": int(top_k),
            "bg_mode": bg_mode,
            "seg_threshold": float(seg_threshold),
            "dilate_px": int(dilate_px),
            "ratio_thresh": float(ratio_thresh),
            "bg_abs_thresh": float(bg_abs_thresh),
            "person_abs_thresh": float(person_abs_thresh),
            "picked": [],
            "all_scores_count": int(len(series)),
            "gated_count": 0,
            "note": "No bg-change highlights passed thresholds (this is expected for normal dance-only videos).",
        }
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        # 폴더는 비우는 게 자연스럽지만, 일단 유지
        print("\nNo highlights passed thresholds. Saved empty JSON.")
        print(f"Saved JSON: {out_json}")
        return

    # gated candidates만 z-score
    bg_g = bg_vals[gated_idx]
    z_g = robust_zscores(bg_g)

    candidates = []
    for idx_local, zz in zip(gated_idx, z_g):
        fidx = int(frames[idx_local])
        s_bg = float(bg_vals[idx_local])
        s_person = float(person_vals[idx_local])
        ratio = float(ratios[idx_local])
        candidates.append(
            {
                "frame": fidx,
                "bg_score": s_bg,
                "person_score": s_person,
                "ratio": ratio,
                "z": float(zz),
                "time": float(fidx / fps),
            }
        )

    candidates_sorted = sorted(candidates, key=lambda x: x["z"], reverse=True)

    min_gap_frames = int(min_gap_sec * fps)
    picked = pick_top_k_with_gap(candidates_sorted, top_k=top_k, min_gap_frames=min_gap_frames)

    save_frames(video_path, picked, out_dir)

    out = {
        "video": video_path,
        "fps": float(fps),
        "stride": int(stride),
        "min_gap_seconds": float(min_gap_sec),
        "top_k": int(top_k),
        "bg_mode": bg_mode,
        "seg_threshold": float(seg_threshold),
        "dilate_px": int(dilate_px),
        "ratio_thresh": float(ratio_thresh),
        "bg_abs_thresh": float(bg_abs_thresh),
        "person_abs_thresh": float(person_abs_thresh),
        "picked": picked,
        "all_scores_count": int(len(series)),
        "gated_count": int(len(candidates)),
    }

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"\nSaved JSON: {out_json}")
    print(f"Saved frames: {out_dir}  (count={len(picked)})")
    print(f"Gated candidates: {len(candidates)} / {len(series)}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--out_json", default="outputs/bg_change_events.json")
    p.add_argument("--out_dir", default="outputs/bg_change_frames")
    p.add_argument("--top_k", type=int, default=20)
    p.add_argument("--stride", type=int, default=2, help="2~4 recommended; 1 for max sensitivity")
    p.add_argument("--min_gap_sec", type=float, default=0.7)
    p.add_argument("--bg_mode", choices=["full", "small"], default="small")

    # segmentation control
    p.add_argument("--seg_threshold", type=float, default=0.0, help="0 disables; try 0.5 to harden person mask")
    p.add_argument("--dilate_px", type=int, default=13, help="person mask dilation in pixels-ish (odd 9~17 typical)")

    # highlight gating
    p.add_argument("--ratio_thresh", type=float, default=0.5, help="bg/person ratio threshold")
    p.add_argument("--bg_abs_thresh", type=float, default=0.02, help="absolute bg diff threshold (0..1 scale)")
    p.add_argument("--person_abs_thresh", type=float, default=0.0, help="optional: exclude if person diff > this")

    args = p.parse_args()

    main(
        video_path=args.video,
        out_json=args.out_json,
        out_dir=args.out_dir,
        top_k=args.top_k,
        stride=args.stride,
        min_gap_sec=args.min_gap_sec,
        bg_mode=args.bg_mode,
        seg_threshold=args.seg_threshold,
        dilate_px=args.dilate_px,
        ratio_thresh=args.ratio_thresh,
        bg_abs_thresh=args.bg_abs_thresh,
        person_abs_thresh=args.person_abs_thresh,
    )
