"""monthly-synthesis-builder — Pedagogy v2 Wave 3 cron-callable bundle builder.

Pythonized port of :file:`supabase/functions/monthly-synthesis-builder/index.ts`.
Builds the structured ``SynthesisBundle`` for a ``(student_id, synthesis_month)``
tuple and inserts a row into ``monthly_synthesis_runs``. The bilingual
parent-share summary is intentionally left empty at insert time — Task 5's
``/api/synthesis/state`` lazy-fills via Claude on first view, so this port
contains no LLM call.

Public entrypoint: :func:`build_synthesis`
"""

from .handler import (
    BundleBuildError,
    HandlerError,
    UnauthorizedError,
    build_synthesis,
)
from .models import (
    BuildResponse,
    BuildSynthesisRequest,
    ChapterMockSummary,
    MasteryDelta,
    SynthesisBundle,
)

__all__ = [
    "BuildResponse",
    "BuildSynthesisRequest",
    "BundleBuildError",
    "ChapterMockSummary",
    "HandlerError",
    "MasteryDelta",
    "SynthesisBundle",
    "UnauthorizedError",
    "build_synthesis",
]
