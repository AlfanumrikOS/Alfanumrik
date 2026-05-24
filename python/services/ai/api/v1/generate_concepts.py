"""``POST /v1/generate-concepts`` + ``GET /v1/generate-concepts`` — admin batch concepts.

Thin wrapper around
:func:`services.ai.business.generate_concepts.handle_generate_concepts` and
:func:`services.ai.business.generate_concepts.handle_generate_concepts_status`.

Responsibilities (mirror the generate-answers route shape):
  1. Pydantic validation of the body (via :class:`GenerateConceptsRequest`).
  2. Pull the ``x-admin-key`` header into a kwarg.
  3. Translate domain exceptions to HTTP status codes.
  4. Bind ``request_id`` into structlog context for the call lifetime.

HTTP contract mirrors the TS Edge Function (same request body, same
response body). The TS Edge proxy forwards requests as-is, so any drift
here breaks the cutover.
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.generate_concepts import (
    GenerateConceptsRequest,
    GenerateConceptsResponse,
    GenerateConceptsStatusResponse,
    handle_generate_concepts,
    handle_generate_concepts_status,
)
from ...business.generate_concepts.auth import AuthFailed
from ...business.generate_concepts.handler import HandlerError
from ...shared.budget_guard import BudgetExceeded

router = APIRouter(prefix="/v1", tags=["admin"])
logger = structlog.get_logger(__name__)


@router.post(
    "/generate-concepts",
    response_model=GenerateConceptsResponse,
    summary="Batch-generate structured concept cards for NCERT chapters (admin only).",
    responses={
        400: {"description": "Bad request — invalid body shape."},
        401: {"description": "Missing or invalid x-admin-key header."},
        429: {"description": "Daily AI INR budget cap exceeded."},
        500: {"description": "Internal error — DB failure or unexpected exception."},
        503: {"description": "ADMIN_API_KEY env var missing — service misconfigured."},
    },
)
async def post_generate_concepts(
    payload: GenerateConceptsRequest,
    request: Request,
    x_admin_key: str | None = Header(
        default=None,
        alias="x-admin-key",
        description="Admin shared-secret. Compared constant-time vs ADMIN_API_KEY env.",
    ),
) -> GenerateConceptsResponse:
    """Run a batch concept-generation cycle.

    Auth: ``x-admin-key`` constant-time match vs ``ADMIN_API_KEY`` env var.

    The handler clamps ``batch_size`` to [1, 15] (default 5), short-circuits
    when no chapters need concepts, and runs sequential per-chapter MoL
    calls until either the batch is done OR ~120s of wall time elapses.
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await handle_generate_concepts(
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
    "/generate-concepts",
    response_model=GenerateConceptsStatusResponse,
    summary="Coverage statistics: how many rag_content_chunks chapters have concepts.",
    responses={
        401: {"description": "Missing or invalid x-admin-key header."},
        500: {"description": "DB error."},
        503: {"description": "ADMIN_API_KEY env var missing — service misconfigured."},
    },
)
async def get_generate_concepts(
    request: Request,
    x_admin_key: str | None = Header(
        default=None,
        alias="x-admin-key",
        description="Admin shared-secret.",
    ),
) -> GenerateConceptsStatusResponse:
    """Status view — concept-coverage statistics across ``rag_content_chunks``."""
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await handle_generate_concepts_status(admin_key_header=x_admin_key)
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
