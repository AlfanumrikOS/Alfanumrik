"""Supabase IO for parent-report-generator.

Five reads + 1 guardian-link verification. P13: only structural data is
fetched; raw quiz responses, foxy chat text are NEVER pulled.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog

from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)


class RepositoryError(Exception):
    """Supabase client misconfigured (fail-CLOSED)."""


def _rows(result: Any) -> list[Any]:
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if data is None:
        return []
    return data if isinstance(data, list) else []


def _first(result: Any) -> dict[str, Any] | None:
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return None


def week_window_iso() -> tuple[str, str]:
    """Return (week_ago_iso, now_iso) - same window TS uses (7 days)."""
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    return (
        week_ago.isoformat().replace("+00:00", "Z"),
        now.isoformat().replace("+00:00", "Z"),
    )


async def verify_guardian_student_link(guardian_id: str, student_id: str) -> bool:
    """Confirm the guardian is actually linked to this student. TS line 148."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("parent_student_links")
            .select("id")
            .eq("guardian_id", guardian_id)
            .eq("student_id", student_id)
            .limit(1)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return False
    return _first(result) is not None


async def fetch_student_name(student_id: str) -> str:
    """Return students.name or empty string. TS line 658."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("students").select("name").eq("id", student_id).limit(1).execute()
        )
    except Exception:  # noqa: BLE001
        return ""
    row = _first(result)
    name = (row or {}).get("name")
    return str(name) if isinstance(name, str) else ""


async def fetch_quiz_sessions(student_id: str) -> list[dict[str, Any]]:
    """Last 7 days quiz_sessions. TS line 178."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    week_ago, _now = week_window_iso()
    try:
        result = (
            await client.table("quiz_sessions")
            .select(
                "id, subject, score_percent, time_taken_seconds, "
                "correct_answers, total_questions, completed_at"
            )
            .eq("student_id", student_id)
            .gte("completed_at", week_ago)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return []
    return _rows(result)


async def fetch_foxy_sessions(student_id: str) -> list[dict[str, Any]]:
    """Last 7 days foxy_sessions. TS line 186."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    week_ago, _now = week_window_iso()
    try:
        result = (
            await client.table("foxy_sessions")
            .select("id, score_percent, time_taken_seconds")
            .eq("student_id", student_id)
            .gte("created_at", week_ago)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return []
    return _rows(result)


async def fetch_learning_profile(student_id: str) -> dict[str, Any] | None:
    """First row of student_learning_profiles. TS line 194."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("student_learning_profiles")
            .select("name, xp_total, streak_days")
            .eq("student_id", student_id)
            .limit(1)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return None
    return _first(result)


async def fetch_concept_mastery(student_id: str) -> list[dict[str, Any]]:
    """Mastery rows with nested topic title. TS line 201."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    week_ago, _now = week_window_iso()
    try:
        result = (
            await client.table("concept_mastery")
            .select("topic_id, mastery_level, updated_at, topics(title)")
            .eq("student_id", student_id)
            .gte("updated_at", week_ago)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return []
    return _rows(result)
