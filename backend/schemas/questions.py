
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


Difficulty = Literal["easy", "medium", "hard"]


class VivaQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    question: str = Field(min_length=10)
    difficulty: Difficulty
    topic: str
    source_file: str
    source_lines: list[int] = Field(default_factory=list)
    source_pages: list[int] = Field(default_factory=list)

    # Private grading data
    expected_points: list[str] = Field(min_length=1)
    follow_up_hint: str


class QuestionSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_id: str
    status: Literal["ready"] = "ready"
    assignment_summary: str = Field(min_length=10)
    questions: list[VivaQuestion] = Field(
        min_length=5,
        max_length=5
    )


# Public schema for the student-facing API.
# Expected points and grading hints remain private.
class PublicVivaQuestion(BaseModel):
    id: str
    question: str
    difficulty: Difficulty
    topic: str


class PublicQuestionSet(BaseModel):
    submission_id: str
    status: Literal["ready"] = "ready"
    questions: list[PublicVivaQuestion]
