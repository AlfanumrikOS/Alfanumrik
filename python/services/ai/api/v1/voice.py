"""Student-facing voice endpoints.

Two sibling routes share this module and the same student-JWT auth path:

1. ``POST /v1/voice/transcribe`` — Voice 1a — speech-to-text via OpenAI
   Whisper. Multipart body (audio file + optional language hint), JSON
   response.

2. ``POST /v1/voice/synthesize`` — Voice 1b — text-to-speech with Indian-
   accent neural voices via Azure Cognitive Services. JSON body, binary
   ``audio/mpeg`` response with metadata in custom headers.

Both routes:
  - Verify the student JWT via :func:`verify_student` BEFORE reading the
    body (so unauthenticated callers can't make us buffer large payloads).
  - Bind ``request_id`` into structlog context for the call lifetime.
  - Emit an error envelope (TranscribeError / SynthesizeError) under
    ``HTTPException.detail`` for consistent frontend error handling.

HTTP contracts:

    /transcribe:
        Request:
            POST /v1/voice/transcribe
            Authorization: Bearer <supabase user JWT>
            Content-Type: multipart/form-data
            Body:
              - audio: <file>  (required, ≤ 25 MiB, format in allowlist)
              - language_hint: 'en' | 'hi' | 'hinglish'  (optional)
        Response 200: TranscribeResponse JSON
        Errors: 400/401/403/413/422/429/500/502/503

    /synthesize:
        Request:
            POST /v1/voice/synthesize
            Authorization: Bearer <supabase user JWT>
            Content-Type: application/json
            Body: { text: 1..2000 chars,
                    language: 'en' | 'hi' | 'hinglish',
                    gender?: 'female' | 'male',  // default female
                    voice_override?: 'xx-XX-NameNeural' }
        Response 200: raw audio/mpeg bytes + headers:
            X-Voice-Used, X-Cost-Inr, X-Char-Count, X-Request-Id
        Errors: 400/401/403/413/422/429/500/502/503

Out of scope for both routes:
    - Frontend wiring (src/lib/voice.ts) — Voice 2
    - Streaming partial transcripts (Whisper API doesn't offer this)
    - Streaming TTS via Azure SSE (Voice 3 or later)
    - Speaker diarization
    - Redis caching of repeated TTS phrases (Phase 3)
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile, status
from starlette.responses import Response

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
    SynthesizeRequest,
    TranscribeResponse,
)
from ...business.voice.synthesize_handler import (
    SynthesizeBudgetExceededError,
    SynthesizeHandlerError,
    TextTooLongError,
    UpstreamAzureError,
    synthesize_speech,
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
    audio: UploadFile = File(
        ..., description="Audio file (webm/mp3/wav/m4a/ogg/mpga/flac, ≤25 MB)."
    ),
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


# ── POST /v1/voice/synthesize — Voice 1b ──────────────────────────────────


@router.post(
    "/synthesize",
    summary="Synthesize text to Indian-accent neural speech (student-facing, Azure TTS).",
    responses={
        # Success returns audio/mpeg, NOT JSON — so we declare a custom
        # content type here for the OpenAPI doc rather than the default
        # JSON response_model. The frontend reads X-* headers for
        # metadata.
        200: {
            "description": "MP3 audio (audio-24khz-48kbitrate-mono-mp3).",
            "content": {"audio/mpeg": {}},
        },
        400: {"description": "Bad request — invalid body."},
        401: {"description": "Missing or invalid Authorization header."},
        403: {"description": "Caller is not an active student."},
        413: {"description": "Text exceeds 2000 characters."},
        422: {"description": "Pydantic validation error on the JSON body."},
        429: {"description": "Daily voice budget exceeded."},
        500: {"description": "Internal error during synthesis pipeline."},
        502: {"description": "Azure TTS upstream returned an error."},
        503: {"description": "Service misconfigured (Supabase/Azure key missing)."},
    },
)
async def post_synthesize(
    request: Request,
    body: SynthesizeRequest,
    authorization: str | None = Header(
        default=None,
        description="Bearer <supabase user JWT> — must be an active student.",
    ),
) -> Response:
    """Synthesize ``body.text`` to Indian-accent speech via Azure Speech.

    Pipeline: auth → handler (length guard → budget guard → voice resolve
    → Azure call → telemetry → result). All sensitive failure paths emit
    a :class:`SynthesizeError` envelope via ``HTTPException.detail``.

    The success response is binary ``audio/mpeg`` with metadata in custom
    headers (``X-Voice-Used``, ``X-Cost-Inr``, ``X-Char-Count``,
    ``X-Request-Id``). The middleware will also echo ``X-Request-Id`` on
    the response, but we set it on the response directly here so it's
    present even if the middleware path changes.
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=rid, route="voice.synthesize")

    try:
        # 1. Auth — done BEFORE the handler so an unauthenticated caller
        #    can't make us call Azure.
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

        # 2. Handler — owns length guard + budget + Azure + telemetry.
        try:
            result = await synthesize_speech(
                body.text,
                body.language,
                body.gender,
                body.voice_override,
                student,
                request_id=rid,
            )
        except TextTooLongError as err:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "error": "TEXT_TOO_LONG",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err
        except SynthesizeBudgetExceededError as err:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "BUDGET_EXCEEDED",
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err
        except UpstreamAzureError as err:
            # 502 (Azure 5xx) vs 503 (we're misconfigured — empty key /
            # auth failure). The handler already mapped this.
            api_error_code = (
                "SERVICE_MISCONFIGURED"
                if err.status == status.HTTP_503_SERVICE_UNAVAILABLE
                else "AZURE_TTS_ERROR"
            )
            raise HTTPException(
                status_code=err.status,
                detail={
                    "error": api_error_code,
                    "detail": str(err),
                    "request_id": rid,
                },
            ) from err
        except SynthesizeHandlerError as err:
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
            # Log + return generic 500 (PII-safe — no text, no audio).
            logger.exception(
                "voice.synthesize_route.unexpected_error",
                error=str(err),
                request_id=rid,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error": "INTERNAL_ERROR",
                    "detail": "Synthesis failed.",
                    "request_id": rid,
                },
            ) from err

        # 3. Build the binary response. The middleware sets X-Request-Id
        #    on the final response, but we also set it here so it's
        #    present at the handler boundary (test assertions can read
        #    it directly without depending on middleware ordering).
        return Response(
            content=result.audio_bytes,
            media_type="audio/mpeg",
            headers={
                "X-Voice-Used": result.voice_used,
                "X-Cost-Inr": f"{result.cost_inr:.4f}",
                "X-Char-Count": str(result.char_count),
                "X-Request-Id": rid,
            },
        )
    finally:
        structlog.contextvars.clear_contextvars()
