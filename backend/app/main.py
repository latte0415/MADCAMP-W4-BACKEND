from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .core.config import SESSION_SECRET, COOKIE_SECURE, WORKER_ENABLED, WORKER_CONCURRENCY
from .db.base import Base, engine
from .db import models  # noqa: F401
from .api.auth import router as auth_router
from .api.api import router as api_router
from .workers.worker import AnalysisWorker

app = FastAPI()
_workers: list[AnalysisWorker] = []

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=COOKIE_SECURE,
)

FRONTEND_DIST = "frontend/dist"
LEGACY_STATIC = "frontend/legacy_static"

if os.path.isdir(os.path.join(FRONTEND_DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
else:
    app.mount("/static", StaticFiles(directory=LEGACY_STATIC), name="static")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    if WORKER_ENABLED:
        count = max(WORKER_CONCURRENCY, 1)
        for _ in range(count):
            worker = AnalysisWorker()
            worker.start()
            _workers.append(worker)


@app.get("/")
def index():
    if os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    return FileResponse(os.path.join(LEGACY_STATIC, "index.html"))


@app.get("/project/{project_id}")
def project_detail(project_id: int):
    if os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    return FileResponse(os.path.join(LEGACY_STATIC, "project.html"))


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(auth_router)
app.include_router(api_router)
