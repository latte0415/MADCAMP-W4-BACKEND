from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .config import SESSION_SECRET, COOKIE_SECURE, WORKER_ENABLED
from .db import Base, engine
from . import models  # noqa: F401
from .auth import router as auth_router
from .api import router as api_router
from .worker import AnalysisWorker

app = FastAPI()

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=COOKIE_SECURE,
)

app.mount("/static", StaticFiles(directory="backend/static"), name="static")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    if WORKER_ENABLED:
        AnalysisWorker().start()


@app.get("/")
def index():
    return FileResponse("backend/static/index.html")


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(auth_router)
app.include_router(api_router)
