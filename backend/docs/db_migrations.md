# Database Migrations

This project uses `Base.metadata.create_all` on startup.
When deploying to an existing DB, apply schema changes manually or via your migration tool.

## 2026-02-04: analysis_jobs table

```sql
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL UNIQUE REFERENCES analysis_requests(id),
  status VARCHAR NOT NULL,
  error_message TEXT,
  message TEXT,
  progress NUMERIC,
  log TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

