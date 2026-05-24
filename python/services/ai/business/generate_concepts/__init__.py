"""generate-concepts — admin-only batch concept-card generation, ported from TS Edge Function.

Mirrors :file:`supabase/functions/generate-concepts/index.ts`. The TS function
already routes through the MoL framework (Phase 1A migration, 2026-05-24);
this Phase 2 port keeps the public HTTP contract byte-for-byte while moving
the orchestration into the Python service so the entire AI/ML stack
converges on Cloud Run.

Public entrypoints:
    :func:`services.ai.business.generate_concepts.handler.handle_generate_concepts`
    :func:`services.ai.business.generate_concepts.handler.handle_generate_concepts_status`

Internal modules:
    - :mod:`.models`     — request/response Pydantic models
    - :mod:`.auth`       — re-exports ``x-admin-key`` verification from generate_answers
    - :mod:`.normalize`  — grade / subject canonicalization (TS twin)
    - :mod:`.prompts`    — system + user prompt builders (PORTED VERBATIM)
    - :mod:`.generator`  — MoL call (task_type='concept_explanation')
    - :mod:`.validator`  — port of TS parseConceptsResponse (P6 quality gate)
    - :mod:`.repository` — service-role reads / inserts on chapter_concepts
    - :mod:`.ops_events` — telemetry for generate_concepts.* events
    - :mod:`.handler`    — pipeline composition behind the FastAPI route
"""

from .handler import handle_generate_concepts, handle_generate_concepts_status
from .models import (
    GenerateConceptsRequest,
    GenerateConceptsResponse,
    GenerateConceptsStatusResponse,
)

__all__ = [
    "GenerateConceptsRequest",
    "GenerateConceptsResponse",
    "GenerateConceptsStatusResponse",
    "handle_generate_concepts",
    "handle_generate_concepts_status",
]
