"""Submission records: local SQLite by default, Firestore when PROVE_IT_STORE=gcp."""
import sqlite3
from datetime import datetime, timezone
import cloud
from config import database_path


def get_connection():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    if cloud.use_cloud():
        cloud.check_cloud_settings()
        return
    with get_connection() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS submissions (
            submission_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            stored_filename TEXT NOT NULL,
            file_size_bytes INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'uploaded',
            created_at TEXT NOT NULL
        )''')


def save_submission(submission_id, title, original_filename, stored_filename, file_size_bytes):
    created_at = datetime.now(timezone.utc).isoformat()
    if cloud.use_cloud():
        # create() fails if the id exists, so a record is never silently overwritten.
        cloud.firestore_db().collection('submissions').document(submission_id).create({
            'submission_id': submission_id, 'title': title,
            'original_filename': original_filename, 'stored_filename': stored_filename,
            'file_size_bytes': file_size_bytes, 'status': 'uploaded', 'created_at': created_at})
        return created_at
    with get_connection() as conn:
        conn.execute('''INSERT INTO submissions
            (submission_id, title, original_filename, stored_filename,
             file_size_bytes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (submission_id, title, original_filename, stored_filename,
             file_size_bytes, 'uploaded', created_at))
    return created_at


def get_submission(submission_id):
    if cloud.use_cloud():
        snapshot = cloud.firestore_db().collection('submissions').document(submission_id).get()
        return snapshot.to_dict() if snapshot.exists else None
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM submissions WHERE submission_id = ?',
                           (submission_id,)).fetchone()
    return dict(row) if row else None


def set_submission_status(submission_id: str, status: str):
    if status not in ('uploaded', 'processing', 'ready', 'failed'):
        raise ValueError('Unknown submission status')
    if cloud.use_cloud():
        cloud.firestore_db().collection('submissions').document(submission_id).update({'status': status})
        return
    with get_connection() as conn:
        conn.execute('UPDATE submissions SET status=? WHERE submission_id=?',
                     (status, submission_id))
