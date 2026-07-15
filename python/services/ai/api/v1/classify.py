"""``POST /v1/classify`` — Foxy per-turn perception classifier (Phase 1C).

Thin router mirroring :file:`api/v1/generate.py`:
  1. Verify the student JWT (``require_active_student``) and enforce that the
     request's ``student_id`` + ``grade`` match the server-owned profile — a
     verified student can never classify (or charge MOL cost to) another student.
  2. Run the cheap MOL classification (``business.foxy_perception.classify_turn``).
  3. Translate ``MolError`` → HTTP status (same map as /v1/generate) and
     ``ClassificationError`` → 502. Both surface as non-2xx so the Next.js
     client (``callPythonMol``) fail-safes to null → no event published.
  4. Bind ``request_id`` into structlog context for the call lifetime.

The classification is OBSERVABILITY only — it never moves mastery (enforced by
the ``learner.turn_classified`` bus contract on the Node side). P13: the request
carries the turn text (the classifier's evidence) but the response + all logs
are codes / enums / short labels only.
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status

from ...business.foxy_perception import (
    ClassificationError,
    ClassifyTurnRequest,
    TurnClassificationResponse,
    classify_turn,
)
from ...mol.errors import MolError
from ..auth import enforce_student_grade_scope, require_active_student

router = APIRouter(prefix="/v1", tags=["foxy"])
logger = structlog.get_logger(__name__)

# Same MolError.code → HTTP status map as /v1/generate. Kept in sync so both
# endpoints report provider failures identically.
_ERROR_STATUS: dict[str, int] = {
    "INVALID_INPUT": status.HTTP_400_BAD_REQUEST,
    "PROVIDER_CONFIG_MISSING": status.HTTP_503_SERVICE_UNAVAILABLE,
    "NO_PROVIDER_AVAILABLE": status.HTTP_502_BAD_GATEWAY,
    "TIMEOUT": status.HTTP_504_GATEWAY_TIMEOUT,
    "COST_CAP_EXCEEDED": status.HTTP_429_TOO_MANY_REQUESTS,
}


@router.post(
    "/classify",
    response_model=TurnClassificationResponse,
    summary="Classify one Foxy tutoring turn (perception sensor, observability only).",
    responses={
        400: {"description": "INVALID_INPUT / STUDENT_SCOPE_MISMATCH."},
        401: {"description": "Missing or invalid Supabase user JWT."},
        403: {"description": "Caller is not an active student / grade mismatch."},
        429: {"description": "COST_CAP_EXCEEDED — daily / per-student budget hit."},
        502: {"description": "NO_PROVIDER_AVAILABLE or unparseable classification."},
        503: {"description": "PROVIDER_CONFIG_MISSING / auth service unavailable."},
        504: {"description": "TIMEOUT — provider took too long."},
    },
)
async def post_classify(
    req: ClassifyTurnRequest,
    request: Request,
    student: dict[str, object] = Depends(require_active_student),
) -> TurnClassificationResponse:
    """Run one perception classification for an authenticated active student."""
    # Prevent a verified student from classifying / billing another student.
    if req.student_id != student["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "STUDENT_SCOPE_MISMATCH"},
        )
    # Authoritative grade (raises 403 on mismatch, 503 when unknown).
    req.grade = enforce_student_grade_scope(req.grade, student)

    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=request_id, route="foxy.classify")
    try:
        return await classify_turn(
            student_id=req.student_id,
            grade=req.grade,
            subject=req.subject,
            chapter_number=req.chapter_number,
            student_message=req.student_message,
            foxy_answer=req.foxy_answer,
            request_id=request_id,
        )
    except MolError as err:
        http_status = _ERROR_STATUS.get(err.code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        logger.warning("foxy_classify.mol_error", code=err.code)
        raise HTTPException(
            status_code=http_status,
            detail={"code": err.code, "request_id": request_id},
        ) from err
    except ClassificationError as err:
        # Unparseable model output — a "bad classification". Non-2xx so the
        # Node client fail-safes to null (no event). P13: no output echoed.
        logger.warning("foxy_classify.unparseable")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "CLASSIFICATION_UNPARSEABLE", "request_id": request_id},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
