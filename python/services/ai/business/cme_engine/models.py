from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class NextActionRequest(BaseModel):
    subject_id: str

class NextActionResponse(BaseModel):
    type: str
    concept_id: Optional[str]
    title: str
    reason: str
    difficulty: int

class RecordResponseRequest(BaseModel):
    concept_id: str
    question_id: Optional[str] = None
    correct: bool
    difficulty: Optional[int] = 2
    response_time_ms: Optional[int] = 30000
    student_answer: Optional[str] = None
    correct_answer: Optional[str] = None

class RecordResponseResponse(BaseModel):
    mastery: float
    retention: float
    streak: int
    error_type: Optional[str]
    total_attempts: int
    total_correct: int

class ConceptStateRequest(BaseModel):
    subject_id: Optional[str] = None

class ConceptStateItem(BaseModel):
    concept_id: str
    mastery_mean: float
    current_retention: float
    retention_half_life: float
    last_practiced_at: Optional[str]
    total_attempts: int
    total_correct: int
    streak_current: int
    error_count_conceptual: int
    max_difficulty_succeeded: Optional[float] = None

class ConceptStateListResponse(BaseModel):
    data: List[ConceptStateItem]

class RevisionScheduleItem(BaseModel):
    concept_id: str
    title: str
    due_at: str
    priority: float
    revision_type: str

class RevisionScheduleResponse(BaseModel):
    data: List[RevisionScheduleItem]

class ExamReadinessRequest(BaseModel):
    subject_id: str
    exam_type: Optional[str] = "periodic"

class WeakestChapter(BaseModel):
    chapter: str
    score: float

class ExamReadinessResponse(BaseModel):
    overall: float
    predicted_percentage: int
    chapters: Dict[str, float]
    weakest: List[WeakestChapter]
    total_concepts: int
    concepts_mastered: int
