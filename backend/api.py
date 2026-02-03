from __future__ import annotations

import io
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session, aliased

from .deps import get_db
from . import models
from .schemas import (
    MediaCreateResponse,
    MediaPresignRequest,
    MediaCommitRequest,
    AnalysisRequestCreate,
    AnalysisRequestResponse,
    AnalysisStatusResponse,
    AnalysisResultUpsert,
    AnalysisStatusUpdate,
    LibraryItem,
    LibraryResponse,
)
from .s3 import upload_fileobj, presign_get_url, presign_put_url, S3_BUCKET
from .jobs import set_job, get_job

router = APIRouter(prefix="/api", tags=["api"])


def require_user(request: Request, db: Session) -> models.User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/media", response_model=MediaCreateResponse)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = require_user(request, db)
    if not file.filename:
        raise HTTPException(status_code=400, detail="empty filename")

    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    media_type = "audio" if (file.content_type or "").startswith("audio/") else "video"
    key = f"uploads/{user.id}/{uuid.uuid4().hex}.{ext}"

    content = await file.read()
    upload_fileobj(io.BytesIO(content), key, content_type=file.content_type)

    media = models.MediaFile(
        user_id=user.id,
        type=media_type,
        s3_bucket=S3_BUCKET,
        s3_key=key,
        content_type=file.content_type,
    )
    db.add(media)
    db.commit()
    db.refresh(media)

    return MediaCreateResponse(
        id=media.id,
        s3_key=media.s3_key,
        type=media.type,
        content_type=media.content_type,
        duration_sec=None,
    )


@router.post("/media/presign")
def presign_media(request: Request, payload: MediaPresignRequest, db: Session = Depends(get_db)):
    user = require_user(request, db)
    ext = payload.filename.split(".")[-1] if "." in payload.filename else "bin"
    key = f"uploads/{user.id}/{uuid.uuid4().hex}.{ext}"
    url = presign_put_url(key, content_type=payload.content_type)
    return {"upload_url": url, "s3_key": key}


@router.post("/media/commit", response_model=MediaCreateResponse)
def commit_media(request: Request, payload: MediaCommitRequest, db: Session = Depends(get_db)):
    user = require_user(request, db)
    media = models.MediaFile(
        user_id=user.id,
        type=payload.type,
        s3_bucket=S3_BUCKET,
        s3_key=payload.s3_key,
        content_type=payload.content_type,
        duration_sec=payload.duration_sec,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return MediaCreateResponse(
        id=media.id,
        s3_key=media.s3_key,
        type=media.type,
        content_type=media.content_type,
        duration_sec=media.duration_sec,
    )


@router.post("/analysis", response_model=AnalysisRequestResponse)
def create_analysis(
    request: Request,
    payload: AnalysisRequestCreate,
    db: Session = Depends(get_db),
):
    user = require_user(request, db)
    req = models.AnalysisRequest(
        user_id=user.id,
        video_id=payload.video_id,
        audio_id=payload.audio_id,
        mode=payload.mode,
        params_json=payload.params_json,
        status="queued",
        title=payload.title,
        notes=payload.notes,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    set_job(req.id, "queued")
    return AnalysisRequestResponse(
        id=req.id,
        mode=req.mode,
        status=req.status,
        title=req.title,
        created_at=req.created_at,
    )


@router.get("/analysis/{request_id}/status", response_model=AnalysisStatusResponse)
def analysis_status(request_id: int, db: Session = Depends(get_db)):
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    job = get_job(request_id) or {}
    return AnalysisStatusResponse(
        id=req.id,
        status=job.get("status", req.status),
        error_message=job.get("error") or req.error_message,
        message=job.get("message"),
        progress=job.get("progress"),
        log=job.get("log"),
    )


@router.post("/analysis/{request_id}/status")
def update_status(
    request_id: int,
    payload: AnalysisStatusUpdate,
    db: Session = Depends(get_db),
):
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    req.status = payload.status
    req.error_message = payload.error_message
    db.commit()
    set_job(
        request_id,
        payload.status,
        payload.error_message,
        message=payload.message,
        progress=payload.progress,
        log=payload.log,
    )
    return {"ok": True}


@router.post("/analysis/{request_id}/result")
def upsert_result(
    request_id: int,
    payload: AnalysisResultUpsert,
    db: Session = Depends(get_db),
):
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
    return {"ok": True}


@router.get("/library", response_model=LibraryResponse)
def library(
    request: Request,
    query: Optional[str] = None,
    status: Optional[str] = None,
    mode: Optional[str] = None,
    archived: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    user = require_user(request, db)

    video = aliased(models.MediaFile)
    audio = aliased(models.MediaFile)

    q = (
        db.query(
            models.AnalysisRequest,
            video,
            models.AnalysisResult,
            models.AnalysisEdit,
            audio,
        )
        .join(video, video.id == models.AnalysisRequest.video_id)
        .outerjoin(models.AnalysisResult, models.AnalysisResult.request_id == models.AnalysisRequest.id)
        .outerjoin(models.AnalysisEdit, models.AnalysisEdit.request_id == models.AnalysisRequest.id)
        .outerjoin(audio, audio.id == models.AnalysisRequest.audio_id)
        .filter(models.AnalysisRequest.user_id == user.id)
        .filter(models.AnalysisRequest.is_deleted == False)
        .order_by(models.AnalysisRequest.created_at.desc())
    )

    if status:
        q = q.filter(models.AnalysisRequest.status == status)
    if mode:
        q = q.filter(models.AnalysisRequest.mode == mode)
    if archived is not None:
        q = q.filter(models.AnalysisRequest.is_archived == archived)
    if query:
        q = q.filter(models.AnalysisRequest.title.ilike(f"%{query}%"))

    q = q.limit(limit).offset(offset)

    items = []
    for req, video_row, res, edit, audio_row in q.all():
        items.append(LibraryItem(
            id=req.id,
            title=req.title,
            mode=req.mode,
            status=req.status,
            created_at=req.created_at,
            finished_at=req.finished_at,
            video_s3_key=video_row.s3_key,
            video_duration_sec=video_row.duration_sec,
            audio_s3_key=audio_row.s3_key if audio_row else None,
            motion_json_s3_key=res.motion_json_s3_key if res else None,
            music_json_s3_key=res.music_json_s3_key if res else None,
            magic_json_s3_key=res.magic_json_s3_key if res else None,
            edited_motion_markers_s3_key=edit.motion_markers_s3_key if edit else None,
        ))

    return items


@router.get("/media/{media_id}/download")
def media_download(media_id: int, db: Session = Depends(get_db)):
    media = db.query(models.MediaFile).filter(models.MediaFile.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="not found")
    return {"url": presign_get_url(media.s3_key)}
