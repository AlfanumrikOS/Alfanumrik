"""Student-facing math-verify endpoint (Part 1D — VERIFIER).

``POST /v1/math/verify`` — deterministic SymPy check of a claimed math answer.

Posture mirrors the voice routes:
  - Verify the student JWT via :func:`verify_student` BEFORE reading the body
    (so an unauthenticated caller can't make us SymPy-evaluate arbitrary
    payloads).
  - Bind ``request_id`` into structlog context for the call lifetime.
  - Emit a :class:`VerifyMathError` envelope under ``HTTPException.detail`` for
    AUTH / request-shape failures.

CRITICAL fail-closed contract (P12): a "could not verify" outcome is NOT an
error — it is a 200 with ``is_correct=None``. Only auth (401/403/503) and a
malformed body (422 from Pydantic) produce non-200s. The handler never raises,
so the only 500 path here is a truly unexpected framework error, which the
Next.js client fail-softs to ``is_correct=None`` anyway.

HTTP contract:
    POST /v1/math/verify
    Authorization: Bearer <supabase user JWT>
    Content-Type: application/json
    Body: { problem_expression, claimed_answer,
            kind: 'evaluate'|'solve_equation'|'simplify', grade? }
    Response 200: VerifyMathResponse JSON
    Errors: 401/403/422/500/503
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from .auth import AuthFailed, verify_student
from .handler import verify_math
from .models import VerifyMathRequest, VerifyMathResponse

router = APIRouter(prefix="/v1/math", tags=["math"])
logger = structlog.get_logger(__name__)


@router.post(
    "/verify",
    response_model=VerifyMathResponse,
    summary="Deterministically verify a claimed math answer (SymPy, no LLM).",
    responses={
        401: {"description": "Missing or invalid Authorization header."},
        403: {"description": "Caller is not an active student."},
        422: {"description": "Pydantic validation error on the JSON body."},
        500: {"description": "Unexpected internal error."},
        503: {"description": "Service misconfigured (Supabase key missing)."},
    },
)
async def post_verify(
    request: Request,
    body: VerifyMathRequest,
    authorization: str | None = Header(
        default=None,
        description="Bearer <supabase user JWT> — must be an active student.",
    ),
) -> VerifyMathResponse:
    """Verify ``body.claimed_answer`` against ``body.problem_expression``.

    Pipeline: auth → SymPy handler. The handler NEVER raises; it returns a
    tristate verdict (True / False / None). None = could-not-verify, which is
    a 200 the caller treats as "unavailable, not wrong".
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid, route="math.verify")

    try:
        # 1. Auth — BEFORE the handler so an unauthenticated caller can't make
        #    us SymPy-evaluate arbitrary input. (FastAPI has already parsed the
        #    JSON body to construct `body`; the SymPy work is gated behind this.)
        try:
            await verify_student(authorization)
        except AuthFailed as err:
            raise HTTPException(
                status_code=err.status,
                detail={
                    "error": "AUTH_FAILED",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err

        # 2. Deterministic verification. NEVER raises — tristate verdict.
        try:
            result = verify_math(
                body.problem_expression,
                body.claimed_answer,
                body.kind,
            )
        except HTTPException:
            raise
        except Exception as err:  # noqa: BLE001 — last-line safety net
            # The handler is designed never to raise; if it somehow does, we
            # log the class only (P13) and surface a generic 500. The Next.js
            # client fail-softs a 500 to is_correct=None.
            logger.exception(
                "math.verify_route.unexpected_error",
                error_type=type(err).__name__,
                request_id=rid,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error": "INTERNAL_ERROR",
                    "detail": "Verification failed.",
                    "request_id": rid,
                },
            ) from err

        # P13: log verdict + reason only, never the expressions.
        logger.info(
            "math.verify.result",
            kind=body.kind,
            is_correct=result.is_correct,
            reason=result.reason,
        )
        return result
    finally:
        structlog.contextvars.clear_contextvars()
