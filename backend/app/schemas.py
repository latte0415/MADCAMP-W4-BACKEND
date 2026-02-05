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
    video_id: Optional[int] = None
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
    video_s3_key: Optional[str]
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
    stem_drums_s3_key: Optional[str] = None
    stem_bass_s3_key: Optional[str] = None
    stem_vocals_s3_key: Optional[str] = None
    stem_other_s3_key: Optional[str] = None
    stem_drum_low_s3_key: Optional[str] = None
    stem_drum_mid_s3_key: Optional[str] = None
    stem_drum_high_s3_key: Optional[str] = None
    match_score: Optional[float] = None
    match_details: Optional[dict] = None


class MusicResultResponse(BaseModel):
    """음악 분석 결과(streams_sections_cnn.json) 다운로드 URL."""
    url: str


class AnalysisAudioUpdate(BaseModel):
    """분석 요청의 오디오(음악) 교체용."""
    audio_id: int


class AnalysisVideoUpdate(BaseModel):
    """분석 요청의 비디오(영상) 교체용."""
    video_id: int


class AnalysisExtractAudioUpdate(BaseModel):
    """영상에서 오디오 추출 사용 여부."""
    enabled: bool


class AnalysisMusicOnlyRequest(BaseModel):
    """음악 분석만 실행할 때 사용하는 요청."""
    audio_id: Optional[int] = None


class MonitoringItem(BaseModel):
    id: int
    title: Optional[str]
    mode: str
    status: str
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
    video_s3_key: Optional[str]
    video_duration_sec: Optional[float]
    audio_s3_key: Optional[str]
    motion_json_s3_key: Optional[str]
    music_json_s3_key: Optional[str]
    magic_json_s3_key: Optional[str]
    edited_motion_markers_s3_key: Optional[str]
    match_score: Optional[float] = None
    job_status: Optional[str] = None
    job_message: Optional[str] = None
    job_progress: Optional[float] = None
    job_log: Optional[str] = None
    job_updated_at: Optional[datetime] = None


class MonitoringResponse(BaseModel):
    queued: List[MonitoringItem]
    queued_music: List[MonitoringItem]
    running: List[MonitoringItem]
    failed: List[MonitoringItem]


class MonitoringHealthResponse(BaseModel):
    total_running: int
    total_queued: int
    total_queued_music: int
    total_failed_24h: int
    total_done_24h: int
    active_running: int
    stale_running: int
