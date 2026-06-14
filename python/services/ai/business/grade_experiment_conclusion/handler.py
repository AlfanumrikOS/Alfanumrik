"""Pipeline orchestrator for POST /v1/grade-experiment-conclusion.

Six-step pipeline:
  1. Bearer JWT - student auth.
  2. Fetch observation; verify ownership.
  3. Idempotency check (grading_result OR coin_transactions row exists).
  4. Score via rule-based scoring.py (Phase 2.5 will swap to MoL).
  5. Persist grading_result + award coins via award_coins RPC.
  6. Return response.

The Phase 2.5 follow-up will replace the scoring.score_conclusion call with
a MoL routing call (task_type=evaluation, OpenAI gpt-4o-mini primary,
Anthropic Haiku fallback) while preserving the same return shape and
coin-award contract.

P12 - AI safety: this port uses deterministic heuristics; no LLM output
reaches the student or DB.
P13 - data privacy: logs only {observation_id, tier, total, coins, latency}.
NEVER logs the conclusion text.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import structlog

from .auth import AuthFailed, verify_student
from .models import (
    CriterionScore,
    GradeConclusionRequest,
    GradeConclusionResponse,
    GradingResult,
)
from .repository import (
    RepositoryError,
    already_awarded,
    award_coins,
    fetch_observation,
    persist_grading,
)
from .scoring import coin_award_for_tier, score_conclusion

logger = structlog.get_logger(__name__)


class HandlerError(Exception):
    def __init__(self, label: str, *, status: int) -> None:
        super().__init__(label)
        self.label = label
        self.status = status


class UnauthorizedError(HandlerError):
    pass


class GradeConclusionError(HandlerError):
    pass


async def grade_conclusion(
    payload: GradeConclusionRequest,
    *,
    authorization_header: str | None,
    request_id: str | None = None,
) -> GradeConclusionResponse:
    rid = request_id or str(uuid.uuid4())
    started = time.monotonic()
    structlog.contextvars.bind_contextvars(request_id=rid, observation_id=payload.observation_id)
    try:
        try:
            student = await verify_student(authorization_header)
        except AuthFailed as err:
            raise UnauthorizedError(
                err.args[0] if err.args else "unauthorized", status=err.status
            ) from err

        try:
            observation = await fetch_observation(payload.observation_id)
        except RepositoryError as err:
            raise GradeConclusionError("server_misconfigured", status=500) from err
        if observation is None:
            raise GradeConclusionError("observation_not_found", status=404)
        if observation.get("student_id") != student.student_id:
            raise UnauthorizedError("observation_owner_mismatch", status=403)

        # Idempotency: cached grading wins.
        cached_grading = observation.get("grading_result")
        if cached_grading is not None and isinstance(cached_grading, dict):
            return _from_cached(payload.observation_id, cached_grading, coins=0, cached=True)

        # Belt-and-suspenders: previously awarded but row missing grading? still cached.
        try:
            awarded_before = await already_awarded(payload.observation_id)
        except RepositoryError as err:
            raise GradeConclusionError("server_misconfigured", status=500) from err
        if awarded_before:
            # No grading_result yet but coins already paid. Use scoring with zero
            # coin award (idempotency).
            grading_dict = score_conclusion(str(observation.get("conclusion_text") or ""))
            return _from_cached(payload.observation_id, grading_dict, coins=0, cached=True)

        # Fresh grade.
        grading_dict = score_conclusion(str(observation.get("conclusion_text") or ""))
        coins = coin_award_for_tier(grading_dict["tier"])

        await persist_grading(payload.observation_id, grading_dict)
        if coins > 0:
            assert student.student_id is not None
            await award_coins(
                student.student_id,
                payload.observation_id,
                coins,
                grading_dict["tier"],
            )

        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "grade_experiment.success",
            tier=grading_dict["tier"],
            total=grading_dict["total"],
            coins=coins,
            latency_ms=elapsed_ms,
        )

        return _from_cached(payload.observation_id, grading_dict, coins=coins, cached=False)
    finally:
        structlog.contextvars.clear_contextvars()


def _from_cached(
    observation_id: str,
    grading_dict: dict[str, Any],
    *,
    coins: int,
    cached: bool,
) -> GradeConclusionResponse:
    return GradeConclusionResponse(
        observation_id=observation_id,
        grading_result=GradingResult(
            r1_question=CriterionScore(**grading_dict["r1_question"]),
            r2_method=CriterionScore(**grading_dict["r2_method"]),
            r3_evidence=CriterionScore(**grading_dict["r3_evidence"]),
            r4_conclusion=CriterionScore(**grading_dict["r4_conclusion"]),
            total=int(grading_dict["total"]),
            tier=grading_dict["tier"],
            feedback_en=str(grading_dict.get("feedback_en") or ""),
            feedback_hi=str(grading_dict.get("feedback_hi") or ""),
        ),
        coins_awarded=coins,
        cached=cached,
    )
