# Backend (FastAPI)

## Env
`.env` 파일을 사용합니다. 예시는 `backend/.env.example` 참고.

DB는 아래 항목으로 분리 설정합니다.
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

## Run
```
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## Auth endpoints
- `GET /auth/google/login`
- `GET /auth/google/callback`
- `GET /auth/me`
- `POST /auth/logout`

## API endpoints
- `POST /api/media` (multipart upload)
- `POST /api/media/presign` (presigned upload)
- `POST /api/media/commit` (create media record after presign upload)
- `POST /api/analysis`
- `POST /api/analysis/{id}/status`
- `POST /api/analysis/{id}/result`
- `GET /api/analysis/{id}/status`
- `GET /api/library` (q/status/mode/archived/limit/offset)
- `GET /api/media/{id}/download`
