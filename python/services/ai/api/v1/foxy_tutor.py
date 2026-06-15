"""Foxy tutor endpoint – thin wrapper that applies budget guard and returns CBSE‑formatted answer.

POST /v1/foxy-tutor
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ...business.foxy.models import FoxyRequest, FoxyResponse
from ...shared.budget_guard import BudgetExceeded, check_daily_budget

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
        raise BudgetExceeded("daily AI budget exceeded — try again tomorrow")

    # ``cbse_parser`` is a repo-root package that lives ONE LEVEL ABOVE python/.
    # The Cloud Run image is built with `context: python` and only COPYs
    # `services/`, so cbse_parser is NOT importable inside the container. A
    # module-level import here therefore crashes the FastAPI app at startup
    # (ModuleNotFoundError → container fails its /live startup probe). This
    # endpoint is the LAST, student-facing strangler-fig cutover step
    # (ff_python_foxy_tutor_v1, seeded OFF) and is not yet live, so we import
    # lazily INSIDE the handler: app startup never touches cbse_parser, and a
    # call to this dark endpoint surfaces a clean runtime error instead. Make
    # cbse_parser importable in the image (vendor it / put repo root on
    # PYTHONPATH) before flipping ff_python_foxy_tutor_v1 to ON — see
    # docs/runbooks/2026-06-13-mol-python-cutover.md prerequisites.
    from cbse_parser.generator import generate_answer

    try:
        answer = await generate_answer(request.question)
    except Exception as exc:  # pragma: no cover – defensive catch
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    return FoxyResponse(answer=answer)
