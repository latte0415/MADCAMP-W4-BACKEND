#!/usr/bin/env bash
set -euo pipefail

VIDEO=${1:-"inputs/magic.mp4"}
OUT_DIR=${2:-"outputs_magic_split"}
OVERLAP=${3:-2}
PARTS=${4:-4}

MODEL=${MODEL:-"/opt/dance/weights/sam3.pt"}
PROMPT=${PROMPT:-"small ball, scarf, silk, cloth, handkerchief, prop"}
TARGET_FPS=${TARGET_FPS:-3}
CONF=${CONF:-0.35}
MIN_HITS=${MIN_HITS:-3}
VANISH_GAP=${VANISH_GAP:-1.5}
PERSON_CROP=${PERSON_CROP:-1}
CROP_MARGIN_X=${CROP_MARGIN_X:-0.7}
CROP_MARGIN_Y=${CROP_MARGIN_Y:-0.05}
FIXED_CROP_SECONDS=${FIXED_CROP_SECONDS:-5}
DEVICE=${DEVICE:-"cuda:0"}

mkdir -p "$OUT_DIR/parts"

DUR=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$VIDEO")
DUR=${DUR%.*}
PART_LEN=$(python - <<PY
D=float("$DUR")
parts=int("$PARTS")
print(D/parts)
PY
)

PIDS=()
OFFSETS=()
EVENTS=()
OUT_VIDS=()

for i in $(seq 0 $((PARTS-1))); do
  START=$(python - <<PY
D=float("$PART_LEN")
O=float("$OVERLAP")
i=int("$i")
print(max(0.0, i*D - (O if i>0 else 0)))
PY
)
  END=$(python - <<PY
D=float("$PART_LEN")
O=float("$OVERLAP")
i=int("$i")
DUR=float("$DUR")
start=max(0.0, i*D - (O if i>0 else 0))
end=min(DUR, (i+1)*D + (O if i<${PARTS}-1 else 0))
print(end)
PY
)
  LEN=$(python - <<PY
start=float("$START")
end=float("$END")
print(max(0.0, end-start))
PY
)

  PART="$OUT_DIR/parts/part_$i.mp4"
  ffmpeg -y -ss "$START" -t "$LEN" -i "$VIDEO" -c copy "$PART" >/dev/null 2>&1
  OFFSETS+=("$START")

  OUT_JSON="$OUT_DIR/parts/part_${i}_events.json"
  OUT_MP4="$OUT_DIR/parts/part_${i}_overlay.mp4"
  EVENTS+=("$OUT_JSON")
  OUT_VIDS+=("$OUT_MP4")

  CMD=(python detect_object_events.py --video "$PART" --out_json "$OUT_JSON" --out_video "$OUT_MP4" --model "$MODEL" --prompt "$PROMPT" --target_fps "$TARGET_FPS" --conf "$CONF" --min_hits "$MIN_HITS" --vanish_gap_s "$VANISH_GAP" --fixed_crop_seconds "$FIXED_CROP_SECONDS" --max_fraction 1.0 --device "$DEVICE")
  if [[ "$PERSON_CROP" == "1" ]]; then
    CMD+=(--person_crop --crop_margin_x "$CROP_MARGIN_X" --crop_margin_y "$CROP_MARGIN_Y")
  fi

  "${CMD[@]}" &
  PIDS+=("$!")
  echo "[RUN] part $i start=$START len=$LEN"
  sleep 1

done

for pid in "${PIDS[@]}"; do
  wait "$pid"
done

python merge_object_events.py \
  --inputs "${EVENTS[@]}" \
  --offsets "${OFFSETS[@]}" \
  --out "$OUT_DIR/object_events_merged.json" \
  --dedupe_window 0.4

# concat with overlap trim
LIST="$OUT_DIR/parts/concat.txt"
> "$LIST"

for i in $(seq 0 $((PARTS-1))); do
  SRC="$OUT_DIR/parts/part_${i}_overlay.mp4"
  [[ -f "$SRC" ]] || continue

  TRIM_START=0
  TRIM_LEN=""
  if [[ $i -gt 0 ]]; then
    TRIM_START=$OVERLAP
  fi
  if [[ $i -lt $((PARTS-1)) ]]; then
    TRIM_LEN=$(python - <<PY
len=float("$PART_LEN")
O=float("$OVERLAP")
print(max(0.1, len + O))
PY
)
  fi

  OUT="$OUT_DIR/parts/part_${i}_overlay_trim.mp4"
  if [[ -n "$TRIM_LEN" ]]; then
    ffmpeg -y -ss "$TRIM_START" -i "$SRC" -t "$TRIM_LEN" -c copy "$OUT" >/dev/null 2>&1
  else
    ffmpeg -y -ss "$TRIM_START" -i "$SRC" -c copy "$OUT" >/dev/null 2>&1
  fi
  echo "file '$OUT'" >> "$LIST"

done

ffmpeg -y -f concat -safe 0 -i "$LIST" -c copy "$OUT_DIR/object_events_overlay_concat.mp4" >/dev/null 2>&1 || true

echo "[OK] merged events: $OUT_DIR/object_events_merged.json"
