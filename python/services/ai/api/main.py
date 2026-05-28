"""FastAPI app factory + middleware.

Lifespan hooks initialize Sentry, configure logging, and (eventually) prime
the Supabase client. ``app`` at module scope is what uvicorn imports
(``uvicorn services.ai.api.main:app``).
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import RateLimitHeadersMiddleware

from .limiter import limiter

from ..config import get_settings
from ..db.supabase import get_service_client
from ..observability.logger import configure_logging, get_logger
from ..observability.sentry import configure_sentry
from .health import router as health_router
from .v1.bulk_question_gen import router as bulk_question_gen_router
from .v1.generate import router as generate_router
from .v1.generate_answers import router as generate_answers_router
from .v1.generate_concepts import router as generate_concepts_router
from .v1.voice import router as voice_router
from .v1.foxy_tutor import router as foxy_tutor_router
from ..business.cme_engine.router import router as cme_router
from ..business.ncert_solver.router import router as ncert_solver_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown handlers.

    Startup: init logging, init Sentry, prime the Supabase client.
    Shutdown: nothing yet — httpx clients are constructed per-call so
    there's no global pool to close. Phase 1 may switch to a shared
    pool, at which point we close it here.
    """
    del app
    configure_logging()
    configure_sentry()
    # Prime the Supabase client cache so first /v1/generate doesn't pay the cost.
    get_service_client()
    logger = get_logger(__name__)
    s = get_settings()
    logger.info(
        "ai_service.startup",
        environment=s.environment,
        port=s.port,
        anthropic_configured=bool(s.anthropic_api_key),
        openai_configured=bool(s.openai_api_key),
        supabase_configured=bool(s.supabase_url and s.supabase_service_role_key),
        sentry_configured=bool(s.sentry_dsn),
    )
    yield
    logger.info("ai_service.shutdown")


def create_app() -> FastAPI:
    """Build the FastAPI app.

    Kept as a factory so tests can spin up a fresh instance via
    ``FastAPI(lifespan=...)`` without polluting the module-level singleton.
    """
    s = get_settings()
    app = FastAPI(
        title="Alfanumrik AI Services",
        version="0.1.0",
        description=(
            "Python port of the Model Orchestration Layer (MoL). Mirrors the "
            "TypeScript framework in supabase/functions/_shared/mol/ at the API "
            "contract level."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.allowed_origins_list(),
        allow_credentials=False,  # MoL endpoint is service-to-service; no cookies
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
    )
    
    # slowapi integration
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(RateLimitHeadersMiddleware)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        """Bind a request_id + log start/end of every request.

        request_id strategy: caller-supplied ``X-Request-Id`` header wins;
        else generate a UUID4. The value is echoed on the response and
        used as a structlog binding for the lifetime of the handler.
        """
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.monotonic()
        structlog.contextvars.bind_contextvars(request_id=rid, path=request.url.path)
        logger = structlog.get_logger("ai_service.request")
        logger.info("request.start", method=request.method)
        try:
            response: Response = await call_next(request)
            response.headers["X-Request-Id"] = rid
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.info(
                "request.end",
                status=response.status_code,
                latency_ms=elapsed_ms,
            )
            return response
        except Exception as err:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error(
                "request.exception",
                error=str(err),
                latency_ms=elapsed_ms,
            )
            raise
        finally:
            structlog.contextvars.clear_contextvars()

    app.include_router(health_router)
    app.include_router(generate_router)
    app.include_router(bulk_question_gen_router)
    app.include_router(generate_answers_router)
    app.include_router(generate_concepts_router)
    app.include_router(voice_router)
    app.include_router(foxy_tutor_router)
    app.include_router(cme_router)
    app.include_router(ncert_solver_router)

    # opentelemetry integration
    FastAPIInstrumentor.instrument_app(app)

    return app


# Module-level singleton — what uvicorn imports.
app = create_app()
