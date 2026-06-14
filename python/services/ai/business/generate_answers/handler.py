"""Orchestrator for generate-answers — composes auth + budget + fetch + LLM + DB.

Mirrors the main handler in :file:`supabase/functions/generate-answers/index.ts`
(POST path: lines 434-659; GET path: lines 342-431).

Public entrypoints:
- :func:`handle_generate_answers` — POST: batch answer generation.
- :func:`handle_generate_answers_status` — GET: coverage statistics.

The FastAPI route is a thin wrapper that maps exceptions to HTTP status codes.

Time-budget posture (mirrors TS index.ts:546-549):
- ``MAX_EXECUTION_S = 120`` — stop processing new questions when we cross
  this threshold, even if the batch isn't done. The 120s ceiling stays
  comfortably under Cloud Run's per-request timeout AND under the TS gateway
  150s wall.
- ``INTER_QUESTION_DELAY_S = 0.3`` — throttle between LLM calls to avoid
  upstream rate-limit storms during a large batch.
"""

from __future__ import annotations

import asyncio
import time
import uuid

import structlog

from ...shared.budget_guard import BudgetExceeded, check_daily_budget
from .auth import verify_admin_key
from .generator import generate_answer_for_question
from .models import (
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
    DryRunQuestionPreview,
    GenerateAnswersRequest,
    GenerateAnswersResponse,
    GenerateAnswersStatusResponse,
    StatusBreakdownEntry,
)
from .ops_events import log_ops_event
from .prompts import build_system_prompt, build_user_prompt
from .repository import (
    RepositoryError,
    count_active_questions,
    count_questions_with_answer,
    fetch_grade_subject_pairs,
    fetch_questions_without_answers,
    fetch_with_answer_pairs,
    update_question_answer,
)
from .validator import parse_answer_response

logger = structlog.get_logger(__name__)

# Time / throttle constants (mirror TS index.ts lines 45-48).
MAX_EXECUTION_S = 120.0
INTER_QUESTION_DELAY_S = 0.3
ANSWER_MIN_LENGTH = 10  # Mirrors TS index.ts:587 (answer_text.length < 10).


class HandlerError(Exception):
    """Generic handler failure with HTTP status hint.

    Mirrors the bulk-question-gen HandlerError shape so the route mapper
    can be reused.
    """

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


# ── POST handler ────────────────────────────────────────────────────────────


async def handle_generate_answers(
    request: GenerateAnswersRequest,
    *,
    admin_key_header: str | None,
    request_id: str | None = None,
) -> GenerateAnswersResponse:
    """Run the full generate-answers batch flow.

    Steps (mirrors TS index.ts:434-659):
      1. Verify ``x-admin-key`` (raises AuthFailed on mismatch → 401).
      2. Daily INR budget guard (raises BudgetExceeded → 429).
      3. Fetch ``question_bank`` rows where ``answer_text IS NULL``.
      4. If empty: return zero-counts envelope.
      5. If dry_run: return previews.
      6. Per question: build prompts → MoL call → parse → length-check → UPDATE.
      7. Emit ops_events telemetry.
      8. Count remaining (post-batch) for the response.
      9. Return GenerateAnswersResponse.

    Raises:
        :class:`AuthFailed`         — bad admin key (401 / 503).
        :class:`BudgetExceeded`     — daily INR cap reached (429).
        :class:`HandlerError`       — DB error, generic 500 fallback.
    """
    rid = request_id or str(uuid.uuid4())

    # 1. Auth — let AuthFailed bubble; route maps it to HTTP status.
    verify_admin_key(admin_key_header)

    # 2. Daily INR budget guard. Must run BEFORE the LLM call so we fail
    # fast on overrun. Same posture as voice/transcribe.
    if not await check_daily_budget(scope="org"):
        raise BudgetExceeded("Daily AI INR budget exceeded — try again tomorrow.")

    # 3. Param clamping. TS handler at index.ts:429-432 clamps batch_size to
    # [1, MAX_BATCH_SIZE], defaulting to DEFAULT_BATCH_SIZE when missing or
    # out of range.
    batch_size = request.batch_size or DEFAULT_BATCH_SIZE
    if batch_size < 1 or batch_size > MAX_BATCH_SIZE:
        batch_size = DEFAULT_BATCH_SIZE
    dry_run = bool(request.dry_run)
    start_ms = time.monotonic()

    # 4. Fetch.
    try:
        questions = await fetch_questions_without_answers(
            grade=request.grade,
            subject=request.subject,
            limit=batch_size,
        )
    except RepositoryError as err:
        logger.warning(
            "generate_answers.handler.fetch_failed",
            error=str(err),
            request_id=rid,
        )
        raise HandlerError(str(err), status=500) from err

    # 5. Empty-batch shortcut. Same shape as TS index.ts:478-499.
    if not questions:
        return GenerateAnswersResponse(
            success=True,
            total_found=0,
            processed=0,
            succeeded=0,
            failed=0,
            errors=[],
            elapsed_ms=_elapsed_ms(start_ms),
            dry_run=dry_run,
        )

    # 6. Dry-run shortcut. Same shape as TS index.ts:514-534.
    if dry_run:
        previews: list[DryRunQuestionPreview] = []
        for q in questions:
            qt = q.get("question_text") or ""
            previews.append(
                DryRunQuestionPreview(
                    id=str(q.get("id", "")),
                    grade=str(q.get("grade", "")),
                    subject=str(q.get("subject", "")),
                    question_type_v2=q.get("question_type_v2"),
                    question_text=qt[:100] + ("..." if len(qt) > 100 else ""),
                )
            )
        return GenerateAnswersResponse(
            success=True,
            total_found=len(questions),
            processed=0,
            succeeded=0,
            failed=0,
            errors=[],
            elapsed_ms=_elapsed_ms(start_ms),
            dry_run=True,
            questions=previews,
        )

    # 7. Per-question pipeline.
    processed = 0
    succeeded = 0
    failed = 0
    errors: list[str] = []

    for i, question in enumerate(questions):
        # Time guard — mirrors TS index.ts:545-548.
        elapsed_s = time.monotonic() - start_ms
        if elapsed_s >= MAX_EXECUTION_S:
            errors.append(
                f"Stopped early: approaching {int(MAX_EXECUTION_S * 1000)}ms "
                f"execution limit after {processed} questions"
            )
            break

        processed += 1
        question_id = str(question.get("id", ""))

        try:
            # NOTE: Phase 2 deliberately does NOT call fetchRAGContext here.
            # The TS path runs RAG retrieval before each LLM call (index.ts:553-560);
            # the Python port defers RAG plumbing until the Python service
            # exposes a retrieval helper. Generator falls back to the
            # "no NCERT reference material" system-prompt branch which
            # mirrors the TS WARNING branch (prompts.py build_system_prompt
            # when rag_context is None). Once the Python rag/ module lands
            # we wire it in here without touching the prompt / parser.
            rag_context: str | None = None

            system_prompt = build_system_prompt(
                grade=str(question.get("grade", "")),
                subject=str(question.get("subject", "")),
                rag_context=rag_context,
            )
            user_prompt = build_user_prompt(question)

            raw_response = await generate_answer_for_question(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                grade=str(question.get("grade", "")),
                subject=str(question.get("subject", "")),
                request_id=rid,
            )

            is_mcq = question.get("question_type_v2") == "mcq"
            parse = parse_answer_response(raw_response, is_mcq)

            if parse.answer is None:
                failed += 1
                errors.append(f"question {question_id}: failed to parse response ({parse.reason})")
                await _log_failure(question_id, request, rid, parse.reason)
                continue

            # Length floor — mirrors TS index.ts:585-591.
            if len(parse.answer.answer_text) < ANSWER_MIN_LENGTH:
                failed += 1
                errors.append(
                    f"question {question_id}: answer too short "
                    f"({len(parse.answer.answer_text)} chars)"
                )
                await _log_failure(question_id, request, rid, "answer_too_short")
                continue

            # DB UPDATE.
            try:
                await update_question_answer(
                    question_id=question_id,
                    answer_text=parse.answer.answer_text,
                    answer_methodology=parse.answer.answer_methodology,
                    marks_expected=parse.answer.marks_expected,
                )
                succeeded += 1
                await log_ops_event(
                    category="quiz.answer_generated",
                    source="generate-answers",
                    severity="info",
                    message="Answer generated and stored",
                    request_id=rid,
                    context={
                        "question_id": question_id,
                        "grade": question.get("grade"),
                        "subject": question.get("subject"),
                        "methodology": parse.answer.answer_methodology,
                        "marks_expected": parse.answer.marks_expected,
                        "answer_length": len(parse.answer.answer_text),
                    },
                )
            except RepositoryError as db_err:
                failed += 1
                errors.append(f"question {question_id}: DB update error: {db_err}")
                await _log_failure(question_id, request, rid, "db_update_error")

        except Exception as exc:  # noqa: BLE001 — per-question safety net
            failed += 1
            msg = str(exc)
            errors.append(f"question {question_id}: {msg}")
            logger.warning(
                "generate_answers.handler.question_exception",
                question_id=question_id,
                error=msg,
                request_id=rid,
            )
            await _log_failure(question_id, request, rid, "unexpected_exception")

        # Errors-list cap. Mirrors TS index.ts:615-619 (cap at ~100, splice
        # the middle so head + tail entries are preserved).
        if len(errors) > 100:
            head = errors[:50]
            errors = head + ["... (errors truncated)"]

        # Inter-question throttle. Mirrors TS index.ts:621-624.
        if i < len(questions) - 1:
            await asyncio.sleep(INTER_QUESTION_DELAY_S)

    # 8. Count remaining (post-batch).
    try:
        remaining = await count_questions_with_answer_complement(
            grade=request.grade,
            subject=request.subject,
        )
    except RepositoryError as err:
        # Soft failure on the post-batch count — don't fail the whole batch.
        logger.warning(
            "generate_answers.handler.remaining_count_failed",
            error=str(err),
        )
        remaining = None

    # TS path returns success=true when either everything succeeded OR
    # at least one row was updated. Mirrors TS index.ts:645.
    success = (failed == 0) or (succeeded > 0)

    return GenerateAnswersResponse(
        success=success,
        total_found=len(questions),
        processed=processed,
        succeeded=succeeded,
        failed=failed,
        errors=errors[:50],
        elapsed_ms=_elapsed_ms(start_ms),
        remaining=remaining,
        dry_run=False,
    )


# ── GET handler (status) ────────────────────────────────────────────────────


async def handle_generate_answers_status() -> GenerateAnswersStatusResponse:
    """Return coverage statistics. Mirrors TS handleGet (index.ts:342-431).

    No auth check at the handler level — the route applies the same
    ``x-admin-key`` gate.
    """
    try:
        total_active = await count_active_questions()
        with_answer = await count_questions_with_answer()
        gs_rows = await fetch_grade_subject_pairs()
        with_answer_rows = await fetch_with_answer_pairs()
    except RepositoryError as err:
        raise HandlerError(f"DB error: {err}", status=500) from err

    breakdown: dict[str, StatusBreakdownEntry] | None = None
    if gs_rows is not None:
        counts: dict[str, dict[str, int]] = {}
        for r in gs_rows:
            key = f"Grade {r.get('grade')} - {r.get('subject')}"
            counts.setdefault(key, {"total": 0, "with_answer": 0})
            counts[key]["total"] += 1
        # With_answer per group.
        if with_answer_rows is not None:
            answer_counts: dict[str, int] = {}
            for r in with_answer_rows:
                key = f"Grade {r.get('grade')} - {r.get('subject')}"
                answer_counts[key] = answer_counts.get(key, 0) + 1
            for key, c in answer_counts.items():
                if key in counts:
                    counts[key]["with_answer"] = c
        breakdown = {
            key: StatusBreakdownEntry(
                total=val["total"],
                with_answer=val["with_answer"],
                without_answer=val["total"] - val["with_answer"],
            )
            for key, val in counts.items()
        }

    coverage_percent = 0
    if total_active and total_active > 0:
        coverage_percent = round(((with_answer or 0) / total_active) * 100)

    return GenerateAnswersStatusResponse(
        total_active=total_active or 0,
        with_answer=with_answer or 0,
        without_answer=(total_active or 0) - (with_answer or 0),
        coverage_percent=coverage_percent,
        breakdown=breakdown,
    )


# ── Internal helpers ────────────────────────────────────────────────────────


def _elapsed_ms(start_monotonic_s: float) -> int:
    """Convert a monotonic start time to integer milliseconds elapsed."""
    return int((time.monotonic() - start_monotonic_s) * 1000)


async def _log_failure(
    question_id: str,
    request: GenerateAnswersRequest,
    request_id: str,
    reason: str,
) -> None:
    """Fire-and-forget ops_events row for a per-question failure."""
    await log_ops_event(
        category="quiz.answer_generation_failed",
        source="generate-answers",
        severity="info",
        message=f"Answer generation failed: {reason}",
        request_id=request_id,
        context={
            "question_id": question_id,
            "grade": request.grade,
            "subject": request.subject,
            "reason": reason,
        },
    )


async def count_questions_with_answer_complement(
    *,
    grade: str | None,
    subject: str | None,
) -> int:
    """Count remaining ``answer_text IS NULL`` rows for the same filter.

    Mirrors TS index.ts:629-641.
    """
    client_ok_count = await count_active_questions(grade=grade, subject=subject)
    answered = await count_questions_with_answer(grade=grade, subject=subject)
    remaining = max(0, client_ok_count - answered)
    return remaining


__all__ = [
    "HandlerError",
    "handle_generate_answers",
    "handle_generate_answers_status",
    "count_questions_with_answer_complement",
]
