"""Per-task ₹ cost-cap enforcement — A4.

Hard ceiling on the estimated INR cost of a single MoL call, checked BEFORE any
provider HTTP request fires. Gated at the call site behind the
``ff_mol_cost_cap_v1`` feature flag (default OFF).

Estimation is deliberately a *conservative worst-case*: we assume the model will
emit ``max_tokens`` of completion (the cap the orchestrator will actually pass to
the provider) on top of the estimated prompt size. A real call almost always
costs less, so the cap only ever trips on genuinely expensive requests — never a
false-positive on a normal one.

An unpriced model returns ``0.0`` from :func:`services.ai.mol.cost.compute_cost`
(it warns and falls back to zero rather than break the request). A ``0.0``
estimate can never exceed a positive ceiling, so an unpriced model NEVER trips
the cap — failing open, consistent with the rest of the MoL safety posture.

The ceilings below are LAUNCH DEFAULTS. They are intentionally generous (a single
call should never approach them under normal token budgets) and are meant to be
tuned by ops once production cost telemetry accumulates. They live in code (not a
table) for Phase 3; a future phase may move them to ``mol_routing_weights``-style
config if ops needs runtime tuning without a deploy.
"""

from __future__ import annotations

import structlog

from .cost import compute_cost
from .errors import MolError
from .types import TaskType

logger = structlog.get_logger(__name__)

# Launch-default per-task INR ceilings. One entry for EVERY TaskType (the unit
# test asserts completeness via ``typing.get_args(TaskType)``). Tunable by ops.
PER_TASK_INR_CEILING: dict[TaskType, float] = {
    "explanation": 5.0,
    "concept_explanation": 5.0,
    "step_by_step": 7.0,
    "reasoning": 25.0,
    "quiz_generation": 12.0,
    "evaluation": 2.0,
    "doubt_solving": 30.0,
    "ocr_extraction": 15.0,
    "grounding_check": 2.0,
}


def estimate_inr(
    provider: str,
    model: str,
    *,
    prompt_tokens: int,
    max_tokens: int,
) -> float:
    """Conservative worst-case INR estimate for a single provider call.

    Treats ``max_tokens`` as the completion-token count (the model is permitted
    to emit up to that many). Returns ``0.0`` for an unpriced model (see
    :func:`services.ai.mol.cost.compute_cost`), which by construction never
    trips a positive ceiling.
    """
    _usd, inr = compute_cost(provider, model, prompt_tokens, max_tokens)
    return inr


def enforce_cost_cap(
    *,
    task_type: TaskType,
    provider: str,
    model: str,
    prompt_tokens: int,
    max_tokens: int,
) -> None:
    """Raise ``MolError("COST_CAP_EXCEEDED")`` when the worst-case estimate
    exceeds the per-task ceiling. No-op otherwise.

    Returns early (no raise) when the task type has no configured ceiling, so a
    task we forgot to budget for can never be blocked by an absent entry.
    """
    ceiling = PER_TASK_INR_CEILING.get(task_type)
    if ceiling is None:
        return

    estimated_inr = estimate_inr(
        provider, model, prompt_tokens=prompt_tokens, max_tokens=max_tokens
    )

    if estimated_inr > ceiling:
        logger.warning(
            "mol.cost_cap.exceeded",
            task_type=task_type,
            provider=provider,
            model=model,
            estimated_inr=estimated_inr,
            ceiling_inr=ceiling,
            prompt_tokens=prompt_tokens,
            max_tokens=max_tokens,
        )
        raise MolError(
            "COST_CAP_EXCEEDED",
            (
                f"Estimated cost ₹{estimated_inr:.4f} exceeds the per-task "
                f"ceiling ₹{ceiling:.2f} for task_type={task_type!r}."
            ),
            details={
                "estimated_inr": estimated_inr,
                "ceiling_inr": ceiling,
                "task_type": task_type,
            },
        )
