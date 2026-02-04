from __future__ import annotations

import uuid
from typing import Optional, Dict, Any

from sqlalchemy.orm import Session
from fastapi import HTTPException, UploadFile

from ..db import models
from ..schemas import MediaPresignRequest, MediaCommitRequest
from .s3 import upload_fileobj, presign_get_url, presign_put_url, S3_BUCKET


def upload_media(db: Session, user_id: int, file: UploadFile) -> models.MediaFile:
    if not file.filename:
        raise HTTPException(status_code=400, detail="empty filename")

    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    media_type = "audio" if (file.content_type or "").startswith("audio/") else "video"
    key = f"uploads/{user_id}/{uuid.uuid4().hex}.{ext}"

    file.file.seek(0)
    upload_fileobj(file.file, key, content_type=file.content_type)

    media = models.MediaFile(
        user_id=user_id,
        type=media_type,
        s3_bucket=S3_BUCKET,
        s3_key=key,
        content_type=file.content_type,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return media


def presign_media(db: Session, user_id: int, payload: MediaPresignRequest) -> Dict[str, Any]:
    ext = payload.filename.split(".")[-1] if "." in payload.filename else "bin"
    key = f"uploads/{user_id}/{uuid.uuid4().hex}.{ext}"
    url = presign_put_url(key, content_type=payload.content_type)
    return {"upload_url": url, "s3_key": key}


def commit_media(db: Session, user_id: int, payload: MediaCommitRequest) -> models.MediaFile:
    media = models.MediaFile(
        user_id=user_id,
        type=payload.type,
        s3_bucket=S3_BUCKET,
        s3_key=payload.s3_key,
        content_type=payload.content_type,
        duration_sec=payload.duration_sec,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return media


def media_download(db: Session, media_id: int) -> str:
    media = db.query(models.MediaFile).filter(models.MediaFile.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="not found")
    return presign_get_url(media.s3_key)

