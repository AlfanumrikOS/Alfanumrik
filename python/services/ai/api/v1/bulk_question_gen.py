"""``POST /v1/bulk-question-gen`` — admin MCQ generation route.

Thin wrapper around :func:`services.ai.business.bulk_question_gen.handle_bulk_question_gen`.
Responsibilities are intentionally narrow:
  1. Pydantic validation of the body (via :class:`BulkQuestionGenRequest`).
  2. Pull the ``Authorization`` header into a kwarg.
  3. Translate domain exceptions to HTTP status codes.
  4. Bind ``request_id`` into structlog context for the call lifetime.

HTTP contract mirrors the TS Edge Function (same request body, same response
body). The TS Edge proxy forwards requests as-is, so any drift here breaks
the cutover.
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.bulk_question_gen import (
    BulkQuestionGenRequest,
    BulkQuestionGenResponse,
    handle_bulk_question_gen,
)
from ...business.bulk_question_gen.auth import AuthFailed
from ...business.bulk_question_gen.handler import CircuitOpen, HandlerError

router = APIRouter(prefix="/v1", tags=["admin"])
logger = structlog.get_logger(__name__)


@router.post(
    "/bulk-question-gen",
    response_model=BulkQuestionGenResponse,
    summary="Generate CBSE MCQs and insert into question_bank (admin only).",
    responses={
        400: {"description": "Bad request — invalid grade/subject/etc."},
        401: {"description": "Missing or invalid Authorization header."},
        403: {"description": "Caller is not an active admin/super_admin user."},
        500: {"description": "Internal error — DB insert failed or unexpected exception."},
        503: {"description": "AI generation failed OR circuit breaker open."},
    },
)
async def post_bulk_question_gen(
    payload: BulkQuestionGenRequest,
    request: Request,
    authorization: str = Header(
        ..., description="Bearer <supabase user JWT> — must be active admin/super_admin."
    ),
) -> BulkQuestionGenResponse:
    """Generate ``count`` MCQs for a CBSE chapter, oracle-grade, and insert.

    Rate-limit + per-IP throttling is the responsibility of the Edge proxy
    that forwards to this endpoint — the Python service trusts that the
    caller has already been admitted.
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await handle_bulk_question_gen(
            payload,
            authorization_header=authorization,
            request_id=rid,
        )
    except AuthFailed as err:
        raise HTTPException(
            status_code=err.status,
            detail={"code": "AUTH_FAILED", "message": str(err), "request_id": rid},
        ) from err
    except CircuitOpen as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "CIRCUIT_OPEN",
                "message": str(err),
                "request_id": rid,
            },
        ) from err
    except HandlerError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"code": "HANDLER_ERROR", "message": str(err), "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
