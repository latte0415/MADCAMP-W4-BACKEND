from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
import time
from typing import Optional
from datetime import datetime
import uuid

from sqlalchemy.orm import Session

from ..db.base import SessionLocal
from ..db import models
from ..services.s3 import download_fileobj, upload_file, S3_BUCKET
from ..services.music_analysis import run_music_analysis
from ..services.match_score import compute_match_score
from ..core.config import PROJECT_ROOT, DEMUCS_MODEL
from .jobs import set_job

MOTION_ROOT = os.environ.get("MOTION_ROOT", str(PROJECT_ROOT / "motion"))
MOTION_PIPELINE = os.path.join(MOTION_ROOT, "pipelines", "motion_pipeline.py")

MAGIC_WORKER_CMD = os.environ.get("MAGIC_WORKER_CMD")

logger = logging.getLogger(__name__)


class BaseAnalysisWorker:
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
                logger.exception("analysis worker tick failed")
            time.sleep(self._poll_interval)

    def _fetch_request(self, db: Session) -> Optional[models.AnalysisRequest]:
        raise NotImplementedError

    def _handle_request(self, db: Session, req: models.AnalysisRequest) -> None:
        raise NotImplementedError

    def _abort_if_deleted(self, db: Session, req: models.AnalysisRequest) -> None:
        db.refresh(req)
        if req.is_deleted:
            raise RuntimeError("deleted")

    def _tick(self) -> None:
        db: Session = SessionLocal()
        try:
            req = self._fetch_request(db)
            if not req:
                return
            if req.is_deleted:
                return

            req.status = "running"
            if req.started_at is None:
                req.started_at = datetime.utcnow()
            db.commit()
            set_job(req.id, "running", message="analysis: starting", progress=0.03, db=db)

            self._handle_request(db, req)

            if req.status == "queued_music":
                set_job(req.id, "queued", message="music: queued", progress=0.05, db=db)
                return

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


class MotionAnalysisWorker(BaseAnalysisWorker):
    def _fetch_request(self, db: Session) -> Optional[models.AnalysisRequest]:
        return (
            db.query(models.AnalysisRequest)
            .filter(models.AnalysisRequest.status == "queued")
            .filter(models.AnalysisRequest.is_deleted == False)
            .order_by(models.AnalysisRequest.created_at.asc())
            .with_for_update(skip_locked=True)
            .first()
        )

    def _handle_request(self, db: Session, req: models.AnalysisRequest) -> None:
        self._abort_if_deleted(db, req)
        if (req.params_json or {}).get("music_only"):
            self._queue_music(db, req)
            return
        handler = {
            "dance": self._run_dance,
            "magic": self._run_magic,
        }.get(req.mode)
        if not handler:
            raise RuntimeError("Unknown mode")
        handler(db, req)

    def _queue_music(self, db: Session, req: models.AnalysisRequest) -> None:
        params = dict(req.params_json or {})
        params.pop("skip_music", None)
        params["music_only"] = True
        req.params_json = params
        req.status = "queued_music"
        db.commit()

    def _run_dance(self, db: Session, req: models.AnalysisRequest) -> None:
        self._abort_if_deleted(db, req)
        video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
        if not video:
            raise RuntimeError("video not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="motion: downloading video", progress=0.12, db=db)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            out_json = os.path.join(tmpdir, "motion_result.json")
            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="motion: preprocessing", progress=0.22, db=db)
            set_job(req.id, "running", message="motion: analyzing", progress=0.45, db=db)
            cmd = ["python", MOTION_PIPELINE, "--video", local_video, "--out", out_json]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                log = (proc.stderr or proc.stdout or "motion pipeline failed")[:4000]
                set_job(req.id, "running", log=log, db=db)
                raise RuntimeError(log)

            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="motion: uploading results", progress=0.7, db=db)
            result_key = f"results/{req.id}/motion_result.json"
            upload_file(out_json, result_key, content_type="application/json")

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.motion_json_s3_key = result_key
            db.commit()

            if not (req.params_json or {}).get("skip_music") and (
                req.audio_id or (req.params_json or {}).get("extract_audio")
            ):
                self._queue_music(db, req)
            else:
                set_job(req.id, "running", message="motion: finalizing", progress=0.85, db=db)
                self._compute_match_if_ready(db, req)

    def _run_magic(self, db: Session, req: models.AnalysisRequest) -> None:
        if not MAGIC_WORKER_CMD:
            raise RuntimeError("MAGIC_WORKER_CMD is not set")

        self._abort_if_deleted(db, req)
        video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
        if not video:
            raise RuntimeError("video not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="magic: downloading video", progress=0.12, db=db)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            out_json = os.path.join(tmpdir, "object_events.json")
            out_video = os.path.join(tmpdir, "object_events_overlay.mp4")

            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="magic: analyzing", progress=0.45, db=db)
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

            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="magic: uploading results", progress=0.7, db=db)
            result_key = f"results/{req.id}/object_events.json"
            upload_file(out_json, result_key, content_type="application/json")

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.magic_json_s3_key = result_key
            db.commit()

            if not (req.params_json or {}).get("skip_music") and (req.audio_id or (req.params_json or {}).get("extract_audio")):
                self._queue_music(db, req)
            else:
                set_job(req.id, "running", message="magic: finalizing", progress=0.85, db=db)
                self._compute_match_if_ready(db, req)

    def _compute_match_if_ready(self, db: Session, req: models.AnalysisRequest) -> None:
        res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
        if not res:
            return
        if res.match_score is not None:
            return
        motion_key = res.motion_json_s3_key or res.magic_json_s3_key
        if not motion_key or not res.music_json_s3_key:
            return
        with tempfile.TemporaryDirectory() as tmpdir:
            motion_path = os.path.join(tmpdir, "motion.json")
            music_path = os.path.join(tmpdir, "music.json")
            with open(motion_path, "wb") as f:
                download_fileobj(motion_key, f)
            with open(music_path, "wb") as f:
                download_fileobj(res.music_json_s3_key, f)
            try:
                set_job(req.id, "running", message="analysis: scoring match", progress=0.92, db=db)
                import json

                with open(motion_path, "r", encoding="utf-8") as f:
                    motion_json = json.load(f)
                with open(music_path, "r", encoding="utf-8") as f:
                    music_json = json.load(f)
                score_info = compute_match_score(music_json, motion_json)
                res.match_score = score_info.get("score")
                res.match_details = score_info
                db.commit()
                set_job(req.id, "running", message="analysis: scoring done", progress=0.95, db=db)
            except Exception:
                logger.exception("match score computation failed")


class DanceAnalysisWorker(MotionAnalysisWorker):
    def _fetch_request(self, db: Session) -> Optional[models.AnalysisRequest]:
        return (
            db.query(models.AnalysisRequest)
            .filter(models.AnalysisRequest.status == "queued")
            .filter(models.AnalysisRequest.mode == "dance")
            .filter(models.AnalysisRequest.is_deleted == False)
            .order_by(models.AnalysisRequest.created_at.asc())
            .with_for_update(skip_locked=True)
            .first()
        )


class MagicAnalysisWorker(MotionAnalysisWorker):
    def _fetch_request(self, db: Session) -> Optional[models.AnalysisRequest]:
        return (
            db.query(models.AnalysisRequest)
            .filter(models.AnalysisRequest.status == "queued")
            .filter(models.AnalysisRequest.mode == "magic")
            .filter(models.AnalysisRequest.is_deleted == False)
            .order_by(models.AnalysisRequest.created_at.asc())
            .with_for_update(skip_locked=True)
            .first()
        )


class MusicAnalysisWorker(BaseAnalysisWorker):
    def _fetch_request(self, db: Session) -> Optional[models.AnalysisRequest]:
        return (
            db.query(models.AnalysisRequest)
            .filter(models.AnalysisRequest.status == "queued_music")
            .filter(models.AnalysisRequest.is_deleted == False)
            .order_by(models.AnalysisRequest.created_at.asc())
            .with_for_update(skip_locked=True)
            .first()
        )

    def _handle_request(self, db: Session, req: models.AnalysisRequest) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            local_audio = None

            self._abort_if_deleted(db, req)
            if req.audio_id:
                audio = db.query(models.MediaFile).filter(models.MediaFile.id == req.audio_id).first()
                if not audio:
                    raise RuntimeError("audio not found")
                set_job(req.id, "running", message="music: downloading audio", progress=0.12, db=db)
                ext = "bin"
                if audio.s3_key and "." in audio.s3_key:
                    ext = audio.s3_key.rsplit(".", 1)[-1]
                elif audio.content_type:
                    if "wav" in audio.content_type:
                        ext = "wav"
                    elif "mpeg" in audio.content_type or "mp3" in audio.content_type:
                        ext = "mp3"
                    elif "mp4" in audio.content_type or "m4a" in audio.content_type:
                        ext = "m4a"
                local_audio = os.path.join(tmpdir, f"input_audio.{ext}")
                with open(local_audio, "wb") as f:
                    download_fileobj(audio.s3_key, f)
            elif req.video_id:
                video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
                if not video:
                    raise RuntimeError("video not found")
                self._abort_if_deleted(db, req)
                set_job(req.id, "running", message="music: downloading video", progress=0.12, db=db)
                local_video = os.path.join(tmpdir, "input_video.mp4")
                with open(local_video, "wb") as f:
                    download_fileobj(video.s3_key, f)
                local_audio = os.path.join(tmpdir, "extracted_audio.wav")
                self._abort_if_deleted(db, req)
                set_job(req.id, "running", message="music: extracting audio", progress=0.26, db=db)
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    local_video,
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "44100",
                    local_audio,
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    log = (proc.stderr or proc.stdout or "ffmpeg extract failed")[:2000]
                    set_job(req.id, "running", log=log, db=db)
                    raise RuntimeError(log)
                if not req.audio_id and (req.params_json or {}).get("extract_audio"):
                    audio_key = f"uploads/{req.user_id}/{uuid.uuid4().hex}.wav"
                    upload_file(local_audio, audio_key, content_type="audio/wav")
                    media = models.MediaFile(
                        user_id=req.user_id,
                        type="audio",
                        s3_bucket=S3_BUCKET,
                        s3_key=audio_key,
                        content_type="audio/wav",
                        duration_sec=None,
                    )
                    db.add(media)
                    db.commit()
                    db.refresh(media)
                    req.audio_id = media.id
                    db.commit()
            else:
                raise RuntimeError("audio or video not found")

            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="music: preparing pipeline", progress=0.35, db=db)
            stem_out_dir = os.path.join(tmpdir, "stems")
            out_json = os.path.join(tmpdir, "streams_sections_cnn.json")
            def _music_progress(stage: str, progress: float) -> None:
                stage_map = {
                    "stems": "music: separating stems",
                    "drum_bands": "music: splitting drum bands",
                    "cnn_onsets": "music: detecting onsets",
                    "keypoints": "music: selecting keypoints",
                    "textures": "music: merging textures",
                    "bass": "music: analyzing bass",
                    "write_json": "music: building json",
                }
                message = stage_map.get(stage, "music: analyzing")
                set_job(req.id, "running", message=message, progress=progress, db=db)

            run_music_analysis(
                local_audio,
                stem_out_dir,
                out_json,
                model_name=DEMUCS_MODEL,
                progress_cb=_music_progress,
            )

            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="music: uploading results", progress=0.95, db=db)
            result_key = f"results/{req.id}/streams_sections_cnn.json"
            upload_file(out_json, result_key, content_type="application/json")

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.music_json_s3_key = result_key
            db.commit()

            # score if motion/magic already ready
            if res.motion_json_s3_key or res.magic_json_s3_key:
                try:
                    import json

                    motion_key = res.motion_json_s3_key or res.magic_json_s3_key
                    motion_path = os.path.join(tmpdir, "motion.json")
                    with open(motion_path, "wb") as f:
                        download_fileobj(motion_key, f)
                    with open(motion_path, "r", encoding="utf-8") as f:
                        motion_json = json.load(f)
                    with open(out_json, "r", encoding="utf-8") as f:
                        music_json = json.load(f)
                    set_job(req.id, "running", message="analysis: scoring match", progress=0.92, db=db)
                    score_info = compute_match_score(music_json, motion_json)
                    res.match_score = score_info.get("score")
                    res.match_details = score_info
                    db.commit()
                    set_job(req.id, "running", message="analysis: scoring done", progress=0.95, db=db)
                except Exception:
                    logger.exception("match score computation failed")

        params = dict(req.params_json or {})
        params.pop("music_only", None)
        req.params_json = params or None
        db.commit()
