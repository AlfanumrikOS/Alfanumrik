"""POST /v1/nep-compliance - NEP 2020 HPC route.

Thin wrapper around services.ai.business.nep_compliance.handle_nep_compliance.
Auth: verified Supabase user JWT resolved to an active student. The request's
``student_id`` is ignored for authorization; data is scoped to the JWT owner.

HTTP contract mirrors the TS Edge Function:
  Body:      { action: 'generate_hpc'|'get_hpc', student_id: str }
  Response:  { success: bool, report?: HPCReport, error?: str }
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status

from ...business.nep_compliance import (
    HandlerError,
    NepComplianceRequest,
    NepComplianceResponse,
    StudentNotFoundError,
    handle_nep_compliance,
)
from ..auth import require_active_student

router = APIRouter(prefix="/v1", tags=["nep-compliance"])
logger = structlog.get_logger(__name__)


@router.post(
    "/nep-compliance",
    response_model=NepComplianceResponse,
    summary="Generate/retrieve NEP 2020 HPC.",
    responses={
        400: {"description": "Bad request."},
        401: {"description": "Missing or invalid Supabase user JWT."},
        403: {"description": "Caller is not an active student."},
        404: {"description": "Student not found."},
        500: {"description": "Internal error."},
        503: {"description": "Authentication or database service unavailable."},
    },
)
async def post_nep_compliance(
    payload: NepComplianceRequest,
    request: Request,
    student: dict[str, object] = Depends(require_active_student),
) -> NepComplianceResponse:
    """Return only the authenticated active student's HPC data."""
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await handle_nep_compliance(
            payload,
            authenticated_student_id=str(student["id"]),
            request_id=rid,
        )
    except StudentNotFoundError as err:
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
        logger.exception("nep_compliance.route.unexpected", request_id=rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
