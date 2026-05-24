"""``POST /v1/generate-answers`` + ``GET /v1/generate-answers`` — admin batch answers.

Thin wrapper around :func:`services.ai.business.generate_answers.handle_generate_answers`
and :func:`services.ai.business.generate_answers.handle_generate_answers_status`.

Responsibilities (mirror the bulk-question-gen route shape):
  1. Pydantic validation of the body (via :class:`GenerateAnswersRequest`).
  2. Pull the ``x-admin-key`` header into a kwarg.
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

from ...business.generate_answers import (
    GenerateAnswersRequest,
    GenerateAnswersResponse,
    GenerateAnswersStatusResponse,
    handle_generate_answers,
)
from ...business.generate_answers.auth import AuthFailed, verify_admin_key
from ...business.generate_answers.handler import (
    HandlerError,
    handle_generate_answers_status,
)
from ...shared.budget_guard import BudgetExceeded

router = APIRouter(prefix="/v1", tags=["admin"])
logger = structlog.get_logger(__name__)


@router.post(
    "/generate-answers",
    response_model=GenerateAnswersResponse,
    summary="Batch-generate CBSE answers for question_bank rows (admin only).",
    responses={
        400: {"description": "Bad request — invalid body shape."},
        401: {"description": "Missing or invalid x-admin-key header."},
        429: {"description": "Daily AI INR budget cap exceeded."},
        500: {"description": "Internal error — DB failure or unexpected exception."},
        503: {"description": "ADMIN_API_KEY env var missing — service misconfigured."},
    },
)
async def post_generate_answers(
    payload: GenerateAnswersRequest,
    request: Request,
    x_admin_key: str | None = Header(
        default=None,
        alias="x-admin-key",
        description="Admin shared-secret. Compared constant-time vs ADMIN_API_KEY env.",
    ),
) -> GenerateAnswersResponse:
    """Run a batch answer-generation cycle.

    Auth: ``x-admin-key`` constant-time match vs ``ADMIN_API_KEY`` env var.

    The handler clamps ``batch_size`` to [1, 50] (default 20), short-circuits
    when no questions need answers, and runs sequential per-question MoL
    calls until either the batch is done OR ~120s of wall time elapses.
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await handle_generate_answers(
            payload,
            admin_key_header=x_admin_key,
            request_id=rid,
        )
    except AuthFailed as err:
        raise HTTPException(
            status_code=err.status,
            detail={"code": "AUTH_FAILED", "message": str(err), "request_id": rid},
        ) from err
    except BudgetExceeded as err:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "BUDGET_EXCEEDED",
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


@router.get(
    "/generate-answers",
    response_model=GenerateAnswersStatusResponse,
    summary="Coverage statistics: how many question_bank rows have answers.",
    responses={
        401: {"description": "Missing or invalid x-admin-key header."},
        500: {"description": "DB error."},
        503: {"description": "ADMIN_API_KEY env var missing — service misconfigured."},
    },
)
async def get_generate_answers(
    request: Request,
    x_admin_key: str | None = Header(
        default=None,
        alias="x-admin-key",
        description="Admin shared-secret.",
    ),
) -> GenerateAnswersStatusResponse:
    """Status view — answer-coverage statistics across ``question_bank``."""
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        verify_admin_key(x_admin_key)
        return await handle_generate_answers_status()
    except AuthFailed as err:
        raise HTTPException(
            status_code=err.status,
            detail={"code": "AUTH_FAILED", "message": str(err), "request_id": rid},
        ) from err
    except HandlerError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"code": "HANDLER_ERROR", "message": str(err), "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
