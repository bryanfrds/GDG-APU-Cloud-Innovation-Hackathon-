
import re
from pathlib import Path

from schemas.questions import QuestionSet, VivaQuestion


def generate_mock_questions(
    submission_id: str,
    filename: str,
    content: str,
) -> QuestionSet:
    """
    Generate five mock viva questions using
    the uploaded assignment's extracted text.

    This is a development-only mock.
    """

    if not content or not content.strip():
        raise ValueError(
            "Cannot generate questions from empty content."
        )

    lines = content.splitlines()

    # Look for meaningful content, excluding PDF page markers.
    candidates = []

    for line_number, raw_line in enumerate(lines, start=1):
        cleaned = raw_line.strip()

        if not cleaned:
            continue

        if re.fullmatch(
            r"[-=\s]*Page\s+\d+[-=\s]*",
            cleaned,
            flags=re.IGNORECASE,
        ):
            continue

        if cleaned.startswith("#") and len(cleaned) < 3:
            continue

        candidates.append((line_number, cleaned))

    if not candidates:
        raise ValueError(
            "No meaningful assignment text found."
        )

    # Select distinct excerpts distributed across the file.
    selected = []

    for index in range(5):
        position = min(
            index * len(candidates) // 5,
            len(candidates) - 1,
        )
        selected.append(candidates[position])

    templates = [
        (
            "easy",
            "Implementation overview",
            "Explain the purpose of this part of your assignment: {excerpt}",
        ),
        (
            "easy",
            "Code or report understanding",
            "What does this section do, and why is it needed: {excerpt}",
        ),
        (
            "medium",
            "Design decisions",
            "Why did you choose the approach shown here: {excerpt}",
        ),
        (
            "medium",
            "Testing and edge cases",
            "What edge case could affect this section, and how would you test it: {excerpt}",
        ),
        (
            "hard",
            "Improvement and evaluation",
            "How would you improve or optimize this part of the assignment: {excerpt}",
        ),
    ]

    is_pdf = Path(filename).suffix.lower() == ".pdf"

    questions = []

    for index, (difficulty, topic, template) in enumerate(
        templates, start=1
    ):
        line_number, excerpt = selected[index - 1]

        # Keep question length manageable.
        excerpt = excerpt[:140]

        question = VivaQuestion(
            id=f"q{index}",
            question=template.format(excerpt=excerpt),
            difficulty=difficulty,
            topic=topic,
            source_file=filename,
            source_lines=[] if is_pdf else [line_number],
            source_pages=[],
            expected_points=[
                "Explain the referenced assignment content accurately.",
                "Justify the implementation or design using evidence.",
            ],
            follow_up_hint=(
                "Ask the student to demonstrate their "
                "understanding with an example."
            ),
        )

        questions.append(question)

    summary_excerpt = " ".join(
        text for _, text in candidates[:3]
    )[:300]

    return QuestionSet(
        submission_id=submission_id,
        status="ready",
        assignment_summary=(
            f"MOCK ANALYSIS — Extracted content from "
            f"{filename}: {summary_excerpt}"
        ),
        questions=questions,
    )
