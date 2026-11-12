"""Shared local settings. A hosted service needs durable external storage."""
import os
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
REPO_DIR = BACKEND_DIR.parent
# Deployment environment always takes precedence over local files.
load_dotenv(REPO_DIR / '.env.local', override=False)
load_dotenv(BACKEND_DIR / '.env.local', override=False)
# Legacy local compatibility only (do not commit .env files).
load_dotenv(BACKEND_DIR / '.env', override=False)

AI_CHAR_LIMIT = 30_000
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {'.pdf', '.py', '.java', '.cpp', '.txt'}


def data_dir() -> Path:
    return Path(os.environ.get('PROVE_IT_DATA_DIR') or BACKEND_DIR).resolve()


def upload_dir() -> Path:
    return data_dir() / 'uploads'


def database_path() -> Path:
    return data_dir() / 'prove_it.db'
