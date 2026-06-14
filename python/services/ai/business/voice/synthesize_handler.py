"""Orchestrator for voice synthesis — composes budget guard + Azure TTS + telemetry.

Sibling of :mod:`services.ai.business.voice.handler` (Whisper STT) on
the output half of the voice loop. Single-pass pipeline (no provider
fallback, no circuit breaker — Phase 2 floor; voice TTS is single-
provider for now):

  1. Validate the text length (defense in depth — Pydantic also checks).
  2. Check the org-level daily INR budget cap.
  3. Resolve the Azure voice id from (language, gender) or voice_override.
  4. Call Azure TTS (retry-with-backoff for transient failures).
  5. Compute INR cost (chars × Azure per-million rate × USD_TO_INR).
  6. Write one ops_events row (telemetry; fire-and-forget).
  7. Return :class:`SynthesizeResult` carrying raw audio bytes + metadata
     for the route to wire into headers.

No circuit breaker here (yet): the budget guard at the org level is the
hard ceiling on runaway spend; if Azure goes down completely, the
voice feature degrades gracefully — the frontend (Voice 2) will swallow
the 502 and fall back to text-only mode.

PII safety (P13):
  - We never persist the raw text. ``char_count`` (int) is enough for
    cost reconciliation.
  - The retry decorator inside ``call_azure_tts`` logs only the status
    and voice name, never the SSML body.

Public entrypoint: :func:`synthesize_speech`. The FastAPI route in
:mod:`services.ai.api.v1.voice` is a thin wrapper that maps exceptions
to HTTP status codes and serializes ``SynthesizeResult.audio_bytes``
into the response body.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import structlog

from ...config import get_settings
from ...shared.budget_guard import check_daily_budget
from .auth import StudentAuthResult
from .repository import log_voice_synthesize_event
from .tts import (
    MAX_TEXT_CHARS,
    AzureTTSError,
    call_azure_tts,
    estimate_cost_inr,
    resolve_voice,
)

logger = structlog.get_logger(__name__)


# ── Custom exceptions ───────────────────────────────────────────────────────


class SynthesizeHandlerError(Exception):
    """Generic synthesize-handler failure with HTTP status hint.

    Parallel hierarchy to :class:`HandlerError` (the Whisper handler) —
    we deliberately keep them distinct so the two flows can diverge
    later (different upstream error mapping, different rate limits)
    without one path's change silently affecting the other.
    """

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


class TextTooLongError(SynthesizeHandlerError):
    """``text`` field exceeds :data:`MAX_TEXT_CHARS` (defense in depth). → HTTP 413."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status=413)


class SynthesizeBudgetExceededError(SynthesizeHandlerError):
    """Daily INR budget cap reached. → HTTP 429."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status=429)


class UpstreamAzureError(SynthesizeHandlerError):
    """Azure TTS upstream error after retry exhaustion. → HTTP 502/503."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message, status=status)


# ── Result dataclass (NOT a Pydantic model — we return raw bytes) ──────────


@dataclass(frozen=True, slots=True)
class SynthesizeResult:
    """Successful TTS result returned by :func:`synthesize_speech`.

    Deliberately a plain dataclass, not a Pydantic model. The route
    serializes ``audio_bytes`` directly into the HTTP body and writes
    the rest as headers — there is no JSON wire format for this
    response. A Pydantic model would imply a JSON envelope which would
    confuse the frontend contract.

    Fields:
      audio_bytes: raw ``audio/mpeg`` bytes from Azure.
      voice_used: the Azure voice id we ended up calling (after
        voice_override / catalog resolution). Surfaced as ``X-Voice-Used``.
      cost_inr: estimated cost in INR for this synthesis. Surfaced as
        ``X-Cost-Inr`` (4 decimal places).
      char_count: number of characters synthesized. Surfaced as
        ``X-Char-Count``.
      request_id: UUIDv4 for log correlation. Surfaced as ``X-Request-Id``.
    """

    audio_bytes: bytes
    voice_used: str
    cost_inr: float
    char_count: int
    request_id: str


# ── Public entrypoint ───────────────────────────────────────────────────────


async def synthesize_speech(
    text: str,
    language: str,
    gender: str,
    voice_override: str | None,
    student: StudentAuthResult,
    *,
    request_id: str | None = None,
) -> SynthesizeResult:
    """Run the full TTS pipeline and return :class:`SynthesizeResult`.

    Args:
        text: Text to synthesize. Pydantic already enforces 1..2000 chars
            at the route boundary; we re-check here as defense in depth.
        language: ``'en'`` | ``'hi'`` | ``'hinglish'``. Pydantic-validated.
        gender: ``'female'`` | ``'male'``. Pydantic-validated.
        voice_override: Full Azure voice id, or None. Pydantic-validated
            against the neural-voice regex.
        student: :class:`StudentAuthResult` from :func:`verify_student`.
            Carries ``student_id`` + ``grade`` for the ops_events row.
        request_id: UUIDv4 string. The route generates one if absent.

    Raises:
        :class:`TextTooLongError`: text > 2000 chars (route-validator
            bypass detected).
        :class:`SynthesizeBudgetExceededError`: daily INR cap hit.
        :class:`UpstreamAzureError`: Azure unreachable / misconfigured /
            5xx after retries.
        :class:`SynthesizeHandlerError`: any other internal failure.

    Returns:
        :class:`SynthesizeResult` with raw audio bytes + metadata.
    """
    rid = request_id or str(uuid.uuid4())
    char_count = len(text)

    # 1. Length guard (defense in depth — Pydantic also enforces). Skip
    #    the Azure call entirely if the text is too long.
    if char_count > MAX_TEXT_CHARS:
        await log_voice_synthesize_event(
            request_id=rid,
            student_id=student.student_id,
            grade=student.grade,
            voice_used="",
            char_count=char_count,
            cost_inr=0.0,
            language=language,
            gender=gender,
            severity="warning",
            success=False,
            failure_reason=f"text_too_long_{char_count}_chars",
        )
        raise TextTooLongError(f"Text exceeds {MAX_TEXT_CHARS} chars (got {char_count})")

    # 2. Budget check — fail-OPEN posture inside check_daily_budget means
    #    a Supabase outage won't gate synthesis. Same trade-off as
    #    everywhere else in the AI service.
    if not await check_daily_budget(scope="org"):
        await log_voice_synthesize_event(
            request_id=rid,
            student_id=student.student_id,
            grade=student.grade,
            voice_used="",
            char_count=char_count,
            cost_inr=0.0,
            language=language,
            gender=gender,
            severity="warning",
            success=False,
            failure_reason="daily_budget_exceeded",
        )
        raise SynthesizeBudgetExceededError(
            "Daily voice synthesis budget exceeded. Try again tomorrow."
        )

    # 3. Voice resolution — voice_override (if valid) wins over catalog.
    voice_name = resolve_voice(language, gender, voice_override)

    # 4. Azure TTS call. The retry decorator inside ``call_azure_tts``
    #    absorbs transient 5xx; we only see exhaustion or a 4xx here.
    try:
        audio = await call_azure_tts(text, voice_name, gender=gender)
    except AzureTTSError as err:
        # Telemetry — failure path. We log status (no PII) at WARN. Don't
        # log text or audio bytes (there are none here anyway).
        logger.warning(
            "voice.synthesize_handler.azure_failed",
            request_id=rid,
            upstream_status=err.status,
        )
        await log_voice_synthesize_event(
            request_id=rid,
            student_id=student.student_id,
            grade=student.grade,
            voice_used=voice_name,
            char_count=char_count,
            cost_inr=0.0,
            language=language,
            gender=gender,
            severity="error",
            success=False,
            failure_reason=f"azure_status_{err.status}",
        )
        # Map upstream status → route status. 0 (network) / 401 / 403
        # from Azure all mean "we're misconfigured" → 503. Anything else
        # (5xx, 429) → 502 (upstream issue, retry on next request).
        route_status = 503 if err.status in (0, 401, 403) else 502
        raise UpstreamAzureError(
            f"Azure TTS synthesis failed (upstream status {err.status})",
            status=route_status,
        ) from err

    # 5. Cost.
    s = get_settings()
    cost_inr = estimate_cost_inr(char_count, s.usd_to_inr)

    # 6. Telemetry — success path. PII-safe: only length + language +
    #    voice + cost. No raw text, no audio bytes.
    await log_voice_synthesize_event(
        request_id=rid,
        student_id=student.student_id,
        grade=student.grade,
        voice_used=voice_name,
        char_count=char_count,
        cost_inr=cost_inr,
        language=language,
        gender=gender,
        severity="info",
        success=True,
    )

    # 7. Result.
    return SynthesizeResult(
        audio_bytes=audio,
        voice_used=voice_name,
        cost_inr=cost_inr,
        char_count=char_count,
        request_id=rid,
    )
