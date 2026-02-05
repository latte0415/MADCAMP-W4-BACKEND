#!/usr/bin/env bash
set -euo pipefail

python -m backend.app.workers.runner --type music "$@"
