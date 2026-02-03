#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import math
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from tqdm import tqdm


# -----------------------------
# Utilities
# -----------------------------

def segment_from_novelty(times, novelty_z, energy_z, fps, pct, min_gap_frames, min_len_sec, max_len_sec):
    T = len(novelty_z)
    thr = np.percentile(novelty_z, pct)

    # boundary candidates: high novelty
    cand = np.where(novelty_z >= thr)[0].tolist()

    # merge by min_gap
    merged = []
    last = -10**9
    for i in cand:
        if i - last >= int(min_gap_frames):
            merged.append(i)
            last = i

    # boundaries include start/end
    bounds = [0] + merged + [T - 1]
    bounds = sorted(set(bounds))

    # build segments
    segs = []
    sid = 0
    for a, b in zip(bounds[:-1], bounds[1:]):
        if b <= a:
            continue
        dur = (b - a) / max(fps, 1e-6)
        if dur < float(min_len_sec):
            continue
        if dur > float(max_len_sec):
            # split long segments by inserting mid points
            step = int(float(max_len_sec) * fps)
            cur = a
            while cur < b:
                nxt = min(b, cur + step)
                segs.append((cur, nxt))
                cur = nxt
        else:
            segs.append((a, b))

    # package output + representative frames
    segments = []
    for (a, b) in segs:
        sl = slice(a, b + 1)
        core_score = float(np.nanmean(energy_z[sl])) if np.isfinite(energy_z[sl]).any() else float(np.nanmean(novelty_z[sl]))
        peak_idx = int(a + np.nanargmax(novelty_z[sl])) if np.isfinite(novelty_z[sl]).any() else int(a)

        segments.append({
            "id": sid,
            "start_frame": int(a),
            "end_frame": int(b),
            "start_time": float(times[a]),
            "end_time": float(times[b]),
            "type": "motion",
            "core_score": core_score,
            "metrics": {
                "peak_novelty": float(np.nanmax(novelty_z[sl])) if np.isfinite(novelty_z[sl]).any() else float("nan"),
                "energy_mean": float(np.nanmean(energy_z[sl])) if np.isfinite(energy_z[sl]).any() else float("nan"),
            },
            "representative": {"peak_frame": peak_idx}
        })
        sid += 1

    debug = {
        "thr": float(thr),
        "boundaries": bounds,
        "novelty_z": novelty_z,
        "energy_z": energy_z,
    }
    return segments, debug


def _try_extract_features_timeseries(data: dict):
    """
    Supports your motion_result.json:
      {
        "fps": 60.0,
        "features": {
          "joint_accel": [...],
          "energy": [...]
        }
      }
    Also supports older names if present.
    Returns (times, feats, fps) or None
    """
    if not isinstance(data, dict) or "features" not in data:
        return None
    feats = data.get("features")
    if not isinstance(feats, dict):
        return None

    fps = float(data.get("fps", 30.0))

    # pick a main series to define T
    main = None
    for k in ["joint_accel", "energy", "accel", "speed", "jerk", "novelty"]:
        v = feats.get(k)
        if isinstance(v, list) and len(v) > 10:
            main = v
            break
    if main is None:
        return None
    T = len(main)

    def get_arr(key, fallback_key=None, default=0.0):
        v = feats.get(key)
        if v is None and fallback_key is not None:
            v = feats.get(fallback_key)
        if isinstance(v, list) and len(v) == T:
            return np.asarray(v, dtype=np.float32)
        return np.full((T,), float(default), dtype=np.float32)

    # times: if not provided, use frame index
    times = None
    for tk in ["time", "times", "t", "timestamps", "timestamp"]:
        tv = feats.get(tk)
        if isinstance(tv, list) and len(tv) == T:
            times = np.asarray(tv, dtype=np.float32)
            break
    if times is None:
        times = np.arange(T, dtype=np.float32) / max(fps, 1e-6)

    # Map your keys into the generic names expected downstream
    joint_accel = get_arr("joint_accel", fallback_key="accel", default=0.0)
    energy = get_arr("energy", default=0.0)

    out = {
        # treat joint_accel as novelty driver
        "novelty": joint_accel,
        # energy can help classify/score
        "energy": energy,
        # fill others as zeros (pipeline compatibility)
        "turn": np.zeros((T,), np.float32),
        "shape": np.zeros((T,), np.float32),
        "hold": np.zeros((T,), np.float32),
    }
    return times, out, fps
def _find_numeric_array(obj, max_depth=6):
    """Find nested numeric arrays inside json (list of list of ...)."""
    if max_depth < 0:
        return None
    if isinstance(obj, list) and len(obj) > 0:
        return obj
    if isinstance(obj, dict):
        for v in obj.values():
            r = _find_numeric_array(v, max_depth=max_depth-1)
            if r is not None:
                return r
    return None


def _try_extract_TJ2(data: dict):
    """
    Try to extract:
      - keypoints array: shape (T,J,2) or (T,J,>=2)
      - confidence array: shape (T,J) optional
      - times array: shape (T,) optional
    Returns (times, pts, conf) or None
    """
    if not isinstance(data, dict):
        return None

    # common key candidates
    kp_keys = ["keypoints_2d", "keypoints2d", "keypoints", "landmarks", "pose_landmarks", "pts", "points"]
    conf_keys = ["conf", "confidence", "scores", "visibilities", "visibility"]
    time_keys = ["times", "time", "timestamps", "timestamp", "t"]

    kp = None
    for k in kp_keys:
        if k in data:
            kp = data[k]
            break

    # Sometimes nested under result/motion/pose
    if kp is None:
        for outer in ["motion", "result", "outputs", "pose", "data"]:
            if outer in data and isinstance(data[outer], dict):
                for k in kp_keys:
                    if k in data[outer]:
                        kp = data[outer][k]
                        break
            if kp is not None:
                break

    if kp is None:
        return None

    # Convert kp to np
    try:
        kp_arr = np.asarray(kp, dtype=np.float32)
    except Exception:
        return None

    if kp_arr.ndim < 3:
        return None

    # Keep first 2 dims as x,y
    pts = kp_arr[..., :2]  # (T,J,2)
    T = pts.shape[0]
    J = pts.shape[1]

    # confidence (optional)
    conf = None
    csrc = None
    for k in conf_keys:
        if k in data:
            csrc = data[k]
            break
    if csrc is None:
        for outer in ["motion", "result", "outputs", "pose", "data"]:
            if outer in data and isinstance(data[outer], dict):
                for k in conf_keys:
                    if k in data[outer]:
                        csrc = data[outer][k]
                        break
            if csrc is not None:
                break

    if csrc is not None:
        try:
            conf_arr = np.asarray(csrc, dtype=np.float32)
            if conf_arr.ndim == 2 and conf_arr.shape[0] == T:
                conf = conf_arr
            elif conf_arr.ndim == 3 and conf_arr.shape[0] == T:
                conf = conf_arr[..., 0]
        except Exception:
            conf = None

    if conf is None:
        # if kp includes 3rd channel per joint as confidence
        if kp_arr.shape[-1] >= 3:
            conf = kp_arr[..., 2]
        else:
            conf = np.ones((T, J), np.float32)

    # times (optional)
    times = None
    ts = None
    for k in time_keys:
        if k in data:
            ts = data[k]
            break
    if ts is None:
        for outer in ["motion", "result", "outputs", "pose", "data"]:
            if outer in data and isinstance(data[outer], dict):
                for k in time_keys:
                    if k in data[outer]:
                        ts = data[outer][k]
                        break
            if ts is not None:
                break

    if ts is not None:
        try:
            ts_arr = np.asarray(ts, dtype=np.float32)
            if ts_arr.ndim == 1 and ts_arr.shape[0] == T:
                times = ts_arr
        except Exception:
            times = None

    if times is None:
        times = np.arange(T, dtype=np.float32)  # frame index

    return times, pts.astype(np.float32), conf.astype(np.float32)


def robust_z(x: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    """Robust z-score using median and MAD."""
    x = np.asarray(x, dtype=np.float32)
    med = np.median(x)
    mad = np.median(np.abs(x - med)) + eps
    # 1.4826 makes MAD consistent with std under normality
    return (x - med) / (1.4826 * mad + eps)

def wrap_pi(a: np.ndarray) -> np.ndarray:
    """Wrap angle to [-pi, pi]."""
    return (a + np.pi) % (2 * np.pi) - np.pi

def ema(x: np.ndarray, alpha: float = 0.2) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    y = np.zeros_like(x)
    y[0] = x[0]
    for i in range(1, len(x)):
        y[i] = alpha * x[i] + (1 - alpha) * y[i - 1]
    return y

def moving_avg(x: np.ndarray, win: int = 5) -> np.ndarray:
    if win <= 1:
        return x.astype(np.float32)
    x = np.asarray(x, dtype=np.float32)
    pad = win // 2
    xp = np.pad(x, (pad, pad), mode="edge")
    k = np.ones(win, dtype=np.float32) / win
    return np.convolve(xp, k, mode="valid")

def local_maxima(x: np.ndarray) -> np.ndarray:
    """Return boolean mask of strict local maxima (excluding endpoints)."""
    x = np.asarray(x, dtype=np.float32)
    m = np.zeros_like(x, dtype=bool)
    if len(x) < 3:
        return m
    m[1:-1] = (x[1:-1] > x[:-2]) & (x[1:-1] > x[2:])
    return m

def safe_get(d: Dict[str, Any], keys: List[str], default=None):
    for k in keys:
        if k in d:
            return d[k]
    return default


# -----------------------------
# Adaptive loader for motion_result.json
# -----------------------------

@dataclass
class MotionData:
    times: np.ndarray          # (T,)
    pts: np.ndarray            # (T, J, 2) float32
    conf: np.ndarray           # (T, J) float32
    fps: float                 # inferred or provided
    meta: Dict[str, Any]


def _parse_landmarks_list(lms: Any) -> Tuple[np.ndarray, np.ndarray]:
    """
    Accepts:
      - list of dicts with keys x,y, (visibility|score|confidence)
      - list of [x,y] or [x,y,c]
      - dict with "landmarks" field
    Returns pts (J,2), conf (J,)
    """
    if isinstance(lms, dict):
        # sometimes { "landmarks": [...] }
        for k in ["landmarks", "keypoints", "pose_landmarks", "pose"]:
            if k in lms:
                lms = lms[k]
                break

    if not isinstance(lms, list) or len(lms) == 0:
        return np.zeros((0, 2), np.float32), np.zeros((0,), np.float32)

    pts = []
    cf = []
    for it in lms:
        if isinstance(it, dict):
            x = float(safe_get(it, ["x", "X", "u"], 0.0))
            y = float(safe_get(it, ["y", "Y", "v"], 0.0))
            c = safe_get(it, ["visibility", "score", "confidence", "conf", "p"], 1.0)
            c = float(c) if c is not None else 1.0
            pts.append([x, y])
            cf.append(c)
        elif isinstance(it, (list, tuple)) and len(it) >= 2:
            x, y = float(it[0]), float(it[1])
            c = float(it[2]) if len(it) >= 3 else 1.0
            pts.append([x, y])
            cf.append(c)
        else:
            # unknown
            continue

    pts = np.asarray(pts, dtype=np.float32)
    cf = np.asarray(cf, dtype=np.float32)
    return pts, cf


def _is_frame_dict(d: Any) -> bool:
    """Heuristic: a dict that looks like a single frame entry."""
    if not isinstance(d, dict):
        return False
    # time-like key + landmarks-like key
    has_time = any(k in d for k in ["time", "timestamp", "t", "sec", "seconds", "time_ms", "timestamp_ms", "frame", "frame_idx"])
    has_pose = any(k in d for k in ["keypoints_2d", "keypoints", "landmarks", "pose_landmarks", "pose", "result", "outputs"])
    return has_pose and (has_time or True)  # time is optional in some dumps


def _dict_values_sorted_as_list(d: Dict[str, Any]) -> Optional[List[Any]]:
    """
    If d is like {"0": {...}, "1": {...}} return list ordered by numeric key.
    """
    if not isinstance(d, dict) or len(d) == 0:
        return None
    keys = list(d.keys())
    # numeric string keys?
    if all(isinstance(k, str) and k.isdigit() for k in keys):
        items = [(int(k), d[k]) for k in keys]
        items.sort(key=lambda x: x[0])
        return [v for _, v in items]
    return None


def _find_frames_container(obj: Any, max_depth: int = 6) -> Optional[List[Any]]:
    """
    Recursively search for a "frames list" inside arbitrary JSON structures.
    Returns a list of frame-like objects if found.
    """
    if max_depth < 0:
        return None

    # Case 1: already a list of frames
    if isinstance(obj, list) and len(obj) > 0:
        # If list elements are dicts and look frame-like -> accept
        if isinstance(obj[0], dict):
            # accept if majority look frame-like
            sample = obj[: min(20, len(obj))]
            score = sum(1 for x in sample if _is_frame_dict(x))
            if score >= max(1, len(sample) // 3):
                return obj
        # If list of landmarks directly, also accept (frame==landmarks)
        if isinstance(obj[0], (list, dict)):
            return obj

    # Case 2: dict keyed by frame index
    if isinstance(obj, dict):
        as_list = _dict_values_sorted_as_list(obj)
        if as_list is not None:
            # verify it looks like frames
            if len(as_list) > 0:
                return as_list

        # Case 3: known keys
        for k in ["frames", "results", "poses", "pose_frames", "items", "sequence", "data", "samples", "records"]:
            if k in obj:
                found = _find_frames_container(obj[k], max_depth=max_depth - 1)
                if found is not None:
                    return found

        # Case 4: brute-force search in children
        for v in obj.values():
            found = _find_frames_container(v, max_depth=max_depth - 1)
            if found is not None:
                return found

    return None

def load_motion_json(path: str, fps_arg: Optional[float] = None) -> MotionData:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    meta = {}
    if isinstance(data, dict):
        meta = {"top_keys": list(data.keys())[:80]}

    # ---------------------------
    # 1) Try array-based extraction first (T,J,2)
    # ---------------------------
    if isinstance(data, dict):
        got = _try_extract_TJ2(data)
        if got is not None:
            times, pts, conf = got
            T = int(pts.shape[0])

            # fps handling
            fps = float(fps_arg) if fps_arg is not None else 30.0
            if fps_arg is None and T >= 5:
                dt = np.diff(times)
                dt = dt[np.isfinite(dt) & (dt > 1e-6)]
                if len(dt) > 0:
                    med_dt = float(np.median(dt))
                    # if times are seconds, med_dt ~ 1/fps (e.g. 0.033)
                    # if times are frame idx, med_dt ~ 1.0
                    if med_dt < 0.5:
                        fps = 1.0 / med_dt

            if fps < 5 or fps > 240:
                fps = float(fps_arg) if fps_arg is not None else 30.0

            meta = {**meta, "mode": "TJ2-array"}
            print(f"[DBG] Loaded array mode: T={T}, J={pts.shape[1]}, mean_conf={float(conf.mean()):.3f}, fps={fps:.2f}")
            return MotionData(times=times, pts=pts, conf=conf, fps=fps, meta=meta)

    # ---------------------------
    # 2) Fallback: find frame container (list of dict frames)
    # ---------------------------
    frames = _find_frames_container(data, max_depth=8)
    if frames is None:
        raise ValueError(
            f"Could not find frames container in {path}. "
            f"Your JSON might store arrays like (T,J,2) instead of frame dicts."
        )

    # Guard: if the found list is floats (timestamps), reject and keep searching deeper
    # (this fixes the exact issue you saw)
    if isinstance(frames, list) and len(frames) > 0 and isinstance(frames[0], (int, float)):
        # try to find another list deeper that is NOT numeric
        alt = None

        def _find_non_numeric_list(obj, max_depth=8):
            if max_depth < 0:
                return None
            if isinstance(obj, list) and len(obj) > 0:
                if not isinstance(obj[0], (int, float)):
                    return obj
            if isinstance(obj, dict):
                for v in obj.values():
                    r = _find_non_numeric_list(v, max_depth=max_depth - 1)
                    if r is not None:
                        return r
            return None

        alt = _find_non_numeric_list(data, max_depth=8)
        if alt is not None:
            frames = alt
        else:
            raise ValueError(
                f"Found a numeric list (likely timestamps) but no frame dict list. "
                f"Most likely your JSON is array-based (T,J,2)."
            )

    times: List[float] = []
    pts_list: List[np.ndarray] = []
    cf_list: List[np.ndarray] = []

    for idx, fr in enumerate(tqdm(frames, desc="Loading frames", unit="frame")):
        if not isinstance(fr, dict):
            pts, cf = _parse_landmarks_list(fr)
            t = float(idx)
        else:
            t = safe_get(fr, ["time", "timestamp", "t", "sec", "seconds"], None)
            if t is None:
                t_ms = safe_get(fr, ["time_ms", "timestamp_ms"], None)
                if t_ms is not None:
                    t = float(t_ms) / 1000.0
                else:
                    fi = safe_get(fr, ["frame", "frame_idx", "index"], None)
                    t = float(fi) if fi is not None else float(idx)

            lms = safe_get(fr, ["keypoints_2d", "keypoints", "landmarks", "landmark", "pose_landmarks", "pose_world_landmarks", "pose"], None)
            if lms is None:
                for k in ["pose", "result", "outputs"]:
                    if k in fr and isinstance(fr[k], dict):
                        lms = safe_get(fr[k], ["keypoints_2d", "keypoints", "landmarks", "landmark", "pose_landmarks", "pose_world_landmarks"], None)
                        if lms is not None:
                            break
            pts, cf = _parse_landmarks_list(lms)

            scores = safe_get(fr, ["scores", "conf", "confidence"], None)
            if isinstance(scores, list) and len(scores) == len(cf):
                cf = np.asarray(scores, dtype=np.float32)

        times.append(float(t))
        pts_list.append(pts)
        cf_list.append(cf)

    # pad to max joints
    Jmax = max((p.shape[0] for p in pts_list), default=0)
    T = len(pts_list)
    pts = np.zeros((T, Jmax, 2), np.float32)
    conf = np.zeros((T, Jmax), np.float32)

    for i in range(T):
        p = pts_list[i]
        c = cf_list[i]
        if p.shape[0] == 0:
            continue
        j = p.shape[0]
        pts[i, :j] = p[:j, :2]
        conf[i, :j] = c[:j]

    times = np.asarray(times, dtype=np.float32)

    # infer fps if possible
    fps = float(fps_arg) if fps_arg is not None else 0.0
    if fps_arg is None:
        if T >= 5:
            dt = np.diff(times)
            dt = dt[np.isfinite(dt) & (dt > 1e-6)]
            if len(dt) > 0:
                med_dt = float(np.median(dt))
                fps = 1.0 / med_dt if med_dt > 0 else 30.0
            else:
                fps = 30.0
        else:
            fps = 30.0

    if fps < 5 or fps > 240:
        fps = float(fps_arg) if fps_arg is not None else 30.0

    meta = {**meta, "mode": "frame-dicts"}
    print(f"[DBG] Loaded frame-dict mode: T={T}, J={Jmax}, mean_conf={float(conf.mean()):.3f}, fps={fps:.2f}")
    return MotionData(times=times, pts=pts, conf=conf, fps=fps, meta=meta)
# -----------------------------
# Feature extraction
# -----------------------------

def compute_scale(pts: np.ndarray, conf: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    """
    Compute per-frame scale factor to normalize motion.
    Heuristic: use bbox diagonal in normalized coordinate space.
    """
    T, J, _ = pts.shape
    scale = np.ones((T,), np.float32)
    for t in range(T):
        m = conf[t] > 0.1
        if not np.any(m):
            scale[t] = 1.0
            continue
        p = pts[t][m]
        xmin, ymin = np.min(p, axis=0)
        xmax, ymax = np.max(p, axis=0)
        diag = float(np.hypot(xmax - xmin, ymax - ymin))
        scale[t] = max(diag, eps)
    # stabilize with median
    med = float(np.median(scale[scale > eps])) if np.any(scale > eps) else 1.0
    scale = np.clip(scale, med * 0.25, med * 4.0).astype(np.float32)
    return scale

def normalize_pose(pts: np.ndarray, conf: np.ndarray, scale: np.ndarray) -> np.ndarray:
    """
    Center each frame at centroid of confident joints, and divide by scale.
    Returns normalized pts (T,J,2).
    """
    T, J, _ = pts.shape
    out = pts.copy().astype(np.float32)
    for t in range(T):
        m = conf[t] > 0.1
        if np.any(m):
            cen = np.mean(out[t][m], axis=0)
        else:
            cen = np.zeros((2,), np.float32)
        out[t] = (out[t] - cen[None, :]) / (scale[t] + 1e-6)
    return out

def feature_timeseries(pts: np.ndarray, conf: np.ndarray, fps: float, smooth_win: int = 5) -> Dict[str, np.ndarray]:
    """
    Build core features for segmentation.
    """
    T, J, _ = pts.shape
    scale = compute_scale(pts, conf)
    npts = normalize_pose(pts, conf, scale)

    # displacement per joint (masked)
    dp = np.zeros((T, J), np.float32)
    for t in range(1, T):
        m = (conf[t] > 0.1) & (conf[t - 1] > 0.1)
        if np.any(m):
            d = npts[t, m] - npts[t - 1, m]
            dp[t, m] = np.linalg.norm(d, axis=1).astype(np.float32)

    speed = np.mean(dp, axis=1)  # (T,)
    accel = np.zeros_like(speed)
    jerk = np.zeros_like(speed)
    accel[1:] = speed[1:] - speed[:-1]
    jerk[2:] = accel[2:] - accel[1:-1]

    # torso turn proxy: use PCA of points to approximate orientation change
    # (more robust across unknown joint indexing)
    turn = np.zeros((T,), np.float32)
    angles = np.zeros((T,), np.float32)
    for t in range(T):
        m = conf[t] > 0.1
        if np.sum(m) >= 3:
            p = npts[t, m]
            # covariance and principal axis
            C = np.cov(p.T)
            vals, vecs = np.linalg.eigh(C)
            axis = vecs[:, np.argmax(vals)]
            angles[t] = float(math.atan2(axis[1], axis[0]))
        else:
            angles[t] = angles[t - 1] if t > 0 else 0.0

    dtheta = wrap_pi(np.diff(angles, prepend=angles[0]))
    turn = np.abs(dtheta).astype(np.float32)

    # pose embedding change (shape proxy)
    # flatten normalized points but zero out low-conf joints
    emb = npts.reshape(T, -1).copy()
    mflat = np.repeat((conf > 0.1).astype(np.float32), 2, axis=1)  # (T, 2J)
    emb *= mflat
    shape = np.zeros((T,), np.float32)
    diff = emb[1:] - emb[:-1]
    shape[1:] = np.linalg.norm(diff, axis=1).astype(np.float32) / math.sqrt(max(1, emb.shape[1]))

    # smooth
    if smooth_win and smooth_win > 1:
        speed_s = moving_avg(speed, smooth_win)
        jerk_s = moving_avg(jerk, smooth_win)
        turn_s = moving_avg(turn, smooth_win)
        shape_s = moving_avg(shape, smooth_win)
    else:
        speed_s, jerk_s, turn_s, shape_s = speed, jerk, turn, shape

    # hold frames (later use run-length)
    return {
        "speed": speed_s.astype(np.float32),
        "accel": accel.astype(np.float32),
        "jerk": jerk_s.astype(np.float32),
        "turn": turn_s.astype(np.float32),
        "shape": shape_s.astype(np.float32),
        "scale": scale.astype(np.float32),
    }


# -----------------------------
# Segmentation
# -----------------------------

def hold_mask(speed: np.ndarray, fps: float, low_pct: float = 15.0, min_hold_sec: float = 0.2) -> np.ndarray:
    """
    Mark frames as hold if speed stays below percentile for >= min_hold_sec.
    """
    T = len(speed)
    thr = np.percentile(speed, low_pct)
    raw = speed <= thr
    min_len = max(1, int(round(min_hold_sec * fps)))
    out = np.zeros((T,), dtype=bool)

    i = 0
    while i < T:
        if not raw[i]:
            i += 1
            continue
        j = i
        while j < T and raw[j]:
            j += 1
        if (j - i) >= min_len:
            out[i:j] = True
        i = j
    return out

def find_boundaries(novelty: np.ndarray, min_gap_frames: int, pct: float = 90.0) -> List[int]:
    """
    Pick boundary candidates as local maxima above percentile threshold.
    Enforce min gap.
    """
    T = len(novelty)
    if T < 3:
        return []
    thr = np.percentile(novelty, pct)
    is_peak = local_maxima(novelty) & (novelty >= thr)
    idxs = np.where(is_peak)[0].tolist()
    if not idxs:
        return []

    # enforce min gap by greedy selection on peak height
    idxs_sorted = sorted(idxs, key=lambda i: float(novelty[i]), reverse=True)
    picked: List[int] = []
    taken = np.zeros((T,), dtype=bool)
    for i in idxs_sorted:
        lo = max(0, i - min_gap_frames)
        hi = min(T, i + min_gap_frames + 1)
        if np.any(taken[lo:hi]):
            continue
        picked.append(i)
        taken[lo:hi] = True
    picked.sort()
    return picked

def merge_short_segments(bounds: List[int], T: int, fps: float, min_len_sec: float) -> List[int]:
    """
    Given internal boundaries, remove ones producing too-short segments by merging.
    """
    if not bounds:
        return []
    min_len = max(1, int(round(min_len_sec * fps)))
    b = [0] + bounds + [T - 1]
    keep_internal = bounds.copy()

    changed = True
    while changed and keep_internal:
        changed = False
        b = [0] + keep_internal + [T - 1]
        seg_lens = [b[i+1] - b[i] for i in range(len(b)-1)]
        # find smallest segment
        k = int(np.argmin(seg_lens))
        if seg_lens[k] >= min_len:
            break
        # remove a boundary adjacent to that smallest segment (prefer removing the boundary that yields better balance)
        # If segment is between b[k]..b[k+1], boundaries are b[k] and b[k+1] (internal are in keep_internal)
        # Remove internal boundary at index k (which is keep_internal[k-1]) or at index k+1 (keep_internal[k]) depending.
        if k == 0:
            # first segment too short -> remove first boundary
            del keep_internal[0]
        elif k == len(seg_lens) - 1:
            # last segment too short -> remove last boundary
            del keep_internal[-1]
        else:
            # middle short: remove the boundary that yields larger merged segment
            left_merge = b[k+1] - b[k-1]
            right_merge = b[k+2] - b[k]
            # remove boundary between (k-1,k) or (k,k+1)
            if left_merge >= right_merge:
                # remove boundary at b[k] which is keep_internal[k-1]
                del keep_internal[k-1]
            else:
                # remove boundary at b[k+1] which is keep_internal[k]
                del keep_internal[k]
        changed = True

    return keep_internal

def split_long_segments(bounds: List[int], novelty: np.ndarray, fps: float, max_len_sec: float, min_gap_frames: int) -> List[int]:
    """
    If a segment is too long, split by adding strongest novelty peaks inside.
    """
    T = len(novelty)
    max_len = max(2, int(round(max_len_sec * fps)))
    internal = bounds.copy()

    changed = True
    while changed:
        changed = False
        b = [0] + internal + [T - 1]
        for i in range(len(b) - 1):
            s, e = b[i], b[i + 1]
            if (e - s) <= max_len:
                continue
            # add a new boundary at the max novelty point within (s+gap, e-gap)
            lo = s + min_gap_frames
            hi = e - min_gap_frames
            if hi <= lo + 1:
                continue
            k = int(lo + np.argmax(novelty[lo:hi]))
            if k not in internal:
                internal.append(k)
                internal.sort()
                changed = True
                break

    return internal


def segment_and_classify(
    times: np.ndarray,
    feats: Dict[str, np.ndarray],
    fps: float,
    pct: float = 90.0,
    min_gap_frames: int = 15,
    min_len_sec: float = 0.6,
    max_len_sec: float = 6.0,
    w_jerk: float = 0.5,
    w_turn: float = 0.3,
    w_shape: float = 0.2,
) -> Tuple[List[Dict[str, Any]], Dict[str, np.ndarray]]:
    speed = feats["speed"]
    jerk = feats["jerk"]
    turn = feats["turn"]
    shape = feats["shape"]

    # Build novelty
    nov = (w_jerk * robust_z(np.abs(jerk)) +
           w_turn * robust_z(turn) +
           w_shape * robust_z(shape)).astype(np.float32)
    nov = ema(nov, alpha=0.25)

    hold = hold_mask(speed, fps=fps, low_pct=15.0, min_hold_sec=0.2)

    bounds = find_boundaries(nov, min_gap_frames=min_gap_frames, pct=pct)
    bounds = merge_short_segments(bounds, T=len(nov), fps=fps, min_len_sec=min_len_sec)
    bounds = split_long_segments(bounds, novelty=nov, fps=fps, max_len_sec=max_len_sec, min_gap_frames=min_gap_frames)

    # finalize segments
    T = len(nov)
    b = [0] + bounds + [T - 1]

    segments: List[Dict[str, Any]] = []
    for sid in range(len(b) - 1):
        s = int(b[sid])
        e = int(b[sid + 1])
        if e <= s:
            continue

        seg_speed = speed[s:e+1]
        seg_turn = turn[s:e+1]
        seg_nov = nov[s:e+1]
        seg_hold = hold[s:e+1]

        energy = float(np.mean(seg_speed))
        peak = float(np.max(seg_nov)) if len(seg_nov) else 0.0
        hold_ratio = float(np.mean(seg_hold)) if len(seg_hold) else 0.0
        direction_change = float(np.sum(seg_turn))

        # core score (simple, stable)
        core_score = (
            0.5 * float(np.max(robust_z(seg_nov))) +
            0.3 * float(np.max(robust_z(seg_speed))) +
            0.2 * float(np.max(robust_z(seg_turn))) -
            0.3 * float(np.max(robust_z(seg_hold.astype(np.float32))))
        )
        seg_type = "core" if core_score > 0.0 else "transition"

        # representative frames
        peak_frame = s + int(np.argmax(seg_nov)) if len(seg_nov) else s
        hold_frame = None
        if np.any(seg_hold):
            # choose the hold frame closest to peak_frame within segment
            hold_idxs = np.where(seg_hold)[0] + s
            hold_frame = int(hold_idxs[np.argmin(np.abs(hold_idxs - peak_frame))])

        start_time = float(times[s]) if s < len(times) else float(s / fps)
        end_time = float(times[e]) if e < len(times) else float(e / fps)

        segments.append({
            "id": sid,
            "start_frame": s,
            "end_frame": e,
            "start_time": start_time,
            "end_time": end_time,
            "type": seg_type,
            "core_score": float(core_score),
            "metrics": {
                "energy": energy,
                "peak_novelty": peak,
                "hold_ratio": hold_ratio,
                "direction_change": direction_change,
            },
            "representative": {
                "peak_frame": int(peak_frame),
                "hold_frame": int(hold_frame) if hold_frame is not None else None,
            }
        })

    debug = {"novelty": nov, "speed": speed, "turn": turn, "shape": shape, "hold": hold.astype(np.float32)}
    return segments, debug


# -----------------------------
# Debug plot
# -----------------------------
def save_debug_plot(out_png: str, fps: float, debug: dict, bounds=None, segments=None):
    import matplotlib.pyplot as plt
    import numpy as np

    if bounds is None:
        bounds = []
    if segments is None:
        segments = []

    # ---- pick available series from debug ----
    # We try common keys and fallbacks, and plot what exists.
    series_candidates = [
        ("novelty", ["novelty", "novelty_z", "joint_accel", "accel", "jerk", "novelty_raw"]),
        ("energy",  ["energy", "energy_z", "energy_raw"]),
        ("speed",   ["speed", "speed_z"]),
        ("turn",    ["turn", "turn_z"]),
        ("shape",   ["shape", "shape_z"]),
        ("hold",    ["hold", "hold_ratio", "hold_z"]),
    ]

    def pick(keys):
        for k in keys:
            if k in debug and debug[k] is not None:
                arr = np.asarray(debug[k], dtype=np.float32)
                if arr.ndim == 1 and len(arr) > 0:
                    return arr, k
        return None, None

    picked = []
    T = None
    for name, keys in series_candidates:
        arr, key_used = pick(keys)
        if arr is not None:
            picked.append((name, key_used, arr))
            if T is None:
                T = len(arr)

    if T is None:
        raise KeyError("save_debug_plot: no 1D series found in debug to plot.")

    # Make a time axis
    t = np.arange(T, dtype=np.float32) / max(float(fps), 1e-6)

    # ---- plot ----
    plt.figure(figsize=(14, 6))

    # plot all picked series
    for (name, key_used, arr) in picked:
        # truncate if different lengths
        if len(arr) != T:
            m = min(T, len(arr))
            plt.plot(t[:m], arr[:m], label=f"{name} ({key_used})")
        else:
            plt.plot(t, arr, label=f"{name} ({key_used})")

    # threshold line if exists
    thr = debug.get("thr", None)
    if thr is not None and np.isfinite(thr):
        plt.axhline(float(thr), linestyle="--", linewidth=1, label="threshold")

    # boundaries (vertical lines)
    b_list = bounds
    if not b_list and isinstance(debug, dict) and "boundaries" in debug:
        b_list = debug["boundaries"]

    for b in b_list or []:
        if b is None:
            continue
        tb = float(b) / max(float(fps), 1e-6)
        plt.axvline(tb, linestyle=":", linewidth=1)

    # segment shading
    if segments:
        for s in segments:
            a = s.get("start_frame", None)
            b = s.get("end_frame", None)
            if a is None or b is None:
                continue
            ta = float(a) / max(float(fps), 1e-6)
            tb = float(b) / max(float(fps), 1e-6)
            plt.axvspan(ta, tb, alpha=0.08)

    plt.title("Motion segmentation debug plot")
    plt.xlabel("time (s)")
    plt.legend(loc="upper right")
    plt.tight_layout()
    plt.savefig(out_png, dpi=150)
    plt.close()
    print(f"[OK] wrote: {out_png}")
# -----------------------------
# Main
# -----------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, help="motion_result.json")
    ap.add_argument("--out_json", required=True, help="output segments json")
    ap.add_argument("--fps", type=float, default=None, help="override fps (optional)")
    ap.add_argument("--pct", type=float, default=90.0, help="novelty peak percentile threshold (e.g., 90)")
    ap.add_argument("--min_gap", type=int, default=15, help="min gap (frames) between boundaries")
    ap.add_argument("--min_len", type=float, default=0.6, help="min segment length (sec)")
    ap.add_argument("--max_len", type=float, default=6.0, help="max segment length (sec)")
    ap.add_argument("--smooth", type=int, default=5, help="moving average window for features")
    ap.add_argument("--debug_plot", type=str, default=None, help="save debug plot png")
    args = ap.parse_args()

    with open(args.json, "r", encoding="utf-8") as f:
        raw = json.load(f)

    feat_mode = _try_extract_features_timeseries(raw)

    if feat_mode is not None:
        times, feats, fps0 = feat_mode
        fps = float(args.fps) if args.fps is not None else fps0

        # smoothing
        if args.smooth and args.smooth > 1:
            for k in ["novelty", "energy"]:
                feats[k] = moving_avg(feats[k], args.smooth)

        # Make "robust z" versions for plotting/thresholding
        nov_z = robust_z(feats["novelty"])
        en_z  = robust_z(feats["energy"]) if np.any(feats["energy"] != 0) else np.zeros_like(nov_z)

        # Use novelty peaks as boundaries
        segments, debug = segment_from_novelty(
            times=times,
            novelty_z=nov_z,
            energy_z=en_z,
            fps=fps,
            pct=args.pct,
            min_gap_frames=args.min_gap,
            min_len_sec=args.min_len,
            max_len_sec=args.max_len,
        )

        motion_fps = fps
        meta = {"top_keys": list(raw.keys())[:80], "mode": "features-only", "feature_keys": list(raw.get("features", {}).keys())}
    else:
        motion = load_motion_json(args.json, fps_arg=args.fps)
        feats = feature_timeseries(motion.pts, motion.conf, fps=motion.fps, smooth_win=args.smooth)
        segments, debug = segment_and_classify(
            times=motion.times,
            feats=feats,
            fps=motion.fps,
            pct=args.pct,
            min_gap_frames=args.min_gap,
            min_len_sec=args.min_len,
            max_len_sec=args.max_len,
        )
        motion_fps = motion.fps
        meta = motion.meta

    # boundaries for plotting
    bounds = []
    if len(segments) > 1:
        bounds = [seg["start_frame"] for seg in segments[1:]]

    out = {
        "fps": motion_fps,
        "source_json": args.json,
        "meta": meta,
        "segments": segments,
    }
    os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"[OK] wrote: {args.out_json}  (segments={len(segments)})")

    if args.debug_plot:
        bounds_ = debug.get("boundaries", None) if isinstance(debug, dict) else None
        save_debug_plot(args.debug_plot, fps=motion_fps, debug=debug, bounds=bounds_, segments=segments)


if __name__ == "__main__":
    main()