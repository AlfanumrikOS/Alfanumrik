"""Pydantic request/response models for ``POST /v1/voice/transcribe``.

The endpoint accepts ``multipart/form-data`` (an audio file + optional
``language_hint`` form field), so the *request* envelope is the FastAPI
route's signature, not a Pydantic model. What this module owns:

- :class:`TranscribeResponse` — success envelope returned to the caller
  (frontend ``src/lib/voice.ts`` will read these fields directly).
- :class:`TranscribeError` — error envelope. The route raises
  ``HTTPException`` with a JSON ``detail`` body; this model documents the
  shape so the frontend has a typed schema to target.
- Audio-format + detected-language enums + the Whisper→Alfanumrik
  language mapping helper.

Product invariants enforced at the model layer:
- P5: ``grade`` is a string (downstream consumers expect ``'6'..'12'``).
  We don't surface grade in the response, but the response carries
  ``request_id`` so logs can correlate.
- P13: response carries no PII — ``transcript`` is whatever the student
  uttered (their own speech, not someone else's), ``detected_language``
  and ``duration_seconds`` are derived; we never echo the student email
  or name back. The frontend uses ``transcript`` as the chat input, so
  it's by-definition user-owned data.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ── Audio + language enums ─────────────────────────────────────────────────
#
# Supported audio formats mirror OpenAI Whisper's documented list
# (see https://platform.openai.com/docs/api-reference/audio/createTranscription).
# We support all formats the browser MediaRecorder API can emit on Android +
# iOS + desktop Chrome/Firefox/Safari without re-encoding on the client.
SupportedAudioFormat = Literal[
    "webm",  # Chrome / Edge / Firefox default
    "mp3",   # iOS Safari + universal fallback
    "wav",   # Desktop fallback, larger payload
    "m4a",   # iOS Safari output for some MediaRecorder configs
    "ogg",   # Firefox Vorbis container
    "mpga",  # MP3 audio with .mpga extension (rare but Whisper-supported)
    "flac",  # Lossless desktop uploads
]

# Detected language returned in the response.
# - 'en' = English (Whisper ISO-639-1 'en')
# - 'hi' = Hindi (Whisper ISO-639-1 'hi')
# - 'hinglish' = Hindi-English code-switch — Whisper itself doesn't
#   return this; we derive it via a script + language heuristic. See
#   :func:`map_whisper_language` and the voice 3 follow-up note in the
#   handler. The frontend's ``LANG_MAP`` in ``src/lib/voice.ts`` already
#   treats 'hinglish' as a first-class option for STT, so we keep the
#   contract symmetric.
# - 'unknown' = Whisper returned a language code outside {en, hi}. We
#   surface the speech transcript but flag the language so the chat
#   layer can decide whether to coerce to the student's preferred
#   language for the AI response.
DetectedLanguage = Literal["en", "hi", "hinglish", "unknown"]

# Set of OpenAI Whisper supported audio formats — used by route + tests
# for membership checks. Kept as a frozenset for O(1) lookup.
SUPPORTED_AUDIO_FORMATS: frozenset[str] = frozenset(
    {"webm", "mp3", "wav", "m4a", "ogg", "mpga", "flac"}
)


# ── Response envelopes ─────────────────────────────────────────────────────


class TranscribeResponse(BaseModel):
    """Success response for ``POST /v1/voice/transcribe``.

    Field shape MUST stay stable: ``src/lib/voice.ts`` (Voice 2) will read
    these field names directly. Any rename here breaks the frontend.
    """

    model_config = ConfigDict(extra="forbid")

    transcript: str = Field(
        ...,
        description="The student's utterance transcribed by Whisper. Trimmed.",
    )
    detected_language: DetectedLanguage = Field(
        ...,
        description="Language Whisper detected (or 'hinglish' via heuristic).",
    )
    duration_seconds: float = Field(
        ...,
        ge=0,
        description="Audio duration in seconds, as reported by Whisper's "
        "verbose_json response. Used for cost reconciliation.",
    )
    audio_format: SupportedAudioFormat = Field(
        ...,
        description="Container format we sent to Whisper (echoed for debugging).",
    )
    confidence: float | None = Field(
        default=None,
        ge=0,
        le=1,
        description="Reserved — Whisper does not return a per-utterance "
        "confidence today; the field is here so a future provider that does "
        "(e.g. AssemblyAI, Deepgram) can populate without a schema change.",
    )
    cost_inr: float = Field(
        default=0.0,
        ge=0,
        description="Estimated cost in INR for this transcription "
        "(audio_seconds × Whisper per-minute rate × USD→INR).",
    )
    request_id: str = Field(
        ...,
        description="UUIDv4 echoed for log correlation with Cloud Run + Sentry.",
    )


class TranscribeError(BaseModel):
    """Error envelope returned via FastAPI ``HTTPException.detail``.

    The route emits this shape consistently across all non-2xx responses
    so the frontend can branch on ``error`` without parsing free text.
    """

    model_config = ConfigDict(extra="forbid")

    error: str = Field(
        ...,
        description="Machine-readable error code (e.g. 'AUTH_FAILED', "
        "'PAYLOAD_TOO_LARGE', 'BUDGET_EXCEEDED', 'WHISPER_ERROR').",
    )
    detail: str = Field(
        ...,
        description="Human-readable explanation. Safe to log; never contains "
        "the audio bytes or transcript.",
    )
    request_id: str = Field(
        ...,
        description="UUIDv4 echoed for log correlation.",
    )


# ── Language mapping ────────────────────────────────────────────────────────


def _looks_romanized_latin(text: str) -> bool:
    """Return True iff the text is dominantly Latin script.

    Counts Devanagari characters vs Latin characters. We declare 'Latin
    dominant' when Latin chars outnumber Devanagari by ≥ 3x. This is
    deliberately conservative — false-positive 'hinglish' would route a
    pure-Hindi utterance to an English flow, which is worse UX than
    flagging a romanized-Hindi utterance as plain 'hi'.

    Voice 3 will replace this with a proper language-id model.
    """
    latin = 0
    devanagari = 0
    for ch in text:
        cp = ord(ch)
        # Devanagari Unicode block: U+0900..U+097F
        if 0x0900 <= cp <= 0x097F:
            devanagari += 1
        elif ch.isalpha():
            # `isalpha` rather than ASCII range so accented Latin is captured.
            latin += 1
    if devanagari == 0 and latin == 0:
        return False
    return latin >= devanagari * 3


def map_whisper_language(
    whisper_language: str | None,
    transcript: str,
) -> DetectedLanguage:
    """Map Whisper's ISO-639-1 language code → our DetectedLanguage enum.

    Heuristic (Phase 2 floor — refined in Voice 3):
        - Whisper returns 'en' for Latin-script speech                    → 'en'
        - Whisper returns 'hi' AND transcript is Latin-script-dominant    → 'hinglish'
          (Whisper occasionally tags romanized Hindi as 'hi'; the student
          spoke Hindi words but in English script — the chat layer should
          honour both languages.)
        - Whisper returns 'hi' AND transcript is Devanagari-dominant      → 'hi'
        - Anything else                                                   → 'unknown'

    Returns:
        One of :data:`DetectedLanguage`.
    """
    if not whisper_language:
        return "unknown"

    lang = whisper_language.lower().strip()
    if lang == "en":
        return "en"
    if lang == "hi":
        # Whisper said Hindi. If the transcript is Latin-dominant, it's
        # almost certainly romanized Hindi (Hinglish-style) — flag for the
        # chat layer. Otherwise, plain Hindi.
        if transcript and _looks_romanized_latin(transcript):
            return "hinglish"
        return "hi"

    return "unknown"
