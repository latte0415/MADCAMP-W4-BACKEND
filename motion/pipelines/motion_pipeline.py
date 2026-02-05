import json
import math
from dataclasses import dataclass
from typing import Dict, List, Tuple, Optional

import cv2
import numpy as np
from tqdm import tqdm
from scipy.signal import savgol_filter, find_peaks

import mediapipe as mp

# -------------------------
# Config
# -------------------------
@dataclass
class MotionConfig:
    # smoothing (odd numbers)
    smooth_window: int = 9
    smooth_poly: int = 2

    # event detection
    hit_peak_prominence: float = 0.02   # adjust per video scale after normalization
    hit_min_distance_s: float = 0.18    # minimum distance between hits (seconds)

    stop_energy_thresh: float = 0.08    # lower = stricter stop
    stop_min_hold_s: float = 0.25       # hold duration (seconds)

    # which joints to track strongly (mediapipe indices)
    # We'll focus on wrists/ankles for "hits" (common in dance/performance)
    track_joints: Tuple[int, ...] = (
        15, 16,  # left/right wrist
        27, 28,  # left/right ankle
    )

    # torso reference joints for normalization
    torso_joints: Tuple[int, ...] = (11, 12, 23, 24)  # L/R shoulder, L/R hip
    shoulder_left: int = 11
    shoulder_right: int = 12


# -------------------------
# Utilities
# -------------------------
def _ensure_odd(n: int) -> int:
    return n if n % 2 == 1 else n + 1

def smooth_1d(x: np.ndarray, window: int, poly: int) -> np.ndarray:
    window = _ensure_odd(max(3, window))
    if len(x) < window:
        return x
    return savgol_filter(x, window_length=window, polyorder=min(poly, window - 1))

def robust_scale(values: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    """
    Optional: standardize feature magnitude a bit.
    """
    med = np.median(values)
    mad = np.median(np.abs(values - med)) + eps
    return (values - med) / mad

def l2(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


# -------------------------
# Core: Pose extraction
# -------------------------
def extract_pose_xy(video_path: str) -> Tuple[np.ndarray, float]:
    """
    Returns:
      poses: (T, J, 2) in normalized image coords [0..1] (x,y)
      fps
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0  # fallback

    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    frames_xy: List[np.ndarray] = []
    num_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    stride = 2 if fps > 30 else 1

    for frame_idx in tqdm(range(num_frames), desc="Extract pose"):
        ok, frame = cap.read()
        if not ok:
            break
        if stride > 1 and (frame_idx % stride != 0):
            continue
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = pose.process(rgb)

        if not res.pose_landmarks:
            # if missing, fill with NaNs so later we can interpolate
            frames_xy.append(np.full((33, 2), np.nan, dtype=np.float32))
            continue

        pts = np.array(
            [(lm.x, lm.y) for lm in res.pose_landmarks.landmark],
            dtype=np.float32
        )  # (33,2)
        frames_xy.append(pts)

    cap.release()
    pose.close()

    poses = np.stack(frames_xy, axis=0)  # (T,33,2)
    return poses, float(fps / stride)


def interpolate_nans(poses: np.ndarray) -> np.ndarray:
    """
    poses: (T,J,2) with NaNs
    Linear interpolation per joint, per coord.
    """
    out = poses.copy()
    T, J, C = out.shape
    for j in range(J):
        for c in range(C):
            x = out[:, j, c]
            nan = np.isnan(x)
            if nan.all():
                # nothing detected for this joint
                out[:, j, c] = 0.0
                continue
            idx = np.arange(T)
            x[nan] = np.interp(idx[nan], idx[~nan], x[~nan])
            out[:, j, c] = x
    return out


# -------------------------
# Normalization + features
# -------------------------
def normalize_pose(poses: np.ndarray, cfg: MotionConfig) -> np.ndarray:
    """
    torso-centered and shoulder-width scaled.
    poses: (T,33,2) in [0..1] coords
    returns poses_norm: (T,33,2)
    """
    poses = poses.copy()

    # torso center
    torso = poses[:, cfg.torso_joints, :]  # (T,4,2)
    center = np.mean(torso, axis=1)        # (T,2)

    # shoulder width scale
    sl = poses[:, cfg.shoulder_left, :]
    sr = poses[:, cfg.shoulder_right, :]
    shoulder_w = np.linalg.norm(sl - sr, axis=1)  # (T,)

    # avoid divide-by-zero
    shoulder_w = np.clip(shoulder_w, 1e-4, None)

    poses_norm = (poses - center[:, None, :]) / shoulder_w[:, None, None]
    return poses_norm


def smooth_pose(poses_norm: np.ndarray, cfg: MotionConfig) -> np.ndarray:
    out = poses_norm.copy()
    T, J, C = out.shape
    for j in range(J):
        for c in range(C):
            out[:, j, c] = smooth_1d(out[:, j, c], cfg.smooth_window, cfg.smooth_poly)
    return out


def compute_features(poses_norm: np.ndarray, fps: float, cfg: MotionConfig) -> Dict[str, np.ndarray]:
    """
    Returns features:
      joint_speed: (T,) aggregated for tracked joints
      joint_accel: (T,) aggregated for tracked joints
      energy: (T,) whole-body motion energy
      per_joint_speed: (T, len(track_joints))
    """
    T = poses_norm.shape[0]

    # velocity per frame per joint
    vel = np.zeros((T, 33, 2), dtype=np.float32)
    vel[1:] = poses_norm[1:] - poses_norm[:-1]

    speed = np.linalg.norm(vel, axis=2)  # (T,33)
    # accel magnitude (difference of speed)
    accel = np.zeros_like(speed)
    accel[1:] = speed[1:] - speed[:-1]
    accel = np.abs(accel)  # magnitude of change

    # focus on key joints
    track = np.array(cfg.track_joints, dtype=int)
    per_joint_speed = speed[:, track]  # (T,K)
    per_joint_accel = accel[:, track]  # (T,K)

    joint_speed = np.mean(per_joint_speed, axis=1)  # (T,)
    joint_accel = np.mean(per_joint_accel, axis=1)  # (T,)

    # whole body energy (mean speed over all joints)
    energy = np.mean(speed, axis=1)  # (T,)

    # smooth features a bit (avoid spurious peaks)
    joint_speed = smooth_1d(joint_speed, cfg.smooth_window, cfg.smooth_poly)
    joint_accel = smooth_1d(joint_accel, cfg.smooth_window, cfg.smooth_poly)
    energy = smooth_1d(energy, cfg.smooth_window, cfg.smooth_poly)

    return {
        "joint_speed": joint_speed,
        "joint_accel": joint_accel,
        "energy": energy,
        "per_joint_speed": per_joint_speed,
        "per_joint_accel": per_joint_accel,
    }


# -------------------------
# Event detection
# -------------------------
def detect_hit_events(joint_accel: np.ndarray, fps: float, cfg: MotionConfig) -> List[int]:
    """
    Hit: peaks in joint_accel
    """
    distance = int(cfg.hit_min_distance_s * fps)
    distance = max(1, distance)

    peaks, _ = find_peaks(
        joint_accel,
        prominence=cfg.hit_peak_prominence,
        distance=distance
    )
    return peaks.tolist()


def detect_stop_events(energy: np.ndarray, fps: float, cfg: MotionConfig) -> List[Tuple[int, int]]:
    """
    Stop/Hold: energy below threshold for at least stop_min_hold_s.
    Returns list of (start_frame, end_frame)
    """
    below = energy < cfg.stop_energy_thresh
    min_len = int(cfg.stop_min_hold_s * fps)
    min_len = max(1, min_len)

    holds = []
    start = None
    for i, b in enumerate(below):
        if b and start is None:
            start = i
        if (not b) and start is not None:
            if i - start >= min_len:
                holds.append((start, i - 1))
            start = None
    if start is not None:
        if len(below) - start >= min_len:
            holds.append((start, len(below) - 1))
    return holds


def to_seconds(frame_idx: int, fps: float, offset_s: float = 0.0) -> float:
    return frame_idx / fps + offset_s


# -------------------------
# Main pipeline
# -------------------------
def run_motion_pipeline(
    video_path: str,
    output_json_path: str,
    music_start_offset_s: float = 0.0,
    cfg: Optional[MotionConfig] = None
) -> Dict:
    """
    music_start_offset_s:
      If user sets "music starts at 1.2s into the video", then offset = -1.2
      (so video t=1.2 aligns to music t=0.0)
    """
    cfg = cfg or MotionConfig()

    poses, fps = extract_pose_xy(video_path)
    poses = interpolate_nans(poses)
    poses_norm = normalize_pose(poses, cfg)
    poses_norm = smooth_pose(poses_norm, cfg)

    feats = compute_features(poses_norm, fps, cfg)

    hit_frames = detect_hit_events(feats["joint_accel"], fps, cfg)
    holds = detect_stop_events(feats["energy"], fps, cfg)

    events = []
    for f in hit_frames:
        events.append({
            "type": "hit",
            "frame": int(f),
            "t": round(to_seconds(f, fps, music_start_offset_s), 4),
        })

    for (s, e) in holds:
        events.append({
            "type": "hold",
            "start_frame": int(s),
            "end_frame": int(e),
            "t_start": round(to_seconds(s, fps, music_start_offset_s), 4),
            "t_end": round(to_seconds(e, fps, music_start_offset_s), 4),
        })

    events = sorted(events, key=lambda x: x.get("t", x.get("t_start", 0.0)))

    result = {
        "video_path": video_path,
        "fps": fps,
        "music_start_offset_s": music_start_offset_s,
        "features": {
            # For MVP: store downsampled arrays to keep JSON small (optional)
            "joint_accel": feats["joint_accel"].tolist(),
            "energy": feats["energy"].tolist(),
        },
        "events": events,
    }

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    return result


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, help="Path to input video (mp4)")
    parser.add_argument("--out", default="outputs/motion_result.json", help="Output json path")
    parser.add_argument(
        "--music_offset",
        type=float,
        default=0.0,
        help="Seconds offset to align video time to music time (video_t + offset = music_t)"
    )
    args = parser.parse_args()

    run_motion_pipeline(args.video, args.out, args.music_offset)
    print(f"Saved: {args.out}")
