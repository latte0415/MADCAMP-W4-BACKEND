import threading
from typing import Dict, Any, Optional

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ..db import models

_jobs: Dict[int, Dict[str, Any]] = {}
_lock = threading.Lock()


def set_job(
    request_id: int,
    status: str,
    error: Optional[str] = None,
    message: Optional[str] = None,
    progress: Optional[float] = None,
    log: Optional[str] = None,
    db: Optional[Session] = None,
) -> None:
    with _lock:
        job = _jobs.get(request_id, {})
        job["status"] = status
        if error is not None:
            job["error"] = error
        if message is not None:
            job["message"] = message
        if progress is not None:
            job["progress"] = progress
        if log is not None:
            job["log"] = log
        _jobs[request_id] = job

    if db is None:
        return

    record = db.query(models.AnalysisJob).filter(models.AnalysisJob.request_id == request_id).first()
    if not record:
        record = models.AnalysisJob(request_id=request_id, status=status)
        db.add(record)
    record.status = status
    if error is not None:
        record.error_message = error
    if message is not None:
        record.message = message
    if progress is not None:
        record.progress = progress
    if log is not None:
        record.log = log
    try:
        db.commit()
    except IntegrityError:
        # Another transaction inserted the row first; retry as update.
        db.rollback()
        record = db.query(models.AnalysisJob).filter(models.AnalysisJob.request_id == request_id).first()
        if record is None:
            record = models.AnalysisJob(request_id=request_id, status=status)
            db.add(record)
        record.status = status
        if error is not None:
            record.error_message = error
        if message is not None:
            record.message = message
        if progress is not None:
            record.progress = progress
        if log is not None:
            record.log = log
        db.commit()


def get_job(request_id: int, db: Optional[Session] = None) -> Optional[Dict[str, Any]]:
    if db is not None:
        record = db.query(models.AnalysisJob).filter(models.AnalysisJob.request_id == request_id).first()
        if record:
            return {
                "status": record.status,
                "error": record.error_message,
                "message": record.message,
                "progress": float(record.progress) if record.progress is not None else None,
                "log": record.log,
            }
    with _lock:
        return _jobs.get(request_id)
