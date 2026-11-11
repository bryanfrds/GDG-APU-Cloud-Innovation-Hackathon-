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
