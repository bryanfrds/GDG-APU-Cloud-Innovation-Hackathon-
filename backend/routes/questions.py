"""Generate and retrieve AI viva questions and a Next-compatible viva plan."""
import re
from fastapi import APIRouter, Depends, HTTPException

from config import upload_dir
from database import get_submission, set_submission_status
from file_processor import ProcessingError, process_assignment
from question_database import get_question_set, save_question_set
from schemas.questions import PublicQuestionSet
from security import one_line, protect_generate, protect_read
from services.gemini import GeminiUnavailableError, generate_gemini_questions

router = APIRouter(prefix='/api/submissions', tags=['Viva Questions'])
SAFE_STORED = re.compile(r'^[0-9a-fA-F]{32}\.(?:pdf|py|java|cpp|txt)$', re.I)


def require_submission(submission_id: str):
    submission = get_submission(submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail='Submission not found')
    return submission


def to_public_question_set(question_set):
    return PublicQuestionSet(
        submission_id=question_set.submission_id, status=question_set.status,
        questions=[{'id': q.id, 'question': q.question,
                    'difficulty': q.difficulty, 'topic': q.topic}
                   for q in question_set.questions],
    )


def to_viva_plan(submission, question_set):
    """4 progressive questions, compatible with lib/viva/plan.ts parsePlan()."""
    try:
        title = one_line(submission['title'], 120, 'Assignment title')
        # Keep two easy, one medium and one hard question.
        selected = [question_set.questions[i] for i in (0, 1, 2, 4)]
        questions = []
        for q in selected:
            text = one_line(q.question, 400, 'Question text')
            focus = one_line(q.topic, 300, 'Question focus')
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', q.id):
                raise ValueError('Invalid question id')
            questions.append({'id': q.id, 'text': text, 'focus': focus})
        return {'assignmentTitle': title, 'questions': questions}
    except (ValueError, IndexError) as error:
        raise HTTPException(status_code=422, detail='Saved questions are not viva-compatible') from error


@router.post('/{submission_id}/generate', dependencies=[Depends(protect_generate)])
def generate_questions(submission_id: str):
    submission = require_submission(submission_id)
    existing = get_question_set(submission_id)
    if existing:
        return {'message': 'Questions already generated',
                'generator_type': existing['generator_type'],
                'data': to_public_question_set(existing['question_set'])}

    stored_filename = submission['stored_filename']
    if not SAFE_STORED.fullmatch(stored_filename):
        raise HTTPException(status_code=500, detail='Invalid stored filename')
    file_path = upload_dir() / stored_filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail='Uploaded file is missing')
    try:
        extracted = process_assignment(file_path)
        set_submission_status(submission_id, 'processing')
        generated = generate_gemini_questions(
            submission_id=submission_id,
            filename=submission['original_filename'], content=extracted['content'],
        )
        save_question_set(generated, generator_type='gemini')
        set_submission_status(submission_id, 'ready')
        return {'message': 'Five Gemini AI viva questions generated',
                'generator_type': 'gemini',
                'data': to_public_question_set(generated)}
    except ProcessingError as error:
        set_submission_status(submission_id, 'failed')
        raise HTTPException(status_code=422, detail=str(error)) from error
    except GeminiUnavailableError as error:
        set_submission_status(submission_id, 'failed')
        raise HTTPException(status_code=error.status, detail='Gemini temporarily unavailable') from error
    except ValueError as error:
        set_submission_status(submission_id, 'failed')
        raise HTTPException(status_code=422, detail='Generated questions failed validation') from error
    except Exception:
        set_submission_status(submission_id, 'failed')
        raise HTTPException(status_code=502, detail='AI question generation failed')


@router.get('/{submission_id}/questions', response_model=PublicQuestionSet,
            dependencies=[Depends(protect_read)])
def retrieve_questions(submission_id: str):
    require_submission(submission_id)
    saved = get_question_set(submission_id)
    if saved is None:
        raise HTTPException(status_code=404, detail='Questions have not been generated')
    return to_public_question_set(saved['question_set'])


@router.get('/{submission_id}/viva-plan', dependencies=[Depends(protect_read)])
def retrieve_viva_plan(submission_id: str):
    submission = require_submission(submission_id)
    saved = get_question_set(submission_id)
    if saved is None:
        raise HTTPException(status_code=404, detail='Questions have not been generated')
    return to_viva_plan(submission, saved['question_set'])
