"""voice — student-facing speech-to-text via OpenAI Whisper.

Phase 2 first voice capability. Companion of bulk_question_gen but on a
DIFFERENT auth path: this endpoint validates a STUDENT JWT against the
``students`` table, not an admin/super-admin against ``admin_users``.

Public entrypoint:
    :func:`services.ai.business.voice.handler.transcribe_audio`

Internal modules:
    - :mod:`.models`     — request/response Pydantic models + audio enums
    - :mod:`.auth`       — student JWT + ``students``-table lookup
    - :mod:`.transcribe` — OpenAI Whisper API call (with retry)
    - :mod:`.repository` — ops_events writes (audio duration + cost)
    - :mod:`.handler`    — pipeline composition (budget guard → Whisper →
      telemetry → response)

Voice 1b will add a sibling sub-module ``tts/`` for Azure-backed
text-to-speech with an Indian accent. Voice 2 wires the frontend, and
Voice 3 closes the adaptive-language loop end-to-end.
"""

from .handler import transcribe_audio
from .models import (
    DetectedLanguage,
    SupportedAudioFormat,
    TranscribeError,
    TranscribeResponse,
)

__all__ = [
    "DetectedLanguage",
    "SupportedAudioFormat",
    "TranscribeError",
    "TranscribeResponse",
    "transcribe_audio",
]
