#!/usr/bin/env python3
# overlay_obj_meshfill.py
# Render OBJ as filled triangles (mesh-like) on top of keyframe images (CPU, no GPU).
import os, re, glob, argparse, json
import cv2
import numpy as np
from tqdm import tqdm

def list_images(d):
    files=[]
    for e in ("*.png","*.jpg","*.jpeg","*.webp"):
        files += glob.glob(os.path.join(d,e))
    return sorted(files)

def stem(p):
    b=os.path.basename(p)
    return os.path.splitext(b)[0]

def ensure_dir(d):
    os.makedirs(d, exist_ok=True)

def read_bbox_any(bbox_path):
    vals=[]
    with open(bbox_path,"r") as f:
        for line in f:
            line=line.strip()
            if not line: 
                continue
            try: vals.append(float(line))
            except: pass
    if len(vals)>=4:
        return vals[0], vals[1], vals[2], vals[3]
    raw=open(bbox_path,"r").read().strip()
    toks=re.split(r"[,\s]+", raw)
    nums=[]
    for t in toks:
        try: nums.append(float(t))
        except: pass
    if len(nums)<4:
        raise ValueError(f"bbox parse failed: {bbox_path}")
    return nums[0], nums[1], nums[2], nums[3]

def load_obj_simple(obj_path):
    verts=[]
    faces=[]
    with open(obj_path,"r") as f:
        for line in f:
            if line.startswith("v "):
                p=line.strip().split()
                if len(p)>=4:
                    verts.append([float(p[1]), float(p[2]), float(p[3])])
            elif line.startswith("f "):
                parts=line.strip().split()[1:]
                if len(parts)<3: 
                    continue
                idx=[]
                for pp in parts[:3]:
                    v = pp.split("/")[0]
                    if v:
                        idx.append(int(v)-1)
                if len(idx)==3:
                    faces.append(idx)
    if not verts or not faces:
        raise ValueError(f"bad obj: {obj_path} (v={len(verts)}, f={len(faces)})")
    return np.asarray(verts,np.float32), np.asarray(faces,np.int32)

def find_pixie_bundle(pixie_dir, img_stem):
    folder=os.path.join(pixie_dir, img_stem)
    if not os.path.isdir(folder):
        raise FileNotFoundError(folder)

    obj=os.path.join(folder, f"{img_stem}.obj")
    if not os.path.exists(obj):
        objs=glob.glob(os.path.join(folder,"*.obj"))
        if not objs: raise FileNotFoundError(f"no obj in {folder}")
        obj=objs[0]

    bbox=os.path.join(folder, f"{img_stem}_bbox.txt")
    if not os.path.exists(bbox):
        bxs=glob.glob(os.path.join(folder,"*_bbox.txt"))
        if not bxs: raise FileNotFoundError(f"no bbox in {folder}")
        bbox=bxs[0]

    return obj, bbox

def project_bbox_fit(verts, bbox, flip_y=False, margin=0.0):
    x1,y1,x2,y2 = bbox
    if x2<x1: x1,x2=x2,x1
    if y2<y1: y1,y2=y2,y1
    w=x2-x1; h=y2-y1
    if margin>0:
        x1 -= w*margin; x2 += w*margin
        y1 -= h*margin; y2 += h*margin
        w=x2-x1; h=y2-y1

    vx=verts[:,0]; vy=verts[:,1]
    xmin,xmax=float(vx.min()), float(vx.max())
    ymin,ymax=float(vy.min()), float(vy.max())
    dx=max(1e-8, xmax-xmin)
    dy=max(1e-8, ymax-ymin)
    x=(vx-xmin)/dx
    y=(vy-ymin)/dy
    if flip_y:
        y=1.0-y
    px=x1 + x*w
    py=y1 + y*h
    return np.stack([px,py],axis=1).astype(np.float32)

def render_filled_mesh(
    img, pts2d, verts3d, faces,
    alpha=0.45,
    color=(0,255,0),
    zmode="mean",       # "mean" or "max"
    draw_edges=False,
    edge_color=(0,0,0),
    edge_thickness=1,
):
    """
    Painter's algorithm: sort faces by depth then fill polygons.
    This is not true z-buffer but looks mesh-like quickly.
    """
    h,w = img.shape[:2]
    overlay = img.copy()

    # face depth
    f = faces
    z = verts3d[:,2]
    if zmode == "max":
        fz = np.max(z[f], axis=1)
    else:
        fz = np.mean(z[f], axis=1)

    order = np.argsort(fz)  # far -> near (usually OK)
    pts = pts2d.astype(np.int32)

    for fi in order:
        a,b,c = f[fi]
        tri = np.array([pts[a], pts[b], pts[c]], dtype=np.int32)

        # quick clip reject
        if (tri[:,0] < -10).all() or (tri[:,0] > w+10).all() or (tri[:,1] < -10).all() or (tri[:,1] > h+10).all():
            continue

        cv2.fillConvexPoly(overlay, tri, color, lineType=cv2.LINE_AA)
        if draw_edges:
            cv2.polylines(overlay, [tri], isClosed=True, color=edge_color, thickness=edge_thickness, lineType=cv2.LINE_AA)

    out = cv2.addWeighted(img, 1.0-alpha, overlay, alpha, 0.0)
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--image_dir", required=True)
    ap.add_argument("--pixie_dir", required=True)
    ap.add_argument("--out_dir", required=True)
    ap.add_argument("--alpha", type=float, default=0.45)
    ap.add_argument("--flip_y", action="store_true")
    ap.add_argument("--margin", type=float, default=0.00)
    ap.add_argument("--color", default="0,255,0", help="B,G,R")
    ap.add_argument("--draw_edges", action="store_true")
    ap.add_argument("--edge_thickness", type=int, default=1)
    ap.add_argument("--max_images", type=int, default=0)
    args=ap.parse_args()

    ensure_dir(args.out_dir)
    imgs=list_images(args.image_dir)
    if args.max_images and args.max_images>0:
        imgs=imgs[:args.max_images]

    bgr=tuple(int(x) for x in args.color.split(","))

    for img_path in tqdm(imgs, desc="meshfill", unit="img"):
        st=stem(img_path)
        out_path=os.path.join(args.out_dir, f"{st}.png")

        obj_path, bbox_path = find_pixie_bundle(args.pixie_dir, st)
        img=cv2.imread(img_path, cv2.IMREAD_COLOR)
        if img is None:
            continue
        bbox=read_bbox_any(bbox_path)
        verts, faces = load_obj_simple(obj_path)
        pts2d=project_bbox_fit(verts, bbox, flip_y=args.flip_y, margin=args.margin)

        out=render_filled_mesh(
            img, pts2d, verts, faces,
            alpha=args.alpha,
            color=bgr,
            draw_edges=args.draw_edges,
            edge_thickness=args.edge_thickness
        )
        cv2.imwrite(out_path, out)

    print(f"[OK] wrote: {args.out_dir}")

if __name__=="__main__":
    main()