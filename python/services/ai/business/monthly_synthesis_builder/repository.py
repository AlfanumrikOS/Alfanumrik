"""Supabase IO for the monthly-synthesis-builder.

All reads use range filters scoped to ``[start_iso, end_iso)`` month
intervals. All writes target ``monthly_synthesis_runs`` and rely on its
UNIQUE(student_id, synthesis_month) constraint for idempotency.

Functions surface ``(value, error_message)`` tuples so the handler can
return the TS-shaped error envelope without exception leakage. Only the
"client misconfigured" case raises :class:`RepositoryError`.
"""

from __future__ import annotations

from typing import Any

import structlog

from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)


class RepositoryError(Exception):
    """Raised when the Supabase client is misconfigured (fail-CLOSED 500)."""


def _rows(result: Any) -> list[Any]:
    """Extract a list of row dicts from a postgrest result object."""
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if data is None:
        return []
    return data if isinstance(data, list) else []


async def fetch_existing_run(
    student_id: str, synthesis_month: str
) -> tuple[dict[str, Any] | None, str | None]:
    """Look up an existing ``monthly_synthesis_runs`` row."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("monthly_synthesis_runs")
            .select("id, bundle")
            .eq("student_id", student_id)
            .eq("synthesis_month", synthesis_month)
            .limit(1)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return None, f"existing_check_failed: {err}"
    rows = _rows(result)
    return (rows[0] if rows else None), None


async def fetch_dive_artifact_ids(
    student_id: str, start_iso: str, end_iso: str
) -> tuple[list[str], str | None]:
    """List ``dive_artifacts.id`` for the student in the month interval."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("dive_artifacts")
            .select("id, iso_week")
            .eq("student_id", student_id)
            .gte("created_at", start_iso)
            .lt("created_at", end_iso)
            .order("iso_week", desc=False)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return [], f"artifact_fetch_failed: {err}"
    ids = [r["id"] for r in _rows(result) if isinstance(r.get("id"), str)]
    return ids, None


async def fetch_concept_mastery_rows(
    student_id: str, start_iso: str, end_iso: str
) -> tuple[list[dict[str, Any]], str | None]:
    """List ``concept_mastery`` rows touched in the month interval."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("concept_mastery")
            .select("topic_id, mastery_probability, mastery_level, total_attempts, last_attempted_at")
            .eq("student_id", student_id)
            .gte("last_attempted_at", start_iso)
            .lt("last_attempted_at", end_iso)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return [], f"mastery_fetch_failed: {err}"
    return _rows(result), None


async def fetch_curriculum_topics(
    topic_ids: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    """Resolve ``curriculum_topics.title`` for the given topic ids."""
    if not topic_ids:
        return [], None
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("curriculum_topics")
            .select("id, title, chapter_number")
            .in_("id", topic_ids)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return [], f"topic_fetch_failed: {err}"
    return _rows(result), None


async def insert_synthesis_run(
    student_id: str, synthesis_month: str, bundle: dict[str, Any]
) -> tuple[dict[str, Any] | None, str | None, bool]:
    """Insert a new ``monthly_synthesis_runs`` row.

    Returns ``(row, None, raced=False)`` on success.
    On 23505 unique_violation (raced), returns ``(None, None, raced=True)``.
    Other errors return ``(None, error_message, False)``.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    payload = {
        "student_id": student_id,
        "synthesis_month": synthesis_month,
        "bundle": bundle,
        "summary_text_en": "",
        "summary_text_hi": "",
        "parent_share_status": "pending",
    }
    try:
        result = (
            await client.table("monthly_synthesis_runs")
            .insert(payload)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        msg = str(err)
        if "23505" in msg:
            return None, None, True
        return None, f"insert_failed: {err}", False
    rows = _rows(result)
    return (rows[0] if rows else None), None, False
