from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .core.config import (
    SESSION_SECRET,
    COOKIE_SECURE,
    WORKER_ENABLED,
    WORKER_CONCURRENCY,
    PROJECT_ROOT,
    MUSIC_WORKER_CONCURRENCY,
    FRONTEND_URL,
)
from .db.base import Base, engine
from .db.migrations import run_auto_migrations
from .db import models  # noqa: F401
from .api.auth import router as auth_router
from .api.api import router as api_router
from .workers.worker import MotionAnalysisWorker, MusicAnalysisWorker

app = FastAPI()
_motion_workers: list[MotionAnalysisWorker] = []
_music_workers: list[MusicAnalysisWorker] = []

allowed_origins = {
    "https://madcamp-w4-backend.vercel.app",
    FRONTEND_URL,
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in allowed_origins if origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=COOKIE_SECURE,
)

FRONTEND_DIST = str(PROJECT_ROOT / "frontend" / "dist")
LEGACY_STATIC = str(PROJECT_ROOT / "frontend" / "legacy_static")

if os.path.isdir(os.path.join(FRONTEND_DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
if os.path.isdir(LEGACY_STATIC):
    app.mount("/static", StaticFiles(directory=LEGACY_STATIC), name="static")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    run_auto_migrations(engine)
    if WORKER_ENABLED:
        motion_count = max(WORKER_CONCURRENCY, 1)
        for _ in range(motion_count):
            worker = MotionAnalysisWorker()
            worker.start()
            _motion_workers.append(worker)

        music_count = max(MUSIC_WORKER_CONCURRENCY, 1)
        for _ in range(music_count):
            worker = MusicAnalysisWorker()
            worker.start()
            _music_workers.append(worker)


@app.get("/")
def index():
    if os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    raise HTTPException(status_code=404, detail="frontend build not found")


@app.get("/project/{project_id}")
def project_detail(project_id: int):
    if os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    raise HTTPException(status_code=404, detail="frontend build not found")


@app.get("/monitoring")
def monitoring():
    if os.path.isfile(os.path.join(LEGACY_STATIC, "monitoring.html")):
        return FileResponse(os.path.join(LEGACY_STATIC, "monitoring.html"))
    raise HTTPException(status_code=404, detail="monitoring page not found")


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(auth_router)
app.include_router(api_router)
