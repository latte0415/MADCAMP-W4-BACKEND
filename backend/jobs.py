import threading
from typing import Dict, Any, Optional

_jobs: Dict[int, Dict[str, Any]] = {}
_lock = threading.Lock()


def set_job(
    request_id: int,
    status: str,
    error: Optional[str] = None,
    message: Optional[str] = None,
    progress: Optional[float] = None,
    log: Optional[str] = None,
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


def get_job(request_id: int) -> Optional[Dict[str, Any]]:
    with _lock:
        return _jobs.get(request_id)
