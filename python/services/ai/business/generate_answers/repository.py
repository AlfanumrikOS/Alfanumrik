"""``question_bank`` UPDATE writes + status-coverage reads.

Unlike bulk-question-gen (which INSERTs new rows), generate-answers UPDATEs
existing rows. Source: :file:`supabase/functions/generate-answers/index.ts`
lines 594-608 (update) and lines 342-431 (GET status).

UPDATE contract — Phase 2 differs from TS posture:
- TS path leaves ``verification_state`` unchanged (uses schema default
  ``'legacy_unverified'``). The Phase 2 spec brief explicitly mandates
  ``verification_state='pending'`` so admin verification queue UIs see
  every Python-generated answer as needing review. This matches the
  bulk-question-gen Phase 1 port posture.
- Updated columns:
    answer_text          — the LLM's parsed response
    answer_methodology   — coerced enum from VALID_METHODOLOGIES
    marks_expected       — clamped to [1, 10]
    verification_state   — 'pending' (was unset; default 'legacy_unverified')

Read helpers (used by GET /v1/generate-answers):
- :func:`count_active_questions` — total ``is_active=true`` rows.
- :func:`count_with_answer` — same filter PLUS ``answer_text IS NOT NULL``.
- :func:`fetch_grade_subject_pairs` — pulls the (grade, subject) tuples
  for active rows; the handler aggregates client-side.
"""

from __future__ import annotations

from typing import Any

import structlog

from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)


class RepositoryError(RuntimeError):
    """Raised on DB query / update failure."""


# ── Fetch (for POST handler) ────────────────────────────────────────────────


async def fetch_questions_without_answers(
    *,
    grade: str | None,
    subject: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    """Select question_bank rows where ``answer_text IS NULL``.

    Mirrors TS fetch query at generate-answers/index.ts:454-471. Returns the
    full slim row shape needed by the user-prompt builder.

    Returns:
        List of dict rows. Empty list when no rows match. Raises
        :class:`RepositoryError` only on DB / network failure.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    try:
        query = (
            client.table("question_bank")
            .select(
                "id, question_text, subject, grade, chapter_number, "
                "difficulty, bloom_level, question_type_v2, options, "
                "correct_answer_index, explanation"
            )
            .eq("is_active", True)
            .is_("answer_text", "null")
            .order("grade", desc=False)
            .order("subject", desc=False)
            .limit(limit)
        )
        if grade is not None:
            query = query.eq("grade", grade)
        if subject is not None:
            query = query.eq("subject", subject)

        result = await query.execute()
    except Exception as err:  # noqa: BLE001 — caller maps to 500
        raise RepositoryError(f"DB fetch error: {err}") from err

    rows = _extract_rows(result)
    return rows or []


# ── Update (for each generated answer) ──────────────────────────────────────


async def update_question_answer(
    *,
    question_id: str,
    answer_text: str,
    answer_methodology: str,
    marks_expected: int,
) -> None:
    """UPDATE one ``question_bank`` row with the generated answer.

    Mirrors TS update at generate-answers/index.ts:594-608 but additionally
    stamps ``verification_state='pending'`` per Phase 2 spec — Python-port
    rows always enter the admin review queue, never go straight to active
    serving.

    Raises:
        :class:`RepositoryError` on DB failure. Caller adds an entry to
        the batch ``errors`` list and continues with the next question
        (per-question failures don't fail the whole batch).
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    try:
        await (
            client.table("question_bank")
            .update(
                {
                    "answer_text": answer_text,
                    "answer_methodology": answer_methodology,
                    "marks_expected": marks_expected,
                    "verification_state": "pending",
                }
            )
            .eq("id", question_id)
            .execute()
        )
    except Exception as err:  # noqa: BLE001 — caller handles per-question
        raise RepositoryError(f"DB update error: {err}") from err


# ── Status read helpers (for GET /v1/generate-answers) ──────────────────────


async def count_active_questions(
    *,
    grade: str | None = None,
    subject: str | None = None,
) -> int:
    """Count ``is_active=true`` rows, optionally filtered by grade/subject.

    Mirrors TS count query at index.ts:344-350.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    try:
        query = (
            client.table("question_bank")
            .select("id", count="exact", head=True)
            .eq("is_active", True)
        )
        if grade is not None:
            query = query.eq("grade", grade)
        if subject is not None:
            query = query.eq("subject", subject)
        result = await query.execute()
    except Exception as err:  # noqa: BLE001
        raise RepositoryError(f"DB count error: {err}") from err

    return _extract_count(result) or 0


async def count_questions_with_answer(
    *,
    grade: str | None = None,
    subject: str | None = None,
) -> int:
    """Count rows where ``is_active=true AND answer_text IS NOT NULL``.

    Mirrors TS query at index.ts:354-360.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    try:
        query = (
            client.table("question_bank")
            .select("id", count="exact", head=True)
            .eq("is_active", True)
            .not_.is_("answer_text", "null")
        )
        if grade is not None:
            query = query.eq("grade", grade)
        if subject is not None:
            query = query.eq("subject", subject)
        result = await query.execute()
    except Exception as err:  # noqa: BLE001
        raise RepositoryError(f"DB count error: {err}") from err

    return _extract_count(result) or 0


async def fetch_grade_subject_pairs() -> list[dict[str, str]]:
    """Pull (grade, subject) pairs for all active rows.

    Mirrors TS query at index.ts:365-369. The handler aggregates the result
    client-side to build the breakdown table.

    Returns:
        List of ``{'grade': str, 'subject': str}`` dicts; the same row may
        appear many times (one per question_bank row).
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    try:
        result = (
            await client.table("question_bank")
            .select("grade, subject")
            .eq("is_active", True)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        raise RepositoryError(f"DB query error: {err}") from err

    return _extract_rows(result) or []


async def fetch_with_answer_pairs() -> list[dict[str, str]]:
    """Pull (grade, subject) pairs for rows that already have an answer.

    Mirrors TS query at index.ts:373-378.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    try:
        result = (
            await client.table("question_bank")
            .select("grade, subject")
            .eq("is_active", True)
            .not_.is_("answer_text", "null")
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        raise RepositoryError(f"DB query error: {err}") from err

    return _extract_rows(result) or []


# ── Internal: result shape helpers ──────────────────────────────────────────


def _extract_rows(result: Any) -> list[dict[str, Any]] | None:
    """Pull the ``.data`` list off a postgrest result, handling dict + obj shapes."""
    rows = getattr(result, "data", None)
    if rows is None and isinstance(result, dict):
        rows = result.get("data")
    if rows is None:
        return None
    if not isinstance(rows, list):
        return None
    return rows


def _extract_count(result: Any) -> int | None:
    """Pull the ``.count`` field off a postgrest result.

    PostgREST returns count separately from data when ``count='exact'`` is
    passed. Different client versions surface it slightly differently.
    """
    count = getattr(result, "count", None)
    if count is None and isinstance(result, dict):
        count = result.get("count")
    if isinstance(count, int):
        return count
    return None
