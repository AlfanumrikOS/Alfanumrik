"""Orchestrator for bulk-question-gen — composes auth + generator + oracle + DB.

Mirrors the main handler in :file:`supabase/functions/bulk-question-gen/index.ts`
(single-pass path, lines 997-1472). The grounded two-pass path is OUT of
scope for Phase 1 and will land in Phase 1.2.

Public entrypoint: :func:`handle_bulk_question_gen`. The FastAPI route in
:mod:`services.ai.api.v1.bulk_question_gen` is a thin wrapper that maps
exceptions to HTTP status codes.

Circuit breaker:
    Same posture as the TS handler — 3 failures in 60s opens for 60s, then
    one probe → half-open → closed. Mirrors index.ts:108-134.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

import structlog

from .auth import AuthFailed, verify_admin
from .generator import GenerationError, generate_candidates
from .models import (
    BulkQuestionGenRequest,
    BulkQuestionGenResponse,
    is_valid_subject_for_grade,
)
from .ops_events import log_ops_event
from .oracle import grade_candidate
from .repository import RepositoryError, insert_questions
from .validator import validate_candidate

logger = structlog.get_logger(__name__)

# ── Circuit breaker (P12 — must always have fallback) ───────────────────────
# Mirrors TS index.ts:108-134. Per-process state; same scope as TS workers.


@dataclass
class _CircuitBreaker:
    failures: int = 0
    last_failure_at: float = 0.0
    state: str = "closed"  # 'closed' | 'open' | 'half-open'
    FAILURE_THRESHOLD: int = field(default=3)
    RESET_TIMEOUT_S: float = field(default=60.0)

    def can_request(self) -> bool:
        if self.state == "closed":
            return True
        if self.state == "open":
            if time.monotonic() - self.last_failure_at > self.RESET_TIMEOUT_S:
                self.state = "half-open"
                return True
            return False
        # half-open — allow one probe
        return True

    def record_success(self) -> None:
        self.failures = 0
        self.state = "closed"

    def record_failure(self) -> None:
        self.failures += 1
        self.last_failure_at = time.monotonic()
        if self.failures >= self.FAILURE_THRESHOLD:
            self.state = "open"


_breaker = _CircuitBreaker()


def reset_circuit_breaker() -> None:
    """Test-only: reset breaker between tests."""
    global _breaker
    _breaker = _CircuitBreaker()


# ── Custom exceptions ───────────────────────────────────────────────────────


class CircuitOpen(Exception):
    """Raised when the breaker is open — caller maps to 503."""


class HandlerError(Exception):
    """Generic handler failure with HTTP status hint."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


# ── Public entrypoint ───────────────────────────────────────────────────────


async def handle_bulk_question_gen(
    request: BulkQuestionGenRequest,
    *,
    authorization_header: str | None,
    request_id: str | None = None,
) -> BulkQuestionGenResponse:
    """Run the full bulk-question-gen flow.

    Steps (mirrors TS index.ts:997-1472):
      1. Verify admin auth (raises AuthFailed on 401/403).
      2. Cross-check subject vs grade (HandlerError on mismatch — 400).
      3. Check the circuit breaker (CircuitOpen on open — 503).
      4. Generate candidates via MoL.
      5. Validate each candidate (P6 + P11).
      6. Grade each valid candidate via the oracle (temp=0).
      7. Insert accepted candidates into question_bank.
      8. Emit ops_events telemetry.
      9. Return BulkQuestionGenResponse.
    """
    rid = request_id or str(uuid.uuid4())

    # 1. Auth — let AuthFailed bubble; route maps it to HTTP status.
    await verify_admin(authorization_header)

    # 2. CBSE subject-vs-grade cross-check. Pydantic validated each field
    # in isolation; the cross-field rule lives here so the rejection
    # message can name the grade-specific allowlist.
    if not is_valid_subject_for_grade(request.grade, request.subject):
        raise HandlerError(
            f"subject {request.subject!r} is not a valid CBSE subject for "
            f"grade {request.grade}",
            status=400,
        )

    # 3. Circuit breaker.
    if not _breaker.can_request():
        raise CircuitOpen("LLM circuit breaker is open. Try again in a moment.")

    try:
        # 4. Generate.
        candidates = await generate_candidates(request, request_id=rid)
        if not candidates:
            # No parseable candidates — still a success (zero generated),
            # not a circuit-breaker hit.
            _breaker.record_success()
            return BulkQuestionGenResponse(
                generated=0,
                inserted=0,
                rejected=0,
                oracle_evaluated=0,
                oracle_rejected=0,
                questions=[],
                warning="AI returned no parseable questions. Please retry.",
            )

        # 5 + 6. Validate + grade.
        accepted = []
        rejected_count = 0
        oracle_evaluated = 0
        oracle_rejected = 0

        for candidate in candidates:
            v = validate_candidate(candidate)
            if not v.ok:
                rejected_count += 1
                continue
            oracle_evaluated += 1
            grade_result = await grade_candidate(candidate)
            if not grade_result.ok:
                oracle_rejected += 1
                # Fire-and-forget rejection event. PII-safe context.
                await log_ops_event(
                    category="quiz.oracle_rejection",
                    source="bulk-question-gen",
                    severity="info",
                    message=f"Oracle rejected candidate: {grade_result.category}",
                    request_id=rid,
                    context={
                        "grade": request.grade,
                        "subject": request.subject,
                        "chapter": request.chapter,
                        "category": grade_result.category,
                        "reason": grade_result.reason[:300] if grade_result.reason else "",
                        "suggested_correct_index": grade_result.suggested_correct_index,
                        "llm_calls": grade_result.llm_calls,
                        # First 80 chars of question_text for triage (not PII).
                        "question_preview": candidate.question_text[:80],
                    },
                )
                continue
            await log_ops_event(
                category="quiz.oracle_evaluated",
                source="bulk-question-gen",
                severity="info",
                message="Oracle accepted candidate",
                request_id=rid,
                context={
                    "verdict": "accepted",
                    "llm_calls": grade_result.llm_calls,
                    "grade": request.grade,
                    "subject": request.subject,
                    "chapter": request.chapter,
                },
            )
            accepted.append(candidate)

        # 7. Insert.
        try:
            inserted = await insert_questions(accepted, request)
        except RepositoryError as err:
            _breaker.record_failure()
            raise HandlerError(str(err), status=500) from err

        _breaker.record_success()

        # 9. Return.
        warning: str | None = None
        if accepted and not inserted:
            warning = "All accepted candidates failed to persist. Check DB logs."
        elif candidates and not inserted:
            warning = "All generated questions failed validation. Please retry or adjust parameters."

        return BulkQuestionGenResponse(
            generated=len(candidates),
            inserted=len(inserted),
            rejected=rejected_count,
            oracle_evaluated=oracle_evaluated,
            oracle_rejected=oracle_rejected,
            questions=inserted,
            warning=warning,
        )

    except GenerationError as err:
        # MoL exhausted retries OR LLM returned unparseable output —
        # both count toward the breaker.
        _breaker.record_failure()
        raise HandlerError(f"AI generation failed: {err}", status=503) from err
    except (AuthFailed, HandlerError, CircuitOpen):
        raise
    except Exception as err:  # noqa: BLE001 — last-line safety net
        _breaker.record_failure()
        logger.exception(
            "bulk_question_gen.handler.unexpected_error",
            error=str(err),
            request_id=rid,
        )
        raise HandlerError("Internal server error", status=500) from err
