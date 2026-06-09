"""POST /v1/parent-report-generator - AI-powered weekly parent report."""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.parent_report_generator import (
    GuardianNotLinkedError,
    HandlerError,
    ParentReportRequest,
    ParentReportResponse,
    UnauthorizedError,
    build_parent_report,
)

router = APIRouter(prefix="/v1", tags=["parent"])
logger = structlog.get_logger(__name__)


@router.post(
    "/parent-report-generator",
    response_model=ParentReportResponse,
    summary="Build weekly parent report (template path, no Claude in Phase 2).",
    responses={
        400: {"description": "Bad request."},
        401: {"description": "Missing/invalid Authorization."},
        403: {"description": "Guardian not linked to student."},
        500: {"description": "Internal error."},
        503: {"description": "Service misconfigured."},
    },
)
async def post_parent_report(
    payload: ParentReportRequest,
    request: Request,
    authorization: str | None = Header(default=None),
) -> ParentReportResponse:
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await build_parent_report(
            payload, authorization_header=authorization, request_id=rid
        )
    except UnauthorizedError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except GuardianNotLinkedError as err:
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
        logger.exception("parent_report.route.unexpected", request_id=rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
