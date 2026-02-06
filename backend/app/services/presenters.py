from __future__ import annotations

from typing import Optional, Dict, Any

from ..schemas import LibraryItem, MonitoringItem
from ..services.s3 import presign_get_url
from ..db import models


def _url_for_key(key: Optional[str]) -> Optional[str]:
    return presign_get_url(key) if key else None


def build_library_item(
    req: models.AnalysisRequest,
    video_row: Optional[models.MediaFile],
    res: Optional[models.AnalysisResult],
    edit: Optional[models.AnalysisEdit],
    audio_row: Optional[models.MediaFile],
) -> LibraryItem:
    return LibraryItem(
        id=req.id,
        title=req.title,
        mode=req.mode,
        status=req.status,
        created_at=req.created_at,
        finished_at=req.finished_at,
        video_s3_key=video_row.s3_key if video_row else None,
        video_duration_sec=video_row.duration_sec if video_row else None,
        audio_s3_key=audio_row.s3_key if audio_row else None,
        motion_json_s3_key=res.motion_json_s3_key if res else None,
        music_json_s3_key=res.music_json_s3_key if res else None,
        magic_json_s3_key=res.magic_json_s3_key if res else None,
        edited_motion_markers_s3_key=edit.motion_markers_s3_key if edit else None,
    )


def build_monitoring_item(
    req: models.AnalysisRequest,
    video_row: Optional[models.MediaFile],
    res: Optional[models.AnalysisResult],
    edit: Optional[models.AnalysisEdit],
    audio_row: Optional[models.MediaFile],
    job: Optional[models.AnalysisJob],
) -> MonitoringItem:
    return MonitoringItem(
        id=req.id,
        title=req.title,
        mode=req.mode,
        status=req.status,
        created_at=req.created_at,
        started_at=req.started_at,
        finished_at=req.finished_at,
        error_message=job.error_message if job and job.error_message else req.error_message,
        video_s3_key=video_row.s3_key if video_row else None,
        video_duration_sec=video_row.duration_sec if video_row else None,
        audio_s3_key=audio_row.s3_key if audio_row else None,
        motion_json_s3_key=res.motion_json_s3_key if res else None,
        music_json_s3_key=res.music_json_s3_key if res else None,
        magic_json_s3_key=res.magic_json_s3_key if res else None,
        edited_motion_markers_s3_key=edit.motion_markers_s3_key if edit else None,
        match_score=float(res.match_score) if res and res.match_score is not None else None,
        job_status=job.status if job else None,
        job_message=job.message if job else None,
        job_progress=float(job.progress) if job and job.progress is not None else None,
        job_log=job.log if job else None,
        job_updated_at=job.updated_at if job else None,
    )


def build_project_detail(
    req: models.AnalysisRequest,
    video: Optional[models.MediaFile],
    audio: Optional[models.MediaFile],
    res: Optional[models.AnalysisResult],
    edit: Optional[models.AnalysisEdit],
    pixie_outputs: Optional[list] = None,
) -> Dict[str, Any]:
    # Build pixie meshes info
    pixie_meshes = None
    if pixie_outputs:
        pixie_meshes = {
            p.kind: {
                "s3_prefix": p.s3_prefix,
                "file_count": p.file_count,
            }
            for p in pixie_outputs
        }

    return {
        "id": req.id,
        "title": req.title,
        "mode": req.mode,
        "status": req.status,
        "error_message": req.error_message,
        "match_score": float(res.match_score) if res and res.match_score is not None else None,
        "match_details": res.match_details if res else None,
        "created_at": req.created_at,
        "finished_at": req.finished_at,
        "video": {
            "s3_key": video.s3_key if video else None,
            "url": _url_for_key(video.s3_key) if video else None,
            "duration_sec": video.duration_sec if video else None,
        },
        "audio": {
            "s3_key": audio.s3_key if audio else None,
            "url": _url_for_key(audio.s3_key) if audio else None,
            "duration_sec": audio.duration_sec if audio else None,
        } if audio else None,
        "results": {
            "motion_json": _url_for_key(res.motion_json_s3_key) if res else None,
            "music_json": _url_for_key(res.music_json_s3_key) if res else None,
            "magic_json": _url_for_key(res.magic_json_s3_key) if res else None,
            "overlay_video": _url_for_key(res.overlay_video_s3_key) if res else None,
            "edited_motion_markers": _url_for_key(edit.motion_markers_s3_key) if edit else None,
            "stems": {
                "drums": _url_for_key(res.stem_drums_s3_key) if res else None,
                "bass": _url_for_key(res.stem_bass_s3_key) if res else None,
                "vocal": _url_for_key(res.stem_vocals_s3_key) if res else None,
                "other": _url_for_key(res.stem_other_s3_key) if res else None,
                "drum_low": _url_for_key(res.stem_drum_low_s3_key) if res else None,
                "drum_mid": _url_for_key(res.stem_drum_mid_s3_key) if res else None,
                "drum_high": _url_for_key(res.stem_drum_high_s3_key) if res else None,
            } if res else None,
        },
        "pixie_meshes": pixie_meshes,
    }
