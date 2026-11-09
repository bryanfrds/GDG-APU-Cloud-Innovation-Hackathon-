
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException

from database import get_submission
from file_processor import process_assignment

from question_database import (
    get_question_set,
    save_question_set,
)

from services.gemini import generate_gemini_questions

from schemas.questions import PublicQuestionSet


router = APIRouter(
    prefix="/api/submissions",
    tags=["Viva Questions"],
)

UPLOAD_DIR = (
    Path(__file__).resolve().parent.parent / "uploads"
)


def require_submission(submission_id: str):
    """Verify that the submission exists."""

    submission = get_submission(submission_id)

    if submission is None:
        raise HTTPException(
            status_code=404,
            detail="Submission not found",
        )

    return submission


def to_public_question_set(question_set):
    """
    Return student-facing questions only.

    Do not expose private grading rubrics
    or expected answer points.
    """

    return PublicQuestionSet(
        submission_id=question_set.submission_id,
        status=question_set.status,
        questions=[
            {
                "id": q.id,
                "question": q.question,
                "difficulty": q.difficulty,
                "topic": q.topic,
            }
            for q in question_set.questions
        ],
    )


@router.post("/{submission_id}/generate")
def generate_questions(submission_id: str):

    # 1. Check submission
    submission = require_submission(submission_id)

    # 2. Reuse previously generated questions
    existing = get_question_set(submission_id)

    if existing is not None:
        return {
            "message": "Questions already generated",
            "generator_type": existing["generator_type"],
            "data": to_public_question_set(
                existing["question_set"]
            ),
        }

    # 3. Validate stored filename
    stored_filename = submission["stored_filename"]

    # Accept UUID hex or standard hyphenated UUID
    valid_name = re.fullmatch(
        r"(?:[0-9a-fA-F]{32}|"
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-"
        r"[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
        r"[0-9a-fA-F]{12})"
        r"\.(?:pdf|py|java|cpp|txt)",
        stored_filename,
        flags=re.IGNORECASE,
    )

    if not valid_name:
        raise HTTPException(
            status_code=500,
            detail="Invalid stored filename",
        )

    file_path = UPLOAD_DIR / stored_filename

    if not file_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Uploaded file is missing",
        )

    try:
        # 4. Extract uploaded assignment
        extracted = process_assignment(file_path)

        content = extracted["content"]

        if not content or not content.strip():
            raise HTTPException(
                status_code=422,
                detail="No readable assignment content",
            )

        # 5. Generate REAL Gemini viva questions
        generated = generate_gemini_questions(
            submission_id=submission_id,
            filename=submission["original_filename"],
            content=content,
        )

        # 6. Save questions to SQLite
        save_question_set(
            generated,
            generator_type="gemini",
        )

        # 7. Return student-safe data
        return {
            "message": "Five Gemini AI viva questions generated",
            "generator_type": "gemini",
            "data": to_public_question_set(generated),
        }

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="Assignment or generated questions could not be validated",
        ) from exc

    except RuntimeError as exc:
        # Gemini overload or timeout after fallback
        if "All Gemini models failed" in str(exc):
            raise HTTPException(
                status_code=503,
                detail="Gemini is temporarily unavailable. Try again later.",
            ) from exc

        raise HTTPException(
            status_code=502,
            detail="AI question generation failed",
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Question generation failed",
        ) from exc


@router.get(
    "/{submission_id}/questions",
    response_model=PublicQuestionSet,
)
def retrieve_questions(submission_id: str):

    require_submission(submission_id)

    saved = get_question_set(submission_id)

    if saved is None:
        raise HTTPException(
            status_code=404,
            detail="Questions have not been generated",
        )

    return to_public_question_set(
        saved["question_set"]
    )
