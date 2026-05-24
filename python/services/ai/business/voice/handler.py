"""Orchestrator for voice transcription — composes budget guard + Whisper + telemetry.

Single-pass pipeline (no provider fallback, no circuit breaker):
  1. Validate the request envelope (size, format) — invoked by the route.
  2. Check the org-level daily INR budget cap.
  3. Call OpenAI Whisper (retry-with-backoff for transient failures).
  4. Map Whisper's iso-639-1 ``language`` → our DetectedLanguage enum.
  5. Compute INR cost (audio_seconds × Whisper rate × USD_TO_INR).
  6. Write one ops_events row (telemetry; fire-and-forget).
  7. Return :class:`TranscribeResponse`.

No circuit breaker here (yet): Whisper is a single-provider single-call
flow and a transient outage would gate ALL transcription if we added a
naive breaker. Phase 2.5 may revisit if we see Whisper instability under
load; the shared :mod:`services.ai.shared.retry` already absorbs the
common 502/503 patterns. For now, fail-CLOSED by raising
:class:`HandlerError` and letting the route return 502/503.

Public entrypoint: :func:`transcribe_audio`. The FastAPI route in
:mod:`services.ai.api.v1.voice` is a thin wrapper that maps exceptions
to HTTP status codes.
"""

from __future__ import annotations

import uuid
from typing import cast

import structlog

from ...config import get_settings
from ...shared.budget_guard import check_daily_budget
from .auth import StudentAuthResult
from .models import SupportedAudioFormat, TranscribeResponse, map_whisper_language
from .repository import log_voice_event
from .transcribe import (
    WHISPER_MAX_BYTES,
    WhisperError,
    call_whisper,
    estimate_cost_inr,
)

logger = structlog.get_logger(__name__)


# ── Custom exceptions ───────────────────────────────────────────────────────


class HandlerError(Exception):
    """Generic handler failure with HTTP status hint (route maps to HTTP)."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


class PayloadTooLargeError(HandlerError):
    """Audio file exceeds Whisper's 25 MiB cap. → HTTP 413."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status=413)


class BudgetExceededError(HandlerError):
    """Daily INR budget cap reached. → HTTP 429."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status=429)


class UpstreamWhisperError(HandlerError):
    """Whisper upstream error after retry exhaustion. → HTTP 502/503."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message, status=status)


# ── Public entrypoint ───────────────────────────────────────────────────────


async def transcribe_audio(
    audio_bytes: bytes,
    audio_format: str,
    student: StudentAuthResult,
    *,
    request_id: str | None = None,
    language_hint: str | None = None,
) -> TranscribeResponse:
    """Run the full STT pipeline and return :class:`TranscribeResponse`.

    Args:
        audio_bytes: raw audio file bytes. MUST be < 25 MiB (Whisper cap);
            we re-check here as defense in depth even though the route
            also enforces it.
        audio_format: one of :data:`SUPPORTED_AUDIO_FORMATS`. The route
            validates this; we trust it here.
        student: :class:`StudentAuthResult` from :func:`verify_student`.
            Carries student_id + grade + preferred_language for the
            ops_events row and the Whisper language hint.
        request_id: UUID4 string. The route generates one if absent.
        language_hint: caller-provided 'en'|'hi'|'hinglish' override.
            Falls back to ``student.preferred_language`` when None.

    Raises:
        :class:`PayloadTooLargeError`: bytes > 25 MiB.
        :class:`BudgetExceededError`: daily INR cap hit.
        :class:`UpstreamWhisperError`: Whisper unreachable after retries.
        :class:`HandlerError`: any other internal failure.

    Returns:
        :class:`TranscribeResponse` with transcript + detected_language +
        duration_seconds + cost_inr.
    """
    rid = request_id or str(uuid.uuid4())

    # 1. Size guard (defense in depth — route also enforces). Skip the
    #    Whisper call entirely if the blob is too large.
    if len(audio_bytes) > WHISPER_MAX_BYTES:
        mb = len(audio_bytes) / (1024 * 1024)
        # Telemetry for the rejection — useful for sizing future limits.
        await log_voice_event(
            request_id=rid,
            student_id=student.student_id,
            grade=student.grade,
            audio_format=audio_format,
            duration_seconds=0.0,
            detected_language="unknown",
            transcript_length=0,
            cost_inr=0.0,
            severity="warning",
            success=False,
            failure_reason=f"payload_too_large_{mb:.1f}MB",
        )
        raise PayloadTooLargeError(
            f"Audio file exceeds 25 MB (got {mb:.1f} MB)"
        )

    # 2. Budget check — fail-OPEN posture inside check_daily_budget means
    #    a Supabase outage won't gate transcription. Same trade-off as
    #    everywhere else in the AI service.
    if not await check_daily_budget(scope="org"):
        await log_voice_event(
            request_id=rid,
            student_id=student.student_id,
            grade=student.grade,
            audio_format=audio_format,
            duration_seconds=0.0,
            detected_language="unknown",
            transcript_length=0,
            cost_inr=0.0,
            severity="warning",
            success=False,
            failure_reason="daily_budget_exceeded",
        )
        raise BudgetExceededError(
            "Daily voice transcription budget exceeded. Try again tomorrow."
        )

    # 3. Whisper call. Prefer the caller's hint; fall back to the student's
    #    preferred_language. Whisper will auto-detect if both are None.
    effective_hint = language_hint or student.preferred_language
    try:
        raw = await call_whisper(
            audio_bytes,
            audio_format,
            language_hint=effective_hint,
        )
    except WhisperError as err:
        # Telemetry — failure path. We log status (no PII) at WARN. Don't
        # log audio bytes or transcripts (there are none here anyway).
        logger.warning(
            "voice.handler.whisper_failed",
            request_id=rid,
            upstream_status=err.status,
        )
        await log_voice_event(
            request_id=rid,
            student_id=student.student_id,
            grade=student.grade,
            audio_format=audio_format,
            duration_seconds=0.0,
            detected_language="unknown",
            transcript_length=0,
            cost_inr=0.0,
            severity="error",
            success=False,
            failure_reason=f"whisper_status_{err.status}",
        )
        # Map upstream status → route status. 401/4xx from Whisper means
        # our API key is wrong → 503 (service misconfigured). Otherwise
        # surface as 502 (upstream issue).
        route_status = 503 if err.status in (0, 401, 403) else 502
        raise UpstreamWhisperError(
            f"Whisper transcription failed (upstream status {err.status})",
            status=route_status,
        ) from err

    # 4. Map response — Whisper's language is iso-639-1; our enum is broader.
    transcript_raw = str(raw.get("text") or "")
    transcript = transcript_raw.strip()
    whisper_language = str(raw.get("language") or "")
    detected = map_whisper_language(whisper_language, transcript)

    # 5. Duration + cost.
    try:
        duration_s = float(raw.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration_s = 0.0
    # Clamp negative durations (defensive — Whisper has never returned one).
    if duration_s < 0:
        duration_s = 0.0

    s = get_settings()
    cost_inr = estimate_cost_inr(duration_s, s.usd_to_inr)

    # 6. Telemetry — success path. PII-safe: only length + duration +
    #    language. No transcript, no audio bytes.
    await log_voice_event(
        request_id=rid,
        student_id=student.student_id,
        grade=student.grade,
        audio_format=audio_format,
        duration_seconds=duration_s,
        detected_language=detected,
        transcript_length=len(transcript),
        cost_inr=cost_inr,
        severity="info",
        success=True,
    )

    # 7. Response.
    #
    # ``audio_format`` is a runtime str but the model field is the
    # SupportedAudioFormat Literal. The route restricts incoming values to
    # the allowlist before calling us, so this cast is sound; mypy can't
    # see through the route's runtime check, so we cast explicitly.
    return TranscribeResponse(
        transcript=transcript,
        detected_language=detected,
        duration_seconds=duration_s,
        audio_format=cast("SupportedAudioFormat", audio_format),
        cost_inr=cost_inr,
        request_id=rid,
    )
