"""Azure Cognitive Services Speech REST client — text-to-speech (Voice 1b).

Sibling of :mod:`services.ai.business.voice.transcribe` (Whisper STT) but
on a different provider. Direct httpx call — we deliberately do NOT pull
the ``azure-cognitiveservices-speech`` SDK. Rationale:

  1. SDK is ~30 MiB of bundled native binaries; the REST API surface we
     need is one POST endpoint.
  2. The SDK ships its own retry/backoff config that would conflict with
     our shared :func:`retry_with_backoff` decorator. Going direct keeps
     the retry budget consistent with the Whisper path.
  3. The REST surface is small enough that direct httpx mirrors the
     Whisper pattern exactly — easier to audit, easier to test (one
     respx mock instead of an SDK monkey-patch).

We DO reuse the shared :func:`retry_with_backoff` for transient failures
(Azure occasionally returns 503 during region rebalances). 4xx short-
circuit on the first attempt — the default predicate doesn't retry them.

Cost model (confirmed 2026-05-24 via Azure pricing docs):
  - Standard neural voices: **$16 / 1M characters** (free tier: first
    500K chars/month).
  - At USD_TO_INR=83, that's ~₹0.00133/char.
  - Typical AI tutor reply (~300 chars): ~$0.0048 / ₹0.40.
  - We compute per-call INR and log via the repository writer; the
    daily budget guard at org level is the hard ceiling against runaway
    spend (NOT enforced per call here).

Fail-CLOSED posture: any HTTP error after retries is re-raised. The
handler maps to 502 ('upstream Azure error') or 503 ('we're
misconfigured' — empty key / non-2xx auth). We NEVER invent audio on
failure — better a clean 502 than a wrong-accent or silent clip.

PII safety: the SSML body is built from caller-supplied ``text`` only.
We do NOT log the text. The retry decorator logs ``fn.__qualname__`` and
the exception string; the latter could include Azure's echo of the SSML
on certain 4xx — we intercept and log only the status code.
"""

from __future__ import annotations

import html

import httpx
import structlog

from ...config import get_settings
from ...shared.retry import retry_with_backoff

logger = structlog.get_logger(__name__)

# ── Azure TTS constants ────────────────────────────────────────────────────

# The Azure Speech REST endpoint. Region is interpolated at call time so
# ops can move regions without a code change (centralindia today; phase 3
# may explore a multi-region active-active setup).
AZURE_TTS_PATH = "/cognitiveservices/v1"

# Output format we request from Azure. 24kHz mono MP3 at 48kbps is the
# sweet spot for AI-tutor playback: ~6 KB/s download (negligible on Indian
# 4G), small enough to cache, and indistinguishable from 192kbps on the
# 1-2-min clips a tutor reply turns into. See the full Azure format
# matrix at https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech.
AZURE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

# Hard cap on text length — same as the Pydantic field cap. Defense in
# depth: a bug in the route could let an oversized request through, and
# we don't want to discover that mid-Azure-call.
MAX_TEXT_CHARS = 2000

# Azure standard neural pricing: $16 per million characters. The free
# tier (first 500K chars/month) is honored at the billing layer; we
# compute the per-call cost from this rate unconditionally so the
# super-admin dashboard surfaces the full would-be-billed amount.
COST_USD_PER_MILLION_CHARS = 16.0

# Per-call timeout. Azure TTS produces audio at roughly 8x real-time —
# a 30-second clip generates in ~4s at the 90th percentile. 30s gives
# safe headroom for a 2000-char request (~3 minutes of audio).
DEFAULT_TIMEOUT_S = 30.0


# ── Voice catalog (HARD-CODED — do NOT make this config) ───────────────────
#
# Adding a voice = code change + PR. Prevents an ops typo from shipping
# the wrong accent to students (e.g. en-US-JennyNeural instead of
# en-IN-NeerjaNeural would violate the direct CEO ask of "Indian accent").
#
# Hinglish: Microsoft's Hindi neural voices (Swara/Madhur) handle
# code-switched Devanagari + Latin best — they pronounce Latin loanwords
# in natural Indian-English phonemes. We deliberately route Hinglish to
# the Hindi voices, NOT the English ones; tested with Foxy reply samples.
VOICE_CATALOG: dict[tuple[str, str], str] = {
    ("en", "female"): "en-IN-NeerjaNeural",
    ("en", "male"): "en-IN-PrabhatNeural",
    ("hi", "female"): "hi-IN-SwaraNeural",
    ("hi", "male"): "hi-IN-MadhurNeural",
    # Hinglish → Hindi voices (see rationale above).
    ("hinglish", "female"): "hi-IN-SwaraNeural",
    ("hinglish", "male"): "hi-IN-MadhurNeural",
}

# Safe fallback voice. Used iff:
#   - voice_override is invalid AND
#   - the (language, gender) lookup misses (shouldn't happen with the
#     Pydantic Literal enums, but defense-in-depth).
# Choice: en-IN-NeerjaNeural is universally intelligible for Indian
# students and is the female English voice — matches Foxy's default
# persona on the frontend.
_FALLBACK_VOICE = "en-IN-NeerjaNeural"


class AzureTTSError(RuntimeError):
    """Raised after retry exhaustion on an Azure TTS HTTP error.

    Carries the upstream status code (or 0 for network failures) so the
    handler can decide whether to map to 502 (upstream issue), 503 (we
    can't reach Azure / no key), or surface as-is.
    """

    def __init__(self, message: str, *, status: int = 0) -> None:
        super().__init__(message)
        self.status = status


# ── Pure helpers (no I/O — safe to call from tests) ────────────────────────


def resolve_voice(
    language: str,
    gender: str,
    voice_override: str | None,
) -> str:
    """Pick the Azure voice id for a (language, gender) pair.

    Resolution order:
      1. ``voice_override`` if non-empty — the Pydantic validator has
         already enforced the Azure neural-voice regex, so we trust it.
      2. ``VOICE_CATALOG[(language, gender)]`` lookup.
      3. ``_FALLBACK_VOICE`` (defense in depth — shouldn't fire with the
         Pydantic enums in play).

    Pure function — kept module-level so tests can pin the lookup
    matrix without spinning up the full settings stack.
    """
    if voice_override:
        # Pydantic validator already enforced the regex; we don't re-check
        # here because the validator is the single source of truth. If
        # someone calls us from outside Pydantic-land, the upstream
        # request validator was bypassed and that's a higher-level bug.
        return voice_override
    key = (language, gender)
    voice = VOICE_CATALOG.get(key)
    if voice:
        return voice
    # Pydantic Literal enums should prevent us from reaching here in
    # production. The fallback is for direct-import tests and Phase 3
    # forward-compatibility (e.g. when ``gender='neutral'`` is added).
    logger.warning(
        "voice.tts.voice_catalog_miss",
        language=language,
        gender=gender,
        fallback=_FALLBACK_VOICE,
    )
    return _FALLBACK_VOICE


def build_ssml(text: str, voice_name: str, gender: str) -> str:
    """Build the Azure SSML body for a TTS request.

    SSML escaping is non-negotiable: ``& < > " '`` are reserved XML
    characters and any of them in raw student text could prematurely
    close the ``<voice>`` tag, inject neighbouring audio segments, or
    cause Azure to 400 the whole request. We use the stdlib
    :func:`html.escape` with ``quote=True`` so single AND double quotes
    are escaped (the SSML attributes use single quotes, so escaping
    only double-quotes would still leave an injection vector).

    xml:lang resolution: takes the ``xx-XX`` prefix from the voice name.
    ``en-IN-NeerjaNeural`` → ``en-IN``; ``hi-IN-SwaraNeural`` → ``hi-IN``.
    This matters because the voice's intrinsic locale and the SSML
    declared locale need to agree — otherwise Azure falls back to a
    default voice and the response loses the Indian accent.

    Args:
        text: Raw text to synthesize. MAY contain SSML-special chars —
            we escape them.
        voice_name: Azure voice id (e.g. ``hi-IN-SwaraNeural``).
        gender: ``'female'`` or ``'male'`` — Azure SSML uses Title-case
            ``Female``/``Male`` in the ``xml:gender`` attribute.

    Returns:
        A complete ``<speak>`` SSML document ready to POST to Azure.
    """
    # xml:lang inferred from the voice id prefix. Defensive guard: if the
    # voice id doesn't match the documented pattern, fall back to en-IN.
    # (voice_override regex already enforces ``xx-XX-NameNeural`` shape,
    # so the else branch is effectively unreachable in production.)
    xml_lang = voice_name[:5] if len(voice_name) >= 5 and voice_name[2] == "-" else "en-IN"

    # Azure xml:gender is Title-case (not lower-case Pydantic enum).
    azure_gender = "Female" if gender.lower() == "female" else "Male"

    # ``html.escape(text, quote=True)`` escapes & < > " ' — all five
    # SSML-significant chars. We deliberately do NOT use a faster
    # bytes-level escape; the stdlib path is auditable and well-tested.
    escaped = html.escape(text, quote=True)

    return (
        f"<speak version='1.0' xml:lang='{xml_lang}'>"
        f"<voice xml:lang='{xml_lang}' xml:gender='{azure_gender}' "
        f"name='{voice_name}'>{escaped}</voice>"
        f"</speak>"
    )


def estimate_cost_inr(char_count: int, usd_to_inr: float) -> float:
    """Compute INR cost for ``char_count`` characters at the Azure neural rate.

    Pure function — kept module-level so tests can pin the math without
    spinning up the full settings stack.

    Math:
        cost_usd = char_count * ($16 / 1_000_000)
        cost_inr = cost_usd * usd_to_inr
        rounded  = round(cost_inr, 4)

    Examples (USD_TO_INR=83):
        - 0 chars     → ₹0.0
        - 100 chars   → 100 × 16/1M × 83 = $0.0016 × 83 ≈ ₹0.1328
        - 300 chars   → 300 × 16/1M × 83 ≈ ₹0.3984
        - 1000 chars  → 1000 × 16/1M × 83 = ₹1.328
    """
    if char_count <= 0:
        return 0.0
    usd = char_count * (COST_USD_PER_MILLION_CHARS / 1_000_000)
    inr = usd * usd_to_inr
    return round(inr, 4)


# ── HTTP call ──────────────────────────────────────────────────────────────


@retry_with_backoff(max_attempts=3, base_delay=1.0, max_delay=8.0)
async def call_azure_tts(
    text: str,
    voice_name: str,
    *,
    gender: str = "female",
    timeout_seconds: float = DEFAULT_TIMEOUT_S,
) -> bytes:
    """Call the Azure TTS REST endpoint and return raw audio bytes.

    The decorator (3 attempts, 1-8s backoff) covers transient 502/503/
    timeout from Azure. 4xx short-circuits on first attempt; the default
    retry predicate doesn't retry them.

    Authentication: subscription key directly via the
    ``Ocp-Apim-Subscription-Key`` header. Azure's REST API supports both
    key auth and a token-exchange flow; we picked key auth for simplicity
    — one fewer network hop, no token refresh state machine, and the
    daily budget guard already bounds spend if the key were compromised.

    Output format: ``audio-24khz-48kbitrate-mono-mp3``. Returned as raw
    ``bytes`` (the route streams these straight into a
    ``starlette.responses.Response`` with ``media_type='audio/mpeg'``).

    Args:
        text: Raw text to synthesize. MUST be ≤ :data:`MAX_TEXT_CHARS`;
            caller (handler) checks this.
        voice_name: Azure voice id (e.g. ``hi-IN-SwaraNeural``). Caller
            (handler) resolves this via :func:`resolve_voice`.
        gender: ``'female'`` / ``'male'`` — used to set the SSML
            ``xml:gender`` attribute. Defaults to female (Foxy default).
        timeout_seconds: per-attempt timeout. Retry budget worst-case is
            ``max_attempts * timeout_seconds + total_backoff`` ≈
            ``3 * 30 + ~17 = ~107s``, well under the Cloud Run 300s cap.

    Returns:
        Raw MP3 audio bytes (~6 KB/s of speech at the configured format).

    Raises:
        :class:`AzureTTSError`: after retries exhausted OR on a 4xx that
            we don't retry. The ``status`` attribute carries the upstream
            HTTP code (0 for network-level failures).
    """
    s = get_settings()
    if not s.azure_speech_key:
        # Misconfigured — fail-CLOSED. Handler maps this to 503.
        raise AzureTTSError("Azure Speech key not configured", status=0)
    if not s.azure_speech_region:
        # Region is also required. Same fail-closed posture.
        raise AzureTTSError("Azure Speech region not configured", status=0)

    url = f"https://{s.azure_speech_region}.tts.speech.microsoft.com" f"{AZURE_TTS_PATH}"
    headers = {
        "Ocp-Apim-Subscription-Key": s.azure_speech_key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": AZURE_TTS_OUTPUT_FORMAT,
        "User-Agent": "alfanumrik-ai-python/0.1.0",
    }
    body = build_ssml(text, voice_name, gender)

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                url,
                headers=headers,
                content=body,
            )
    except httpx.HTTPError as err:
        # Network-level — connection refused, DNS, timeout. The retry
        # predicate retries these by default.
        raise AzureTTSError(f"Azure TTS network error: {err}", status=0) from err

    if response.status_code != 200:
        status = response.status_code
        # Don't log the body — Azure can echo SSML in 4xx responses, and
        # the SSML contains the student's text. Log status + voice only.
        logger.warning(
            "voice.azure_tts.non_200",
            status=status,
            voice_name=voice_name,
        )
        raise AzureTTSError(
            f"Azure TTS returned HTTP {status}",
            status=status,
        )

    audio = response.content
    if not audio:
        # 200 with empty body is a contract violation — Azure either
        # returns audio or a 4xx/5xx. Treat as upstream issue.
        logger.warning(
            "voice.azure_tts.empty_200",
            voice_name=voice_name,
        )
        raise AzureTTSError("Azure returned empty audio", status=200)

    return audio
