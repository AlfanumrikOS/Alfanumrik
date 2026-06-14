"""POST /v1/grade-experiment-conclusion."""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from ...business.grade_experiment_conclusion import (
    GradeConclusionError,
    GradeConclusionRequest,
    GradeConclusionResponse,
    HandlerError,
    UnauthorizedError,
    grade_conclusion,
)

router = APIRouter(prefix="/v1", tags=["experiment"])
logger = structlog.get_logger(__name__)


@router.post(
    "/grade-experiment-conclusion",
    response_model=GradeConclusionResponse,
    summary="Grade a guided-experiment conclusion (Phase 2: rule-based; Phase 2.5: MoL).",
)
async def post_grade(
    payload: GradeConclusionRequest,
    request: Request,
    authorization: str | None = Header(default=None),
) -> GradeConclusionResponse:
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        return await grade_conclusion(payload, authorization_header=authorization, request_id=rid)
    except UnauthorizedError as err:
        raise HTTPException(
            status_code=err.status,
            detail={"error": err.label, "request_id": rid},
        ) from err
    except GradeConclusionError as err:
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
        logger.exception("grade_experiment.route.unexpected", request_id=rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "request_id": rid},
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()
