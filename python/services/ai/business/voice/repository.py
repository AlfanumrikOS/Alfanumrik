"""``ops_events`` telemetry writes for the voice transcribe pipeline.

Same writer pattern as :mod:`services.ai.business.bulk_question_gen.ops_events`
(re-implemented locally rather than imported from there because we may
want different severity defaults / different sampling — keeping the
modules independent makes future divergence cheap).

PII safety (P13):
- We never persist the raw transcript. ``transcript_length`` (int) is
  enough for cost reconciliation and quality monitoring.
- We never persist raw audio bytes. Duration in seconds is sufficient.
- ``student_id`` is the ``students.id`` UUID, which is the existing
  convention elsewhere (chat_sessions, foxy_sessions, mol_request_logs).
  UUIDs aren't PII per the codebase posture.
- No name / email / phone is ever sent to ``ops_events``.

Failure mode: fire-and-forget. Logger warns on insert failure but the
user-facing transcript response is unaffected (observability MUST NOT
break the user request — same posture as the bulk-question-gen writer).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

import structlog

from ...config import get_settings
from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)

OpsSeverity = Literal["info", "warning", "error", "critical"]

# Event categories used by the super-admin voice dashboard (TBD). Keep this
# tuple small so the dashboard filter UI has a known set to render against.
VOICE_EVENT_SUCCESS = "voice.transcribe.success"
VOICE_EVENT_FAILURE = "voice.transcribe.failure"


async def log_voice_event(
    *,
    request_id: str,
    student_id: str | None,
    grade: str | None,
    audio_format: str,
    duration_seconds: float,
    detected_language: str,
    transcript_length: int,
    cost_inr: float,
    severity: OpsSeverity = "info",
    success: bool = True,
    failure_reason: str | None = None,
) -> None:
    """Insert one row into ``public.ops_events`` for a transcription event.

    Row shape mirrors the existing TS writer (see
    :file:`supabase/functions/_shared/ops-events.ts`) so the super-admin
    events dashboard surfaces voice activity without schema changes:

        {
          occurred_at: now(),
          category: 'voice.transcribe.success' | 'voice.transcribe.failure',
          source:   'voice-transcribe',
          severity: 'info'|'warning'|'error'|'critical',
          subject_type: 'student',
          subject_id: <students.id UUID>,
          message:  short human description,
          context:  { request_id, audio_format, audio_duration_seconds,
                       detected_language, transcript_length, cost_inr,
                       grade, [failure_reason] },
          request_id: <UUID for log correlation>,
          environment: 'production' | 'staging' | 'local',
        }

    Never raises — failures are swallowed with a structured warn line.
    """
    client = get_service_client()
    if client is None:
        logger.debug(
            "voice.ops_events.skipped",
            reason="no_supabase_client",
            request_id=request_id,
        )
        return

    s = get_settings()
    category = VOICE_EVENT_SUCCESS if success else VOICE_EVENT_FAILURE
    message = (
        f"Voice transcribed: {round(duration_seconds, 2)}s "
        f"({detected_language})"
        if success
        else f"Voice transcription failed: {failure_reason or 'unknown'}"
    )

    context: dict[str, Any] = {
        "request_id": request_id,
        "audio_format": audio_format,
        "audio_duration_seconds": round(duration_seconds, 2),
        "detected_language": detected_language,
        "transcript_length": int(transcript_length),
        "cost_inr": cost_inr,
        "grade": grade,
    }
    if failure_reason and not success:
        # Truncate to keep the context blob small; the full failure trace
        # belongs in Cloud Run logs (structlog), not in ops_events.
        context["failure_reason"] = failure_reason[:300]

    row = {
        "occurred_at": datetime.now(UTC).isoformat(),
        "category": category,
        "source": "voice-transcribe",
        "severity": severity,
        "subject_type": "student" if student_id else None,
        "subject_id": student_id,
        "message": message,
        # PII safety reminder: never put the transcript or audio bytes here.
        # Caller already passes length + duration only — keep it that way.
        "context": context,
        "request_id": request_id,
        "environment": s.environment,
    }

    try:
        await client.table("ops_events").insert(row).execute()
    except Exception as err:  # noqa: BLE001 — fire-and-forget by contract
        logger.warning(
            "voice.ops_events.write_failed",
            error=str(err),
            category=category,
            request_id=request_id,
        )
