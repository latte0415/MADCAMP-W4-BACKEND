from __future__ import annotations

import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
from typing import Optional
from datetime import datetime
import uuid
from pathlib import Path

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ..db.base import SessionLocal
from ..db import models
from ..services.s3 import download_fileobj, upload_file, S3_BUCKET
from ..services.music_analysis import run_music_analysis
from ..services.match_score import compute_match_score
from ..core.config import PROJECT_ROOT, DEMUCS_MODEL
from .jobs import set_job

# MOTION_ROOT should be relative to PROJECT_ROOT
_motion_root_env = os.environ.get("MOTION_ROOT", "motion")
# Strip leading slashes to ensure it's treated as relative path
MOTION_ROOT = _motion_root_env.lstrip("/\\")
MOTION_PIPELINE = str(PROJECT_ROOT / MOTION_ROOT / "pipelines" / "motion_pipeline.py")

MAGIC_WORKER_CMD = os.environ.get("MAGIC_WORKER_CMD")

logger = logging.getLogger(__name__)


def _upload_music_stems(request_id: int, local_audio: str, stem_out_dir: str) -> dict[str, str]:
    stem_dir = Path(stem_out_dir) / DEMUCS_MODEL / Path(local_audio).stem
    stem_candidates = {
        "drums": stem_dir / "drums.wav",
        "bass": stem_dir / "bass.wav",
        "vocal": stem_dir / "vocals.wav",
        "other": stem_dir / "other.wav",
        "drum_low": stem_dir / "drum_low.wav",
        "drum_mid": stem_dir / "drum_mid.wav",
        "drum_high": stem_dir / "drum_high.wav",
    }
    out: dict[str, str] = {}
    for key, path in stem_candidates.items():
        if not path.exists():
            continue
        s3_key = f"results/{request_id}/stems/{key}.wav"
        upload_file(str(path), s3_key, content_type="audio/wav")
        out[key] = s3_key
    return out


def _resolve_motion_pipeline() -> str:
    candidates = [
        MOTION_PIPELINE,
        str(PROJECT_ROOT / "motion" / "pipelines" / "motion_pipeline.py"),
        str(Path.cwd() / "motion" / "pipelines" / "motion_pipeline.py"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    logger.error("motion_pipeline.py not found. Checked: %s", candidates)
    logger.error("PROJECT_ROOT=%s MOTION_ROOT=%s", PROJECT_ROOT, MOTION_ROOT)
    raise RuntimeError(f"motion_pipeline.py not found. Checked: {candidates}")


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
            music_thread = None
            if self._should_run_music(req):
                logger.info("request %s: starting parallel music thread", req.id)
                music_thread = threading.Thread(
                    target=self._run_music_for_request,
                    args=(req.id,),
                    daemon=True,
                )
                music_thread.start()

            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="motion: downloading video", progress=0.12, db=db)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            out_json = os.path.join(tmpdir, "motion_result.json")
            self._abort_if_deleted(db, req)
            set_job(req.id, "running", message="motion: preprocessing", progress=0.22, db=db)
            set_job(req.id, "running", message="motion: analyzing", progress=0.45, db=db)
            motion_pipeline = _resolve_motion_pipeline()
            cmd = [sys.executable, motion_pipeline, "--video", local_video, "--out", out_json]
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

            if music_thread:
                set_job(req.id, "running", message="motion done (waiting music)", progress=0.85, db=db)
                music_thread.join()
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
            music_thread = None
            if self._should_run_music(req):
                logger.info("request %s: starting parallel music thread", req.id)
                music_thread = threading.Thread(
                    target=self._run_music_for_request,
                    args=(req.id,),
                    daemon=True,
                )
                music_thread.start()

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

            if music_thread:
                set_job(req.id, "running", message="magic done (waiting music)", progress=0.85, db=db)
                music_thread.join()
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

    def _should_run_music(self, req: models.AnalysisRequest) -> bool:
        params = req.params_json or {}
        if params.get("skip_music"):
            logger.info("request %s: skip_music is set, skipping music analysis", req.id)
            return False
        should_run = bool(req.audio_id or params.get("extract_audio"))
        logger.info("request %s: _should_run_music=%s (audio_id=%s, extract_audio=%s)",
                    req.id, should_run, req.audio_id, params.get("extract_audio"))
        return should_run

    def _run_music_for_request(self, request_id: int) -> None:
        db = SessionLocal()
        try:
            req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
            if not req:
                logger.warning("parallel music: request %s not found", request_id)
                return
            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if res and res.music_json_s3_key:
                logger.info("parallel music: request %s already has music result", request_id)
                return

            logger.info("parallel music: starting for request %s, audio_id=%s, extract_audio=%s",
                        request_id, req.audio_id, (req.params_json or {}).get("extract_audio"))

            with tempfile.TemporaryDirectory() as tmpdir:
                local_audio = None

                if req.audio_id:
                    audio = db.query(models.MediaFile).filter(models.MediaFile.id == req.audio_id).first()
                    if not audio:
                        logger.warning("parallel music: audio_id %s not found", req.audio_id)
                        return
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
                    logger.info("parallel music: downloading audio %s", audio.s3_key)
                    with open(local_audio, "wb") as f:
                        download_fileobj(audio.s3_key, f)
                elif (req.params_json or {}).get("extract_audio") and req.video_id:
                    video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
                    if not video:
                        logger.warning("parallel music: video_id %s not found", req.video_id)
                        return
                    local_video = os.path.join(tmpdir, "input_video.mp4")
                    logger.info("parallel music: downloading video %s for extraction", video.s3_key)
                    with open(local_video, "wb") as f:
                        download_fileobj(video.s3_key, f)
                    local_audio = os.path.join(tmpdir, "extracted_audio.wav")
                    logger.info("parallel music: extracting audio with ffmpeg")
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
                        logger.error("parallel music: ffmpeg failed: %s", proc.stderr or proc.stdout)
                        return
                    logger.info("parallel music: audio extracted successfully")

                    # Save extracted audio to S3 and update audio_id
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
                    logger.info("parallel music: saved extracted audio as media_id=%s", media.id)
                else:
                    logger.warning("parallel music: no audio_id and extract_audio not set, skipping")
                    return

                stem_out_dir = os.path.join(tmpdir, "stems")
                out_json = os.path.join(tmpdir, "streams_sections_cnn.json")
                run_music_analysis(local_audio, stem_out_dir, out_json, model_name=DEMUCS_MODEL)

                result_key = f"results/{req.id}/streams_sections_cnn.json"
                upload_file(out_json, result_key, content_type="application/json")
                stem_keys = _upload_music_stems(req.id, local_audio, stem_out_dir)

                if not res:
                    res = models.AnalysisResult(request_id=req.id)
                    db.add(res)
                    try:
                        db.commit()
                    except IntegrityError:
                        db.rollback()
                        res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()

                if res:
                    res.music_json_s3_key = result_key
                    res.stem_drums_s3_key = stem_keys.get("drums")
                    res.stem_bass_s3_key = stem_keys.get("bass")
                    res.stem_vocals_s3_key = stem_keys.get("vocal")
                    res.stem_other_s3_key = stem_keys.get("other")
                    res.stem_drum_low_s3_key = stem_keys.get("drum_low")
                    res.stem_drum_mid_s3_key = stem_keys.get("drum_mid")
                    res.stem_drum_high_s3_key = stem_keys.get("drum_high")
                    db.commit()
                    logger.info("parallel music: completed successfully for request %s", request_id)
        except Exception:
            logger.exception("parallel music analysis failed for request %s", request_id)
        finally:
            db.close()


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
            stem_keys = _upload_music_stems(req.id, local_audio, stem_out_dir)

            res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
            if not res:
                res = models.AnalysisResult(request_id=req.id)
                db.add(res)
            res.music_json_s3_key = result_key
            res.stem_drums_s3_key = stem_keys.get("drums")
            res.stem_bass_s3_key = stem_keys.get("bass")
            res.stem_vocals_s3_key = stem_keys.get("vocal")
            res.stem_other_s3_key = stem_keys.get("other")
            res.stem_drum_low_s3_key = stem_keys.get("drum_low")
            res.stem_drum_mid_s3_key = stem_keys.get("drum_mid")
            res.stem_drum_high_s3_key = stem_keys.get("drum_high")
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


# ============================================================================
# PIXIE Analysis Worker - runs in background after motion analysis completes
# ============================================================================

PIXIE_ROOT = str(PROJECT_ROOT / MOTION_ROOT / "gpu" / "pixie" / "PIXIE")
PIXIE_DEMO = str(Path(PIXIE_ROOT) / "demos" / "demo_fit_body.py")
EXTRACT_KEYFRAMES = str(PROJECT_ROOT / MOTION_ROOT / "pipelines" / "extract_keyframes.py")
# PIXIE requires specific conda environment (pixie310) with its dependencies
PIXIE_PYTHON = os.environ.get("PIXIE_PYTHON", "/opt/anaconda3/envs/pixie310/bin/python")


def _extract_keyframes(video_path: str, motion_json_path: str, out_dir: str) -> dict[str, list[int]]:
    """Extract keyframes from video based on motion events."""
    import json
    import cv2

    with open(motion_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    events = data.get("events", [])

    hit_frames = [e["frame"] for e in events if e.get("type") == "hit" and "frame" in e]
    hold_frames = [e["start_frame"] for e in events if e.get("type") == "hold" and "start_frame" in e]

    def extract_frames(frames: list[int], subdir: str, prefix: str) -> int:
        out_path = os.path.join(out_dir, subdir)
        os.makedirs(out_path, exist_ok=True)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error("Cannot open video: %s", video_path)
            return 0
        count = 0
        for fidx in frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(fidx))
            ok, frame = cap.read()
            if not ok:
                continue
            fname = os.path.join(out_path, f"{prefix}_{int(fidx):06d}.png")
            cv2.imwrite(fname, frame)
            count += 1
        cap.release()
        return count

    hit_count = extract_frames(hit_frames, "hit", "hit")
    hold_count = extract_frames(hold_frames, "hold", "hold")

    logger.info("Extracted keyframes: hit=%d, hold=%d", hit_count, hold_count)
    return {"hit": hit_frames, "hold": hold_frames}


def _run_pixie_on_keyframes(keyframe_dir: str, output_dir: str, kind: str) -> int:
    """Run PIXIE on extracted keyframes. Returns number of OBJ files generated."""
    input_dir = os.path.join(keyframe_dir, kind)
    out_dir = os.path.join(output_dir, kind)

    if not os.path.isdir(input_dir) or not os.listdir(input_dir):
        logger.info("No keyframes for kind=%s, skipping PIXIE", kind)
        return 0

    os.makedirs(out_dir, exist_ok=True)

    # Run PIXIE with CPU (uses pixie310 conda environment)
    cmd = [
        PIXIE_PYTHON,
        PIXIE_DEMO,
        "-i", input_dir,
        "-s", out_dir,
        "--device", "cpu",
        "--iscrop", "True",
        "--saveObj", "True",
        "--saveVis", "False",
        "--saveParam", "True",
        "--savePred", "True",
        "--saveImages", "False",
        "--useTex", "False",
        "--lightTex", "False",
        "--extractTex", "False",
    ]

    logger.info("Running PIXIE: %s", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=PIXIE_ROOT)

    if proc.returncode != 0:
        logger.error("PIXIE failed for kind=%s: %s", kind, proc.stderr or proc.stdout)
        return 0

    # Count generated OBJ files (PIXIE creates subdirectories: out_dir/hit_000123/hit_000123.obj)
    obj_count = 0
    for subdir in os.listdir(out_dir):
        subdir_path = os.path.join(out_dir, subdir)
        if os.path.isdir(subdir_path):
            obj_file = os.path.join(subdir_path, f"{subdir}.obj")
            if os.path.isfile(obj_file):
                obj_count += 1
    logger.info("PIXIE generated %d OBJ files for kind=%s", obj_count, kind)
    return obj_count


def _upload_pixie_outputs(request_id: int, output_dir: str, kind: str) -> tuple[str, int]:
    """Upload PIXIE OBJ files to S3. Returns (s3_prefix, file_count)."""
    local_dir = os.path.join(output_dir, kind)
    if not os.path.isdir(local_dir):
        return "", 0

    s3_prefix = f"results/{request_id}/pixie/{kind}"
    count = 0

    # PIXIE creates subdirectories: local_dir/hit_000123/hit_000123.obj
    # We need to upload as: s3_prefix/hit_000123.obj
    for subdir in os.listdir(local_dir):
        subdir_path = os.path.join(local_dir, subdir)
        if not os.path.isdir(subdir_path):
            continue
        obj_file = os.path.join(subdir_path, f"{subdir}.obj")
        if not os.path.isfile(obj_file):
            continue
        # Upload with flattened name: hit_000123.obj
        s3_key = f"{s3_prefix}/{subdir}.obj"
        upload_file(obj_file, s3_key, content_type="application/octet-stream")
        count += 1

    logger.info("Uploaded %d OBJ files to %s", count, s3_prefix)
    return s3_prefix, count


class PixieAnalysisWorker(BaseAnalysisWorker):
    """Background worker that runs PIXIE on completed motion analysis requests."""

    def __init__(self, poll_interval: float = 10.0):
        super().__init__(poll_interval)

    def _fetch_request(self, db: Session) -> Optional[models.AnalysisRequest]:
        # Find "done" requests with motion results but no PIXIE outputs
        subq = db.query(models.PixieOutput.request_id).distinct()
        return (
            db.query(models.AnalysisRequest)
            .join(models.AnalysisResult, models.AnalysisResult.request_id == models.AnalysisRequest.id)
            .filter(models.AnalysisRequest.status == "done")
            .filter(models.AnalysisRequest.mode == "dance")
            .filter(models.AnalysisRequest.is_deleted == False)
            .filter(models.AnalysisResult.motion_json_s3_key.isnot(None))
            .filter(~models.AnalysisRequest.id.in_(subq))
            .order_by(models.AnalysisRequest.finished_at.asc())
            .with_for_update(skip_locked=True)
            .first()
        )

    def _tick(self) -> None:
        """Override to not change request status."""
        db: Session = SessionLocal()
        try:
            req = self._fetch_request(db)
            if not req:
                return
            if req.is_deleted:
                return

            logger.info("PIXIE worker processing request %s", req.id)
            self._handle_request(db, req)
            logger.info("PIXIE worker completed request %s", req.id)
        except Exception:
            logger.exception("PIXIE worker failed for request")
        finally:
            db.close()

    def _handle_request(self, db: Session, req: models.AnalysisRequest) -> None:
        # Check if PIXIE Python and demo exist
        if not os.path.isfile(PIXIE_PYTHON):
            logger.warning("PIXIE Python not found at %s, skipping", PIXIE_PYTHON)
            return
        if not os.path.isfile(PIXIE_DEMO):
            logger.warning("PIXIE demo not found at %s, skipping", PIXIE_DEMO)
            return

        res = db.query(models.AnalysisResult).filter(
            models.AnalysisResult.request_id == req.id
        ).first()
        if not res or not res.motion_json_s3_key:
            logger.warning("No motion result for request %s", req.id)
            return

        video = db.query(models.MediaFile).filter(
            models.MediaFile.id == req.video_id
        ).first()
        if not video:
            logger.warning("No video for request %s", req.id)
            return

        with tempfile.TemporaryDirectory() as tmpdir:
            # Download video
            logger.info("PIXIE: downloading video for request %s", req.id)
            local_video = os.path.join(tmpdir, "input.mp4")
            with open(local_video, "wb") as f:
                download_fileobj(video.s3_key, f)

            # Download motion_result.json
            logger.info("PIXIE: downloading motion result for request %s", req.id)
            local_motion = os.path.join(tmpdir, "motion_result.json")
            with open(local_motion, "wb") as f:
                download_fileobj(res.motion_json_s3_key, f)

            # Extract keyframes
            logger.info("PIXIE: extracting keyframes for request %s", req.id)
            keyframe_dir = os.path.join(tmpdir, "keyframes")
            frame_info = _extract_keyframes(local_video, local_motion, keyframe_dir)

            # Run PIXIE on each kind
            pixie_out = os.path.join(tmpdir, "pixie_mesh")
            for kind in ["hit", "hold"]:
                if not frame_info.get(kind):
                    continue

                logger.info("PIXIE: running inference for kind=%s, request %s", kind, req.id)
                obj_count = _run_pixie_on_keyframes(keyframe_dir, pixie_out, kind)

                if obj_count > 0:
                    # Upload to S3
                    logger.info("PIXIE: uploading results for kind=%s, request %s", kind, req.id)
                    s3_prefix, file_count = _upload_pixie_outputs(req.id, pixie_out, kind)

                    # Create PixieOutput record
                    if s3_prefix and file_count > 0:
                        pixie_record = models.PixieOutput(
                            request_id=req.id,
                            kind=kind,
                            s3_prefix=s3_prefix,
                            file_count=file_count,
                        )
                        db.add(pixie_record)
                        db.commit()
                        logger.info("PIXIE: created PixieOutput record for kind=%s, request %s", kind, req.id)
