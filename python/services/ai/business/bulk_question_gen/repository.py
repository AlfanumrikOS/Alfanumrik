"""``question_bank`` insert via the service-role client.

Source: ``supabase/functions/bulk-question-gen/index.ts:1393-1427``.

Key contract:
- ``verification_state='pending'`` — CRITICAL (P6 + assessment): students
  never see unreviewed AI questions. The TS legacy single-pass path uses
  the schema default ``'legacy_unverified'``, but for the Python port we
  use ``'pending'`` per the spec brief (admins must claim/verify before
  exposure).
- ``source='ai_generated'`` — distinguishes AI-generated rows from NCERT
  imports for the verification queue UI.
- ``is_active=false`` until verified — defense-in-depth alongside
  ``verification_state``; the ``idx_question_bank_verified`` index filters
  on ``verified_against_ncert=true`` so pending rows aren't served anyway,
  but we keep ``is_active=false`` for additional clarity.

Returns the inserted rows with the DB-generated ``id`` populated, so the
handler can serialize them into :class:`InsertedQuestion`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog

from ...db.supabase import get_service_client
from .models import BulkQuestionGenRequest, CandidateQuestion, InsertedQuestion

logger = structlog.get_logger(__name__)


class RepositoryError(RuntimeError):
    """Raised on DB insert failure."""


async def insert_questions(
    accepted: list[CandidateQuestion],
    request: BulkQuestionGenRequest,
) -> list[InsertedQuestion]:
    """Bulk-insert accepted candidates into ``public.question_bank``.

    Rows are written with ``verification_state='pending'`` and
    ``is_active=false`` — the verification queue UI claims them before
    they're served to students.

    Returns the inserted rows with DB-generated ``id`` populated. Returns
    empty list when ``accepted`` is empty (no DB call made).
    """
    if not accepted:
        return []

    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    now = datetime.now(UTC).isoformat()
    rows: list[dict[str, Any]] = []
    for c in accepted:
        row: dict[str, Any] = {
            "question_text": c.question_text.strip(),
            "question_type": "mcq",
            "options": [o.strip() for o in c.options],
            "correct_answer_index": c.correct_answer_index,
            "explanation": c.explanation.strip(),
            "hint": c.hint.strip() if c.hint else "",
            "difficulty": c.difficulty,
            "bloom_level": c.bloom_level.lower().strip(),
            "subject": request.subject,
            "grade": request.grade,  # P5: string
            "chapter_title": request.chapter,
            "source": "ai_generated",
            "is_active": False,
            "verification_state": "pending",
            "verified_against_ncert": False,
            "created_at": now,
        }
        if request.chapter_id:
            row["topic_id"] = request.chapter_id
        rows.append(row)

    try:
        result = await client.table("question_bank").insert(rows).execute()
    except Exception as err:  # noqa: BLE001 — surface to handler as 500
        logger.error(
            "bulk_question_gen.repository.insert_failed",
            error=str(err),
            row_count=len(rows),
        )
        raise RepositoryError(f"Database insert failed: {err}") from err

    inserted_rows = getattr(result, "data", None)
    if inserted_rows is None and isinstance(result, dict):
        inserted_rows = result.get("data")
    if not inserted_rows:
        # Postgrest insert with return=representation returns the row;
        # some test fakes return None. Fall back to the input shape.
        inserted_rows = []

    return _to_inserted_questions(inserted_rows, request, fallback=rows)


def _to_inserted_questions(
    db_rows: list[dict[str, Any]],
    request: BulkQuestionGenRequest,
    *,
    fallback: list[dict[str, Any]],
) -> list[InsertedQuestion]:
    """Project DB rows into :class:`InsertedQuestion`.

    If the DB returned no rows (test fake / Prefer=return=minimal), use
    the input shape with a synthetic id so the response shape stays stable.
    """
    source = db_rows if db_rows else fallback
    out: list[InsertedQuestion] = []
    for i, r in enumerate(source):
        row_id = r.get("id") or f"unknown-{i}"
        out.append(
            InsertedQuestion(
                id=str(row_id),
                question_text=r["question_text"],
                options=r["options"],
                correct_answer_index=r["correct_answer_index"],
                explanation=r["explanation"],
                hint=r.get("hint", ""),
                difficulty=int(r["difficulty"]),
                bloom_level=r["bloom_level"],
                grade=request.grade,
                subject=request.subject,
                chapter=request.chapter,
            )
        )
    return out
