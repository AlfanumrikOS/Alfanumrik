"""``POST /v1/generate`` — MoL generic entry point.

Thin wrapper around :func:`services.ai.mol.generate_response`. Pydantic
already validates the request envelope; this handler's job is to:
1. Translate ``MolError`` codes to HTTP status codes.
2. Surface the request_id on every response (success + error) so callers
   can correlate with mol_request_logs.
3. Bind ``request_id`` into structlog context for the duration of the call.
"""

from __future__ import annotations

import json
import uuid

import structlog
from fastapi import APIRouter, HTTPException, Request, status
from starlette.responses import StreamingResponse

from ...mol import GenerateRequest, MolResult, generate_response
from ...mol.errors import MolError

router = APIRouter(prefix="/v1", tags=["mol"])
logger = structlog.get_logger(__name__)


# Map MolError.code → HTTP status. Documented so callers can branch on these.
_ERROR_STATUS: dict[str, int] = {
    "INVALID_INPUT": status.HTTP_400_BAD_REQUEST,
    "PROVIDER_CONFIG_MISSING": status.HTTP_503_SERVICE_UNAVAILABLE,
    "NO_PROVIDER_AVAILABLE": status.HTTP_502_BAD_GATEWAY,
    "TIMEOUT": status.HTTP_504_GATEWAY_TIMEOUT,
    "COST_CAP_EXCEEDED": status.HTTP_429_TOO_MANY_REQUESTS,
}


@router.post(
    "/generate",
    response_model=MolResult,
    summary="Run a single Model Orchestration Layer call",
    responses={
        400: {"description": "INVALID_INPUT — request envelope is malformed."},
        429: {"description": "COST_CAP_EXCEEDED — daily / per-student budget hit."},
        502: {"description": "NO_PROVIDER_AVAILABLE — all providers in chain failed."},
        503: {"description": "PROVIDER_CONFIG_MISSING — no API key configured."},
        504: {"description": "TIMEOUT — provider took too long to respond."},
    },
)
async def post_generate(req: GenerateRequest, request: Request) -> MolResult:
    """Run a single MoL call and return the response envelope."""
    request_id = (
        (req.config and req.config.request_id)
        or request.headers.get("x-request-id")
        or str(uuid.uuid4())
    )

    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        surface=req.config.surface if req.config else None,
        task_type=req.task_type,
    )
    try:
        if req.config is None:
            from ...mol.types import GenerateConfig

            req.config = GenerateConfig(request_id=request_id)
        else:
            req.config.request_id = request_id

        return await generate_response(req)
    except MolError as err:
        http_status = _ERROR_STATUS.get(err.code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        logger.warning(
            "mol.generate.error",
            code=err.code,
            message=err.message,
            details=err.details,
        )
        raise HTTPException(
            status_code=http_status,
            detail={
                "code": err.code,
                "message": err.message,
                "details": err.details,
                "request_id": request_id,
            },
        ) from err
    finally:
        structlog.contextvars.clear_contextvars()


def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post(
    "/generate/stream",
    summary="Run a MOL call and stream the answer as Server-Sent Events",
)
async def post_generate_stream(req: GenerateRequest, request: Request) -> StreamingResponse:
    """Stream a MOL answer. Emits ``event: token`` frames followed by a final
    ``event: done`` frame; ``event: error`` on a MolError (never a 5xx into
    the stream). Cooperatively cancels emission if the client disconnects.

    The endpoint is always mounted; the ``ff_mol_stream_v1`` flag gating is a
    caller-layer concern, not enforced here.
    """
    request_id = (
        (req.config and req.config.request_id)
        or request.headers.get("x-request-id")
        or str(uuid.uuid4())
    )
    if req.config is None:
        from ...mol.types import GenerateConfig

        req.config = GenerateConfig(request_id=request_id)
    else:
        req.config.request_id = request_id

    async def _gen():
        try:
            result = await generate_response(req)
        except MolError as err:
            logger.warning("mol.stream.error", code=err.code, message=err.message)
            yield _sse(
                "error",
                {"code": err.code, "message": err.message, "request_id": request_id},
            )
            return
        # Chunk the final text into ~120-char SSE token frames. Phase A streams
        # the final answer in chunks; token-level provider streaming is a
        # follow-up.
        text = result.text
        size = 120
        for i in range(0, len(text), size):
            # Cooperative cancellation: stop emitting if the client disconnected.
            if await request.is_disconnected():
                logger.info("mol.stream.client_disconnected", request_id=request_id)
                return
            yield _sse("token", {"text": text[i : i + size]})
        yield _sse(
            "done",
            {
                "request_id": result.request_id,
                "provider": result.provider,
                "model": result.model,
                "task_type": result.task_type,
                "latency_ms": result.latency_ms,
            },
        )

    return StreamingResponse(_gen(), media_type="text/event-stream")
