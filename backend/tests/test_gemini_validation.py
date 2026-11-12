import json
import pytest
from services.gemini import validate_generated_response


def data():
    return {
        'assignment_summary': 'This program searches a sorted input list.',
        'questions': [
            {'id': f'q{i}', 'question': f'Explain the logic behind code line {i} and why it is needed?',
             'difficulty': ['easy', 'easy', 'medium', 'medium', 'hard'][i - 1],
             'topic': 'Search algorithm', 'source_file': 'assignment.py',
             'source_lines': [1], 'source_pages': [],
             'expected_points': ['Uses the actual code to answer'],
             'follow_up_hint': 'Ask for an edge case'}
            for i in range(1, 6)
        ],
    }


def validate(payload):
    return validate_generated_response(json.dumps(payload), submission_id='real-id',
        filename='original.py', safe_filename='assignment.py', line_count=4, is_pdf=False)


def test_valid_response_has_backend_metadata():
    payload = data()
    payload['status'] = 'evaluated'
    payload['submission_id'] = 'invented'
    result = validate(payload)
    assert result.status == 'ready'
    assert result.submission_id == 'real-id'
    assert result.questions[0].source_file == 'original.py'


@pytest.mark.parametrize('mutate', [
    lambda p: p['questions'][0].update(source_file='../other.py'),
    lambda p: p['questions'][0].update(source_lines=[999]),
    lambda p: p['questions'][0].update(difficulty='hard'),
    lambda p: p['questions'].pop(),
    lambda p: p['questions'][0].update(question='x' * 401),
])
def test_rejects_malformed_or_unsubstantiated_response(mutate):
    payload = data()
    mutate(payload)
    with pytest.raises(ValueError):
        validate(payload)


def pdf_payload(pages):
    payload = data()
    for q in payload['questions']:
        q.update(source_file='assignment.pdf', source_lines=[], source_pages=pages)
    return payload


def validate_pdf(payload, page_count=2):
    return validate_generated_response(json.dumps(payload), submission_id='real-id',
        filename='report.pdf', safe_filename='assignment.pdf', line_count=40,
        is_pdf=True, page_count=page_count)


def test_pdf_accepts_pages_that_exist():
    assert validate_pdf(pdf_payload([1, 2])).questions[0].source_pages == [1, 2]


@pytest.mark.parametrize('mutate', [
    lambda p: p['questions'][0].update(source_pages=[3]),
    lambda p: p['questions'][0].update(source_pages=[0]),
    lambda p: p['questions'][0].update(source_lines=[1]),
])
def test_pdf_rejects_invented_pages_or_lines(mutate):
    payload = pdf_payload([1])
    mutate(payload)
    with pytest.raises(ValueError):
        validate_pdf(payload)
