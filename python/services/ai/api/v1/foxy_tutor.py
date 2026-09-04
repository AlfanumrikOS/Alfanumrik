"""Foxy tutor endpoint – thin wrapper that applies budget guard and returns CBSE‑formatted answer.

POST /v1/foxy-tutor
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ...business.foxy.models import FoxyRequest, FoxyResponse
from ...shared.budget_guard import BudgetExceeded, check_daily_budget
from ..auth import require_active_student

router = APIRouter(prefix="/v1", tags=["foxy"])


@router.post(
    "/foxy-tutor",
    response_model=FoxyResponse,
    summary="Generate a CBSE-style answer for an authenticated active student.",
    responses={
        400: {"description": "Bad request – invalid body shape."},
        401: {"description": "Missing or invalid Supabase user JWT."},
        403: {"description": "Caller is not an active student."},
        429: {"description": "Daily AI INR budget cap exceeded."},
        500: {"description": "Internal error – unexpected exception."},
        503: {"description": "Authentication or database service unavailable."},
    },
)
async def post_foxy_tutor(
    request: FoxyRequest,
    _student: dict[str, object] = Depends(require_active_student),
) -> FoxyResponse:
    """Validate budget, generate CBSE answer, and return it.

    The endpoint is deliberately simple: it expects a single ``question`` string.
    ``generate_answer`` handles parsing, templating, and keyword underlining.
    """
    # 1. Budget guard – fail fast if cap exceeded.
    if not await check_daily_budget(scope="org"):
        raise BudgetExceeded("daily AI budget exceeded — try again tomorrow")

    # ``cbse_parser`` is a repo-root package; the Cloud Run image is built
    # with `context: python`, which can't reach a path outside that context
    # by COPY. Fixed 2026-09-04 (P2-13) by vendoring a copy into
    # python/cbse_parser/ (see its README.md) and adding it to
    # python/Dockerfile's COPY step — a CI job
    # (container-import-smoke in .github/workflows/python-ai-deploy.yml)
    # now builds the real image on every PR and imports this module inside
    # it directly, so a regression here fails CI. The import stays lazy
    # (inside the handler, not at module level) on its own merits: this
    # endpoint is the LAST, student-facing strangler-fig cutover step
    # (ff_python_foxy_tutor_v1, seeded OFF) and is not yet live, so keeping
    # app startup independent of this import means a problem here still
    # surfaces as a clean runtime error on this one dark endpoint rather
    # than failing the whole app's /live probe. See
    # docs/runbooks/2026-06-13-mol-python-cutover.md.
    from cbse_parser.generator import generate_answer

    try:
        answer = await generate_answer(request.question)
    except Exception as exc:  # pragma: no cover – defensive catch
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    return FoxyResponse(answer=answer)
