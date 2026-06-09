"""grade-experiment-conclusion - Tier 3 R10 experiment-conclusion grader.

Pythonized port of supabase/functions/grade-experiment-conclusion/index.ts.
Phase 2 port covers the data layer + idempotency + coin-award path.
The Claude rubric-scoring (TS lines 250-310) is DEFERRED to Phase 2.5 -
this port uses rule-based scoring as the deterministic fallback (the TS
already has a short-conclusion bypass path that emits tier='weak' without
Claude; our path extends that to all inputs).

Public entrypoint: grade_conclusion
"""

from .handler import (
    GradeConclusionError,
    HandlerError,
    UnauthorizedError,
    grade_conclusion,
)
from .models import (
    GradeConclusionRequest,
    GradeConclusionResponse,
    GradingResult,
    Tier,
)

__all__ = [
    "GradeConclusionError",
    "GradeConclusionRequest",
    "GradeConclusionResponse",
    "GradingResult",
    "HandlerError",
    "Tier",
    "UnauthorizedError",
    "grade_conclusion",
]
