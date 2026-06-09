"""extract-ncert-questions - admin batch extractor (Phase 2 stub port).

Pythonized port of supabase/functions/extract-ncert-questions/index.ts.
Phase 2 covers the auth + chapter selection + repository scaffolding.
The actual MoL extraction call (TS lines 250-380) is STUBBED in this port -
each chapter is marked extraction_pending without inserting questions.
Phase 2.5 will wire MoL routing (task_type='quiz_generation', OpenAI
gpt-4o-mini primary, Anthropic Haiku fallback) for the actual extraction.

Public entrypoint: run_extraction
"""

from .handler import (
    ExtractionError,
    HandlerError,
    UnauthorizedError,
    run_extraction,
)
from .models import (
    ExtractRequest,
    ExtractResponse,
    ExtractStatusResponse,
)

__all__ = [
    "ExtractRequest",
    "ExtractResponse",
    "ExtractStatusResponse",
    "ExtractionError",
    "HandlerError",
    "UnauthorizedError",
    "run_extraction",
]
