"""POST + GET /v1/extract-ncert-questions - admin batch extractor (Phase 2 stub)."""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.extract_ncert_questions import (
    ExtractionError,
    ExtractRequest,
    ExtractResponse,
    ExtractStatusResponse,
    HandlerError,
    UnauthorizedError,
    run_extraction,
)
from ...business.extract_ncert_questions.handler import get_extraction_status

router = APIRouter(prefix="/v1", tags=["admin"])
logger = structlog.get_logger(__name__)


@router.post(
    "/extract-ncert-questions",
    response_model=ExtractResponse,
    summary="Batch extract questions from NCERT chapters (Phase 2 stub).",
)
async def post_extract(
    payload: ExtractRequest,
    request: Request,
    x_admin_key: str | None = Header(default=None, alias="x-admin-key"),
) -> ExtractResponse:
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await run_extraction(
            payload, admin_key_header=x_admin_key, request_id=rid
        )
    except UnauthorizedError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except ExtractionError as err:
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
        logger.exception("extract_ncert.route.unexpected", request_id=rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()


@router.get(
    "/extract-ncert-questions",
    response_model=ExtractStatusResponse,
    summary="Extraction coverage overview.",
)
async def get_extract_status(
    request: Request,
    x_admin_key: str | None = Header(default=None, alias="x-admin-key"),
) -> ExtractStatusResponse:
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await get_extraction_status(admin_key_header=x_admin_key)
    except UnauthorizedError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except ExtractionError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
