from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

Difficulty = Literal['easy', 'medium', 'hard']


class VivaQuestion(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=2, max_length=40)
    question: str = Field(min_length=10, max_length=400)
    difficulty: Difficulty
    topic: str = Field(min_length=1, max_length=300)
    source_file: str
    source_lines: list[int] = Field(default_factory=list)
    source_pages: list[int] = Field(default_factory=list)
    expected_points: list[str] = Field(min_length=1)
    follow_up_hint: str


class QuestionSet(BaseModel):
    model_config = ConfigDict(extra='forbid')
    submission_id: str
    status: Literal['ready'] = 'ready'
    assignment_summary: str = Field(min_length=10)
    questions: list[VivaQuestion] = Field(min_length=5, max_length=5)


class PublicVivaQuestion(BaseModel):
    id: str
    question: str
    difficulty: Difficulty
    topic: str


class PublicQuestionSet(BaseModel):
    submission_id: str
    status: Literal['ready'] = 'ready'
    questions: list[PublicVivaQuestion]
