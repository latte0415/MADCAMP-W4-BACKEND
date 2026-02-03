import os, re, argparse
import cv2
import numpy as np
from glob import glob
from tqdm import tqdm

def parse_obj(path):
    verts = []
    faces = []
    with open(path, "r") as f:
        for line in f:
            if line.startswith("v "):
                _, x, y, z = line.strip().split()[:4]
                verts.append([float(x), float(y), float(z)])
            elif line.startswith("f "):
                parts = line.strip().split()[1:4]
                idx = [int(p.split("/")[0]) - 1 for p in parts]
                faces.append(idx)
    return np.asarray(verts, np.float32), np.asarray(faces, np.int32)

def read_bbox_any(path):
    # 1) 가장 안전: 줄 단위 float 파싱 (지수표기 완벽 지원)
    vals = []
    with open(path, "r") as f:
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
        raw = open(path, "r").read()
        return x1, y1, x2, y2, vals, raw

    # 2) fallback: 공백/콤마 split로 float 파싱
    raw = open(path, "r").read()
    tokens = re.split(r"[,\s]+", raw.strip())
    nums = []
    for t in tokens:
        try:
            nums.append(float(t))
        except:
            pass
    if len(nums) < 4:
        raise ValueError(f"bbox parse failed: {path} / raw={raw[:200]}")
    x1, y1, x2, y2 = nums[:4]
    return x1, y1, x2, y2, nums, raw

def extract_frame_id(filename):
    m = re.findall(r"\d+", filename)
    return int(m[-1]) if m else None

def project_bbox_fit(verts, bbox):
    """verts의 xy를 bbox에 꽉 채우도록 맵핑(임시)"""
    x1,y1,x2,y2 = bbox
    w = max(1.0, x2-x1)
    h = max(1.0, y2-y1)

    xy = verts[:, :2].copy()
    mn = xy.min(axis=0)
    mx = xy.max(axis=0)
    span = np.maximum(mx-mn, 1e-6)
    xy = (xy - mn) / span
    xy[:,1] = 1.0 - xy[:,1]

    xy[:,0] = x1 + xy[:,0]*w
    xy[:,1] = y1 + xy[:,1]*h
    return xy, mn, mx

def draw_wireframe(img, pts2d, faces, max_edges=4000, thickness=1):
    h,w = img.shape[:2]
    pts = pts2d.astype(np.int32)

    # edge set 만들기 (중복 제거)
    edges = set()
    for f in faces:
        a,b,c = int(f[0]), int(f[1]), int(f[2])
        edges.add(tuple(sorted((a,b))))
        edges.add(tuple(sorted((b,c))))
        edges.add(tuple(sorted((c,a))))
        if len(edges) > max_edges:
            break

    for a,b in edges:
        xa,ya = pts[a]
        xb,yb = pts[b]
        if (0 <= xa < w and 0 <= ya < h and 0 <= xb < w and 0 <= yb < h):
            cv2.line(img, (xa,ya), (xb,yb), (0,255,0), thickness)

def draw_points(img, pts2d, step=30, radius=2):
    h,w = img.shape[:2]
    pts = pts2d.astype(np.int32)
    for p in pts[::max(1, step)]:
        x,y = int(p[0]), int(p[1])
        if 0 <= x < w and 0 <= y < h:
            cv2.circle(img, celebrated_point=(x,y), radius=radius, color=(0,0,255), thickness=-1)

def draw_bbox(img, bbox):
    x1,y1,x2,y2 = map(int, bbox)
    cv2.rectangle(img, (x1,y1), (x2,y2), (255,0,0), 2)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image_dir", required=True)
    ap.add_argument("--pixie_dir", required=True)  # outputs/pixie_mesh/hit
    ap.add_argument("--out_dir", required=True)
    ap.add_argument("--ext", default="png")
    ap.add_argument("--point_step", type=int, default=25)
    ap.add_argument("--only_first", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    images = sorted(glob(os.path.join(args.image_dir, f"*.{args.ext}")))
    print("[INFO] images:", len(images))

    for i, img_path in enumerate(tqdm(images, desc="overlay(debug)", unit="img")):
        fname = os.path.basename(img_path)
        fid = extract_frame_id(fname)
        if fid is None:
            continue

        folder = os.path.join(args.pixie_dir, f"hit_{fid:06d}")
        obj_path = os.path.join(folder, f"hit_{fid:06d}.obj")
        bbox_path = os.path.join(folder, f"hit_{fid:06d}_bbox.txt")
        if not (os.path.exists(obj_path) and os.path.exists(bbox_path)):
            continue

        img = cv2.imread(img_path)
        if img is None:
            continue

        verts, faces = parse_obj(obj_path)
        x1,y1,x2,y2, nums, raw = read_bbox_any(bbox_path)

        # bbox sanity: clip into image bounds
        H,W = img.shape[:2]
        x1c = max(0, min(W-1, x1))
        x2c = max(0, min(W-1, x2))
        y1c = max(0, min(H-1, y1))
        y2c = max(0, min(H-1, y2))
        bbox = (x1c,y1c,x2c,y2c)

        pts2d, mn, mx = project_bbox_fit(verts, bbox)

        out = img.copy()
        draw_bbox(out, bbox)

        # 디버그 텍스트
        cv2.putText(out, f"fid={fid} bbox=({bbox[0]:.0f},{bbox[1]:.0f},{bbox[2]:.0f},{bbox[3]:.0f})",
                    (10,30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,255,255), 2)
        cv2.putText(out, f"verts_xy min={mn[0]:.2f},{mn[1]:.2f} max={mx[0]:.2f},{mx[1]:.2f}",
                    (10,60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,255), 2)

        # 점으로 먼저 찍기(무조건 보이게)
        draw_wireframe(out, pts2d, faces, max_edges=8000, thickness=1)


        cv2.imwrite(os.path.join(args.out_dir, fname), out)

        if args.only_first:
            print("[DBG] bbox raw text:", raw[:200])
            print("[DBG] bbox nums:", nums[:10], "len=", len(nums))
            print("[DBG] wrote:", os.path.join(args.out_dir, fname))
            break

if __name__ == "__main__":
    main()