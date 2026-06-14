"""POST /v1/verify-question-bank — cron-triggered verifier (Phase 2 stub)."""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.verify_question_bank import (
    HandlerError,
    UnauthorizedError,
    VerifierCronRequest,
    VerifierCronResponse,
    run_verifier_cron,
)

router = APIRouter(prefix="/v1", tags=["verifier-cron"])
logger = structlog.get_logger(__name__)


@router.post(
    "/verify-question-bank",
    response_model=VerifierCronResponse,
    summary="Verifier cron tick (Phase 2 stub: claim + release; Phase 2.5 wires grounded-answer).",
)
async def post_verify_cron(
    payload: VerifierCronRequest,
    request: Request,
    x_cron_secret: str | None = Header(default=None, alias="x-cron-secret"),
) -> VerifierCronResponse:
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await run_verifier_cron(payload, cron_secret_header=x_cron_secret, request_id=rid)
    except UnauthorizedError as err:
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
        logger.exception("verify_qb.route.unexpected", request_id=rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
