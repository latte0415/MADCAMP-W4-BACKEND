from __future__ import annotations

from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from fastapi import HTTPException

from ..db import models
from ..schemas import (
    AnalysisRequestCreate,
    AnalysisResultUpsert,
    AnalysisAudioUpdate,
)
from ..workers.jobs import set_job, get_job
from ..core.config import STALE_RUNNING_MINUTES
from ..services.s3 import delete_key, delete_keys


def _get_media_or_404(db: Session, media_id: int, expected_type: Optional[str] = None) -> models.MediaFile:
    media = db.query(models.MediaFile).filter(models.MediaFile.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="media not found")
    if expected_type and media.type != expected_type:
        raise HTTPException(status_code=400, detail=f"media must be {expected_type} type")
    return media


def _require_owned_media(
    db: Session,
    user_id: int,
    media_id: int,
    expected_type: Optional[str] = None,
    not_found_detail: str = "media not found",
    forbidden_detail: str = "media must belong to you",
) -> models.MediaFile:
    media = db.query(models.MediaFile).filter(models.MediaFile.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail=not_found_detail)
    if media.user_id != user_id:
        raise HTTPException(status_code=403, detail=forbidden_detail)
    if expected_type and media.type != expected_type:
        raise HTTPException(status_code=400, detail=f"media must be {expected_type} type")
    return media


def create_analysis_request(db: Session, user_id: int, payload: AnalysisRequestCreate) -> models.AnalysisRequest:
    if not payload.video_id and not payload.audio_id:
        raise HTTPException(status_code=400, detail="video or audio is required")

    if payload.video_id is not None:
        _require_owned_media(
            db,
            user_id,
            payload.video_id,
            expected_type="video",
            not_found_detail="video media not found",
            forbidden_detail="video must belong to you",
        )

    if payload.audio_id is not None:
        _require_owned_media(
            db,
            user_id,
            payload.audio_id,
            expected_type="audio",
            not_found_detail="audio media not found",
            forbidden_detail="audio must belong to you",
        )

    params = dict(payload.params_json or {})
    status = "queued"
    extract_audio = bool(params.get("extract_audio"))
    if payload.video_id is None:
        params["music_only"] = True
        status = "queued_music"
    elif payload.audio_id is None and not extract_audio:
        params["skip_music"] = True

    req = models.AnalysisRequest(
        user_id=user_id,
        video_id=payload.video_id,
        audio_id=payload.audio_id,
        mode=payload.mode,
        params_json=params or None,
        status=status,
        title=payload.title,
        notes=payload.notes,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    set_job(req.id, "queued", db=db)
    return req


def get_analysis_status(db: Session, request_id: int) -> Dict[str, Any]:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.is_deleted:
        raise HTTPException(status_code=404, detail="not found")
    job = get_job(request_id, db=db) or {}

    def _mark_stale_running() -> None:
        if STALE_RUNNING_MINUTES <= 0:
            return
        job_status = job.get("status") or req.status
        if job_status != "running":
            return
        updated_at = job.get("updated_at") or req.started_at
        if updated_at is None:
            return
        if updated_at.tzinfo is not None:
            updated_at_local = updated_at.replace(tzinfo=None)
        else:
            updated_at_local = updated_at
        cutoff = datetime.utcnow() - timedelta(minutes=STALE_RUNNING_MINUTES)
        if updated_at_local >= cutoff:
            return
        error_message = "analysis stalled; please retry"
        req.status = "failed"
        req.error_message = error_message
        req.finished_at = datetime.utcnow()
        db.commit()
        set_job(
            req.id,
            "failed",
            error_message,
            message="stalled",
            progress=1.0,
            db=db,
        )
        job["status"] = "failed"
        job["error"] = error_message
        job["message"] = "stalled"
        job["progress"] = 1.0

    _mark_stale_running()
    return {
        "id": req.id,
        "status": job.get("status", req.status),
        "error_message": job.get("error") or req.error_message,
        "message": job.get("message"),
        "progress": job.get("progress"),
        "log": job.get("log"),
    }


def update_analysis_status(
    db: Session,
    request_id: int,
    status: str,
    error_message: Optional[str] = None,
    message: Optional[str] = None,
    progress: Optional[float] = None,
    log: Optional[str] = None,
) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    req.status = status
    req.error_message = error_message
    db.commit()
    set_job(
        request_id,
        status,
        error_message,
        message=message,
        progress=progress,
        log=log,
        db=db,
    )


def upsert_analysis_result(db: Session, request_id: int, payload: AnalysisResultUpsert) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")

    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == request_id).first()
    if not res:
        res = models.AnalysisResult(request_id=request_id)
        db.add(res)

    res.motion_json_s3_key = payload.motion_json_s3_key
    res.music_json_s3_key = payload.music_json_s3_key
    res.magic_json_s3_key = payload.magic_json_s3_key
    res.overlay_video_s3_key = payload.overlay_video_s3_key
    if payload.stem_drums_s3_key is not None:
        res.stem_drums_s3_key = payload.stem_drums_s3_key
    if payload.stem_bass_s3_key is not None:
        res.stem_bass_s3_key = payload.stem_bass_s3_key
    if payload.stem_vocals_s3_key is not None:
        res.stem_vocals_s3_key = payload.stem_vocals_s3_key
    if payload.stem_other_s3_key is not None:
        res.stem_other_s3_key = payload.stem_other_s3_key
    if payload.stem_drum_low_s3_key is not None:
        res.stem_drum_low_s3_key = payload.stem_drum_low_s3_key
    if payload.stem_drum_mid_s3_key is not None:
        res.stem_drum_mid_s3_key = payload.stem_drum_mid_s3_key
    if payload.stem_drum_high_s3_key is not None:
        res.stem_drum_high_s3_key = payload.stem_drum_high_s3_key
    if payload.match_score is not None:
        res.match_score = payload.match_score
    if payload.match_details is not None:
        res.match_details = payload.match_details
    req.status = "done"
    db.commit()


def _delete_result_keys(res: Optional[models.AnalysisResult], keys: list[str]) -> None:
    if not res:
        return
    to_delete = [key for key in keys if key]
    if not to_delete:
        return
    try:
        delete_keys(to_delete)
    except Exception:
        pass


def _delete_keys(keys: list[str]) -> None:
    to_delete = [key for key in keys if key]
    if not to_delete:
        return
    try:
        delete_keys(to_delete)
    except Exception:
        pass


def update_analysis_audio(
    db: Session,
    user_id: int,
    request_id: int,
    payload: AnalysisAudioUpdate,
) -> int:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")

    _require_owned_media(
        db,
        user_id,
        payload.audio_id,
        expected_type="audio",
        not_found_detail="audio media not found",
        forbidden_detail="audio must belong to you",
    )
    req.audio_id = payload.audio_id
    if req.params_json and req.params_json.get("skip_music"):
        params = dict(req.params_json)
        params.pop("skip_music", None)
        req.params_json = params or None
    db.commit()
    return payload.audio_id


def update_analysis_video(
    db: Session,
    user_id: int,
    request_id: int,
    video_id: int,
) -> int:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")

    _require_owned_media(
        db,
        user_id,
        video_id,
        expected_type="video",
        not_found_detail="video media not found",
        forbidden_detail="video must belong to you",
    )
    req.video_id = video_id
    if not req.audio_id:
        params = dict(req.params_json or {})
        if not params.get("extract_audio"):
            params["skip_music"] = True
        params.pop("music_only", None)
        req.params_json = params
    db.commit()
    return video_id


def delete_analysis_request(
    db: Session,
    user_id: int,
    request_id: int,
) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")
    if req.is_deleted:
        return

    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
    edit = db.query(models.AnalysisEdit).filter(models.AnalysisEdit.request_id == req.id).first()
    keys = []
    if res:
        keys.extend(
            [
                res.motion_json_s3_key,
                res.music_json_s3_key,
                res.magic_json_s3_key,
                res.overlay_video_s3_key,
                res.stem_drums_s3_key,
                res.stem_bass_s3_key,
                res.stem_vocals_s3_key,
                res.stem_other_s3_key,
                res.stem_drum_low_s3_key,
                res.stem_drum_mid_s3_key,
                res.stem_drum_high_s3_key,
            ]
        )
    if edit:
        keys.extend([edit.motion_markers_s3_key, edit.edited_overlay_s3_key])
    _delete_keys(keys)

    if res:
        db.delete(res)
    if edit:
        db.delete(edit)
    db.query(models.AnalysisJob).filter(models.AnalysisJob.request_id == req.id).delete()

    req.is_deleted = True
    req.status = "failed"
    req.error_message = "deleted"
    req.finished_at = datetime.utcnow()
    db.commit()


def remove_analysis_audio(
    db: Session,
    user_id: int,
    request_id: int,
) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")
    req.audio_id = None
    params = dict(req.params_json or {})
    params.pop("music_only", None)
    if req.video_id and params.get("extract_audio"):
        params.pop("skip_music", None)
    else:
        params["skip_music"] = True
    req.params_json = params

    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
    if res:
        _delete_result_keys(
            res,
            [
                res.music_json_s3_key,
                res.stem_drums_s3_key,
                res.stem_bass_s3_key,
                res.stem_vocals_s3_key,
                res.stem_other_s3_key,
                res.stem_drum_low_s3_key,
                res.stem_drum_mid_s3_key,
                res.stem_drum_high_s3_key,
            ],
        )
        res.music_json_s3_key = None
        res.stem_drums_s3_key = None
        res.stem_bass_s3_key = None
        res.stem_vocals_s3_key = None
        res.stem_other_s3_key = None
        res.stem_drum_low_s3_key = None
        res.stem_drum_mid_s3_key = None
        res.stem_drum_high_s3_key = None
        res.match_score = None
        res.match_details = None
    db.commit()


def remove_analysis_video(
    db: Session,
    user_id: int,
    request_id: int,
) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")
    req.video_id = None
    params = dict(req.params_json or {})
    params["music_only"] = True if req.audio_id else False
    params.pop("skip_music", None)
    req.params_json = params or None

    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
    if res:
        _delete_result_keys(res, [res.motion_json_s3_key, res.magic_json_s3_key, res.overlay_video_s3_key])
        res.motion_json_s3_key = None
        res.magic_json_s3_key = None
        res.overlay_video_s3_key = None
        res.match_score = None
        res.match_details = None
    db.query(models.AnalysisEdit).filter(models.AnalysisEdit.request_id == req.id).delete()
    db.commit()


def set_extract_audio(
    db: Session,
    user_id: int,
    request_id: int,
    enabled: bool,
) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")

    params = dict(req.params_json or {})
    if enabled:
        params["extract_audio"] = True
        params.pop("skip_music", None)
    else:
        params.pop("extract_audio", None)
        if not req.audio_id:
            params["skip_music"] = True
    req.params_json = params or None
    db.commit()


def queue_motion_rerun(db: Session, user_id: int, request_id: int) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")
    if not req.video_id:
        raise HTTPException(status_code=400, detail="no video attached")

    _get_media_or_404(db, req.video_id, expected_type="video")

    params = dict(req.params_json or {})
    params.pop("music_only", None)
    if req.audio_id:
        params.pop("skip_music", None)
    else:
        params["skip_music"] = True
    req.params_json = params or None
    req.status = "queued"
    req.error_message = None
    req.finished_at = None
    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
    if res:
        _delete_result_keys(res, [res.motion_json_s3_key, res.magic_json_s3_key, res.overlay_video_s3_key])
        res.motion_json_s3_key = None
        res.magic_json_s3_key = None
        res.overlay_video_s3_key = None
        res.match_score = None
        res.match_details = None
    db.query(models.AnalysisEdit).filter(models.AnalysisEdit.request_id == req.id).delete()
    db.commit()
    set_job(req.id, "queued", message="motion rerun queued", progress=0.0, db=db)


def queue_music_rerun(db: Session, user_id: int, request_id: int) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")
    if req.audio_id:
        _get_media_or_404(db, req.audio_id, expected_type="audio")
    elif req.video_id:
        _get_media_or_404(db, req.video_id, expected_type="video")
    else:
        raise HTTPException(status_code=400, detail="no audio or video attached")
    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
    if res:
        _delete_result_keys(res, [res.music_json_s3_key])
        res.music_json_s3_key = None
        res.match_score = None
        res.match_details = None
    db.commit()
    queue_music_only(db, user_id, request_id, audio_id=None)


def queue_music_only(
    db: Session,
    user_id: int,
    request_id: int,
    audio_id: Optional[int] = None,
) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")

    if audio_id is not None:
        _require_owned_media(
            db,
            user_id,
            audio_id,
            expected_type="audio",
            not_found_detail="audio media not found",
            forbidden_detail="audio must belong to you",
        )
        req.audio_id = audio_id

    if req.audio_id:
        _get_media_or_404(db, req.audio_id, expected_type="audio")
    elif req.video_id:
        _get_media_or_404(db, req.video_id, expected_type="video")
    else:
        raise HTTPException(status_code=400, detail="no audio or video attached")

    params = dict(req.params_json or {})
    params.pop("skip_music", None)
    params["music_only"] = True
    req.params_json = params
    req.status = "queued_music"
    req.error_message = None
    db.commit()
    set_job(req.id, "queued", message="music only queued", progress=0.0, db=db)
