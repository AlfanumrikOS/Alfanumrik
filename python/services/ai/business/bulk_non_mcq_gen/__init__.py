"""bulk-non-mcq-gen - admin batch non-MCQ generator (Phase 2 stub port).

Pythonized port of supabase/functions/bulk-non-mcq-gen/index.ts. Phase 2 covers
the auth + request validation + scaffolding. The actual MoL generation call
(task_type='quiz_generation' with the Sonnet oracle grader gate) is STUBBED.
Phase 2.5 will wire MoL routing + the oracle grader bypass pattern (REG-71).

Public entrypoint: run_bulk_non_mcq_gen
"""

from .handler import (
    BulkGenError,
    HandlerError,
    UnauthorizedError,
    run_bulk_non_mcq_gen,
)
from .models import BulkGenRequest, BulkGenResponse

__all__ = [
    "BulkGenError",
    "BulkGenRequest",
    "BulkGenResponse",
    "HandlerError",
    "UnauthorizedError",
    "run_bulk_non_mcq_gen",
]
