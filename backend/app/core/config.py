import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=False)


def get_env(name: str, default: Optional[str] = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"{name} is not set")
    return value


DB_HOST = get_env("DB_HOST")
DB_PORT = get_env("DB_PORT", "5432")
DB_NAME = get_env("DB_NAME")
DB_USER = get_env("DB_USER")
DB_PASSWORD = get_env("DB_PASSWORD")
DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
SESSION_SECRET = get_env("SESSION_SECRET")
GOOGLE_CLIENT_ID = get_env("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = get_env("GOOGLE_CLIENT_SECRET")

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://127.0.0.1:8000")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax")  # "lax", "strict", or "none"
WORKER_ENABLED = os.environ.get("WORKER_ENABLED", "true").lower() == "true"
WORKER_CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "1"))
MUSIC_WORKER_CONCURRENCY = int(os.environ.get("MUSIC_WORKER_CONCURRENCY", "1"))
MONITORING_PUBLIC = os.environ.get("MONITORING_PUBLIC", "false").lower() == "true"
def _find_project_root() -> Path:
    """Find the project root directory containing 'motion' and 'backend' folders."""
    # Try from config.py location: backend/app/core/config.py -> parents[3] = project root
    candidates = [
        Path(__file__).resolve().parents[3],
        Path.cwd().resolve(),
        Path("/app"),  # Common container path
        Path("/opt/app"),
        Path.home() / "dance",
    ]

    # Also check PROJECT_ROOT env var
    env_root = os.environ.get("PROJECT_ROOT")
    if env_root:
        candidates.insert(0, Path(env_root).resolve())

    for candidate in candidates:
        if candidate.exists() and (candidate / "motion").exists() and (candidate / "backend").exists():
            return candidate

    # Fallback to default
    return Path(__file__).resolve().parents[3]


PROJECT_ROOT = _find_project_root()
MUSIC_ANALYZER_ROOT = os.environ.get("MUSIC_ANALYZER_ROOT", str(PROJECT_ROOT / "music-analyzer"))
DEMUCS_MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs")
