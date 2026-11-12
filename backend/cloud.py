"""Optional Google Cloud storage: Firestore for records, Cloud Storage for files.

PROVE_IT_STORE picks the mode:
- unset (default): SQLite records and an uploads/ folder, for development.
- firestore: records in Firestore (needs GOOGLE_CLOUD_PROJECT); files stay on local disk.
  Works on Firebase's free Spark plan, with no billing card.
- gcp: records in Firestore and files in a Cloud Storage bucket (needs GCS_BUCKET too, which needs billing).

Credentials come from the environment (Application Default Credentials), never from code. The bucket must be private: uniform
bucket-level access with public access prevention, so files have no public URLs.
"""
import os
import tempfile
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from config import upload_dir


def _mode() -> str:
    return os.getenv('PROVE_IT_STORE', '').strip().lower()


def use_firestore() -> bool:
    """Records live in Firestore."""
    return _mode() in ('firestore', 'gcp')


def use_cloud() -> bool:
    """Files live in the Cloud Storage bucket."""
    return _mode() == 'gcp'


def check_cloud_settings():
    """Fail at startup, not on the first student's upload."""
    mode = _mode()
    if mode not in ('', 'firestore', 'gcp'):
        raise RuntimeError('PROVE_IT_STORE must be empty, "firestore" or "gcp"')
    needed = {'firestore': ('GOOGLE_CLOUD_PROJECT',), 'gcp': ('GCS_BUCKET', 'GOOGLE_CLOUD_PROJECT')}.get(mode, ())
    missing = [name for name in needed if not os.getenv(name, '').strip()]
    if missing:
        raise RuntimeError(f'PROVE_IT_STORE={mode} needs {", ".join(missing)}')


@lru_cache(maxsize=1)
def bucket():
    from google.cloud import storage
    return storage.Client(project=os.environ['GOOGLE_CLOUD_PROJECT']).bucket(os.environ['GCS_BUCKET'])


@lru_cache(maxsize=1)
def firestore_db():
    from google.cloud import firestore
    return firestore.Client(project=os.environ['GOOGLE_CLOUD_PROJECT'])


def _blob_name(stored_filename: str) -> str:
    return f'uploads/{stored_filename}'


def incoming_path(stored_filename: str) -> Path:
    """Where an upload is first written: the uploads folder locally, a temp folder in the cloud."""
    if use_cloud():
        return Path(tempfile.mkdtemp(prefix='prove-it-')) / stored_filename
    folder = upload_dir()
    folder.mkdir(parents=True, exist_ok=True)
    return folder / stored_filename


def commit_file(path: Path, stored_filename: str):
    """Makes a validated upload permanent. In the cloud, uploads it and removes the temp copy."""
    if not use_cloud():
        return
    bucket().blob(_blob_name(stored_filename)).upload_from_filename(str(path))
    discard_incoming(path)


def discard_incoming(path: Path):
    """Removes a temp upload (and, in the cloud, its temp folder)."""
    path.unlink(missing_ok=True)
    if use_cloud():
        try:
            path.parent.rmdir()
        except OSError:
            pass


def delete_file(stored_filename: str):
    """Removes a permanently stored file; used when saving its record fails."""
    if use_cloud():
        bucket().blob(_blob_name(stored_filename)).delete()
    else:
        (upload_dir() / stored_filename).unlink(missing_ok=True)


@contextmanager
def stored_file(stored_filename: str):
    """Yields a local path to a stored file. Raises FileNotFoundError if it is gone."""
    if not use_cloud():
        path = upload_dir() / stored_filename
        if not path.is_file():
            raise FileNotFoundError(stored_filename)
        yield path
        return
    blob = bucket().blob(_blob_name(stored_filename))
    if not blob.exists():
        raise FileNotFoundError(stored_filename)
    folder = Path(tempfile.mkdtemp(prefix='prove-it-'))
    path = folder / stored_filename
    try:
        blob.download_to_filename(str(path))
        yield path
    finally:
        path.unlink(missing_ok=True)
        try:
            folder.rmdir()
        except OSError:
            pass
