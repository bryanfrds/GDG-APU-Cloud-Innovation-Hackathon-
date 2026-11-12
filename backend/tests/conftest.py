from pathlib import Path
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('PROVE_IT_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('DEMO_PASSCODE', 'only-for-tests')
    from security import UPLOAD_LIMITER, GENERATE_LIMITER
    UPLOAD_LIMITER.clear()
    GENERATE_LIMITER.clear()
    from main import app
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth():
    return {'x-demo-code': 'only-for-tests'}
