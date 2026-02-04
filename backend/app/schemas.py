from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class MediaCreateResponse(BaseModel):
    id: int
    s3_key: str
    type: str
    content_type: Optional[str] = None
    duration_sec: Optional[float] = None


class MediaPresignRequest(BaseModel):
    filename: str
    content_type: Optional[str] = None
    type: str  # video | audio


class MediaCommitRequest(BaseModel):
    s3_key: str
    type: str  # video | audio
    content_type: Optional[str] = None
    duration_sec: Optional[float] = None


class AnalysisRequestCreate(BaseModel):
    video_id: int
    audio_id: Optional[int] = None
    mode: str
    params_json: Optional[dict] = None
    title: Optional[str] = None
    notes: Optional[str] = None


class AnalysisRequestResponse(BaseModel):
    id: int
    mode: str
    status: str
    title: Optional[str]
    created_at: datetime


class AnalysisStatusResponse(BaseModel):
    id: int
    status: str
    error_message: Optional[str] = None
    message: Optional[str] = None
    progress: Optional[float] = None
    log: Optional[str] = None


class AnalysisStatusUpdate(BaseModel):
    status: str
    error_message: Optional[str] = None
    message: Optional[str] = None
    progress: Optional[float] = None
    log: Optional[str] = None


class LibraryItem(BaseModel):
    id: int
    title: Optional[str]
    mode: str
    status: str
    created_at: datetime
    finished_at: Optional[datetime]
    video_s3_key: str
    video_duration_sec: Optional[float]
    audio_s3_key: Optional[str]
    motion_json_s3_key: Optional[str]
    music_json_s3_key: Optional[str]
    magic_json_s3_key: Optional[str]
    edited_motion_markers_s3_key: Optional[str]


LibraryResponse = List[LibraryItem]


class AnalysisResultUpsert(BaseModel):
    motion_json_s3_key: Optional[str] = None
    music_json_s3_key: Optional[str] = None
    magic_json_s3_key: Optional[str] = None
    overlay_video_s3_key: Optional[str] = None


class MusicResultResponse(BaseModel):
    """음악 분석 결과(streams_sections_cnn.json) 다운로드 URL."""
    url: str


class AnalysisAudioUpdate(BaseModel):
    """분석 요청의 오디오(음악) 교체용."""
    audio_id: int
