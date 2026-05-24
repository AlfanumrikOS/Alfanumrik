"""``POST /v1/voice/transcribe`` — student-facing speech-to-text.

Thin wrapper around :func:`services.ai.business.voice.handler.transcribe_audio`.
Responsibilities are intentionally narrow (same pattern as the
bulk-question-gen route):

  1. Read the multipart body (``audio`` file + optional ``language_hint``).
  2. Validate the audio format against our allowlist.
  3. Verify the student JWT via :func:`verify_student`.
  4. Hand off to the handler.
  5. Translate domain exceptions → HTTP status codes.
  6. Bind ``request_id`` into structlog context for the call lifetime.

HTTP contract:
    Request:
        POST /v1/voice/transcribe
        Authorization: Bearer <supabase user JWT>
        Content-Type: multipart/form-data
        Body:
          - audio: <file>  (required, ≤ 25 MiB, format in allowlist)
          - language_hint: 'en' | 'hi' | 'hinglish'  (optional, form field)
    Response 200: TranscribeResponse
        { transcript, detected_language, duration_seconds, audio_format,
          confidence?, cost_inr, request_id }
    Errors (TranscribeError envelope under HTTPException.detail):
        400 — unsupported audio format
        401 — missing/invalid Authorization header
        403 — student not found OR account inactive
        413 — audio > 25 MiB
        422 — multipart parse failure (FastAPI built-in)
        429 — daily INR budget exceeded
        500 — internal error
        502 — Whisper upstream error (after retries)
        503 — Supabase / Whisper API key misconfigured

Out of scope for this route (Voice 1b/2/3):
    - TTS endpoint
    - Frontend wiring (src/lib/voice.ts)
    - Streaming partial transcripts (Whisper API doesn't offer this)
    - Speaker diarization
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile, status

from ...business.voice.auth import AuthFailed, verify_student
from ...business.voice.handler import (
    BudgetExceededError,
    HandlerError,
    PayloadTooLargeError,
    UpstreamWhisperError,
    transcribe_audio,
)
from ...business.voice.models import (
    SUPPORTED_AUDIO_FORMATS,
    TranscribeResponse,
)

router = APIRouter(prefix="/v1/voice", tags=["voice"])
logger = structlog.get_logger(__name__)


def _extract_audio_format(filename: str | None) -> str:
    """Pull the lowercase extension off ``filename`` or fall back to 'webm'.

    Browser MediaRecorder defaults to webm on Chrome/Firefox so we use it
    as the safe fallback. The caller's format is still validated against
    :data:`SUPPORTED_AUDIO_FORMATS` after this resolves.
    """
    if not filename or "." not in filename:
        return "webm"
    return filename.rsplit(".", 1)[-1].lower().strip()


@router.post(
    "/transcribe",
    response_model=TranscribeResponse,
    summary="Transcribe audio to text (student-facing, OpenAI Whisper).",
    responses={
        400: {"description": "Bad request — unsupported audio format."},
        401: {"description": "Missing or invalid Authorization header."},
        403: {"description": "Caller is not an active student."},
        413: {"description": "Audio file exceeds 25 MB."},
        429: {"description": "Daily voice budget exceeded."},
        500: {"description": "Internal error during transcription pipeline."},
        502: {"description": "Whisper upstream returned an error."},
        503: {"description": "Service misconfigured (Supabase/Whisper key missing)."},
    },
)
async def post_transcribe(
    request: Request,
    # Body — FastAPI parses multipart automatically. We accept a single
    # audio file and an optional language hint.
    audio: UploadFile = File(..., description="Audio file (webm/mp3/wav/m4a/ogg/mpga/flac, ≤25 MB)."),
    language_hint: str | None = Form(
        default=None,
        description="Optional iso-639-1 code: 'en' | 'hi' | 'hinglish'. "
        "Omit to let Whisper auto-detect.",
    ),
    authorization: str | None = Header(
        default=None,
        description="Bearer <supabase user JWT> — must be an active student.",
    ),
) -> TranscribeResponse:
    """Transcribe ``audio`` to text via OpenAI Whisper.

    Pipeline: auth → format check → handler (budget guard → Whisper →
    telemetry → response). All sensitive failure paths emit a
    :class:`TranscribeError` envelope via ``HTTPException.detail``.
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid, route="voice.transcribe")

    try:
        # 1. Auth — done BEFORE reading the body so an unauthenticated
        #    caller can't make us buffer 25 MiB before rejecting them.
        try:
            student = await verify_student(authorization)
        except AuthFailed as err:
            raise HTTPException(
                status_code=err.status,
                detail={
                    "error": "AUTH_FAILED",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err

        # 2. Audio format. UploadFile.filename can be None — fall back to webm.
        audio_format = _extract_audio_format(audio.filename)
        if audio_format not in SUPPORTED_AUDIO_FORMATS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "UNSUPPORTED_AUDIO_FORMAT",
                    "detail": f"Unsupported audio format: {audio_format}. "
                    f"Allowed: {sorted(SUPPORTED_AUDIO_FORMATS)}",
                    "request_id": rid,
                },
            )

        # 3. Read the body. FastAPI / starlette spool large bodies to a
        #    temp file (SpooledTemporaryFile, default 1 MiB threshold) so
        #    we don't OOM on a 25 MiB upload.
        try:
            audio_bytes = await audio.read()
        except Exception as err:  # noqa: BLE001 — multipart parse failure
            # We DO NOT log filename / bytes — the path is PII-noisy.
            logger.warning(
                "voice.route.body_read_failed",
                error=str(err),
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "BODY_READ_FAILED",
                    "detail": "Could not read audio body.",
                    "request_id": rid,
                },
            ) from err

        # 4. Handler — owns budget + Whisper + telemetry.
        try:
            result = await transcribe_audio(
                audio_bytes,
                audio_format,
                student,
                request_id=rid,
                language_hint=language_hint,
            )
            return result
        except PayloadTooLargeError as err:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "error": "PAYLOAD_TOO_LARGE",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err
        except BudgetExceededError as err:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "BUDGET_EXCEEDED",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err
        except UpstreamWhisperError as err:
            raise HTTPException(
                status_code=err.status,
                detail={
                    "error": "WHISPER_ERROR",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err
        except HandlerError as err:
            raise HTTPException(
                status_code=err.status,
                detail={
                    "error": "HANDLER_ERROR",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err
        except HTTPException:
            raise
        except Exception as err:  # noqa: BLE001 — last-line safety net
            # Log + return generic 500 (PII-safe — no transcript, no audio).
            logger.exception(
                "voice.route.unexpected_error",
                error=str(err),
                request_id=rid,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error": "INTERNAL_ERROR",
                    "detail": "Transcription failed.",
                    "request_id": rid,
                },
            ) from err
    finally:
        structlog.contextvars.clear_contextvars()
