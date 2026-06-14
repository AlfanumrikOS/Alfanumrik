"""POST /v1/bulk-non-mcq-gen - admin batch non-MCQ generator (Phase 2 stub)."""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.bulk_non_mcq_gen import (
    BulkGenError,
    BulkGenRequest,
    BulkGenResponse,
    HandlerError,
    UnauthorizedError,
    run_bulk_non_mcq_gen,
)

router = APIRouter(prefix="/v1", tags=["admin"])
logger = structlog.get_logger(__name__)


@router.post(
    "/bulk-non-mcq-gen",
    response_model=BulkGenResponse,
    summary="Batch generate non-MCQ questions (Phase 2 stub).",
)
async def post_bulk_non_mcq(
    payload: BulkGenRequest,
    request: Request,
    x_admin_key: str | None = Header(default=None, alias="x-admin-key"),
) -> BulkGenResponse:
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await run_bulk_non_mcq_gen(payload, admin_key_header=x_admin_key, request_id=rid)
    except UnauthorizedError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except BulkGenError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except HandlerError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except HTTPException:
        raise
    except Exception as err:  # noqa: BLE001
        logger.exception("bulk_non_mcq.route.unexpected", request_id=rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
