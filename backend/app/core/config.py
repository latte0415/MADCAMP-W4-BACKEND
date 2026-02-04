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
WORKER_ENABLED = os.environ.get("WORKER_ENABLED", "true").lower() == "true"
WORKER_CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "1"))
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MUSIC_ANALYZER_ROOT = os.environ.get("MUSIC_ANALYZER_ROOT", str(PROJECT_ROOT / "music-analyzer"))
DEMUCS_MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs")
