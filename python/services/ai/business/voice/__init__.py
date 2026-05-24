"""voice — student-facing speech-to-text (Voice 1a) + text-to-speech (Voice 1b).

Phase 2 voice capabilities. Companion of bulk_question_gen but on a
DIFFERENT auth path: these endpoints validate a STUDENT JWT against the
``students`` table, not an admin/super-admin against ``admin_users``.

Public entrypoints:
    :func:`services.ai.business.voice.handler.transcribe_audio` (STT)
    :func:`services.ai.business.voice.synthesize_handler.synthesize_speech` (TTS)

Internal modules:
    - :mod:`.models`              — request/response Pydantic models +
      audio + language enums (shared across both endpoints)
    - :mod:`.auth`                — student JWT + ``students``-table lookup
      (shared)
    - :mod:`.transcribe`          — OpenAI Whisper API call (with retry)
    - :mod:`.tts`                 — Azure Speech REST API call (with retry)
      + voice catalog + SSML builder + cost helper
    - :mod:`.repository`          — ops_events writes for both flows
    - :mod:`.handler`             — STT pipeline (budget guard → Whisper →
      telemetry → response)
    - :mod:`.synthesize_handler`  — TTS pipeline (budget guard → Azure TTS →
      telemetry → result)

Voice 2 wires the frontend (``src/lib/voice.ts``) — the synthesize
endpoint isn't gated by a feature flag at the service boundary; the
gate lives on the client side until then. Voice 3 closes the adaptive-
language loop end-to-end.
"""

from .handler import transcribe_audio
from .models import (
    DetectedLanguage,
    SupportedAudioFormat,
    SynthesisGender,
    SynthesisLanguage,
    SynthesizeError,
    SynthesizeRequest,
    TranscribeError,
    TranscribeResponse,
)
from .synthesize_handler import (
    SynthesizeBudgetExceededError,
    SynthesizeHandlerError,
    SynthesizeResult,
    TextTooLongError,
    UpstreamAzureError,
    synthesize_speech,
)

__all__ = [
    "DetectedLanguage",
    "SupportedAudioFormat",
    "SynthesisGender",
    "SynthesisLanguage",
    "SynthesizeBudgetExceededError",
    "SynthesizeError",
    "SynthesizeHandlerError",
    "SynthesizeRequest",
    "SynthesizeResult",
    "TextTooLongError",
    "TranscribeError",
    "TranscribeResponse",
    "UpstreamAzureError",
    "synthesize_speech",
    "transcribe_audio",
]
