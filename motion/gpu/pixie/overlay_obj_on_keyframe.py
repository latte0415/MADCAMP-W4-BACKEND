#!/usr/bin/env python3
# overlay_obj_on_keyframe.py
#
# Overlay PIXIE-exported SMPL-X .obj wireframe onto original keyframe images.
# - Robust bbox parsing (supports scientific notation like 5.83e+02)
# - Sparse wireframe drawing to avoid "dot noise"
# - Optional Y flip to fix upside-down projection
# - Alpha blending
#
# Example:
#   python3 overlay_obj_on_keyframe.py \
#     --image_dir outputs/keyframes/hit \
#     --pixie_dir outputs/pixie_mesh/hit \
#     --out_dir outputs/overlay_mesh \
#     --keep_edges 2500 \
#     --thickness 2 \
#     --alpha 0.35 \
#     --no_flip_y
#
import os
import re
import glob
import json
import argparse
from dataclasses import dataclass
from typing import List, Tuple, Optional

import cv2
import numpy as np
from tqdm import tqdm


# -------------------------
# IO helpers
# -------------------------
def list_images(image_dir: str) -> List[str]:
    exts = ("*.png", "*.jpg", "*.jpeg", "*.webp")
    files = []
    for e in exts:
        files.extend(glob.glob(os.path.join(image_dir, e)))
    files = sorted(files)
    return files


def stem(path: str) -> str:
    base = os.path.basename(path)
    return os.path.splitext(base)[0]


def ensure_dir(d: str):
    os.makedirs(d, exist_ok=True)


# -------------------------
# Parse bbox (x1,y1,x2,y2)
# -------------------------
def read_bbox_any(bbox_path: str) -> Tuple[float, float, float, float]:
    """
    PIXIE bbox file is often 4 lines, each scientific notation float.
    We parse line-by-line float() to preserve exponent.
    """
    vals = []
    with open(bbox_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                vals.append(float(line))
            except:
                pass

    if len(vals) >= 4:
        x1, y1, x2, y2 = vals[:4]
        return float(x1), float(y1), float(x2), float(y2)

    # fallback: split by whitespace/commas
    raw = open(bbox_path, "r").read().strip()
    tokens = re.split(r"[,\s]+", raw)
    nums = []
    for t in tokens:
        try:
            nums.append(float(t))
        except:
            pass
    if len(nums) < 4:
        raise ValueError(f"bbox parse failed: {bbox_path} (raw={raw[:200]})")
    x1, y1, x2, y2 = nums[:4]
    return float(x1), float(y1), float(x2), float(y2)


# -------------------------
# OBJ loading
# -------------------------
def load_obj_simple(obj_path: str) -> Tuple[np.ndarray, np.ndarray]:
    """
    Loads vertices and triangle faces from .obj.
    - Supports faces like: f v1 v2 v3 OR f v1/.. v2/.. v3/..
    Returns:
      verts: (V,3) float32
      faces: (F,3) int32, zero-based
    """
    verts = []
    faces = []

    with open(obj_path, "r") as f:
        for line in f:
            if line.startswith("v "):
                parts = line.strip().split()
                if len(parts) >= 4:
                    verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
            elif line.startswith("f "):
                parts = line.strip().split()[1:]
                if len(parts) < 3:
                    continue

                # parse first 3 indices only (triangulated assumption)
                idxs = []
                for p in parts[:3]:
                    # "12/34/56" -> "12"
                    v = p.split("/")[0]
                    if v:
                        idxs.append(int(v) - 1)  # to 0-based
                if len(idxs) == 3:
                    faces.append(idxs)

    if len(verts) == 0:
        raise ValueError(f"No verts found in OBJ: {obj_path}")
    if len(faces) == 0:
        raise ValueError(f"No faces found in OBJ: {obj_path}")

    return np.asarray(verts, np.float32), np.asarray(faces, np.int32)


def find_pixie_bundle(pixie_dir: str, img_stem: str) -> Tuple[str, str]:
    """
    For an image stem like "hit_000292",
    expect:
      pixie_dir/hit_000292/   (folder)
        hit_000292.obj
        hit_000292_bbox.txt  (or *_bbox.txt)
    Returns:
      obj_path, bbox_path
    """
    folder = os.path.join(pixie_dir, img_stem)
    if not os.path.isdir(folder):
        raise FileNotFoundError(f"Missing pixie folder: {folder}")

    # obj
    obj_path = os.path.join(folder, f"{img_stem}.obj")
    if not os.path.exists(obj_path):
        # fallback: any .obj
        objs = glob.glob(os.path.join(folder, "*.obj"))
        if len(objs) == 0:
            raise FileNotFoundError(f"No OBJ found in {folder}")
        obj_path = objs[0]

    # bbox
    bbox_path = os.path.join(folder, f"{img_stem}_bbox.txt")
    if not os.path.exists(bbox_path):
        bxs = glob.glob(os.path.join(folder, "*_bbox.txt"))
        if len(bxs) == 0:
            raise FileNotFoundError(f"No *_bbox.txt found in {folder}")
        bbox_path = bxs[0]

    return obj_path, bbox_path


# -------------------------
# Projection (bbox-fit)
# -------------------------
def project_verts_bbox_fit(
    verts: np.ndarray,
    bbox: Tuple[float, float, float, float],
    flip_y: bool = True,
    margin_ratio: float = 0.00,
) -> np.ndarray:
    """
    Projects 3D verts to 2D using min-max normalization on X,Y in model space,
    then maps into the bbox in image pixel space.

    This is not a physically accurate camera projection. It's a stable overlay method
    aligned to the PIXIE bbox crop, good for collaboration/visualization.

    Args:
      verts: (V,3)
      bbox: (x1,y1,x2,y2) in image pixels
      flip_y: if True, y_norm -> 1 - y_norm (fix upside-down)
      margin_ratio: expand bbox by this ratio (e.g., 0.05)
    """
    x1, y1, x2, y2 = bbox
    # sanitize bbox ordering
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1

    # optional bbox margin
    w = x2 - x1
    h = y2 - y1
    if margin_ratio > 0:
        x1 -= w * margin_ratio
        x2 += w * margin_ratio
        y1 -= h * margin_ratio
        y2 += h * margin_ratio
        w = x2 - x1
        h = y2 - y1

    vx = verts[:, 0]
    vy = verts[:, 1]

    xmin, xmax = float(vx.min()), float(vx.max())
    ymin, ymax = float(vy.min()), float(vy.max())

    # avoid div0
    dx = max(1e-8, (xmax - xmin))
    dy = max(1e-8, (ymax - ymin))

    x_norm = (vx - xmin) / dx
    y_norm = (vy - ymin) / dy

    if flip_y:
        y_norm = 1.0 - y_norm

    x_img = x1 + x_norm * w
    y_img = y1 + y_norm * h

    pts2d = np.stack([x_img, y_img], axis=1).astype(np.float32)
    return pts2d


# -------------------------
# Drawing
# -------------------------
def draw_bbox(img: np.ndarray, bbox: Tuple[float, float, float, float], thickness: int = 2):
    x1, y1, x2, y2 = bbox
    x1, y1, x2, y2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))
    cv2.rectangle(img, (x1, y1), (x2, y2), (255, 0, 0), thickness)


def draw_wireframe_sparse(
    img: np.ndarray,
    pts2d: np.ndarray,
    faces: np.ndarray,
    keep_edges: int = 2500,
    thickness: int = 1,
    seed: Optional[int] = 123,
):
    """
    Draws a sparse subset of edges from triangle faces.
    This avoids the "dense dot/noise" look when faces are many.
    """
    h, w = img.shape[:2]
    pts = pts2d.astype(np.int32)

    edges = set()
    # build edges (unique)
    for (a, b, c) in faces:
        a, b, c = int(a), int(b), int(c)
        edges.add(tuple(sorted((a, b))))
        edges.add(tuple(sorted((b, c))))
        edges.add(tuple(sorted((c, a))))

    edges = list(edges)
    if len(edges) == 0:
        return

    # sample edges
    if keep_edges is not None and keep_edges > 0 and len(edges) > keep_edges:
        rng = np.random.default_rng(seed)
        idx = rng.choice(len(edges), size=keep_edges, replace=False)
        edges = [edges[i] for i in idx]

    # draw
    for a, b in edges:
        xa, ya = pts[a]
        xb, yb = pts[b]
        if 0 <= xa < w and 0 <= ya < h and 0 <= xb < w and 0 <= yb < h:
            cv2.line(img, (xa, ya), (xb, yb), (0, 255, 0), thickness, lineType=cv2.LINE_AA)


# -------------------------
# Main
# -------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image_dir", required=True, help="Directory with keyframe images (png/jpg).")
    ap.add_argument("--pixie_dir", required=True, help="Directory with PIXIE outputs per frame-stem.")
    ap.add_argument("--out_dir", required=True, help="Where to write overlay images.")
    ap.add_argument("--alpha", type=float, default=0.35, help="Blend weight for mesh layer (0~1).")
    ap.add_argument("--keep_edges", type=int, default=2500, help="How many edges to draw (sparser = clearer lines).")
    ap.add_argument("--thickness", type=int, default=2, help="Line thickness for wireframe.")
    ap.add_argument("--flip_y", action="store_true", help="Flip y when mapping to image bbox (fix upside-down).")
    ap.add_argument("--no_flip_y", action="store_true", help="Disable y flip (overrides --flip_y).")
    ap.add_argument("--margin", type=float, default=0.00, help="Expand bbox by this ratio (e.g. 0.05).")
    ap.add_argument("--draw_bbox", action="store_true", help="Draw bbox rectangle for debugging.")
    ap.add_argument("--max_images", type=int, default=0, help="Process only first N images (0=all).")
    ap.add_argument("--seed", type=int, default=123, help="Random seed for edge sampling.")
    ap.add_argument("--ext", default="png", help="Output extension (png/jpg).")
    ap.add_argument("--save_index", default="", help="Optional path to save a JSON index of outputs.")
    args = ap.parse_args()

    ensure_dir(args.out_dir)

    imgs = list_images(args.image_dir)
    if args.max_images and args.max_images > 0:
        imgs = imgs[: args.max_images]

    if len(imgs) == 0:
        print(f"[WARN] No images found in {args.image_dir}")
        return

    flip_y = args.flip_y
    if args.no_flip_y:
        flip_y = False

    index = {
        "image_dir": args.image_dir,
        "pixie_dir": args.pixie_dir,
        "out_dir": args.out_dir,
        "alpha": args.alpha,
        "keep_edges": args.keep_edges,
        "thickness": args.thickness,
        "flip_y": flip_y,
        "margin": args.margin,
        "items": [],
    }

    ok = 0
    miss = 0
    err = 0

    for img_path in tqdm(imgs, desc="overlay(obj)", unit="img"):
        st = stem(img_path)
        out_path = os.path.join(args.out_dir, f"{st}.{args.ext}")

        try:
            obj_path, bbox_path = find_pixie_bundle(args.pixie_dir, st)
        except FileNotFoundError as e:
            miss += 1
            index["items"].append({
                "stem": st,
                "image": img_path,
                "status": "missing_pixie",
                "error": str(e),
            })
            continue

        try:
            img = cv2.imread(img_path, cv2.IMREAD_COLOR)
            if img is None:
                raise RuntimeError(f"cv2.imread failed: {img_path}")

            bbox = read_bbox_any(bbox_path)
            verts, faces = load_obj_simple(obj_path)

            pts2d = project_verts_bbox_fit(
                verts,
                bbox=bbox,
                flip_y=flip_y,
                margin_ratio=args.margin,
            )

            # overlay layer
            overlay = img.copy()
            if args.draw_bbox:
                draw_bbox(overlay, bbox, thickness=2)

            draw_wireframe_sparse(
                overlay,
                pts2d=pts2d,
                faces=faces,
                keep_edges=args.keep_edges,
                thickness=args.thickness,
                seed=args.seed,
            )

            # blend
            a = float(args.alpha)
            a = max(0.0, min(1.0, a))
            out = cv2.addWeighted(img, 1.0 - a, overlay, a, 0.0)

            cv2.imwrite(out_path, out)
            ok += 1

            index["items"].append({
                "stem": st,
                "image": img_path,
                "obj": obj_path,
                "bbox": bbox_path,
                "out": out_path,
                "status": "ok",
            })

        except Exception as e:
            err += 1
            index["items"].append({
                "stem": st,
                "image": img_path,
                "obj": obj_path,
                "bbox": bbox_path,
                "status": "error",
                "error": repr(e),
            })

    print(f"[OK ] wrote overlays: {ok} | missing: {miss} | error: {err}")
    if args.save_index:
        with open(args.save_index, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        print(f"[OK ] wrote index: {args.save_index}")


if __name__ == "__main__":
    main()