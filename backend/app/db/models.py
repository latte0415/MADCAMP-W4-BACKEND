from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    BigInteger,
    Text,
    String,
    JSON,
)
from sqlalchemy.sql import func

from .base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True)
    google_sub = Column(String, unique=True, nullable=False)
    email = Column(String)
    name = Column(String)
    avatar_url = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(BigInteger, ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)
    s3_bucket = Column(String, nullable=False)
    s3_key = Column(String, nullable=False)
    content_type = Column(String)
    duration_sec = Column(Numeric)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AnalysisRequest(Base):
    __tablename__ = "analysis_requests"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(BigInteger, ForeignKey("users.id"), nullable=False)
    video_id = Column(BigInteger, ForeignKey("media_files.id"), nullable=False)
    audio_id = Column(BigInteger, ForeignKey("media_files.id"))
    mode = Column(String, nullable=False)
    params_json = Column(JSON)
    status = Column(String, nullable=False)
    error_message = Column(Text)
    title = Column(String)
    notes = Column(Text)
    is_archived = Column(Boolean, nullable=False, server_default="false")
    is_deleted = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True))
    finished_at = Column(DateTime(timezone=True))


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id = Column(BigInteger, primary_key=True)
    request_id = Column(BigInteger, ForeignKey("analysis_requests.id"), nullable=False, unique=True)
    motion_json_s3_key = Column(String)
    music_json_s3_key = Column(String)
    magic_json_s3_key = Column(String)
    overlay_video_s3_key = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AnalysisEdit(Base):
    __tablename__ = "analysis_edits"

    id = Column(BigInteger, primary_key=True)
    request_id = Column(BigInteger, ForeignKey("analysis_requests.id"), nullable=False, unique=True)
    motion_markers_s3_key = Column(String, nullable=False)
    edited_overlay_s3_key = Column(String)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id = Column(BigInteger, primary_key=True)
    request_id = Column(BigInteger, ForeignKey("analysis_requests.id"), nullable=False, unique=True)
    status = Column(String, nullable=False)
    error_message = Column(Text)
    message = Column(Text)
    progress = Column(Numeric)
    log = Column(Text)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class PixieOutput(Base):
    __tablename__ = "pixie_outputs"

    id = Column(BigInteger, primary_key=True)
    request_id = Column(BigInteger, ForeignKey("analysis_requests.id"), nullable=False)
    kind = Column(String, nullable=False)
    s3_prefix = Column(String, nullable=False)
    file_count = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
