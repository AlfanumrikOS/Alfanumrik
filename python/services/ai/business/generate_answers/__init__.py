"""generate-answers — admin-only batch answer generation, ported from TS Edge Function.

Mirrors :file:`supabase/functions/generate-answers/index.ts`. The TS function
already routes through the MoL framework (Phase 1A migration); this Phase 2
port keeps the public HTTP contract byte-for-byte while moving the orchestration
into the Python service so the entire AI/ML stack converges on Cloud Run.

Public entrypoint:
    :func:`services.ai.business.generate_answers.handler.handle_generate_answers`

Internal modules:
    - :mod:`.models`     — request/response Pydantic models
    - :mod:`.auth`       — `x-admin-key` constant-time comparison
    - :mod:`.prompts`    — system + user prompt builders (PORTED VERBATIM)
    - :mod:`.generator`  — MoL call (task_type='explanation') with retry+budget
    - :mod:`.validator`  — port of TS parseAnswerResponse + length check
    - :mod:`.repository` — service-role UPDATE on question_bank
    - :mod:`.ops_events` — telemetry for `quiz.answer_generated`
    - :mod:`.handler`    — pipeline composition behind the FastAPI route
"""

from .handler import handle_generate_answers
from .models import (
    GenerateAnswersRequest,
    GenerateAnswersResponse,
    GenerateAnswersStatusResponse,
)

__all__ = [
    "GenerateAnswersRequest",
    "GenerateAnswersResponse",
    "GenerateAnswersStatusResponse",
    "handle_generate_answers",
]
