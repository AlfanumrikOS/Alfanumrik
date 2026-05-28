"""Foxy tutor endpoint – thin wrapper that applies budget guard and returns CBSE‑formatted answer.

POST /v1/foxy-tutor
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ...shared.budget_guard import BudgetExceeded, check_daily_budget
from ...business.foxy.models import FoxyRequest, FoxyResponse
from cbse_parser.generator import generate_answer

router = APIRouter(prefix="/v1", tags=["foxy"])

@router.post(
    "/foxy-tutor",
    response_model=FoxyResponse,
    summary="Generate a CBSE‑style answer for a single question (admin‑only).",
    responses={
        400: {"description": "Bad request – invalid body shape."},
        429: {"description": "Daily AI INR budget cap exceeded."},
        500: {"description": "Internal error – unexpected exception."},
    },
)
async def post_foxy_tutor(request: FoxyRequest) -> FoxyResponse:
    """Validate budget, generate CBSE answer, and return it.

    The endpoint is deliberately simple: it expects a single ``question`` string.
    ``generate_answer`` handles parsing, templating, and keyword underlining.
    """
    # 1. Budget guard – fail fast if cap exceeded.
    if not await check_daily_budget(scope="org"):
        raise BudgetExceeded(
            "daily AI budget exceeded — try again tomorrow"
        )

    try:
        answer = generate_answer(request.question)
    except Exception as exc:  # pragma: no cover – defensive catch
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    return FoxyResponse(answer=answer)
