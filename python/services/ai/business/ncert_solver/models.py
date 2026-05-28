from pydantic import BaseModel
from typing import Optional, List

class NcertSolverRequest(BaseModel):
    question: str
    subject: str
    grade: str
    options: Optional[List[str]] = None
    marks: Optional[int] = None
    chapter: Optional[str] = None
    student_id: Optional[str] = None

class NcertSolverResponse(BaseModel):
    answer: str
    steps: List[str]
    concept: str
    explanation: str
    common_mistake: str = ""
    formula_used: str = ""
    confidence: float
    verified: bool
    verification_issues: List[str]
    solver_type: str
    question_type: str
    marks: int
    trace_id: Optional[str] = None
    citations: Optional[List[dict]] = None
    flow: Optional[str] = None
    abstain_reason: Optional[str] = None
    suggested_alternatives: Optional[List[str]] = None

class ParsedQuestion(BaseModel):
    originalText: str
    type: str
    subject: str
    grade: str
    concepts: List[str]
    marks: int
    expectedDepth: str
    hasNumerical: bool
    hasFormula: bool
    options: List[str]

class RouteInfo(BaseModel):
    solver: str
    requiresVerification: bool
    maxResponseTokens: int
