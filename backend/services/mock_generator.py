"""Development-only mock; never score students from these generic answer points."""
from pathlib import Path
from schemas.questions import QuestionSet, VivaQuestion


def generate_mock_questions(submission_id: str, filename: str, content: str) -> QuestionSet:
    if not content.strip():
        raise ValueError('Cannot generate from empty assignment')
    lines = [(i, line.strip()) for i, line in enumerate(content.splitlines(), 1)
             if line.strip()]
    if not lines:
        raise ValueError('No readable source lines')
    is_pdf = Path(filename).suffix.lower() == '.pdf'
    questions = []
    templates = [
        ('easy', 'Overview', 'Explain the purpose of the following: '),
        ('easy', 'Logic', 'What does this part do in your implementation: '),
        ('medium', 'Design', 'Why did you choose this approach: '),
        ('medium', 'Testing', 'How would you test an edge case involving: '),
        ('hard', 'Evaluation', 'What limitations or improvements apply to: '),
    ]
    for ix, (difficulty, topic, prefix) in enumerate(templates):
        number, excerpt = lines[min(ix * len(lines) // 5, len(lines) - 1)]
        questions.append(VivaQuestion(
            id=f'q{ix+1}', question=prefix + excerpt[:150],
            difficulty=difficulty, topic=topic, source_file=filename,
            source_lines=[] if is_pdf else [number], source_pages=[],
            expected_points=['MOCK: explain this real source excerpt'],
            follow_up_hint='Ask for a concrete example',
        ))
    return QuestionSet(submission_id=submission_id, status='ready',
        assignment_summary=f'MOCK SUMMARY — file {filename} has extracted assignment content.',
        questions=questions)
