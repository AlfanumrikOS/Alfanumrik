from pydantic import BaseModel


class NcertSolverRequest(BaseModel):
    question: str
    subject: str
    grade: str
    options: list[str] | None = None
    marks: int | None = None
    chapter: str | None = None
    student_id: str | None = None


class NcertSolverResponse(BaseModel):
    answer: str
    steps: list[str]
    concept: str
    explanation: str
    common_mistake: str = ""
    formula_used: str = ""
    confidence: float
    verified: bool
    verification_issues: list[str]
    solver_type: str
    question_type: str
    marks: int
    trace_id: str | None = None
    citations: list[dict] | None = None
    flow: str | None = None
    abstain_reason: str | None = None
    suggested_alternatives: list[str] | None = None


class ParsedQuestion(BaseModel):
    originalText: str
    type: str
    subject: str
    grade: str
    concepts: list[str]
    marks: int
    expectedDepth: str
    hasNumerical: bool
    hasFormula: bool
    options: list[str]


class RouteInfo(BaseModel):
    solver: str
    requiresVerification: bool
    maxResponseTokens: int
