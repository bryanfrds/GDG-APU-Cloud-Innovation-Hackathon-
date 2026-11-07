
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).resolve().parent / "prove_it.db"


def get_connection():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS submissions (
                submission_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'uploaded',
                created_at TEXT NOT NULL
            )
        """)


def save_submission(
    submission_id,
    title,
    original_filename,
    stored_filename,
    file_size_bytes
):
    created_at = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO submissions (
                submission_id,
                title,
                original_filename,
                stored_filename,
                file_size_bytes,
                status,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            submission_id,
            title,
            original_filename,
            stored_filename,
            file_size_bytes,
            "uploaded",
            created_at
        ))

    return created_at


def get_submission(submission_id):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM submissions WHERE submission_id = ?",
            (submission_id,)
        ).fetchone()

    return dict(row) if row else None
