"""``ops_events`` writer for generate-concepts telemetry.

The TS Edge Function does NOT currently emit ops_events for
generate-concepts — it only writes structured console.warn lines. Phase 2
ADDS this telemetry so the super-admin dashboard can attribute concept-
generation volume to the Python service, in parity with bulk-question-gen's
oracle events and generate-answers' answer events.

Event categories:
- ``generate_concepts.batch.started``  — once at the top of POST.
- ``generate_concepts.chapter.success`` — one per chapter that lands rows.
- ``generate_concepts.chapter.failed``  — one per chapter that doesn't.
- ``generate_concepts.batch.complete`` — once at the bottom of POST.

PII safety: context blobs carry grade / subject / chapter_number / counters
ONLY — never concept text, never NCERT chunks, never any student
identifier. The events table is queried by the super-admin coverage
dashboard, which is service-role-only.

Fire-and-forget: any insert failure is swallowed with a structured warn
line. Telemetry MUST NOT block the user-facing batch.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

import structlog

from ...config import get_settings
from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)

OpsSeverity = Literal["info", "warning", "error", "critical"]


async def log_generate_concepts_event(
    *,
    category: str,
    severity: OpsSeverity,
    success: bool,
    message: str,
    context: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    """Insert one row into ``public.ops_events`` with source='generate-concepts'.

    Args:
        category: one of the ``generate_concepts.*`` namespaced strings
            listed in the module docstring.
        severity: severity bucket (info / warning / error / critical).
        success: whether the event represents a successful outcome.
            Currently stored in the context blob — kept as a separate
            kwarg for readability at call sites.
        message: human-readable description. SAFE FOR DASHBOARDS — never
            include concept text or other potentially-large content.
        context: structured metadata. P13: callers MUST NOT put concept
            text, NCERT content, or PII into this blob. Counters + ids
            + bucket labels only.
        request_id: trace id from the FastAPI middleware. None when
            called outside a request scope.
    """
    client = get_service_client()
    if client is None:
        logger.debug(
            "generate_concepts.ops_events.skipped",
            reason="no_supabase_client",
            category=category,
        )
        return

    s = get_settings()
    ctx = dict(context or {})
    ctx.setdefault("success", success)

    row = {
        "occurred_at": datetime.now(UTC).isoformat(),
        "category": category,
        "source": "generate-concepts",
        "severity": severity,
        # subject_type='admin' marks this as a service-side event, not a
        # student-attributable one. Matches the bulk-question-gen pattern.
        "subject_type": "admin",
        "subject_id": None,
        "message": message,
        "context": ctx,
        "request_id": request_id,
        "environment": s.environment,
    }

    try:
        await client.table("ops_events").insert(row).execute()
    except Exception as err:  # noqa: BLE001 — fire-and-forget by contract
        logger.warning(
            "generate_concepts.ops_events.write_failed",
            error=str(err),
            category=category,
            severity=severity,
        )
