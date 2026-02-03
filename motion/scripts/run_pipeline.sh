#!/usr/bin/env bash
set -euo pipefail

# End-to-end pipeline:
# dance video -> pose events -> segmentation/visualization -> keyframes -> PIXIE -> mesh overlay

usage() {
  cat <<'EOF'
Usage:
  ./run_pipeline.sh [options]

Options:
  --video PATH            Input video (default: inputs/dance.mp4)
  --out_dir PATH          Output root (default: outputs_<video_stem>)
  --music_offset SECONDS  Offset for motion_pipeline (default: 0.0)
  --pixie_py PATH         Python executable to use (default: current env `python`)
  --device DEVICE         PIXIE device, e.g. cuda:0 or cpu (default: cpu)
  --skip_pixie            Skip PIXIE inference + mesh overlay
  --skip_hold             Skip hold keyframes/PIXIE for hold
  --wireframe             Use wireframe overlay (default if PIXIE runs)
  --meshfill              Use meshfill overlay (can be combined with --wireframe)
  --no_overlay            Skip mesh overlay (still runs PIXIE)
EOF
}

VIDEO="inputs/dance.mp4"
OUT_DIR="outputs"
OUT_DIR_SET="0"
MUSIC_OFFSET="0.0"
PIXIE_PY=""
DEVICE="cpu"
SKIP_PIXIE="0"
SKIP_HOLD="0"
DO_WIREFRAME="1"
DO_MESHFILL="0"
NO_OVERLAY="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --video) VIDEO="$2"; shift 2 ;;
    --out_dir) OUT_DIR="$2"; OUT_DIR_SET="1"; shift 2 ;;
    --music_offset) MUSIC_OFFSET="$2"; shift 2 ;;
    --pixie_py) PIXIE_PY="$2"; shift 2 ;;
    --device) DEVICE="$2"; shift 2 ;;
    --skip_pixie) SKIP_PIXIE="1"; shift ;;
    --skip_hold) SKIP_HOLD="1"; shift ;;
    --wireframe) DO_WIREFRAME="1"; shift ;;
    --meshfill) DO_MESHFILL="1"; shift ;;
    --no_overlay) NO_OVERLAY="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$PIXIE_PY" ]]; then
  PIXIE_PY="python"
fi

if [[ "$OUT_DIR_SET" == "0" ]]; then
  VIDEO_BASE="$(basename "$VIDEO")"
  STEM="${VIDEO_BASE%.*}"
  OUT_DIR="outputs_${STEM}"
fi

mkdir -p "$OUT_DIR"

MOTION_JSON="${OUT_DIR}/motion_result.json"
SEGMENT_JSON="${OUT_DIR}/motion_segments.json"
KEYFRAME_DIR="${OUT_DIR}/keyframes"
PIXIE_OUT="${OUT_DIR}/pixie_mesh"

echo "[1/6] Motion events"
"$PIXIE_PY" pipelines/motion_pipeline.py --video "$VIDEO" --out "$MOTION_JSON" --music_offset "$MUSIC_OFFSET"

echo "[2/6] Feature visualization + segmentation"
"$PIXIE_PY" pipelines/visualize_motion.py --json "$MOTION_JSON" --out "${OUT_DIR}/motion_features.png"
"$PIXIE_PY" pipelines/segment_motion.py --json "$MOTION_JSON" --out_json "$SEGMENT_JSON" --debug_plot "${OUT_DIR}/novelty.png"

echo "[3/6] Keyframes"
"$PIXIE_PY" pipelines/extract_keyframes.py --video "$VIDEO" --json "$MOTION_JSON" --out_dir "$KEYFRAME_DIR"

if [[ "$SKIP_PIXIE" == "1" ]]; then
  echo "[4/6] PIXIE skipped"
  exit 0
fi

echo "[4/6] PIXIE (hit)"
mkdir -p "$PIXIE_OUT"
(cd gpu/pixie/PIXIE && \
  "$PIXIE_PY" demos/demo_fit_body.py \
    -i "../../${KEYFRAME_DIR}/hit" \
    -s "../../${PIXIE_OUT}/hit" \
    --device "$DEVICE" \
    --iscrop True \
    --saveObj True \
    --saveVis False \
    --saveParam True \
    --savePred True \
    --saveImages False \
    --useTex False \
    --lightTex False \
    --extractTex False)

if [[ "$SKIP_HOLD" != "1" ]]; then
  echo "[5/6] PIXIE (hold)"
  (cd gpu/pixie/PIXIE && \
    "$PIXIE_PY" demos/demo_fit_body.py \
      -i "../../${KEYFRAME_DIR}/hold" \
      -s "../../${PIXIE_OUT}/hold" \
      --device "$DEVICE" \
      --iscrop True \
      --saveObj True \
      --saveVis False \
      --saveParam True \
      --savePred True \
      --saveImages False \
      --useTex False \
      --lightTex False \
      --extractTex False)
fi

if [[ "$NO_OVERLAY" == "1" ]]; then
  echo "[6/6] Overlay skipped"
  exit 0
fi

if [[ "$DO_WIREFRAME" == "1" ]]; then
  echo "[6/6] Wireframe overlay"
  "$PIXIE_PY" gpu/pixie/overlay_obj_on_keyframe.py \
    --image_dir "${KEYFRAME_DIR}/hit" \
    --pixie_dir "${PIXIE_OUT}/hit" \
    --out_dir "${OUT_DIR}/overlay_mesh" \
    --keep_edges 2500 \
    --thickness 2 \
    --alpha 0.35 \
    --flip_y

  if [[ "$SKIP_HOLD" != "1" ]]; then
    "$PIXIE_PY" gpu/pixie/overlay_obj_on_keyframe.py \
      --image_dir "${KEYFRAME_DIR}/hold" \
      --pixie_dir "${PIXIE_OUT}/hold" \
      --out_dir "${OUT_DIR}/overlay_mesh_hold" \
      --keep_edges 2500 \
      --thickness 2 \
      --alpha 0.35 \
      --flip_y
  fi
fi

if [[ "$DO_MESHFILL" == "1" ]]; then
  echo "[6/6] Meshfill overlay"
  "$PIXIE_PY" gpu/pixie/overlay_obj_meshfill.py \
    --image_dir "${KEYFRAME_DIR}/hit" \
    --pixie_dir "${PIXIE_OUT}/hit" \
    --out_dir "${OUT_DIR}/overlay_meshfill" \
    --flip_y

  if [[ "$SKIP_HOLD" != "1" ]]; then
    "$PIXIE_PY" gpu/pixie/overlay_obj_meshfill.py \
      --image_dir "${KEYFRAME_DIR}/hold" \
      --pixie_dir "${PIXIE_OUT}/hold" \
      --out_dir "${OUT_DIR}/overlay_meshfill_hold" \
      --flip_y
  fi
fi

echo "[OK] pipeline finished"
