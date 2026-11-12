"""Cloud mode with in-memory fakes of Cloud Storage and Firestore (no network)."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

import cloud
from schemas.questions import QuestionSet


class FakeBlob:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def upload_from_filename(self, path):
        self.store[self.name] = Path(path).read_bytes()

    def download_to_filename(self, path):
        Path(path).write_bytes(self.store[self.name])

    def exists(self):
        return self.name in self.store

    def delete(self):
        del self.store[self.name]


class FakeBucket:
    def __init__(self):
        self.objects = {}

    def blob(self, name):
        return FakeBlob(self.objects, name)


class FakeSnapshot:
    def __init__(self, data):
        self.data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self.data)


class FakeDocument:
    def __init__(self, docs, doc_id):
        self.docs, self.doc_id = docs, doc_id

    def create(self, data):
        if self.doc_id in self.docs:
            raise RuntimeError('already exists')
        self.docs[self.doc_id] = dict(data)

    def set(self, data):
        self.docs[self.doc_id] = dict(data)

    def update(self, data):
        self.docs[self.doc_id].update(data)

    def get(self):
        return FakeSnapshot(self.docs.get(self.doc_id))


class FakeFirestore:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        docs = self.collections.setdefault(name, {})
        return type('Collection', (), {'document': lambda _self, doc_id: FakeDocument(docs, doc_id)})()


@pytest.fixture
def cloud_client(tmp_path, monkeypatch):
    fake_bucket, fake_db = FakeBucket(), FakeFirestore()
    monkeypatch.setenv('PROVE_IT_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('DEMO_PASSCODE', 'only-for-tests')
    monkeypatch.setenv('PROVE_IT_STORE', 'gcp')
    monkeypatch.setenv('GCS_BUCKET', 'test-bucket')
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'test-project')
    monkeypatch.setattr(cloud, 'bucket', lambda: fake_bucket)
    monkeypatch.setattr(cloud, 'firestore_db', lambda: fake_db)
    from security import UPLOAD_LIMITER, GENERATE_LIMITER
    UPLOAD_LIMITER.clear()
    GENERATE_LIMITER.clear()
    from main import app
    with TestClient(app) as client:
        yield client, fake_bucket, fake_db, tmp_path


AUTH = {'x-demo-code': 'only-for-tests'}


def question_set(submission_id):
    return QuestionSet.model_validate({
        'submission_id': submission_id, 'assignment_summary': 'A tiny adder program.',
        'questions': [{
            'id': f'q{i}', 'question': f'What does line {i} of the program do?',
            'difficulty': ['easy', 'easy', 'medium', 'medium', 'hard'][i - 1],
            'topic': 'Basics', 'source_file': 'a.py', 'source_lines': [1],
            'expected_points': ['private rubric'], 'follow_up_hint': 'hint'} for i in range(1, 6)]})


def upload(client, name='a.py', body=b'print(1)\n'):
    return client.post('/api/submissions', headers=AUTH, data={'title': 'T'}, files={'file': (name, body)})


def test_upload_goes_to_bucket_and_firestore_not_local_disk(cloud_client):
    client, bucket, db, tmp_path = cloud_client
    res = upload(client)
    assert res.status_code == 201
    sid, stored = res.json()['submission_id'], res.json()['stored_filename']
    assert bucket.objects == {f'uploads/{stored}': b'print(1)\n'}
    assert db.collections['submissions'][sid]['status'] == 'uploaded'
    assert not (tmp_path / 'prove_it.db').exists()
    assert not (tmp_path / 'uploads').exists() or not list((tmp_path / 'uploads').iterdir())


def test_content_and_generation_read_back_from_the_bucket(cloud_client, monkeypatch):
    client, bucket, db, _ = cloud_client
    sid = upload(client).json()['submission_id']
    assert client.get(f'/api/submissions/{sid}/content', headers=AUTH).json()['content'].strip() != ''
    import routes.questions as routes
    monkeypatch.setattr(routes, 'generate_gemini_questions', lambda **kw: question_set(kw['submission_id']))
    assert client.post(f'/api/submissions/{sid}/generate', headers=AUTH).status_code == 200
    assert db.collections['submissions'][sid]['status'] == 'ready'
    assert client.get(f'/api/submissions/{sid}/questions', headers=AUTH).status_code == 200
    plan = client.get(f'/api/submissions/{sid}/viva-plan', headers=AUTH).json()
    assert len(plan['questions']) == 4
    assert 'private rubric' not in str(plan)


@pytest.mark.parametrize('name,body,status', [('a.exe', b'x', 415), ('a.py', b'', 400), ('a.txt', b'\xff\xfe\xfa', 422)])
def test_rejected_uploads_leave_nothing_in_the_cloud(cloud_client, name, body, status):
    client, bucket, db, _ = cloud_client
    assert upload(client, name, body).status_code == status
    assert bucket.objects == {}
    assert db.collections.get('submissions', {}) == {}


def test_failed_record_save_removes_the_uploaded_file(cloud_client, monkeypatch):
    client, bucket, db, _ = cloud_client
    import main

    def boom(**kw):
        raise RuntimeError('firestore down')
    monkeypatch.setattr(main, 'save_submission', boom)
    with pytest.raises(RuntimeError):
        upload(client)
    assert bucket.objects == {}


def test_missing_file_in_bucket_is_a_404(cloud_client):
    client, bucket, db, _ = cloud_client
    sid = upload(client).json()['submission_id']
    bucket.objects.clear()
    assert client.get(f'/api/submissions/{sid}/content', headers=AUTH).status_code == 404
    assert client.post(f'/api/submissions/{sid}/generate', headers=AUTH).status_code == 404


def test_cloud_mode_without_bucket_settings_fails_at_startup(tmp_path, monkeypatch):
    monkeypatch.setenv('PROVE_IT_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('PROVE_IT_STORE', 'gcp')
    monkeypatch.delenv('GCS_BUCKET', raising=False)
    from main import app
    with pytest.raises(RuntimeError, match='GCS_BUCKET'):
        with TestClient(app):
            pass


def test_firestore_only_mode_keeps_files_on_local_disk(tmp_path, monkeypatch):
    fake_db = FakeFirestore()
    monkeypatch.setenv('PROVE_IT_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('DEMO_PASSCODE', 'only-for-tests')
    monkeypatch.setenv('PROVE_IT_STORE', 'firestore')
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'test-project')
    monkeypatch.delenv('GCS_BUCKET', raising=False)
    monkeypatch.setattr(cloud, 'firestore_db', lambda: fake_db)
    monkeypatch.setattr(cloud, 'bucket', lambda: pytest.fail('bucket must not be used'))
    from security import UPLOAD_LIMITER, GENERATE_LIMITER
    UPLOAD_LIMITER.clear()
    GENERATE_LIMITER.clear()
    from main import app
    with TestClient(app) as client:
        res = upload(client)
        assert res.status_code == 201
        sid, stored = res.json()['submission_id'], res.json()['stored_filename']
        assert (tmp_path / 'uploads' / stored).is_file()
        assert fake_db.collections['submissions'][sid]['stored_filename'] == stored
        assert not (tmp_path / 'prove_it.db').exists()
        assert client.get(f'/api/submissions/{sid}/content', headers=AUTH).status_code == 200


def test_firestore_mode_without_a_project_fails_at_startup(tmp_path, monkeypatch):
    monkeypatch.setenv('PROVE_IT_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('PROVE_IT_STORE', 'firestore')
    monkeypatch.delenv('GOOGLE_CLOUD_PROJECT', raising=False)
    from main import app
    with pytest.raises(RuntimeError, match='GOOGLE_CLOUD_PROJECT'):
        with TestClient(app):
            pass


def test_unknown_store_mode_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv('PROVE_IT_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('PROVE_IT_STORE', 'firestor')
    from main import app
    with pytest.raises(RuntimeError, match='PROVE_IT_STORE'):
        with TestClient(app):
            pass
