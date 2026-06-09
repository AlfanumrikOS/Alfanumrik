"""Supabase IO. Claim batch via RPC; release on failure / Phase 2 stub-pass."""

from __future__ import annotations

from typing import Any

import structlog

from ...db.supabase import get_service_client
from .scheduling import DEFAULT_CLAIM_TTL_SECONDS

logger = structlog.get_logger(__name__)


class RepositoryError(Exception):
    pass


def _rows(result: Any) -> list[Any]:
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if data is None:
        return []
    return data if isinstance(data, list) else []


async def claim_batch(batch_size: int) -> list[dict[str, Any]]:
    """Atomically claim up to batch_size legacy_unverified rows."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    try:
        result = await client.rpc(
            "claim_verification_batch",
            {
                "p_batch_size": batch_size,
                "p_ttl_seconds": DEFAULT_CLAIM_TTL_SECONDS,
            },
        ).execute()
    except Exception as err:  # noqa: BLE001
        logger.warning("verify_qb.claim_failed", error=str(err))
        return []
    return _rows(result)


async def release_claim(question_id: str, new_state: str = "legacy_unverified") -> None:
    """Release a claimed row back for the next tick (Phase 2 stub default)."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    try:
        await (
            client.table("question_bank")
            .update(
                {
                    "verification_state": new_state,
                    "verification_claimed_at": None,
                    "verification_claim_expires_at": None,
                }
            )
            .eq("id", question_id)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        logger.warning("verify_qb.release_failed", question_id=question_id, error=str(err))


async def get_rpm_last_minute() -> int:
    """Approximate inserts-per-minute on grounded_ai_traces - throttle signal."""
    client = get_service_client()
    if client is None:
        return 0
    try:
        result = await client.rpc("get_grounded_traces_rpm_last_minute", {}).execute()
    except Exception:  # noqa: BLE001
        return 0
    data = getattr(result, "data", None)
    if isinstance(data, int):
        return data
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            for v in first.values():
                if isinstance(v, int):
                    return v
        if isinstance(first, int):
            return first
    return 0
