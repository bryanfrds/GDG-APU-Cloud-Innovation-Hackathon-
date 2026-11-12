from io import BytesIO


def upload(client, auth, data=b'print("hello")\n', filename='program.py', title='My assignment'):
    return client.post('/api/submissions', headers=auth,
                       data={'title': title},
                       files={'file': (filename, BytesIO(data))})


def test_requires_passcode_for_upload_and_read(client, auth):
    assert client.post('/api/submissions', data={'title': 'Hi'},
                       files={'file': ('a.py', b'print(1)')}).status_code == 401
    result = upload(client, auth)
    assert result.status_code == 201, result.text
    submission_id = result.json()['submission_id']
    assert client.get(f'/api/submissions/{submission_id}/content').status_code == 401
    assert client.get(f'/api/submissions/{submission_id}', headers=auth).status_code == 200


def test_extension_empty_and_size_limits(client, auth):
    assert upload(client, auth, filename='malware.exe').status_code == 415
    assert upload(client, auth, data=b'').status_code == 400
    assert upload(client, auth, data=b'x' * (10 * 1024 * 1024 + 1)).status_code == 413
    assert upload(client, auth, data=b'x' * 30001).status_code == 422
    assert upload(client, auth, data=b'\xff\xfe').status_code == 422
    assert upload(client, auth, title='line\nbreak').status_code == 400
    assert upload(client, auth, title='X' * 121).status_code == 400


def test_upload_rate_limit(client, auth):
    from security import UPLOAD_LIMITER
    UPLOAD_LIMITER.clear()
    for _ in range(10):
        assert upload(client, auth).status_code == 201
    assert upload(client, auth).status_code == 429


def test_question_database_roundtrip_and_viva_plan(client, auth, monkeypatch):
    from services.mock_generator import generate_mock_questions
    monkeypatch.setattr('routes.questions.generate_gemini_questions', generate_mock_questions)
    result = upload(client, auth, data=b'def answer(x):\n    return x * 2\nprint(answer(4))\n')
    assert result.status_code == 201, result.text
    submission_id = result.json()['submission_id']
    path = f'/api/submissions/{submission_id}'
    generated = client.post(path + '/generate', headers=auth)
    assert generated.status_code == 200, generated.text
    assert generated.json()['generator_type'] == 'gemini'
    assert len(generated.json()['data']['questions']) == 5
    assert 'expected_points' not in generated.text
    plan = client.get(path + '/viva-plan', headers=auth)
    assert plan.status_code == 200, plan.text
    assert plan.json()['assignmentTitle'] == 'My assignment'
    assert len(plan.json()['questions']) == 4
    assert all(set(q) == {'id', 'text', 'focus'} for q in plan.json()['questions'])
    assert all(len(q['text']) <= 400 and '\n' not in q['text'] for q in plan.json()['questions'])
    assert client.post(path + '/generate', headers=auth).json()['message'] == 'Questions already generated'
    from question_database import get_question_set
    saved = get_question_set(submission_id)
    assert saved['question_set'].questions[0].expected_points
    assert client.get(path + '/questions', headers=auth).status_code == 200
    assert client.get(path + '/viva-plan').status_code == 401


def test_generation_limit(client, auth):
    from security import GENERATE_LIMITER
    GENERATE_LIMITER.clear()
    for _ in range(5):
        assert client.post('/api/submissions/no-such-id/generate', headers=auth).status_code == 404
    assert client.post('/api/submissions/no-such-id/generate', headers=auth).status_code == 429
