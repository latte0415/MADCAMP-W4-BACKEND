#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
ANALYSIS_ID="${ANALYSIS_ID:-}"

python -m backend.app.workers.runner --type magic "$@" &
worker_pid=$!

cleanup() {
  kill "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT

if [[ -n "$ANALYSIS_ID" ]]; then
  echo "[watch] polling ${API_BASE}/api/analysis/${ANALYSIS_ID}/status"
  while true; do
    curl -s "${API_BASE}/api/analysis/${ANALYSIS_ID}/status" | jq .
    sleep 2
  done
else
  wait "$worker_pid"
fi
