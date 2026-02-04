from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
import time
from typing import Optional
from pathlib import Path
from datetime import datetime

from sqlalchemy.orm import Session

from ..db.base import SessionLocal
from ..db import models
from ..services.s3 import download_fileobj, upload_file
from ..services.music_analysis import run_music_analysis
from ..core.config import PROJECT_ROOT, DEMUCS_MODEL
from .jobs import set_job

MOTION_ROOT = os.environ.get("MOTION_ROOT", str(PROJECT_ROOT / "motion"))
MOTION_PIPELINE = os.path.join(MOTION_ROOT, "pipelines", "motion_pipeline.py")

MAGIC_WORKER_CMD = os.environ.get("MAGIC_WORKER_CMD")

logger = logging.getLogger(__name__)


class AnalysisWorker:
    def __init__(self, poll_interval: float = 2.0):
        self._poll_interval = poll_interval
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._handlers = {
            "dance": self._run_dance,
            "magic": self._run_magic,
        }

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
                .with_for_update(skip_locked=True)
                .first()
            )
            if not req:
                return

            req.status = "running"
            req.started_at = datetime.utcnow()
            db.commit()
            set_job(req.id, "running", message="starting", progress=0.05, db=db)

            if (req.params_json or {}).get("music_only"):
                handler = self._run_music_only
            else:
                handler = self._handlers.get(req.mode)

            if not handler:
                raise RuntimeError("Unknown mode")

            handler(db, req)

            if (req.params_json or {}).get("music_only"):
                params = dict(req.params_json or {})
                params.pop("music_only", None)
                req.params_json = params or None

            req.status = "done"
            req.finished_at = datetime.utcnow()
            db.commit()
            set_job(req.id, "done", message="completed", progress=1.0, db=db)
        except Exception as exc:
            if "req" in locals() and req is not None:
                logger.exception("analysis request failed: id=%s", req.id)
                req.status = "failed"
                req.error_message = str(exc)
                req.finished_at = datetime.utcnow()
                db.commit()
                log = str(exc)[:4000]
                set_job(req.id, "failed", str(exc), message="failed", progress=1.0, log=log, db=db)
            else:
                logger.exception("analysis worker tick failed before request loaded")
        finally:
            db.close()

    def _run_dance(self, db: Session, req: models.AnalysisRequest) -> None:
        video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
        if not video:
            raise RuntimeError("video not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            set_job(req.id, "running", message="downloading video", progress=0.15, db=db)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            out_json = os.path.join(tmpdir, "motion_result.json")
            set_job(req.id, "running", message="running motion pipeline", progress=0.5, db=db)
            cmd = ["python", MOTION_PIPELINE, "--video", local_video, "--out", out_json]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                log = (proc.stderr or proc.stdout or "motion pipeline failed")[:4000]
                set_job(req.id, "running", log=log, db=db)
                raise RuntimeError(log)

            set_job(req.id, "running", message="uploading results", progress=0.55, db=db)
            result_key = f"results/{req.id}/motion_result.json"
            upload_file(out_json, result_key, content_type="application/json")

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.motion_json_s3_key = result_key
            db.commit()

            if req.audio_id:
                self._run_music(db, req, tmpdir, progress_start=0.6, progress_end=0.95)
            else:
                set_job(req.id, "running", message="motion done", progress=0.85, db=db)

    def _run_magic(self, db: Session, req: models.AnalysisRequest) -> None:
        if not MAGIC_WORKER_CMD:
            raise RuntimeError("MAGIC_WORKER_CMD is not set")

        video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
        if not video:
            raise RuntimeError("video not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            set_job(req.id, "running", message="downloading video", progress=0.15, db=db)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            out_json = os.path.join(tmpdir, "object_events.json")
            out_video = os.path.join(tmpdir, "object_events_overlay.mp4")

            set_job(req.id, "running", message="running magic pipeline", progress=0.5, db=db)
            cmd = MAGIC_WORKER_CMD.format(
                video=local_video,
                out_json=out_json,
                out_video=out_video,
            )
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if proc.returncode != 0:
                log = (proc.stderr or proc.stdout or "magic pipeline failed")[:4000]
                set_job(req.id, "running", log=log, db=db)
                raise RuntimeError(log)

            set_job(req.id, "running", message="uploading results", progress=0.55, db=db)
            result_key = f"results/{req.id}/object_events.json"
            upload_file(out_json, result_key, content_type="application/json")

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.magic_json_s3_key = result_key
            db.commit()

            if req.audio_id:
                self._run_music(db, req, tmpdir, progress_start=0.6, progress_end=0.95)
            else:
                set_job(req.id, "running", message="magic done", progress=0.85, db=db)

    def _run_music_only(self, db: Session, req: models.AnalysisRequest) -> None:
        if not req.audio_id:
            raise RuntimeError("audio not found")
        with tempfile.TemporaryDirectory() as tmpdir:
            self._run_music(db, req, tmpdir, progress_start=0.2, progress_end=0.95)

    def _run_music(
        self,
        db: Session,
        req: models.AnalysisRequest,
        tmpdir: str,
        progress_start: float = 0.6,
        progress_end: float = 0.95,
    ) -> None:
        audio = db.query(models.MediaFile).filter(models.MediaFile.id == req.audio_id).first()
        if not audio:
            return

        progress_span = max(progress_end - progress_start, 0.01)

        set_job(
            req.id,
            "running",
            message="downloading audio",
            progress=progress_start + 0.1 * progress_span,
            db=db,
        )
        ext = None
        if audio.s3_key and "." in audio.s3_key:
            ext = audio.s3_key.rsplit(".", 1)[-1]
        if not ext and audio.content_type:
            if "wav" in audio.content_type:
                ext = "wav"
            elif "mpeg" in audio.content_type or "mp3" in audio.content_type:
                ext = "mp3"
            elif "mp4" in audio.content_type or "m4a" in audio.content_type:
                ext = "m4a"
        if not ext:
            ext = "bin"
        local_audio = os.path.join(tmpdir, f"input_audio.{ext}")
        with open(local_audio, "wb") as f:
            download_fileobj(audio.s3_key, f)

        stem_out_dir = os.path.join(tmpdir, "stems")
        out_json = os.path.join(tmpdir, "streams_sections_cnn.json")

        set_job(
            req.id,
            "running",
            message="analyzing music",
            progress=progress_start + 0.3 * progress_span,
            db=db,
        )
        run_music_analysis(
            local_audio,
            stem_out_dir,
            out_json,
            model_name=DEMUCS_MODEL,
        )

        set_job(
            req.id,
            "running",
            message="uploading music results",
            progress=progress_start + 0.8 * progress_span,
            db=db,
        )
        result_key = f"results/{req.id}/streams_sections_cnn.json"
        upload_file(out_json, result_key, content_type="application/json")

        res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
        if not res:
            res = models.AnalysisResult(request_id=req.id)
            db.add(res)
        res.music_json_s3_key = result_key
        db.commit()
