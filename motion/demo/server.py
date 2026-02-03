#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")


@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/health")
def health():
    return jsonify({"ok": True})


def safe_stem(name: str) -> str:
    base = Path(name).stem
    safe = "".join(c for c in base if c.isalnum() or c in ("-", "_"))
    return safe or "upload"


def run_motion_pipeline(video_path: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / "motion_result.json"
    cmd = [sys.executable, str(ROOT_DIR / "pipelines" / "motion_pipeline.py"), "--video", str(video_path), "--out", str(out_json)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "motion_pipeline failed")
    return out_json


@app.route("/analyze", methods=["POST"])
def analyze():
    if "video" not in request.files:
        return jsonify({"error": "missing video"}), 400

    video_file = request.files["video"]
    if not video_file.filename:
        return jsonify({"error": "empty filename"}), 400

    stem = safe_stem(video_file.filename)
    out_dir = ROOT_DIR / f"outputs_{stem}"

    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(video_file.filename).suffix or ".mp4") as tmp:
        video_file.save(tmp)
        tmp_path = Path(tmp.name)

    try:
        out_json = run_motion_pipeline(tmp_path, out_dir)
        data = json.loads(out_json.read_text(encoding="utf-8"))
        return jsonify({"output_dir": str(out_dir), "motion": data})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5173"))
    app.run(host="127.0.0.1", port=port, debug=False)
