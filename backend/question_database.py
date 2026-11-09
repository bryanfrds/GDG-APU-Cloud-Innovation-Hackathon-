
import json
import sqlite3
from pathlib import Path

from schemas.questions import QuestionSet

DB_PATH = Path(__file__).resolve().parent / "prove_it.db"


def init_question_db():
    """Create the question table without deleting existing data."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS question_sets (
                submission_id TEXT PRIMARY KEY,
                generator_type TEXT NOT NULL,
                question_data TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


def save_question_set(
    question_set: QuestionSet,
    generator_type: str = "mock",
):
    """Insert or update generated questions for a submission."""

    if generator_type not in ("mock", "gemini"):
        raise ValueError("Unsupported generator type")

    init_question_db()

    payload = question_set.model_dump_json()

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            INSERT INTO question_sets (
                submission_id,
                generator_type,
                question_data
            )
            VALUES (?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET
                generator_type = excluded.generator_type,
                question_data = excluded.question_data,
                updated_at = CURRENT_TIMESTAMP
        """, (
            question_set.submission_id,
            generator_type,
            payload,
        ))


def get_question_set(submission_id: str):
    """Retrieve and validate a saved question set."""

    init_question_db()

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        row = conn.execute("""
            SELECT generator_type, question_data
            FROM question_sets
            WHERE submission_id = ?
        """, (submission_id,)).fetchone()

    if row is None:
        return None

    return {
        "generator_type": row["generator_type"],
        "question_set": QuestionSet.model_validate_json(
            row["question_data"]
        ),
    }
