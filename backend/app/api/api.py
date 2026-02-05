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
    AnalysisVideoUpdate,
    AnalysisExtractAudioUpdate,
    AnalysisMusicOnlyRequest,
    LibraryItem,
    LibraryResponse,
    MusicResultResponse,
    MonitoringResponse,
)
from ..services import analysis as analysis_service
from ..services import media as media_service
from ..services import presenters
from ..services.s3 import delete_keys, presign_get_url

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
        .outerjoin(video, video.id == models.AnalysisRequest.video_id)
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
            .outerjoin(video, video.id == models.AnalysisRequest.video_id)
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


@router.patch("/analysis/{request_id}/video")
def update_analysis_video(
    request_id: int,
    payload: AnalysisVideoUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """분석 요청에 연결된 비디오(영상)를 교체합니다."""
    video_id = analysis_service.update_analysis_video(db, user.id, request_id, payload.video_id)
    return {"ok": True, "video_id": video_id}


@router.delete("/analysis/{request_id}/audio")
def remove_analysis_audio(
    request_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """분석 요청에서 오디오를 제거합니다."""
    analysis_service.remove_analysis_audio(db, user.id, request_id)
    return {"ok": True}


@router.delete("/analysis/{request_id}/video")
def remove_analysis_video(
    request_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """분석 요청에서 비디오를 제거합니다."""
    analysis_service.remove_analysis_video(db, user.id, request_id)
    return {"ok": True}


@router.patch("/analysis/{request_id}/extract-audio")
def update_extract_audio(
    request_id: int,
    payload: AnalysisExtractAudioUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """영상에서 오디오 추출 사용 여부를 설정합니다."""
    analysis_service.set_extract_audio(db, user.id, request_id, payload.enabled)
    return {"ok": True, "enabled": payload.enabled}


@router.post("/analysis/{request_id}/rerun-music")
def rerun_music_analysis(
    request_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """해당 분석 요청의 오디오로 음악 분석만 다시 실행합니다. 오디오가 연결되어 있어야 합니다."""
    analysis_service.queue_music_rerun(db, user.id, request_id)
    return {"ok": True, "queued": True}


@router.post("/analysis/{request_id}/rerun-motion")
def rerun_motion_analysis(
    request_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """해당 분석 요청의 비디오로 동작 분석을 다시 실행합니다."""
    analysis_service.queue_motion_rerun(db, user.id, request_id)
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


@router.delete("/project/{request_id}")
def delete_project(
    request_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """프로젝트와 관련된 모든 S3 파일을 삭제합니다."""
    req = db.query(models.AnalysisRequest).filter(models.AnalysisRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="not found")
    if req.user_id != user.id:
        raise HTTPException(status_code=403, detail="forbidden")

    # Collect all S3 keys to delete
    s3_keys: list[str] = []

    # Get media files
    video = db.query(models.MediaFile).filter(models.MediaFile.id == req.video_id).first() if req.video_id else None
    audio = db.query(models.MediaFile).filter(models.MediaFile.id == req.audio_id).first() if req.audio_id else None

    if video and video.s3_key:
        s3_keys.append(video.s3_key)
    if audio and audio.s3_key:
        s3_keys.append(audio.s3_key)

    # Get analysis result S3 keys
    res = db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == request_id).first()
    if res:
        if res.motion_json_s3_key:
            s3_keys.append(res.motion_json_s3_key)
        if res.music_json_s3_key:
            s3_keys.append(res.music_json_s3_key)
        if res.magic_json_s3_key:
            s3_keys.append(res.magic_json_s3_key)
        if res.overlay_video_s3_key:
            s3_keys.append(res.overlay_video_s3_key)

    # Get analysis edit S3 keys
    edit = db.query(models.AnalysisEdit).filter(models.AnalysisEdit.request_id == request_id).first()
    if edit:
        if edit.motion_markers_s3_key:
            s3_keys.append(edit.motion_markers_s3_key)
        if edit.edited_overlay_s3_key:
            s3_keys.append(edit.edited_overlay_s3_key)

    # Delete related database records
    db.query(models.AnalysisJob).filter(models.AnalysisJob.request_id == request_id).delete()
    db.query(models.PixieOutput).filter(models.PixieOutput.request_id == request_id).delete()
    db.query(models.AnalysisEdit).filter(models.AnalysisEdit.request_id == request_id).delete()
    db.query(models.AnalysisResult).filter(models.AnalysisResult.request_id == request_id).delete()

    # Delete media files (only if not used by other requests)
    if video:
        other_video_refs = db.query(models.AnalysisRequest).filter(
            models.AnalysisRequest.video_id == video.id,
            models.AnalysisRequest.id != request_id
        ).count()
        if other_video_refs == 0:
            db.delete(video)

    if audio:
        other_audio_refs = db.query(models.AnalysisRequest).filter(
            models.AnalysisRequest.audio_id == audio.id,
            models.AnalysisRequest.id != request_id
        ).count()
        if other_audio_refs == 0:
            db.delete(audio)

    # Delete the analysis request
    db.delete(req)
    db.commit()

    # Delete S3 files
    if s3_keys:
        try:
            delete_keys(s3_keys)
        except Exception:
            pass  # Log but don't fail if S3 deletion fails

    return {"ok": True, "deleted_keys": len(s3_keys)}
