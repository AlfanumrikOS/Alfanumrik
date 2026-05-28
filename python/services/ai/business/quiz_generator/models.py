from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any, Union

class ResponseSoFar(BaseModel):
    question_id: str
    is_correct: bool
    time_spent: float

class QuizGeneratorRequest(BaseModel):
    action: Optional[Literal['generate', 'next_question']] = 'generate'
    student_id: str
    subject: str
    grade: str
    count: Optional[int] = 10
    difficulty: Optional[int] = None
    chapter_number: Optional[int] = None
    ability_estimate: Optional[float] = None
    
    # For next_question
    session_id: Optional[str] = None
    responses_so_far: Optional[List[ResponseSoFar]] = None
    exclude_ids: Optional[List[str]] = None

class QuestionRow(BaseModel):
    id: str
    question_text: str
    question_hi: Optional[str] = None
    question_type: str
    options: Union[str, List[str]]
    correct_answer_index: int
    explanation: Optional[str] = None
    explanation_hi: Optional[str] = None
    hint: Optional[str] = None
    difficulty: int
    bloom_level: str
    chapter_number: int
    topic: Optional[str] = None
    concept_tag: Optional[str] = None
    subject: Optional[str] = None
    source: Optional[str] = None

class QuizGeneratorMeta(BaseModel):
    strategy: Optional[str] = None
    weak_topics_targeted: Optional[int] = None
    total_returned: Optional[int] = None
    bloom_distribution: Optional[Dict[str, int]] = None
    review_count: Optional[int] = None
    adaptive_count: Optional[int] = None
    random_count: Optional[int] = None
    review_topic_count: Optional[int] = None
    review_question_ids: Optional[List[str]] = None
    dropped_by_p6_validator: Optional[int] = None
    dropped_reasons: Optional[List[str]] = None
    
    # Next question specific metadata
    adjusted_difficulty: Optional[int] = None
    reason: Optional[str] = None
    running_score: Optional[str] = None
    bloom_ceiling: Optional[str] = None

class QuizGeneratorResponse(BaseModel):
    questions: Optional[List[Dict[str, Any]]] = None # Can be dict or QuestionRow dict
    question: Optional[Dict[str, Any]] = None # For next_question
    meta: QuizGeneratorMeta
