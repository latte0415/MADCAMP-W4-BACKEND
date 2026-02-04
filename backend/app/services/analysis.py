from __future__ import annotations

from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from fastapi import HTTPException

from ..db import models
from ..schemas import (
    AnalysisRequestCreate,
    AnalysisResultUpsert,
    AnalysisAudioUpdate,
)
from ..workers.jobs import set_job, get_job


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
    if payload.audio_id is None:
        params["skip_music"] = True

    req = models.AnalysisRequest(
        user_id=user_id,
        video_id=payload.video_id,
        audio_id=payload.audio_id,
        mode=payload.mode,
        params_json=params or None,
        status="queued",
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
    job = get_job(request_id, db=db) or {}
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
    req.status = "done"
    db.commit()


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


def queue_music_rerun(db: Session, user_id: int, request_id: int) -> None:
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user_id:
        raise HTTPException(status_code=404, detail="not found")
    if not req.audio_id:
        raise HTTPException(status_code=400, detail="no audio attached")

    _get_media_or_404(db, req.audio_id, expected_type="audio")
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

    if not req.audio_id:
        raise HTTPException(status_code=400, detail="no audio attached")

    _get_media_or_404(db, req.audio_id, expected_type="audio")

    params = dict(req.params_json or {})
    params.pop("skip_music", None)
    params["music_only"] = True
    req.params_json = params
    req.status = "queued_music"
    req.error_message = None
    db.commit()
    set_job(req.id, "queued", message="music only queued", progress=0.0, db=db)
