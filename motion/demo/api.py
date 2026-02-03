#!/usr/bin/env python3
import json
import os
import shlex
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Optional

import paramiko
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

app = FastAPI()
app.mount("/static", StaticFiles(directory=str(BASE_DIR)), name="static")

_jobs = {}
_jobs_lock = threading.Lock()


def safe_stem(name: str) -> str:
    base = Path(name).stem
    safe = "".join(c for c in base if c.isalnum() or c in ("-", "_"))
    return safe or "upload"


@app.get("/")
def index():
    return FileResponse(str(BASE_DIR / "index.html"))


@app.get("/health")
def health():
    return {"ok": True}


def run_motion_pipeline(video_path: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / "motion_result.json"
    cmd = [
        sys.executable,
        str(ROOT_DIR / "pipelines" / "motion_pipeline.py"),
        "--video",
        str(video_path),
        "--out",
        str(out_json),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "motion_pipeline failed")
    return out_json


def ssh_connect():
    host = os.environ.get("DANCE_SSH_HOST", "172.10.5.177")
    user = os.environ.get("DANCE_SSH_USER", "root")
    password = os.environ.get("DANCE_SSH_PASS")
    if not password:
        raise RuntimeError("DANCE_SSH_PASS is not set")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=password, timeout=30)
    return client


def run_remote_magic(video_path: Path, params: dict) -> dict:
    remote_root = os.environ.get("DANCE_REMOTE_ROOT", "/opt/dance")
    remote_venv = os.environ.get("DANCE_REMOTE_VENV", "/opt/venvs/dance-gpu/bin/activate")
    remote_model = os.environ.get("DANCE_REMOTE_MODEL", f"{remote_root}/weights/sam3.pt")
    device = params.get("device", "cuda:0")

    job_id = uuid.uuid4().hex[:10]
    remote_inputs = f"{remote_root}/inputs"
    remote_outputs = f"{remote_root}/outputs_magic/{job_id}"
    remote_video = f"{remote_inputs}/{job_id}{video_path.suffix or '.mp4'}"
    remote_json = f"{remote_outputs}/object_events.json"
    remote_overlay = f"{remote_outputs}/object_events_overlay.mp4"

    prompt = params.get("prompt", "object")
    target_fps = params.get("target_fps", 5)
    conf = params.get("conf", 0.35)
    min_hits = params.get("min_hits", 2)
    vanish_gap_s = params.get("vanish_gap_s", 1.2)
    max_fraction = params.get("max_fraction", 1.0)

    client = ssh_connect()
    try:
        sftp = client.open_sftp()
        try:
            update_job(params.get("job_id"), "uploading", 0.1, "Uploading to GPU server...")
            client.exec_command(f"mkdir -p {shlex.quote(remote_inputs)} {shlex.quote(remote_outputs)}")
            sftp.put(str(video_path), remote_video)
        finally:
            sftp.close()

        update_job(params.get("job_id"), "running", 0.4, "Running SAM3 on GPU server...")
        cmd = (
            f"source {shlex.quote(remote_venv)} && "
            f"cd {shlex.quote(remote_root)} && "
            "python gpu/sam3/detect_object_events.py "
            f"--video {shlex.quote(remote_video.replace(remote_root + '/', ''))} "
            f"--out_json {shlex.quote(remote_json.replace(remote_root + '/', ''))} "
            f"--out_video {shlex.quote(remote_overlay.replace(remote_root + '/', ''))} "
            f"--model {shlex.quote(remote_model)} "
            f"--prompt {shlex.quote(prompt)} "
            f"--target_fps {shlex.quote(str(target_fps))} "
            f"--conf {shlex.quote(str(conf))} "
            f"--min_hits {shlex.quote(str(min_hits))} "
            f"--vanish_gap_s {shlex.quote(str(vanish_gap_s))} "
            f"--max_fraction {shlex.quote(str(max_fraction))} "
            f"--device {shlex.quote(device)}"
        )
        full_cmd = f"bash -lc {shlex.quote(cmd)}"
        _, stdout, stderr = client.exec_command(full_cmd)
        exit_status = stdout.channel.recv_exit_status()
        if exit_status != 0:
            raise RuntimeError(stderr.read().decode("utf-8") or stdout.read().decode("utf-8") or "remote failed")

        update_job(params.get("job_id"), "downloading", 0.85, "Downloading results...")
        local_out_dir = ROOT_DIR / "outputs_magic" / job_id
        local_out_dir.mkdir(parents=True, exist_ok=True)
        local_json = local_out_dir / "object_events.json"
        local_overlay = local_out_dir / "object_events_overlay.mp4"

        sftp = client.open_sftp()
        try:
            sftp.get(remote_json, str(local_json))
            try:
                sftp.get(remote_overlay, str(local_overlay))
            except Exception:
                pass
        finally:
            sftp.close()

        return {
            "job_id": job_id,
            "local_json": str(local_json),
            "local_overlay": str(local_overlay) if local_overlay.exists() else None,
            "data": json.loads(local_json.read_text(encoding="utf-8")),
        }
    finally:
        client.close()


def update_job(job_id: str, state: str, progress: float, message: str, error: Optional[str] = None):
    if not job_id:
        return
    with _jobs_lock:
        job = _jobs.get(job_id, {})
        job.update({
            "state": state,
            "progress": progress,
            "message": message,
            "error": error,
        })
        _jobs[job_id] = job


def run_magic_job(job_id: str, tmp_path: Path, params: dict):
    try:
        update_job(job_id, "queued", 0.0, "Queued...")
        params = dict(params)
        params["job_id"] = job_id
        result = run_remote_magic(tmp_path, params)
        with _jobs_lock:
            _jobs[job_id]["result"] = {
                "job_id": result["job_id"],
                "output_dir": str(Path(result["local_json"]).parent),
                "magic": result["data"],
                "overlay": result["local_overlay"],
            }
        update_job(job_id, "done", 1.0, "Completed.")
    except Exception as exc:
        update_job(job_id, "error", 1.0, "Failed.", error=str(exc))
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


@app.post("/analyze")
async def analyze_dance(video: UploadFile = File(...)):
    if not video.filename:
        raise HTTPException(status_code=400, detail="empty filename")
    stem = safe_stem(video.filename)
    out_dir = ROOT_DIR / f"outputs_{stem}"

    suffix = Path(video.filename).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await video.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        out_json = run_motion_pipeline(tmp_path, out_dir)
        data = json.loads(out_json.read_text(encoding="utf-8"))
        return JSONResponse({"output_dir": str(out_dir), "motion": data})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


@app.post("/analyze-magic")
async def analyze_magic(
    video: UploadFile = File(...),
    prompt: str = Form("object"),
    target_fps: int = Form(5),
    conf: float = Form(0.35),
    min_hits: int = Form(2),
    vanish_gap_s: float = Form(1.2),
    max_fraction: float = Form(1.0),
):
    if not video.filename:
        raise HTTPException(status_code=400, detail="empty filename")

    suffix = Path(video.filename).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await video.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    job_id = uuid.uuid4().hex[:10]
    with _jobs_lock:
        _jobs[job_id] = {
            "state": "queued",
            "progress": 0.0,
            "message": "Queued...",
            "error": None,
            "result": None,
        }
    thread = threading.Thread(
        target=run_magic_job,
        args=(job_id, tmp_path, {
            "prompt": prompt,
            "target_fps": target_fps,
            "conf": conf,
            "min_hits": min_hits,
            "vanish_gap_s": vanish_gap_s,
            "max_fraction": max_fraction,
        }),
        daemon=True,
    )
    thread.start()
    return JSONResponse({"job_id": job_id})


@app.get("/status/{job_id}")
def status(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return JSONResponse({
        "job_id": job_id,
        "state": job["state"],
        "progress": job["progress"],
        "message": job["message"],
        "error": job.get("error"),
    })


@app.get("/result/{job_id}")
def result(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job.get("state") != "done":
        raise HTTPException(status_code=409, detail="job not completed")
    return JSONResponse(job.get("result") or {})


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
