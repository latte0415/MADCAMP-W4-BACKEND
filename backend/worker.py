from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
from typing import Optional

from sqlalchemy.orm import Session

from .db import SessionLocal
from . import models
from .s3 import download_fileobj, upload_file
from .jobs import set_job

MOTION_ROOT = os.environ.get(
    "MOTION_ROOT",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "motion")),
)
MOTION_PIPELINE = os.path.join(MOTION_ROOT, "pipelines", "motion_pipeline.py")

MAGIC_WORKER_CMD = os.environ.get("MAGIC_WORKER_CMD")


class AnalysisWorker:
    def __init__(self, poll_interval: float = 2.0):
        self._poll_interval = poll_interval
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception:
                pass
            time.sleep(self._poll_interval)

    def _tick(self) -> None:
        db: Session = SessionLocal()
        try:
            req = (
                db.query(models.AnalysisRequest)
                .filter(models.AnalysisRequest.status == "queued")
                .order_by(models.AnalysisRequest.created_at.asc())
                .first()
            )
            if not req:
                return

            req.status = "running"
            db.commit()
            set_job(req.id, "running", message="starting", progress=0.05)

            if req.mode == "dance":
                self._run_dance(db, req)
            elif req.mode == "magic":
                self._run_magic(db, req)
            else:
                raise RuntimeError("Unknown mode")

            req.status = "done"
            db.commit()
            set_job(req.id, "done", message="completed", progress=1.0)
        except Exception as exc:
            if "req" in locals() and req is not None:
                req.status = "failed"
                req.error_message = str(exc)
                db.commit()
                set_job(req.id, "failed", str(exc), message="failed", progress=1.0)
        finally:
            db.close()

    def _run_dance(self, db: Session, req: models.AnalysisRequest) -> None:
        video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
        if not video:
            raise RuntimeError("video not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            set_job(req.id, "running", message="downloading video", progress=0.15)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            out_json = os.path.join(tmpdir, "motion_result.json")
            set_job(req.id, "running", message="running motion pipeline", progress=0.5)
            cmd = ["python", MOTION_PIPELINE, "--video", local_video, "--out", out_json]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                log = (proc.stderr or proc.stdout or "motion pipeline failed")[:4000]
                set_job(req.id, "running", log=log)
                raise RuntimeError(log)

            set_job(req.id, "running", message="uploading results", progress=0.85)
            result_key = f"results/{req.id}/motion_result.json"
            upload_file(out_json, result_key, content_type="application/json")

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.motion_json_s3_key = result_key
            db.commit()

    def _run_magic(self, db: Session, req: models.AnalysisRequest) -> None:
        if not MAGIC_WORKER_CMD:
            raise RuntimeError("MAGIC_WORKER_CMD is not set")

        video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
        if not video:
            raise RuntimeError("video not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            set_job(req.id, "running", message="downloading video", progress=0.15)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            out_json = os.path.join(tmpdir, "object_events.json")
            out_video = os.path.join(tmpdir, "object_events_overlay.mp4")

            set_job(req.id, "running", message="running magic pipeline", progress=0.5)
            cmd = MAGIC_WORKER_CMD.format(
                video=local_video,
                out_json=out_json,
                out_video=out_video,
            )
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if proc.returncode != 0:
                log = (proc.stderr or proc.stdout or "magic pipeline failed")[:4000]
                set_job(req.id, "running", log=log)
                raise RuntimeError(log)

            set_job(req.id, "running", message="uploading results", progress=0.85)
            result_key = f"results/{req.id}/object_events.json"
            upload_file(out_json, result_key, content_type="application/json")

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.magic_json_s3_key = result_key
            db.commit()
