"""Supabase IO. Three queries + 1 coin RPC."""

from __future__ import annotations

from typing import Any

import structlog

from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)


class RepositoryError(Exception):
    pass


def _first(result: Any) -> dict[str, Any] | None:
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return None


async def fetch_observation(observation_id: str) -> dict[str, Any] | None:
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    try:
        result = (
            await client.table("experiment_observations")
            .select(
                "id, student_id, conclusion_text, grading_result, " "experiment_id, observed_at"
            )
            .eq("id", observation_id)
            .limit(1)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return None
    return _first(result)


async def already_awarded(observation_id: str) -> bool:
    """Check coin_transactions for prior award."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    try:
        result = (
            await client.table("coin_transactions")
            .select("id")
            .eq("source", "conclusion_quality_bonus")
            .contains("metadata", {"observation_id": observation_id})
            .limit(1)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return False
    return _first(result) is not None


async def persist_grading(observation_id: str, grading_result: dict[str, Any]) -> bool:
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    try:
        await (
            client.table("experiment_observations")
            .update({"grading_result": grading_result})
            .eq("id", observation_id)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return False
    return True


async def award_coins(student_id: str, observation_id: str, amount: int, tier: str) -> bool:
    if amount <= 0:
        return True
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    try:
        await client.rpc(
            "award_coins",
            {
                "p_student_id": student_id,
                "p_amount": amount,
                "p_source": "conclusion_quality_bonus",
                "p_metadata": {"observation_id": observation_id, "tier": tier},
            },
        ).execute()
    except Exception as err:  # noqa: BLE001
        logger.warning("grade_experiment.award_failed", error=str(err))
        return False
    return True
