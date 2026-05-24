"""OpenAI Whisper API call — speech-to-text for voice transcription.

Direct httpx call (not routed through MoL). MoL exists for text generation
chains (Anthropic + OpenAI chat-completions, retry + provider fallback);
Whisper is a single-provider audio endpoint with a distinct response shape,
so going direct is simpler and avoids forcing MoL to grow audio awareness.

We DO reuse the shared :func:`retry_with_backoff` decorator for transient
failures — Whisper occasionally returns 502/503 under load, and the
decorator's default predicate already retries on those.

Cost model: OpenAI charges $0.006 per minute of audio for whisper-1
(verified 2026-05-24 via https://openai.com/api/pricing). At USD_TO_INR=83
that's ~₹0.498/min ≈ ₹0.50/min. We multiply audio duration → minutes →
USD → INR for the per-call cost.

Fail-CLOSED posture: any HTTP error after retries is re-raised. The handler
catches and maps to a 502 ('upstream Whisper error') — we never invent a
transcript on failure.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import httpx
import structlog

from ...config import get_settings
from ...shared.retry import retry_with_backoff

logger = structlog.get_logger(__name__)

# ── Whisper API constants ──────────────────────────────────────────────────

WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions"
WHISPER_MODEL = "whisper-1"

# Whisper pricing: $0.006/minute (verified 2026-05-24 at openai.com/api/pricing).
# Multiplied by USD_TO_INR (from Settings) downstream to produce per-call INR.
COST_USD_PER_MINUTE = 0.006

# OpenAI Whisper hard limit on upload size — 25 MiB per request. We
# enforce client-side in the handler for an early reject + readable error;
# this constant is kept here so the retry layer can also bail early if the
# blob is too large (no point retrying a 413).
WHISPER_MAX_BYTES = 25 * 1024 * 1024  # 25 MiB

# Per-call timeout. Whisper has been measured at ~1s/10s-of-audio at the
# 90th percentile in our internal smoke runs; 30s gives a safe ceiling for
# a 25 MiB clip while staying under the Cloud Run per-request 300s cap.
DEFAULT_TIMEOUT_S = 30.0

# Whisper supports the iso-639-1 two-letter code. We map our internal
# 'hinglish' marker to 'hi' here so a student with preferred_language='hinglish'
# still gets a useful language hint — Hindi recognition handles mixed Devanagari
# + Latin better than English recognition does for the same input. Same posture
# as ``src/lib/voice.ts:LANG_MAP``.
_OUR_LANG_TO_WHISPER_HINT = {
    "en": "en",
    "hi": "hi",
    "hinglish": "hi",
}


class WhisperError(RuntimeError):
    """Raised after retry exhaustion on a Whisper HTTP error.

    Carries the upstream status code (or 0 for network failures) so the
    route can decide whether to map to 502 (upstream) or 503 (we can't
    reach Whisper at all).
    """

    def __init__(self, message: str, *, status: int = 0) -> None:
        super().__init__(message)
        self.status = status


@retry_with_backoff(max_attempts=3, base_delay=1.0, max_delay=8.0)
async def call_whisper(
    audio_bytes: bytes,
    audio_format: str,
    *,
    language_hint: str | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_S,
) -> dict[str, Any]:
    """Call OpenAI Whisper API and return the raw verbose_json response.

    The decorator (3 attempts, 1-8s backoff) covers transient 502/503/
    timeout from Whisper. Auth failures (401), bad-request (400), and
    payload-too-large (413) are raised on the first attempt; the
    decorator's default predicate does not retry 4xx.

    Args:
        audio_bytes: raw audio file bytes. Caller MUST verify size <
            :data:`WHISPER_MAX_BYTES` before calling — we don't re-check
            here so the retry layer doesn't burn budget on a doomed call.
        audio_format: one of the supported extensions ('webm','mp3','wav',
            'm4a','ogg','mpga','flac'). Used to set the multipart filename
            + Content-Type so Whisper picks the right decoder.
        language_hint: optional iso-639-1 code ('en'|'hi'). Pass through
            our :data:`_OUR_LANG_TO_WHISPER_HINT` map so internal tokens
            like 'hinglish' are folded to 'hi'. Omit (None) to let
            Whisper auto-detect — recommended for short clips.
        timeout_seconds: per-attempt timeout. The retry budget worst-case
            is ``max_attempts * timeout_seconds + total_backoff``; with
            defaults that's ``3 * 30 + ~9 = ~99s``, well under the
            Cloud Run 300s ceiling.

    Returns:
        The decoded JSON dict with shape (per Whisper docs):
            ``{
                "text": str,
                "language": str,  # iso-639-1, e.g. 'en' or 'hi'
                "duration": float,  # seconds
                "segments": list[dict],  # token-level details (we ignore)
                "task": "transcribe",
            }``

    Raises:
        :class:`WhisperError`: after retries exhausted OR on a 4xx that
            we don't retry. The ``status`` attribute carries the upstream
            HTTP code (0 for network-level failures).
    """
    s = get_settings()
    if not s.openai_api_key:
        # Misconfigured — fail-closed. Route maps this to 503.
        raise WhisperError("OpenAI API key not configured", status=0)

    # Resolve the language hint via our internal alias map. None / unknown
    # alias → omit the parameter entirely so Whisper auto-detects.
    resolved_hint: str | None = None
    if language_hint:
        resolved_hint = _OUR_LANG_TO_WHISPER_HINT.get(language_hint.lower().strip())

    files = {
        # NOTE: BytesIO is rewound on every retry because we wrap in a
        # fresh BytesIO inside the call — the wrapper above just hands us
        # ``audio_bytes`` (the raw payload) on each attempt.
        "file": (
            f"audio.{audio_format}",
            BytesIO(audio_bytes),
            f"audio/{audio_format}",
        ),
    }
    data: dict[str, str] = {
        "model": WHISPER_MODEL,
        # verbose_json returns language + duration; perfect for our shape.
        "response_format": "verbose_json",
    }
    if resolved_hint:
        data["language"] = resolved_hint

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                WHISPER_API_URL,
                headers={"Authorization": f"Bearer {s.openai_api_key}"},
                files=files,
                data=data,
            )
    except httpx.HTTPError as err:
        # Network-level — connection refused, DNS, timeout, etc. The retry
        # decorator's default predicate retries these.
        raise WhisperError(f"Whisper network error: {err}", status=0) from err

    if response.status_code != 200:
        # Map common upstream statuses to a WhisperError carrying the code.
        # 429/5xx pass through the retry predicate; 4xx (other than 429)
        # short-circuit on first attempt.
        status = response.status_code
        # Don't include the body verbatim — Whisper sometimes echoes the
        # filename. Log just the status + short error class.
        logger.warning(
            "voice.whisper.non_200",
            status=status,
            audio_format=audio_format,
        )
        raise WhisperError(f"Whisper returned HTTP {status}", status=status)

    try:
        body = response.json()
    except ValueError as err:
        # 200 but non-JSON — Whisper contract violation, treat as upstream.
        raise WhisperError("Whisper returned non-JSON 200", status=200) from err

    if not isinstance(body, dict):
        raise WhisperError("Whisper returned non-dict JSON", status=200)

    # Whisper SHOULD always include text + language + duration in
    # verbose_json. Defensive defaults so the handler doesn't crash on a
    # quirky 200 response.
    body.setdefault("text", "")
    body.setdefault("language", "")
    body.setdefault("duration", 0.0)
    return body


def estimate_cost_inr(duration_seconds: float, usd_to_inr: float) -> float:
    """Compute INR cost for ``duration_seconds`` of audio at the Whisper rate.

    Pure function — kept module-level so tests can pin the math without
    spinning up the full settings stack.

    Math:
        cost_usd = (duration_s / 60) * $0.006
        cost_inr = cost_usd * usd_to_inr
        rounded  = round(cost_inr, 4)

    Examples:
        - 60 s at USD_TO_INR=83 → 1 × 0.006 × 83 = 0.498 → ₹0.4980
        - 120 s at USD_TO_INR=83 → 2 × 0.006 × 83 = 0.996 → ₹0.9960
        - 0 s → ₹0.0
    """
    if duration_seconds <= 0:
        return 0.0
    usd = (duration_seconds / 60.0) * COST_USD_PER_MINUTE
    inr = usd * usd_to_inr
    return round(inr, 4)
