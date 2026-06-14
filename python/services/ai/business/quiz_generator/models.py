from typing import Any, Literal

from pydantic import BaseModel


class ResponseSoFar(BaseModel):
    question_id: str
    is_correct: bool
    time_spent: float


class QuizGeneratorRequest(BaseModel):
    action: Literal["generate", "next_question"] | None = "generate"
    student_id: str
    subject: str
    grade: str
    count: int | None = 10
    difficulty: int | None = None
    chapter_number: int | None = None
    ability_estimate: float | None = None

    # For next_question
    session_id: str | None = None
    responses_so_far: list[ResponseSoFar] | None = None
    exclude_ids: list[str] | None = None


class QuestionRow(BaseModel):
    id: str
    question_text: str
    question_hi: str | None = None
    question_type: str
    options: str | list[str]
    correct_answer_index: int
    explanation: str | None = None
    explanation_hi: str | None = None
    hint: str | None = None
    difficulty: int
    bloom_level: str
    chapter_number: int
    topic: str | None = None
    concept_tag: str | None = None
    subject: str | None = None
    source: str | None = None


class QuizGeneratorMeta(BaseModel):
    strategy: str | None = None
    weak_topics_targeted: int | None = None
    total_returned: int | None = None
    bloom_distribution: dict[str, int] | None = None
    review_count: int | None = None
    adaptive_count: int | None = None
    random_count: int | None = None
    review_topic_count: int | None = None
    review_question_ids: list[str] | None = None
    dropped_by_p6_validator: int | None = None
    dropped_reasons: list[str] | None = None

    # Next question specific metadata
    adjusted_difficulty: int | None = None
    reason: str | None = None
    running_score: str | None = None
    bloom_ceiling: str | None = None


class QuizGeneratorResponse(BaseModel):
    questions: list[dict[str, Any]] | None = None  # Can be dict or QuestionRow dict
    question: dict[str, Any] | None = None  # For next_question
    meta: QuizGeneratorMeta
