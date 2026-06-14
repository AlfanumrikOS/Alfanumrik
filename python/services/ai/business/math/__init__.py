"""math — student-facing deterministic math verifier (Part 1D — VERIFIER).

Part 1D of the Foxy 3-Agent Math Pipeline (Classifier → Solver → Verifier).
The verifier is a SymPy-backed check that runs server-side, NO LLM: given the
originating problem expression and the answer Foxy's solver claimed, it
independently computes a canonical result and returns a fail-closed tristate
verdict (True / False / None).

Public entrypoint:
    :func:`services.ai.business.math.handler.verify_math`

Route:
    :data:`services.ai.business.math.router.router` — ``POST /v1/math/verify``

Internal modules:
    - :mod:`.models`   — VerifyMathRequest / VerifyMathResponse / VerifyMathError.
    - :mod:`.auth`     — re-exports the voice student-JWT verifier (same posture).
    - :mod:`.handler`  — the SymPy verification logic (never raises).
    - :mod:`.router`   — the FastAPI route (auth BEFORE body read).

Gated end-to-end by ``ff_foxy_math_pipeline_v1`` on the Next.js side; when the
flag is OFF the route is simply never called, so this package is inert.
"""

from .handler import verify_math
from .models import (
    VerifyKind,
    VerifyMathError,
    VerifyMathRequest,
    VerifyMathResponse,
)

__all__ = [
    "VerifyKind",
    "VerifyMathError",
    "VerifyMathRequest",
    "VerifyMathResponse",
    "verify_math",
]
