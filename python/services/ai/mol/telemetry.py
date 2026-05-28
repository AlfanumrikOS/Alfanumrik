"""Telemetry writer — inserts one row into ``public.mol_request_logs``.

The row shape MUST match the TS-side writer (telemetry.ts:recordMolRequest)
column-for-column so the existing super-admin dashboard, the
``mol_request_health_24h`` view, and ``mol_shadow_pairs_v1`` keep working
once we cut traffic from TS → Python.

Fire-and-forget: this writer NEVER raises. The TS source has the same
posture — observability must never break the user request.

PII: this writer never accepts free-form text. ``student_id`` is a UUID
(validated by Pydantic upstream); ``grade`` / ``language`` / ``exam_goal``
are enum strings; ``failure_chain`` is a tokenized error label list. If
that contract changes, redact via :func:`services.ai.observability.logger`
before persisting.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

import structlog

from .types import TokenUsage

logger = structlog.get_logger(__name__)


@dataclass
class LogPayload:
    """Mirrors TS ``LogPayload`` field-for-field.

    Default-None on every optional shadow field so the row always writes
    explicit NULLs into the new nullable columns (matches the C4 contract
    described in the migration comment).
    """

    request_id: str
    student_id: str | None
    task_type: str
    surface: str | None
    provider: str
    model: str
    passes: int
    fallback_count: int
    failure_chain: str | None
    latency_ms: int
    tokens: TokenUsage
    usd_cost: float
    inr_cost: float
    grade: str | None
    language: str | None
    exam_goal: str | None

    # C4 foundation: shadow-routing pair correlation. All optional.
    shadow_of_request_id: str | None = None
    shadow_role: Literal["baseline", "shadow"] | None = None
    trace_id: str | None = None


def _row_from_payload(p: LogPayload) -> dict:
    """Project a LogPayload into the exact mol_request_logs insert shape.

    Kept as a pure function so tests can assert on the dict without spinning
    up a Supabase client.
    """
    return {
        "request_id": p.request_id,
        "student_id": p.student_id,
        "task_type": p.task_type,
        "surface": p.surface,
        "provider": p.provider,
        "model": p.model,
        "passes": p.passes,
        "fallback_count": p.fallback_count,
        "failure_chain": p.failure_chain,
        "latency_ms": p.latency_ms,
        "prompt_tokens": p.tokens.prompt,
        "completion_tokens": p.tokens.completion,
        "usd_cost": p.usd_cost,
        "inr_cost": p.inr_cost,
        "grade": p.grade,
        "language": p.language,
        "exam_goal": p.exam_goal,
        "shadow_of_request_id": p.shadow_of_request_id,
        "shadow_role": p.shadow_role,
        "trace_id": p.trace_id,
    }


async def record_mol_request(payload: LogPayload) -> None:
    """Fire-and-forget insert into ``public.mol_request_logs``.

    Never raises — every failure path is swallowed with a structured warn
    line. The TS source uses the same posture: observability must not
    break the user-facing request path.

    Lazy import of the Supabase client so unit tests can patch
    :mod:`services.ai.db.supabase` without dragging postgrest into the
    import graph.
    """
    try:
        from ..db.supabase import get_service_client

        client = get_service_client()
        if client is None:
            # No Supabase configured — local dev / pytest happy path.
            logger.debug("mol.telemetry.skipped", reason="no_supabase_client")
            return

        row = _row_from_payload(payload)
        # postgrest-py's APIRequestBuilder is sync at the .insert() call but
        # the network round-trip is async via .execute(). Same surface as the
        # TS .then() pattern.
        await client.table("mol_request_logs").insert(row).execute()
    except Exception as err:  # noqa: BLE001 — fire-and-forget by contract
        msg = str(err) if err else type(err).__name__
        logger.warning("mol.telemetry.write_failed", error=msg)


def sum_tokens(usages: list[TokenUsage]) -> TokenUsage:
    """Combine multiple pass token-usages into a single MolResult tokens block."""
    total = TokenUsage()
    for u in usages:
        total = total + u
    return total


@dataclass
class ShadowTextPayload:
    """Payload for record_shadow_text. All text fields are pre-PII-redaction."""
    baseline_request_id: str
    shadow_request_id: str
    question_text: str
    baseline_system_prompt: str
    shadow_system_prompt: str | None
    baseline_response_text: str
    shadow_response_text: str


_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{9}\b")
_RZP_ID_RE = re.compile(r"\b(pay|order|rzp|cust|sub|inv)_[A-Za-z0-9]{14,}\b")


def redact_pii_in_text(s: str) -> tuple[str, list[str]]:
    """Strip email/Indian-phone/Razorpay-ID patterns and return applied labels."""
    if not s:
        return s, []
    applied = set()
    out = s
    if _EMAIL_RE.search(out):
        out = _EMAIL_RE.sub("[REDACTED_EMAIL]", out)
        applied.add("email")
    if _PHONE_RE.search(out):
        out = _PHONE_RE.sub("[REDACTED_PHONE]", out)
        applied.add("phone")
    if _RZP_ID_RE.search(out):
        out = _RZP_ID_RE.sub("[REDACTED_PAYMENT_ID]", out)
        applied.add("payment_id")
    return out, sorted(list(applied))


async def record_shadow_text(p: ShadowTextPayload) -> None:
    """Fire-and-forget write to mol_shadow_text_buffer with PII redaction.
    
    The DB has a 7-day TTL. The async grader CRON reads these rows, grades the
    shadow response, and deletes the row upon completion.
    """
    try:
        from ..db.supabase import get_service_client

        client = get_service_client()
        if client is None:
            logger.debug("mol.telemetry.shadow_text_skipped", reason="no_supabase_client")
            return

        q_text, q_app = redact_pii_in_text(p.question_text)
        base_sys_text, base_sys_app = redact_pii_in_text(p.baseline_system_prompt)
        base_resp_text, base_resp_app = redact_pii_in_text(p.baseline_response_text)
        shadow_resp_text, shadow_resp_app = redact_pii_in_text(p.shadow_response_text)
        
        if p.shadow_system_prompt is not None:
            shadow_sys_text, shadow_sys_app = redact_pii_in_text(p.shadow_system_prompt)
        else:
            shadow_sys_text, shadow_sys_app = None, []

        applied = sorted(list(set(q_app + base_sys_app + base_resp_app + shadow_resp_app + shadow_sys_app)))

        row = {
            "baseline_request_id": p.baseline_request_id,
            "shadow_request_id": p.shadow_request_id,
            "question_text": q_text,
            "baseline_system_prompt": base_sys_text,
            "shadow_system_prompt": shadow_sys_text,
            "baseline_response_text": base_resp_text,
            "shadow_response_text": shadow_resp_text,
            "redaction_applied": applied,
        }
        
        await client.table("mol_shadow_text_buffer").insert(row).execute()
    except Exception as err:
        msg = str(err) if err else type(err).__name__
        logger.warning("mol.telemetry.shadow_text_write_failed", error=msg)
