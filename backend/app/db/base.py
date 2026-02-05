from __future__ import annotations

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base

from ..core.config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


@event.listens_for(engine, "connect")
def _set_session_defaults(dbapi_connection, _connection_record):
    try:
        cursor = dbapi_connection.cursor()
        # Ensure reads don't fail due to lock/statement timeouts set at DB/user level
        cursor.execute("SET lock_timeout = '0'")
        cursor.execute("SET statement_timeout = '0'")
        cursor.close()
    except Exception:
        pass
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
