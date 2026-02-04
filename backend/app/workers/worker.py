from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
from typing import Optional
from pathlib import Path
import sys

from sqlalchemy.orm import Session

from ..db.base import SessionLocal
from ..db import models
from ..services.s3 import download_fileobj, upload_file
from ..core.config import PROJECT_ROOT, MUSIC_ANALYZER_ROOT, DEMUCS_MODEL
from .jobs import set_job

MOTION_ROOT = os.environ.get("MOTION_ROOT", str(PROJECT_ROOT / "motion"))
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

            if req.audio_id:
                self._run_music(db, req, tmpdir, progress_base=0.6)
            else:
                self._run_music_from_video(local_video, req, tmpdir, progress_base=0.6)

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

            if req.audio_id:
                self._run_music(db, req, tmpdir, progress_base=0.6)
            else:
                self._run_music_from_video(local_video, req, tmpdir, progress_base=0.6)

    def _run_music(self, db: Session, req: models.AnalysisRequest, tmpdir: str, progress_base: float = 0.6) -> None:
        audio = db.query(models.MediaFile).filter(models.MediaFile.id == req.audio_id).first()
        if not audio:
            return

        if MUSIC_ANALYZER_ROOT and MUSIC_ANALYZER_ROOT not in sys.path:
            sys.path.insert(0, MUSIC_ANALYZER_ROOT)

        try:
            from audio_engine.engine.stems import separate as demucs_separate
            from audio_engine.engine.onset.pipeline import filter_y_into_bands
            from audio_engine.engine.onset.constants import BAND_HZ
            from audio_engine.engine.onset import (
                compute_cnn_band_onsets_with_odf,
                select_key_onsets_by_band,
                merge_texture_blocks_by_band,
                write_streams_sections_json,
            )
            from audio_engine.engine.bass import run_bass_pipeline
            import librosa
            import soundfile as sf
        except Exception as exc:
            raise RuntimeError(f"music analyzer import failed: {exc}") from exc

        set_job(req.id, "running", message="downloading audio", progress=progress_base + 0.05)
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

        self._run_music_from_path(local_audio, req, tmpdir, progress_base)

    def _run_music_from_video(self, video_path: str, req: models.AnalysisRequest, tmpdir: str, progress_base: float = 0.6) -> None:
        local_audio = os.path.join(tmpdir, "extracted_audio.wav")
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            video_path,
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
            set_job(req.id, "running", log=log)
            return
        self._run_music_from_path(local_audio, req, tmpdir, progress_base)

    def _run_music_from_path(self, local_audio: str, req: models.AnalysisRequest, tmpdir: str, progress_base: float) -> None:
        audio_path = Path(local_audio)
        stem_out_dir = Path(tmpdir) / "stems"

        set_job(req.id, "running", message="separating stems", progress=progress_base + 0.15)
        demucs_separate(str(audio_path), out_dir=str(stem_out_dir), model_name=DEMUCS_MODEL)

        track_name = audio_path.stem
        stem_dir = stem_out_dir / DEMUCS_MODEL / track_name
        drums_path = stem_dir / "drums.wav"
        if drums_path.exists():
            y, sr = librosa.load(str(drums_path), sr=None, mono=True)
            y_low, y_mid, y_high = filter_y_into_bands(y, sr, BAND_HZ)
            sf.write(str(stem_dir / "drum_low.wav"), y_low, sr)
            sf.write(str(stem_dir / "drum_mid.wav"), y_mid, sr)
            sf.write(str(stem_dir / "drum_high.wav"), y_high, sr)

        set_job(req.id, "running", message="analyzing music", progress=progress_base + 0.35)
        band_onsets, band_strengths, duration, sr = compute_cnn_band_onsets_with_odf(
            track_name,
            stem_out_dir / DEMUCS_MODEL,
        )
        band_audio_paths = {
            "low": stem_dir / "drum_low.wav",
            "mid": stem_dir / "drum_mid.wav",
            "high": stem_dir / "drum_high.wav",
        }
        keypoints_by_band = select_key_onsets_by_band(
            band_onsets,
            band_strengths,
            duration,
            sr,
            band_audio_paths=band_audio_paths,
        )
        texture_blocks_by_band = merge_texture_blocks_by_band(band_onsets, band_strengths)

        bass_dict = None
        bass_path = stem_dir / "bass.wav"
        if bass_path.exists():
            try:
                bass_dict = run_bass_pipeline(str(bass_path), sr=sr)
            except Exception:
                bass_dict = None

        out_json = os.path.join(tmpdir, "streams_sections_cnn.json")
        write_streams_sections_json(
            out_json,
            source=track_name,
            sr=sr,
            duration_sec=duration,
            streams=[],
            sections=[],
            keypoints=[],
            events=None,
            keypoints_by_band=keypoints_by_band,
            texture_blocks_by_band=texture_blocks_by_band,
            bass=bass_dict,
        )

        set_job(req.id, "running", message="uploading music results", progress=progress_base + 0.6)
        result_key = f"results/{req.id}/streams_sections_cnn.json"
        upload_file(out_json, result_key, content_type="application/json")

        res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
        if not res:
            res = models.AnalysisResult(request_id=req.id)
            db.add(res)
        res.music_json_s3_key = result_key
        db.commit()
