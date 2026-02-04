from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from authlib.integrations.starlette_client import OAuth, OAuthError

from ..db import models
from ..core.config import BASE_URL, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from ..core.deps import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


@router.get("/google/login")
async def google_login(request: Request):
    redirect_uri = f"{BASE_URL}/auth/google/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = await oauth.google.parse_id_token(request, token)

    if not userinfo:
        raise HTTPException(status_code=400, detail="Failed to read userinfo")

    google_sub = userinfo.get("sub")
    if not google_sub:
        raise HTTPException(status_code=400, detail="Missing sub")

    user = db.query(models.User).filter(models.User.google_sub == google_sub).first()
    if not user:
        user = models.User(
            google_sub=google_sub,
            email=userinfo.get("email"),
            name=userinfo.get("name"),
            avatar_url=userinfo.get("picture"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.email = userinfo.get("email")
        user.name = userinfo.get("name")
        user.avatar_url = userinfo.get("picture")
        db.commit()

    request.session["user_id"] = user.id
    return RedirectResponse(url=FRONTEND_URL)


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
    }


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}
