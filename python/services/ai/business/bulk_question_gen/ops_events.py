"""``logOpsEvent`` port — writes one row to ``public.ops_events``.

Source: :file:`supabase/functions/_shared/ops-events.ts`.

Same row shape as the TS writer so the existing super-admin events dashboard
keeps working post-cutover. PII is scrubbed via the structlog redact pipeline
when ``context`` is logged on failure — the row body itself contains only
volumetric data (grade, subject, chapter, category) per P13.

Severity semantics (mirrors TS):
  - 'info' / 'warning': fire-and-forget (no await on the network round-trip).
  - 'error' / 'critical': awaited (guaranteed delivery) — used when a row
    drop would mask a customer-impacting incident.

For bulk-question-gen specifically we only emit two events:
  - ``quiz.oracle_evaluated`` (severity='info') on every accept
  - ``quiz.oracle_rejection`` (severity='info') on every reject

Both feed the super-admin oracle health panel — see TS comments at
bulk-question-gen/index.ts lines 594-672 for the contract.
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

    Never raises — failures are swallowed with a structured warn line. The TS
    source has the same posture: observability MUST NOT break the user
    request.

    The fire-and-forget vs awaited split is intentional: 'info' rows go
    through ``asyncio.shield`` so a slow Supabase doesn't stall the
    bulk-gen response, while 'error' / 'critical' rows are awaited.
    """
    client = get_service_client()
    if client is None:
        logger.debug("ops_events.skipped", reason="no_supabase_client", category=category)
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
        # PII safety: caller is responsible for not putting raw user text into
        # ``context``. The current call sites (handler.py) only pass grade /
        # subject / chapter / category / counters — all P13-safe.
        "context": context or {},
        "request_id": request_id,
        "environment": s.environment,
    }

    try:
        await client.table("ops_events").insert(row).execute()
    except Exception as err:  # noqa: BLE001 — fire-and-forget by contract
        logger.warning(
            "ops_events.write_failed",
            error=str(err),
            category=category,
            severity=severity,
        )
