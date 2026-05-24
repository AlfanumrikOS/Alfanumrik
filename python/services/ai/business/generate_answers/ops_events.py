"""``logOpsEvent`` writer — writes one row to ``public.ops_events``.

Source: :file:`supabase/functions/_shared/ops-events.ts`.

For generate-answers we emit:
- ``quiz.answer_generated`` (severity='info') on every successful answer
  write. PII-safe context: question_id, grade, subject, methodology,
  marks_expected, answer_length (no answer body text — P13).
- ``quiz.answer_generation_failed`` (severity='info') on per-question
  failures so the super-admin dashboard can graph success rate.

The TS path does NOT currently emit ops_events for generate-answers — it
only writes a structured console.warn line. Phase 2 ADDS this telemetry so
the super-admin "answer coverage" dashboard can attribute generation
volume to the Python service (parity with bulk-question-gen's oracle
events).

Never raises — failures are swallowed with a structured warn line. The
fire-and-forget posture mirrors the bulk-question-gen ops_events writer.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

import structlog

from ...config import get_settings
from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)

OpsSeverity = Literal["info", "warning", "error", "critical"]


async def log_ops_event(
    *,
    category: str,
    source: str,
    severity: OpsSeverity,
    message: str,
    context: dict[str, Any] | None = None,
    request_id: str | None = None,
    subject_type: str | None = None,
    subject_id: str | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Insert one row into ``public.ops_events``.

    PII safety: caller is responsible for not putting raw answer text into
    ``context``. The current call sites only pass IDs + lengths + counters
    — all P13-safe.
    """
    client = get_service_client()
    if client is None:
        logger.debug(
            "generate_answers.ops_events.skipped",
            reason="no_supabase_client",
            category=category,
        )
        return

    s = get_settings()
    row = {
        "occurred_at": (occurred_at or datetime.now(UTC)).isoformat(),
        "category": category,
        "source": source,
        "severity": severity,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "message": message,
        "context": context or {},
        "request_id": request_id,
        "environment": s.environment,
    }

    try:
        await client.table("ops_events").insert(row).execute()
    except Exception as err:  # noqa: BLE001 — fire-and-forget by contract
        logger.warning(
            "generate_answers.ops_events.write_failed",
            error=str(err),
            category=category,
            severity=severity,
        )
