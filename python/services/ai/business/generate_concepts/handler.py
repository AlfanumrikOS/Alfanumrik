"""Orchestrator for generate-concepts — composes auth + budget + fetch + LLM + DB.

Mirrors the main handler in :file:`supabase/functions/generate-concepts/index.ts`
(POST path: lines 629-870; GET path: lines 549-616).

Public entrypoints:
- :func:`handle_generate_concepts` — POST: batch concept generation.
- :func:`handle_generate_concepts_status` — GET: coverage statistics.

The FastAPI route is a thin wrapper that maps exceptions to HTTP status codes.

Time-budget posture (mirrors TS index.ts:44-45):
- ``MAX_EXECUTION_S = 120`` — stop processing new chapters when wall time
  crosses this threshold. Stays under Cloud Run's per-request timeout AND
  under the TS gateway 150s wall.
- ``INTER_CHAPTER_DELAY_S = 0.5`` — throttle between LLM calls to be
  polite to the upstream provider during a large batch.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

import structlog

from ...shared.budget_guard import BudgetExceeded, check_daily_budget
from .auth import verify_admin_key
from .generator import call_mol_for_concepts
from .models import (
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
    ChapterInfo,
    ChapterPreview,
    ConceptInsertRow,
    GenerateConceptsRequest,
    GenerateConceptsResponse,
    GenerateConceptsStatusResponse,
    GeneratedConcept,
)
from .normalize import slugify
from .ops_events import log_generate_concepts_event
from .prompts import MIN_RAG_CHUNKS, build_system_prompt, build_user_prompt
from .repository import (
    RepositoryError,
    fetch_chapter_questions,
    fetch_chapters_without_concepts,
    fetch_diagram_refs,
    fetch_rag_chunks,
    get_coverage_overview,
    insert_chapter_concepts,
)
from .validator import parse_concepts_response

logger = structlog.get_logger(__name__)

# Time / throttle constants (mirror TS index.ts lines 44-45).
MAX_EXECUTION_S = 120.0
INTER_CHAPTER_DELAY_S = 0.5

# Errors list cap — mirrors TS index.ts:834-837 (cap ~100, splice middle).
_ERRORS_HARD_CAP = 100
_ERRORS_HEAD_SLICE = 50

# Large-limit ceiling used for the post-batch "remaining" count. Mirrors
# TS index.ts:850.
_REMAINING_LIMIT = 999


class HandlerError(Exception):
    """Generic handler failure with HTTP status hint.

    Mirrors the generate-answers HandlerError shape so the route mapper
    can be reused.
    """

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


# ── POST handler ────────────────────────────────────────────────────────────


async def handle_generate_concepts(
    request: GenerateConceptsRequest,
    *,
    admin_key_header: str | None,
    request_id: str | None = None,
) -> GenerateConceptsResponse:
    """Run the full generate-concepts batch flow.

    Steps (mirrors TS index.ts:629-870):
      1. Verify ``x-admin-key`` (raises AuthFailed on mismatch → 401).
      2. Daily INR budget guard (raises BudgetExceeded → 429).
      3. Fetch candidate chapters (missing from chapter_concepts).
      4. If empty: return zero-counts envelope.
      5. If dry_run: return chapter previews.
      6. Per chapter: RAG → questions+diagrams → MoL → parse → insert.
      7. Emit ops_events telemetry at batch start, per chapter, batch end.
      8. Count remaining (post-batch) for the response.
      9. Return GenerateConceptsResponse.

    Raises:
        :class:`AuthFailed`         — bad admin key (401 / 503).
        :class:`BudgetExceeded`     — daily INR cap reached (429).
        :class:`HandlerError`       — DB error, generic 500 fallback.
    """
    rid = request_id or str(uuid.uuid4())

    # 1. Auth — let AuthFailed bubble; route maps it to HTTP status.
    verify_admin_key(admin_key_header)

    # 2. Daily INR budget guard. Must run BEFORE the LLM call so we fail
    # fast on overrun. Same posture as generate-answers.
    if not await check_daily_budget(scope="org"):
        raise BudgetExceeded("Daily AI INR budget exceeded — try again tomorrow.")

    # 3. Param clamping. TS handler at index.ts:652-655 clamps batch_size
    # to [1, MAX_BATCH_SIZE]; out-of-range falls back to DEFAULT_BATCH_SIZE.
    batch_size = request.batch_size or DEFAULT_BATCH_SIZE
    if batch_size < 1 or batch_size > MAX_BATCH_SIZE:
        batch_size = DEFAULT_BATCH_SIZE
    dry_run = bool(request.dry_run)
    start_ms = time.monotonic()

    # 4. Fetch candidate chapters.
    try:
        chapters = await fetch_chapters_without_concepts(
            grade=request.grade,
            subject=request.subject,
            limit=batch_size,
        )
    except RepositoryError as err:
        logger.warning(
            "generate_concepts.handler.fetch_failed",
            error=str(err),
            request_id=rid,
        )
        raise HandlerError(str(err), status=500) from err

    # Telemetry: batch started. Fire-and-forget; never blocks.
    await log_generate_concepts_event(
        category="generate_concepts.batch.started",
        severity="info",
        success=True,
        message="Concept-generation batch started",
        request_id=rid,
        context={
            "grade": request.grade,
            "subject": request.subject,
            "batch_size": batch_size,
            "dry_run": dry_run,
            "candidate_count": len(chapters),
        },
    )

    # 5. Empty-batch shortcut. Same shape as TS index.ts:666-683.
    if not chapters:
        return GenerateConceptsResponse(
            success=True,
            total_found=0,
            processed=0,
            succeeded=0,
            failed=0,
            skipped=0,
            errors=[],
            elapsed_ms=_elapsed_ms(start_ms),
            dry_run=dry_run,
        )

    # 6. Dry-run shortcut. Same shape as TS index.ts:686-704.
    if dry_run:
        previews = [
            ChapterPreview(
                grade=ch.grade,
                subject=ch.subject,
                chapter_number=ch.chapter_number,
                chapter_title=ch.chapter_title,
            )
            for ch in chapters
        ]
        return GenerateConceptsResponse(
            success=True,
            total_found=len(chapters),
            processed=0,
            succeeded=0,
            failed=0,
            skipped=0,
            errors=[],
            elapsed_ms=_elapsed_ms(start_ms),
            dry_run=True,
            chapters=previews,
        )

    # 7. Per-chapter pipeline.
    processed = 0
    succeeded = 0
    failed = 0
    skipped = 0
    errors: list[str] = []

    for i, chapter in enumerate(chapters):
        chapter_key = f"Grade {chapter.grade} {chapter.subject} Ch{chapter.chapter_number}"

        # Time guard — mirrors TS index.ts:716-722.
        elapsed_s = time.monotonic() - start_ms
        if elapsed_s >= MAX_EXECUTION_S:
            errors.append(
                f"Stopped early: approaching {int(MAX_EXECUTION_S * 1000)}ms "
                f"execution limit after {processed} chapters"
            )
            break

        processed += 1

        try:
            # Step 1: Fetch RAG chunks (raw "Grade N" / "Mathematics" form).
            rag_chunks = await fetch_rag_chunks(
                rag_grade=chapter.rag_grade,
                rag_subject=chapter.rag_subject,
                chapter_number=chapter.chapter_number,
            )

            if len(rag_chunks) < MIN_RAG_CHUNKS:
                skipped += 1
                errors.append(
                    f"{chapter_key}: skipped — only {len(rag_chunks)} "
                    f"RAG chunks (need >= {MIN_RAG_CHUNKS})"
                )
                await _log_chapter_event(
                    chapter,
                    rid,
                    success=False,
                    reason="insufficient_rag_chunks",
                    rag_chunk_count=len(rag_chunks),
                )
                # Fall through to throttle + cap-check.
            else:
                # Step 2: Fetch questions + diagrams in parallel.
                questions, diagram_refs = await asyncio.gather(
                    fetch_chapter_questions(
                        grade=chapter.grade,
                        subject=chapter.subject,
                        chapter_number=chapter.chapter_number,
                    ),
                    fetch_diagram_refs(
                        grade=chapter.grade,
                        subject=chapter.subject,
                        chapter_number=chapter.chapter_number,
                    ),
                )

                sample_question = questions[0] if questions else None

                # Step 3: Build prompts.
                system_prompt = build_system_prompt(
                    grade=chapter.grade,
                    subject=chapter.subject,
                )
                user_prompt = build_user_prompt(chapter, rag_chunks, diagram_refs, sample_question)

                # Step 4: Call MoL.
                raw_response = await call_mol_for_concepts(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    grade=chapter.grade,
                    subject=chapter.subject,
                    request_id=rid,
                )

                # Step 5: Parse + validate (P6 quality gate).
                concepts = parse_concepts_response(raw_response)
                if concepts is None:
                    failed += 1
                    errors.append(f"{chapter_key}: failed to parse Claude response")
                    await _log_chapter_event(chapter, rid, success=False, reason="parse_failed")
                else:
                    # Step 6: Build insert rows.
                    rows = _build_insert_rows(
                        chapter=chapter,
                        concepts=concepts,
                        questions=questions,
                        diagram_refs=diagram_refs,
                    )

                    # Step 7: Insert.
                    ok, err_msg = await insert_chapter_concepts(rows)
                    if not ok:
                        failed += 1
                        errors.append(f"{chapter_key}: DB insert error: {err_msg}")
                        await _log_chapter_event(
                            chapter,
                            rid,
                            success=False,
                            reason="db_insert_error",
                        )
                    else:
                        succeeded += 1
                        await _log_chapter_event(
                            chapter,
                            rid,
                            success=True,
                            reason=None,
                            concept_count=len(concepts),
                        )

        except Exception as exc:  # noqa: BLE001 — per-chapter safety net
            failed += 1
            msg = str(exc)
            errors.append(f"{chapter_key}: {msg}")
            logger.warning(
                "generate_concepts.handler.chapter_exception",
                chapter_key=chapter_key,
                error=msg,
                request_id=rid,
            )
            await _log_chapter_event(chapter, rid, success=False, reason="unexpected_exception")

        # Errors-list cap. Mirrors TS index.ts:834-837 (cap at 100, splice
        # the middle so head + tail entries are preserved).
        if len(errors) > _ERRORS_HARD_CAP:
            head = errors[:_ERRORS_HEAD_SLICE]
            errors = head + ["... (errors truncated)"]

        # Inter-chapter throttle. Mirrors TS index.ts:840-842 (skip on last).
        if i < len(chapters) - 1:
            await asyncio.sleep(INTER_CHAPTER_DELAY_S)

    # 8. Count remaining (post-batch). Mirrors TS index.ts:845-851.
    remaining: int | None = None
    try:
        remaining_chapters = await fetch_chapters_without_concepts(
            grade=request.grade,
            subject=request.subject,
            limit=_REMAINING_LIMIT,
        )
        remaining = len(remaining_chapters)
    except RepositoryError as err:
        # Soft failure on the post-batch count — don't fail the whole batch.
        logger.warning(
            "generate_concepts.handler.remaining_count_failed",
            error=str(err),
        )

    # Telemetry: batch complete.
    await log_generate_concepts_event(
        category="generate_concepts.batch.complete",
        severity="info",
        success=(failed == 0),
        message="Concept-generation batch complete",
        request_id=rid,
        context={
            "grade": request.grade,
            "subject": request.subject,
            "total_found": len(chapters),
            "processed": processed,
            "succeeded": succeeded,
            "failed": failed,
            "skipped": skipped,
            "remaining": remaining,
        },
    )

    # TS path returns success=true when either everything succeeded OR at
    # least one row was inserted. Mirrors TS index.ts:855.
    success = (failed == 0) or (succeeded > 0)

    return GenerateConceptsResponse(
        success=success,
        total_found=len(chapters),
        processed=processed,
        succeeded=succeeded,
        failed=failed,
        skipped=skipped,
        errors=errors[:_ERRORS_HEAD_SLICE],
        elapsed_ms=_elapsed_ms(start_ms),
        remaining=remaining,
        dry_run=False,
    )


# ── GET handler (status) ────────────────────────────────────────────────────


async def handle_generate_concepts_status(
    *,
    admin_key_header: str | None,
) -> GenerateConceptsStatusResponse:
    """Return coverage statistics. Mirrors TS handleGet (index.ts:549-616).

    Args:
        admin_key_header: ``x-admin-key`` request header value. Verified
            constant-time vs the ``ADMIN_API_KEY`` env. The route also
            calls verify_admin_key; the handler call here means anyone
            invoking the handler directly (tests, future internal helpers)
            still passes through the gate.

    Raises:
        :class:`AuthFailed` on missing/bad key.
        :class:`HandlerError` (status=500) on DB query failure.
    """
    verify_admin_key(admin_key_header)
    try:
        return await get_coverage_overview()
    except RepositoryError as err:
        raise HandlerError(f"DB error: {err}", status=500) from err


# ── Internal helpers ────────────────────────────────────────────────────────


def _elapsed_ms(start_monotonic_s: float) -> int:
    """Convert a monotonic start time to integer milliseconds elapsed."""
    return int((time.monotonic() - start_monotonic_s) * 1000)


async def _log_chapter_event(
    chapter: ChapterInfo,
    request_id: str,
    *,
    success: bool,
    reason: str | None,
    concept_count: int | None = None,
    rag_chunk_count: int | None = None,
) -> None:
    """Fire-and-forget per-chapter telemetry row."""
    ctx: dict[str, Any] = {
        "grade": chapter.grade,
        "subject": chapter.subject,
        "chapter_number": chapter.chapter_number,
    }
    if reason is not None:
        ctx["reason"] = reason
    if concept_count is not None:
        ctx["concept_count"] = concept_count
    if rag_chunk_count is not None:
        ctx["rag_chunk_count"] = rag_chunk_count

    await log_generate_concepts_event(
        category=(
            "generate_concepts.chapter.success" if success else "generate_concepts.chapter.failed"
        ),
        severity="info",
        success=success,
        message=(
            "Concepts generated and stored"
            if success
            else f"Concept generation failed: {reason or 'unknown'}"
        ),
        request_id=request_id,
        context=ctx,
    )


def _build_insert_rows(
    *,
    chapter: ChapterInfo,
    concepts: list[GeneratedConcept],
    questions: list[dict[str, Any]],
    diagram_refs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Port of the TS row-mapping logic at index.ts:773-814.

    For each concept:
      - assign a practice question by index (None if exhausted)
      - filter diagram_refs by title-keyword match in caption
      - stamp P5 grade-as-string, subject, chapter_number / title
      - slugify the concept title
      - stamp source='ncert_2025', is_active=true, estimated_minutes=5

    Returns:
        List of plain dicts ready for `chapter_concepts` insertion. We
        round-trip through :class:`ConceptInsertRow` for Pydantic
        validation so any future schema drift surfaces in tests.
    """
    rows: list[dict[str, Any]] = []
    for index, concept in enumerate(concepts):
        practice_q = questions[index] if index < len(questions) else None
        raw_practice_options = practice_q.get("options") if practice_q else None
        practice_options: list[str] | None = None
        if isinstance(raw_practice_options, list) and all(
            isinstance(o, str) for o in raw_practice_options
        ):
            practice_options = list(raw_practice_options)

        # Diagram filter — keyword-match concept title against caption.
        # Mirrors TS index.ts:779-786.
        title_words = [w for w in concept.title.lower().split() if w]
        matching_diagrams: list[dict[str, Any]] = []
        for d in diagram_refs:
            caption = d.get("caption")
            if not isinstance(caption, str) or not caption:
                continue
            caption_lower = caption.lower()
            for w in title_words:
                if len(w) > 3 and w in caption_lower:
                    matching_diagrams.append(
                        {
                            "media_type": d.get("media_type"),
                            "caption": caption,
                            "url": d.get("url"),
                        }
                    )
                    break

        row_model = ConceptInsertRow(
            grade=chapter.grade,  # P5: string grade
            subject=chapter.subject,
            chapter_number=chapter.chapter_number,
            chapter_title=chapter.chapter_title,
            concept_number=index + 1,
            title=concept.title,
            slug=slugify(concept.title),
            learning_objective=concept.learning_objective,
            explanation=concept.explanation,
            key_formula=concept.key_formula,
            example_title=concept.example_title,
            example_content=concept.example_content,
            common_mistakes=concept.common_mistakes,
            exam_tips=[],
            diagram_refs=matching_diagrams,
            practice_question=(practice_q.get("question_text") if practice_q else None),
            practice_options=practice_options,
            practice_correct_index=(practice_q.get("correct_answer_index") if practice_q else None),
            practice_explanation=(practice_q.get("explanation") if practice_q else None),
            difficulty=concept.difficulty,
            bloom_level=concept.bloom_level,
            estimated_minutes=5,
            is_active=True,
            source="ncert_2025",
        )
        rows.append(row_model.model_dump())
    return rows


__all__ = [
    "HandlerError",
    "MAX_EXECUTION_S",
    "INTER_CHAPTER_DELAY_S",
    "handle_generate_concepts",
    "handle_generate_concepts_status",
]
