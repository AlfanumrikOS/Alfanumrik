from pydantic import BaseModel


class NextActionRequest(BaseModel):
    subject_id: str


class NextActionResponse(BaseModel):
    type: str
    concept_id: str | None
    title: str
    reason: str
    difficulty: int


class MicroTelemetry(BaseModel):
    latency_ms: int | None = None
    changed_answers_count: int | None = 0
    hints_used: int | None = 0


class RecordResponseRequest(BaseModel):
    concept_id: str
    question_id: str | None = None
    correct: bool
    difficulty: int | None = 2
    response_time_ms: int | None = 30000
    student_answer: str | None = None
    correct_answer: str | None = None
    telemetry: MicroTelemetry | None = None


class RecordResponseResponse(BaseModel):
    mastery: float
    retention: float
    streak: int
    error_type: str | None
    total_attempts: int
    total_correct: int


class ConceptStateRequest(BaseModel):
    subject_id: str | None = None


class ConceptStateItem(BaseModel):
    concept_id: str
    mastery_mean: float
    current_retention: float
    retention_half_life: float
    last_practiced_at: str | None
    total_attempts: int
    total_correct: int
    streak_current: int
    error_count_conceptual: int
    max_difficulty_succeeded: float | None = None


class ConceptStateListResponse(BaseModel):
    data: list[ConceptStateItem]


class RevisionScheduleItem(BaseModel):
    concept_id: str
    title: str
    due_at: str
    priority: float
    revision_type: str


class RevisionScheduleResponse(BaseModel):
    data: list[RevisionScheduleItem]


class ExamReadinessRequest(BaseModel):
    subject_id: str
    exam_type: str | None = "periodic"


class WeakestChapter(BaseModel):
    chapter: str
    score: float


class ExamReadinessResponse(BaseModel):
    overall: float
    predicted_percentage: int
    chapters: dict[str, float]
    weakest: list[WeakestChapter]
    total_concepts: int
    concepts_mastered: int
