from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


def _get_column_meta(conn, table: str, column: str):
    res = conn.execute(
        text(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = :table
              AND column_name = :column
            """
        ),
        {"table": table, "column": column},
    ).fetchone()
    return res


def run_auto_migrations(engine: Engine) -> None:
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        # avoid hanging on locks
        try:
            conn.execute(text("SET lock_timeout = '3s'"))
            conn.execute(text("SET statement_timeout = '5s'"))
        except Exception:
            pass
        # analysis_results.match_score, match_details
        if not _get_column_meta(conn, "analysis_results", "match_score"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS match_score NUMERIC"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "match_details"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS match_details JSON"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "stem_drums_s3_key"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS stem_drums_s3_key VARCHAR"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "stem_bass_s3_key"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS stem_bass_s3_key VARCHAR"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "stem_vocals_s3_key"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS stem_vocals_s3_key VARCHAR"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "stem_other_s3_key"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS stem_other_s3_key VARCHAR"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "stem_drum_low_s3_key"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS stem_drum_low_s3_key VARCHAR"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "stem_drum_mid_s3_key"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS stem_drum_mid_s3_key VARCHAR"))
            except Exception:
                pass
        if not _get_column_meta(conn, "analysis_results", "stem_drum_high_s3_key"):
            try:
                conn.execute(text("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS stem_drum_high_s3_key VARCHAR"))
            except Exception:
                pass

        # allow audio-only analysis
        meta = _get_column_meta(conn, "analysis_requests", "video_id")
        if meta and str(meta[1]).upper() == "NO":
            try:
                conn.execute(text("ALTER TABLE analysis_requests ALTER COLUMN video_id DROP NOT NULL"))
            except Exception:
                pass

        # pixie_outputs table for 3D mesh storage
        try:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS pixie_outputs (
                        id BIGSERIAL PRIMARY KEY,
                        request_id BIGINT NOT NULL REFERENCES analysis_requests(id),
                        kind VARCHAR NOT NULL,
                        s3_prefix VARCHAR NOT NULL,
                        file_count INTEGER,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
        except Exception:
            pass

        # Index for faster lookups by request_id
        try:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_pixie_outputs_request_id ON pixie_outputs(request_id)"
                )
            )
        except Exception:
            pass
