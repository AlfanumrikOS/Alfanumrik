"""Supabase IO for nep-compliance.

Five reads (student, profiles, mastery, quiz_sessions, recent reports) and
one upsert into nep_compliance_reports. The TS path also writes the
generated report to that table for caching - we mirror this.

All errors surface as (value, error_message) tuples except for missing
Supabase client which raises RepositoryError for fail-CLOSED 500.
"""

from __future__ import annotations

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


def _first_or_none(result: Any) -> dict[str, Any] | None:
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and data:
        first = data[0]
        return first if isinstance(first, dict) else None
    return None


async def fetch_student(
    student_id: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Fetch students row (id, name, grade)."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("students")
            .select("id, name, grade")
            .eq("id", student_id)
            .limit(1)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return None, f"student_fetch_failed: {err}"
    return _first_or_none(result), None


async def fetch_learning_profiles(
    student_id: str,
) -> tuple[list[dict[str, Any]], str | None]:
    """Fetch student_learning_profiles across all subjects."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("student_learning_profiles")
            .select(
                "subject, xp_total, streak_days, total_questions_asked, "
                "total_questions_answered_correctly"
            )
            .eq("student_id", student_id)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return [], f"profiles_fetch_failed: {err}"
    return _rows(result), None


async def fetch_concept_mastery(
    student_id: str,
) -> tuple[list[dict[str, Any]], str | None]:
    """Fetch concept_mastery with nested curriculum_topics → subjects join.

    Note: the postgrest nested-select string mirrors the TS one (lines
    170-177) to preserve the response shape exactly.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    nested_select = (
        "topic_id, mastery_level, total_attempts, correct_attempts, "
        "curriculum_topics(title, chapter_number, subject_id, "
        "subjects(name, code))"
    )
    try:
        result = (
            await client.table("concept_mastery")
            .select(nested_select)
            .eq("student_id", student_id)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return [], f"mastery_fetch_failed: {err}"
    return _rows(result), None


async def fetch_quiz_sessions(
    student_id: str,
) -> tuple[list[dict[str, Any]], str | None]:
    """Fetch quiz_sessions ordered by created_at desc for Bloom + session counts."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("quiz_sessions")
            .select("id, subject, score_percent, xp_earned, bloom_level, created_at")
            .eq("student_id", student_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return [], f"quiz_fetch_failed: {err}"
    return _rows(result), None


async def fetch_existing_report(
    student_id: str, academic_year: str, term: str
) -> tuple[dict[str, Any] | None, str | None]:
    """Look up cached HPC for (student, academic_year, term)."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    try:
        result = (
            await client.table("nep_compliance_reports")
            .select("id, report_data, generated_at")
            .eq("student_id", student_id)
            .eq("academic_year", academic_year)
            .eq("term", term)
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return None, f"report_fetch_failed: {err}"
    return _first_or_none(result), None


async def upsert_report(
    student_id: str,
    academic_year: str,
    term: str,
    report_data: dict[str, Any],
) -> tuple[str | None, str | None]:
    """Upsert nep_compliance_reports row, return id."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase client not configured")
    payload = {
        "student_id": student_id,
        "academic_year": academic_year,
        "term": term,
        "report_data": report_data,
    }
    try:
        result = (
            await client.table("nep_compliance_reports")
            .upsert(payload)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        return None, f"upsert_failed: {err}"
    row = _first_or_none(result)
    return (
        (str(row.get("id")) if row and isinstance(row.get("id"), str) else None),
        None,
    )
