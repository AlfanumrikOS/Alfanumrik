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
