"""Persist full question sets privately, separate from public question response."""
import sqlite3
from config import database_path
from schemas.questions import QuestionSet


def init_question_db():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS question_sets (
            submission_id TEXT PRIMARY KEY,
            generator_type TEXT NOT NULL,
            question_data TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )''')


def save_question_set(question_set: QuestionSet, generator_type='gemini'):
    if generator_type not in ('gemini', 'mock'):
        raise ValueError('Unsupported generator type')
    init_question_db()
    with sqlite3.connect(database_path()) as conn:
        conn.execute('''INSERT INTO question_sets
            (submission_id, generator_type, question_data) VALUES (?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET
            generator_type=excluded.generator_type,
            question_data=excluded.question_data,
            updated_at=CURRENT_TIMESTAMP''',
            (question_set.submission_id, generator_type,
             question_set.model_dump_json()))


def get_question_set(submission_id: str):
    init_question_db()
    with sqlite3.connect(database_path()) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute('''SELECT generator_type, question_data
            FROM question_sets WHERE submission_id = ?''',
            (submission_id,)).fetchone()
    return ({'generator_type': row['generator_type'],
             'question_set': QuestionSet.model_validate_json(row['question_data'])}
            if row else None)
