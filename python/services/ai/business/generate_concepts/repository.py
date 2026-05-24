"""Supabase reads + writes for chapter_concepts ingestion.

Mirrors :file:`supabase/functions/generate-concepts/index.ts` data-access
helpers (lines 173-314 for POST path, 549-616 for GET path).

Tables touched:
- ``rag_content_chunks`` — read-only; chapter discovery + RAG retrieval.
- ``chapter_concepts``   — read (existing chapters) + write (insert rows).
- ``question_bank``      — read-only; one practice question per concept.
- ``content_media``      — read-only; diagram references injected into prompts.

The 20000-row override on ``rag_content_chunks`` and ``chapter_concepts``
mirrors TS index.ts:187 and 228 — both tables are wide and the default
PostgREST 1000-row cap would silently truncate the chapter-coverage
calculation. The production dataset is ~10k rag_content_chunks rows /
~542 distinct chapters as of 2025, so 20000 is a safe ceiling.
"""

from __future__ import annotations

from typing import Any

import structlog

from ...db.supabase import get_service_client
from .models import (
    ChapterInfo,
    GenerateConceptsStatusResponse,
    StatusBreakdownEntry,
)
from .normalize import normalize_grade, normalize_subject, raw_subject_for

logger = structlog.get_logger(__name__)

# Hard ceiling on per-query rows — overrides PostgREST default 1000 cap.
# Mirrors TS index.ts:187 / 228 / 555 / 574.
_ROW_CEILING = 20000


class RepositoryError(RuntimeError):
    """Raised on DB query / insert failure."""


# ── POST path: candidate chapter discovery ──────────────────────────────────


async def fetch_chapters_without_concepts(
    *,
    grade: str | None,
    subject: str | None,
    limit: int,
) -> list[ChapterInfo]:
    """Return chapters from ``rag_content_chunks`` missing in ``chapter_concepts``.

    Mirrors TS ``fetchChaptersWithoutConcepts`` (index.ts:173-246). The
    algorithm:
      1. Pull all (grade, subject, chapter_number, chapter_title) rows from
         rag_content_chunks (up to 20000) matching optional grade/subject
         filter (in BOTH raw "Grade 10" and normalized "10" form).
      2. Deduplicate by normalized (grade, subject, chapter_number) tuple.
      3. Pull all (grade, subject, chapter_number) rows from chapter_concepts.
      4. Filter the candidate set to those missing from chapter_concepts.
      5. Return the first ``limit`` results in stable ordering.

    Args:
        grade: optional grade filter; accepts both "10" and "Grade 10".
        subject: optional subject; accepts both "math" and "Mathematics".
        limit: cap on returned candidates. The TS path uses
            DEFAULT_BATCH_SIZE here; we surface it so the handler can
            request a larger count for the remaining-count tally.

    Returns:
        List of :class:`ChapterInfo`. Empty list when no chapters qualify
        or when the DB query errors (matches TS posture of returning ``[]``
        on error rather than throwing — chapter discovery is a soft step).

    Raises:
        :class:`RepositoryError` only when the Supabase client is None
        (misconfigured environment, fail-closed). The TS path returns []
        even in this case; we explicitly raise so misconfig surfaces.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    try:
        chunk_query = (
            client.table("rag_content_chunks")
            .select("grade, subject, chapter_number, chapter_title")
            .order("grade", desc=False)
            .order("subject", desc=False)
            .order("chapter_number", desc=False)
            .limit(_ROW_CEILING)
        )

        # Caller may pass already-normalised OR raw "Grade N" form. The TS
        # path uses postgrest's .or() to match either spelling — we do the
        # same. ng+ns are pre-computed so error logs see the intended filter.
        if grade is not None and grade != "":
            ng = normalize_grade(grade)
            chunk_query = chunk_query.or_(f"grade.eq.Grade {ng},grade.eq.{ng}")
        if subject is not None and subject != "":
            ns = normalize_subject(subject)
            raw = raw_subject_for(ns)
            chunk_query = chunk_query.or_(f"subject.eq.{raw},subject.eq.{ns}")

        chunk_result = await chunk_query.execute()
    except Exception as err:  # noqa: BLE001 — soft fail with telemetry
        logger.warning(
            "generate_concepts.repository.chunk_query_failed",
            error=str(err),
        )
        return []

    chunks = _extract_rows(chunk_result) or []
    if not chunks:
        return []

    # Deduplicate to distinct (normalised grade, normalised subject,
    # chapter_number) tuples. We keep the raw fields for the RAG RPC and
    # normalize for chapter_concepts. Mirrors TS index.ts:207-222.
    chapter_map: dict[str, ChapterInfo] = {}
    for row in chunks:
        raw_grade = row.get("grade")
        raw_subject = row.get("subject")
        chapter_number = row.get("chapter_number")
        if (
            not isinstance(raw_grade, str)
            or not isinstance(raw_subject, str)
            or not isinstance(chapter_number, int)
        ):
            # Malformed row — skip rather than crash the batch. Mirrors TS
            # behavior (TypeScript types let this slip past silently).
            continue
        norm_grade = normalize_grade(raw_grade)
        norm_subject = normalize_subject(raw_subject)
        key = f"{norm_grade}|{norm_subject}|{chapter_number}"
        if key not in chapter_map:
            title = row.get("chapter_title") or f"Chapter {chapter_number}"
            chapter_map[key] = ChapterInfo(
                rag_grade=raw_grade,
                rag_subject=raw_subject,
                grade=norm_grade,
                subject=norm_subject,
                chapter_number=chapter_number,
                chapter_title=str(title),
            )

    # Pull existing chapters with concepts. Mirrors TS index.ts:225-235.
    try:
        existing_result = await (
            client.table("chapter_concepts")
            .select("grade, subject, chapter_number")
            .limit(_ROW_CEILING)
            .execute()
        )
        existing_rows = _extract_rows(existing_result) or []
    except Exception as err:  # noqa: BLE001
        logger.warning(
            "generate_concepts.repository.existing_concepts_query_failed",
            error=str(err),
        )
        existing_rows = []

    existing_set: set[str] = set()
    for r in existing_rows:
        g = r.get("grade")
        s = r.get("subject")
        n = r.get("chapter_number")
        if isinstance(g, str) and isinstance(s, str) and isinstance(n, int):
            existing_set.add(f"{g}|{s}|{n}")

    # Filter + cap. Mirrors TS index.ts:238-245.
    missing: list[ChapterInfo] = []
    for key, chapter in chapter_map.items():
        if key not in existing_set:
            missing.append(chapter)

    if limit < 0:
        limit = 0
    return missing[:limit]


# ── POST path: per-chapter RAG / question / diagram fetches ─────────────────


async def fetch_rag_chunks(
    *,
    rag_grade: str,
    rag_subject: str,
    chapter_number: int,
) -> list[str]:
    """Call the ``get_chapter_rag_content`` RPC for one chapter's content.

    Mirrors TS ``fetchRAGChunks`` (index.ts:248-277). Returns the list of
    chunk ``content`` strings (filtering empty ones). The RPC expects the
    RAW "Grade N" / "Mathematics" form — pre-normalised values would miss.

    Returns:
        List of non-empty chunk strings. Empty list on RPC error or when
        the chapter has no chunks. Mirrors TS posture of returning ``[]``
        on every error path so the caller can decide whether to skip the
        chapter (when below MIN_RAG_CHUNKS).
    """
    client = get_service_client()
    if client is None:
        return []

    try:
        result = await client.rpc(
            "get_chapter_rag_content",
            {
                "p_grade": rag_grade,
                "p_subject": rag_subject,
                "p_chapter_number": chapter_number,
            },
        ).execute()
    except Exception as err:  # noqa: BLE001 — RPC failure ⇒ skip chapter
        logger.warning(
            "generate_concepts.repository.rag_rpc_failed",
            error=str(err),
            rag_grade=rag_grade,
            rag_subject=rag_subject,
            chapter_number=chapter_number,
        )
        return []

    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if data is None:
        return []

    if isinstance(data, list):
        chunks = []
        for chunk in data:
            if isinstance(chunk, dict):
                content = chunk.get("content")
                if isinstance(content, str) and content:
                    chunks.append(content)
        return chunks

    if isinstance(data, str) and data:
        return [data]

    return []


async def fetch_chapter_questions(
    *,
    grade: str,
    subject: str,
    chapter_number: int,
) -> list[dict[str, Any]]:
    """Pull active ``question_bank`` rows for one chapter (max 20).

    Mirrors TS ``fetchChapterQuestions`` (index.ts:279-296). Used to peel
    off one practice question per generated concept.
    """
    client = get_service_client()
    if client is None:
        return []

    try:
        result = await (
            client.table("question_bank")
            .select("id, question_text, options, correct_answer_index, explanation")
            .eq("grade", grade)
            .eq("subject", subject)
            .eq("chapter_number", chapter_number)
            .eq("is_active", True)
            .limit(20)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        logger.warning(
            "generate_concepts.repository.question_query_failed",
            error=str(err),
            grade=grade,
            subject=subject,
            chapter_number=chapter_number,
        )
        return []

    return _extract_rows(result) or []


async def fetch_diagram_refs(
    *,
    grade: str,
    subject: str,
    chapter_number: int,
) -> list[dict[str, Any]]:
    """Pull up to 10 ``content_media`` rows for one chapter.

    Mirrors TS ``fetchDiagramRefs`` (index.ts:298-314). The handler later
    filters this list to diagrams whose caption matches concept title
    keywords.
    """
    client = get_service_client()
    if client is None:
        return []

    try:
        result = await (
            client.table("content_media")
            .select("media_type, caption, url")
            .eq("grade", grade)
            .eq("subject", subject)
            .eq("chapter_number", chapter_number)
            .limit(10)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        logger.warning(
            "generate_concepts.repository.diagram_query_failed",
            error=str(err),
            grade=grade,
            subject=subject,
            chapter_number=chapter_number,
        )
        return []

    return _extract_rows(result) or []


# ── POST path: insertion ────────────────────────────────────────────────────


async def insert_chapter_concepts(rows: list[dict[str, Any]]) -> tuple[bool, str | None]:
    """INSERT one or more rows into ``chapter_concepts``.

    Mirrors TS index.ts:817-826. The TS path performs a single bulk insert;
    we keep the same shape because the per-chapter batch is small (3-6
    concepts) and atomic per-chapter writes are easier to reason about.

    Returns:
        Tuple ``(success, error_message)``. ``success=False`` carries the
        error string for the handler to push into the per-chapter error list.

    Never raises — failures are returned as the tuple's error_message so
    one bad chapter does not abort the batch.
    """
    client = get_service_client()
    if client is None:
        return (False, "Supabase not configured")

    if not rows:
        return (True, None)

    try:
        await client.table("chapter_concepts").insert(rows).execute()
    except Exception as err:  # noqa: BLE001 — surface to caller's error list
        msg = str(err)
        logger.warning(
            "generate_concepts.repository.insert_failed",
            error=msg,
            row_count=len(rows),
        )
        return (False, msg)

    return (True, None)


# ── GET path: coverage overview ─────────────────────────────────────────────


async def get_coverage_overview() -> GenerateConceptsStatusResponse:
    """Compute the chapter-coverage statistics for the GET endpoint.

    Mirrors TS ``handleGet`` (index.ts:549-616). Returns a Pydantic
    envelope rather than a Response — the route layer is responsible for
    JSON serialization.

    Raises:
        :class:`RepositoryError` on DB / network failure or when the
        Supabase client is None.
    """
    client = get_service_client()
    if client is None:
        raise RepositoryError("Supabase not configured")

    # Pull distinct chapters from rag_content_chunks.
    try:
        chunk_result = await (
            client.table("rag_content_chunks")
            .select("grade, subject, chapter_number")
            .limit(_ROW_CEILING)
            .execute()
        )
    except Exception as err:  # noqa: BLE001 → 500 at the route layer
        raise RepositoryError(f"DB error: {err}") from err

    chunks = _extract_rows(chunk_result) or []
    total_chapters: set[str] = set()
    for r in chunks:
        g = r.get("grade")
        s = r.get("subject")
        n = r.get("chapter_number")
        if isinstance(g, str) and isinstance(s, str) and isinstance(n, int):
            total_chapters.add(f"{normalize_grade(g)}|{normalize_subject(s)}|{n}")

    # Pull chapters that already have concepts.
    try:
        concept_result = await (
            client.table("chapter_concepts")
            .select("grade, subject, chapter_number")
            .limit(_ROW_CEILING)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        raise RepositoryError(f"DB error: {err}") from err

    concept_rows = _extract_rows(concept_result) or []
    with_concepts: set[str] = set()
    for r in concept_rows:
        g = r.get("grade")
        s = r.get("subject")
        n = r.get("chapter_number")
        if isinstance(g, str) and isinstance(s, str) and isinstance(n, int):
            with_concepts.add(f"{g}|{s}|{n}")

    # Build breakdown by grade/subject. Mirrors TS index.ts:587-599.
    breakdown_counts: dict[str, dict[str, int]] = {}
    for key in total_chapters:
        parts = key.split("|", 2)
        if len(parts) < 2:
            continue
        grade_part, subject_part = parts[0], parts[1]
        b_key = f"Grade {grade_part} - {subject_part}"
        if b_key not in breakdown_counts:
            breakdown_counts[b_key] = {
                "total": 0,
                "with_concepts": 0,
                "without_concepts": 0,
            }
        breakdown_counts[b_key]["total"] += 1
        if key in with_concepts:
            breakdown_counts[b_key]["with_concepts"] += 1
        else:
            breakdown_counts[b_key]["without_concepts"] += 1

    breakdown: dict[str, StatusBreakdownEntry] = {
        k: StatusBreakdownEntry(
            total=v["total"],
            with_concepts=v["with_concepts"],
            without_concepts=v["without_concepts"],
        )
        for k, v in breakdown_counts.items()
    }

    coverage_percent = 0
    if total_chapters:
        coverage_percent = round((len(with_concepts) / len(total_chapters)) * 100)

    return GenerateConceptsStatusResponse(
        total_chapters=len(total_chapters),
        with_concepts=len(with_concepts),
        without_concepts=len(total_chapters) - len(with_concepts),
        coverage_percent=coverage_percent,
        breakdown=breakdown,
    )


# ── Internal: result shape helper ───────────────────────────────────────────


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
