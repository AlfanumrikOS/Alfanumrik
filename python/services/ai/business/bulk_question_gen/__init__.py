"""bulk-question-gen — admin-only MCQ generation, ported from TS Edge Function.

Mirrors :file:`supabase/functions/bulk-question-gen/index.ts` (single-pass path).
Phase 1.2 will port the grounded two-pass path that calls ``grounded-answer``.

Public entrypoint:
    :func:`services.ai.business.bulk_question_gen.handler.handle_bulk_question_gen`

Internal modules:
    - :mod:`.models`     — request/response Pydantic models
    - :mod:`.auth`       — admin JWT + admin_level check
    - :mod:`.validator`  — P6 + P11 candidate validation
    - :mod:`.generator`  — single-pass MCQ generation via MoL
    - :mod:`.oracle`     — direct-Anthropic grader at temp=0
    - :mod:`.repository` — service-role insert into ``question_bank``
    - :mod:`.ops_events` — writes to ``ops_events`` for super-admin dashboards
    - :mod:`.handler`    — composes the above behind the FastAPI route
"""

from .handler import handle_bulk_question_gen
from .models import (
    BulkQuestionGenRequest,
    BulkQuestionGenResponse,
    CandidateQuestion,
    InsertedQuestion,
)

__all__ = [
    "BulkQuestionGenRequest",
    "BulkQuestionGenResponse",
    "CandidateQuestion",
    "InsertedQuestion",
    "handle_bulk_question_gen",
]
