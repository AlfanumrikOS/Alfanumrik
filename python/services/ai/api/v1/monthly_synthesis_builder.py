"""POST /v1/monthly-synthesis-builder - cron-callable bundle builder route.

Thin wrapper around services.ai.business.monthly_synthesis_builder.build_synthesis.
Authentication: x-cron-secret header constant-time match vs CRON_SECRET env.

HTTP contract mirrors the TS Edge Function:
  Request body:  { student_id: str, synthesis_month: 'YYYY-MM' }
  Response 200:  { id: str | null, alreadyExists: bool, bundle: SynthesisBundle }
  Errors:        { error: '<label>', request_id: '<uuid>' }

Error labels are preserved from the TS path so the Edge proxy + Next.js
consumer can branch on them without parsing free text.
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.monthly_synthesis_builder import (
    BuildResponse,
    BuildSynthesisRequest,
    BundleBuildError,
    HandlerError,
    UnauthorizedError,
    build_synthesis,
)

router = APIRouter(prefix="/v1", tags=["pedagogy-v2"])
logger = structlog.get_logger(__name__)


@router.post(
    "/monthly-synthesis-builder",
    response_model=BuildResponse,
    summary="Build the monthly synthesis bundle for a student (cron-only).",
    responses={
        400: {"description": "Bad request - invalid body shape."},
        401: {"description": "Missing or invalid x-cron-secret header."},
        500: {"description": "Internal error - DB failure or unexpected exception."},
        503: {"description": "CRON_SECRET env var missing - service misconfigured."},
    },
)
async def post_monthly_synthesis_builder(
    payload: BuildSynthesisRequest,
    request: Request,
    x_cron_secret: str | None = Header(
        default=None,
        alias="x-cron-secret",
        description="Cron shared-secret. Compared constant-time vs CRON_SECRET env.",
    ),
) -> BuildResponse:
    """Build (or idempotently re-return) the monthly synthesis bundle.

    Mirrors the TS Edge Function behavior verbatim - same auth, same body,
    same response shape, same error labels.
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await build_synthesis(
            payload,
            cron_secret_header=x_cron_secret,
            request_id=rid,
        )
    except UnauthorizedError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except BundleBuildError as err:
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
    except Exception as err:
        logger.exception("monthly_synthesis.route.unexpected_error", request_id=rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
