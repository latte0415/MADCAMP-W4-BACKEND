from __future__ import annotations

from typing import Optional, Dict, Any

from ..schemas import LibraryItem
from ..services.s3 import presign_get_url
from ..db import models


def _url_for_key(key: Optional[str]) -> Optional[str]:
    return presign_get_url(key) if key else None


def build_library_item(
    req: models.AnalysisRequest,
    video_row: models.MediaFile,
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
        video_s3_key=video_row.s3_key,
        video_duration_sec=video_row.duration_sec,
        audio_s3_key=audio_row.s3_key if audio_row else None,
        motion_json_s3_key=res.motion_json_s3_key if res else None,
        music_json_s3_key=res.music_json_s3_key if res else None,
        magic_json_s3_key=res.magic_json_s3_key if res else None,
        edited_motion_markers_s3_key=edit.motion_markers_s3_key if edit else None,
    )


def build_project_detail(
    req: models.AnalysisRequest,
    video: Optional[models.MediaFile],
    audio: Optional[models.MediaFile],
    res: Optional[models.AnalysisResult],
    edit: Optional[models.AnalysisEdit],
) -> Dict[str, Any]:
    return {
        "id": req.id,
        "title": req.title,
        "mode": req.mode,
        "status": req.status,
        "error_message": req.error_message,
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
        },
    }
