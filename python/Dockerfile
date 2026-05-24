# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Alfanumrik AI Services — Production container.
#
# Owned by: architect (this file). Coordinates with: ai-engineer (FastAPI app).
#
# Build:
#   docker build -t alfanumrik-ai-services:local python/
#
# Run locally (against an .env file you create from python/.env.example):
#   docker run --rm -p 8080:8080 --env-file python/.env alfanumrik-ai-services:local
#
# Deployed to Google Cloud Run (asia-south1) by .github/workflows/python-ai-deploy.yml.
# Cloud Run scales horizontally and reuses a single uvicorn worker per instance —
# do NOT bump --workers above 1 without re-tuning concurrency.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: builder ────────────────────────────────────────────────────────
# Pin the digest-less slim tag; CI builds bind to whichever 3.12 patch the
# registry serves at build time. Switch to a digest pin once we cut a release.
FROM python:3.12-slim AS builder

# Build-time deps for any wheels that may need to compile (httptools/uvloop).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# Install into a dedicated prefix so we can copy only site-packages to the
# runtime stage — keeps the final image small.
COPY requirements.txt ./requirements.txt
RUN pip install --prefix=/install -r requirements.txt

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# curl is needed for HEALTHCHECK; ca-certificates for TLS to Anthropic/OpenAI/Supabase.
# tini gives us PID-1 signal forwarding so SIGTERM from Cloud Run shuts uvicorn cleanly.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Non-root runtime user. Cloud Run does not require this but it is a defense
# in depth if a future provider lets us pick the UID.
RUN groupadd --system --gid 1000 appgroup \
    && useradd --system --uid 1000 --gid appgroup --home-dir /app --shell /sbin/nologin appuser

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Cloud Run injects $PORT; default to 8080 for local docker runs.
    PORT=8080 \
    # Ensure the copied packages are on the path.
    PATH="/usr/local/bin:${PATH}"

# Bring installed Python packages over from the builder stage.
COPY --from=builder /install /usr/local

WORKDIR /app

# Application source. The pyproject.toml is included so any `python -m`
# imports that rely on package metadata keep working inside the container.
COPY --chown=appuser:appgroup pyproject.toml ./pyproject.toml
COPY --chown=appuser:appgroup services ./services

USER appuser

EXPOSE 8080

# Cloud Run probes /live over HTTP; HEALTHCHECK is mostly useful for
# local docker/podman runs. 30s interval matches the runbook expectation.
# Path is /live (not /healthz) because Cloud Run's frontend intercepts
# the path /healthz before it reaches the container (confirmed 2026-05-24).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT}/live" || exit 1

# tini → uvicorn keeps Ctrl-C and Cloud Run's SIGTERM clean.
# Shell form on the uvicorn line is intentional so $PORT is expanded by /bin/sh.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "uvicorn services.ai.api.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
