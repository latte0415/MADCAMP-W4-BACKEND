from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, aliased

from ..core.deps import get_db, get_current_user
from ..core.config import MONITORING_PUBLIC
from ..db import models
from ..schemas import (
    MediaCreateResponse,
    MediaPresignRequest,
    MediaCommitRequest,
    AnalysisRequestCreate,
    AnalysisRequestResponse,
    AnalysisStatusResponse,
    AnalysisResultUpsert,
    AnalysisStatusUpdate,
    AnalysisAudioUpdate,
    AnalysisMusicOnlyRequest,
    LibraryItem,
    LibraryResponse,
    MusicResultResponse,
    MonitoringResponse,
)
from ..services import analysis as analysis_service
from ..services import media as media_service
from ..services import presenters

router = APIRouter(prefix="/api", tags=["api"])


@router.post("/media", response_model=MediaCreateResponse)
async def upload_media(
    file: UploadFile = File(...),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    media = media_service.upload_media(db, user.id, file)

    return MediaCreateResponse(
        id=media.id,
        s3_key=media.s3_key,
        type=media.type,
        content_type=media.content_type,
        duration_sec=None,
    )


@router.post("/media/presign")
def presign_media(
    payload: MediaPresignRequest,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return media_service.presign_media(db, user.id, payload)


@router.post("/media/commit", response_model=MediaCreateResponse)
def commit_media(
    payload: MediaCommitRequest,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    media = media_service.commit_media(db, user.id, payload)
    return MediaCreateResponse(
        id=media.id,
        s3_key=media.s3_key,
        type=media.type,
        content_type=media.content_type,
        duration_sec=media.duration_sec,
    )


@router.post("/analysis", response_model=AnalysisRequestResponse)
def create_analysis(
    payload: AnalysisRequestCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    req = analysis_service.create_analysis_request(db, user.id, payload)
    return AnalysisRequestResponse(
        id=req.id,
        mode=req.mode,
        status=req.status,
        title=req.title,
        created_at=req.created_at,
    )


@router.get("/analysis/{request_id}/status", response_model=AnalysisStatusResponse)
def analysis_status(request_id: int, db: Session = Depends(get_db)):
    data = analysis_service.get_analysis_status(db, request_id)
    return AnalysisStatusResponse(**data)


@router.post("/analysis/{request_id}/status")
def update_status(
    request_id: int,
    payload: AnalysisStatusUpdate,
    db: Session = Depends(get_db),
):
    analysis_service.update_analysis_status(
        db,
        request_id,
        payload.status,
        error_message=payload.error_message,
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
    analysis_service.upsert_analysis_result(db, request_id, payload)
    return {"ok": True}


@router.get("/library", response_model=LibraryResponse)
def library(
    query: Optional[str] = None,
    status: Optional[str] = None,
    mode: Optional[str] = None,
    archived: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
        items.append(presenters.build_library_item(req, video_row, res, edit, audio_row))

    return items


@router.get("/monitoring", response_model=MonitoringResponse)
def monitoring(
    limit: int = 25,
    db: Session = Depends(get_db),
):
    if not MONITORING_PUBLIC:
        raise HTTPException(status_code=401, detail="monitoring disabled")

    video = aliased(models.MediaFile)
    audio = aliased(models.MediaFile)

    def _fetch(status_value: str):
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
            .filter(models.AnalysisRequest.status == status_value)
            .filter(models.AnalysisRequest.is_deleted == False)
            .order_by(models.AnalysisRequest.created_at.desc())
            .limit(limit)
        )
        return [presenters.build_library_item(req, video_row, res, edit, audio_row) for req, video_row, res, edit, audio_row in q.all()]

    return MonitoringResponse(
        queued=_fetch("queued"),
        queued_music=_fetch("queued_music"),
        running=_fetch("running"),
    )


@router.get("/media/{media_id}/download")
def media_download(media_id: int, db: Session = Depends(get_db)):
    return {"url": media_service.media_download(db, media_id)}


@router.get("/analysis/{request_id}/music", response_model=MusicResultResponse)
def get_analysis_music(
    request_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """분석 요청의 음악 분석 결과(streams_sections_cnn.json) 다운로드 URL을 반환합니다."""
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == request_id).first()
    if not res or not res.music_json_s3_key:
        raise HTTPException(status_code=404, detail="music result not ready")
    return MusicResultResponse(url=presign_get_url(res.music_json_s3_key))


@router.patch("/analysis/{request_id}/audio")
def update_analysis_audio(
    request_id: int,
    payload: AnalysisAudioUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """분석 요청에 연결된 오디오(음악)를 교체합니다."""
    audio_id = analysis_service.update_analysis_audio(db, user.id, request_id, payload)
    return {"ok": True, "audio_id": audio_id}


@router.post("/analysis/{request_id}/rerun-music")
def rerun_music_analysis(
    request_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """해당 분석 요청의 오디오로 음악 분석만 다시 실행합니다. 오디오가 연결되어 있어야 합니다."""
    analysis_service.queue_music_rerun(db, user.id, request_id)
    return {"ok": True, "queued": True}


@router.post("/analysis/{request_id}/music-only")
def run_music_only(
    request_id: int,
    payload: AnalysisMusicOnlyRequest,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """오디오만 사용해 음악 분석을 실행합니다. audio_id를 주면 교체 후 실행합니다."""
    analysis_service.queue_music_only(db, user.id, request_id, audio_id=payload.audio_id)
    return {"ok": True, "queued": True}


@router.get("/project/{request_id}")
def project_detail(request_id: int, db: Session = Depends(get_db)):
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first()
    audio = db.query(models.MediaFile).filter(models.MediaFile.id == req.audio_id).first() if req.audio_id else None
    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == req.id).first()
    edit = db.query(models.AnalysisEdit).filter(models.AnalysisEdit.request_id == req.id).first()
    return presenters.build_project_detail(req, video, audio, res, edit)
