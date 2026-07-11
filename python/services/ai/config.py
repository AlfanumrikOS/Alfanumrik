"""Pydantic-settings loader for the AI service.

Reads environment variables (and a ``.env`` file when present) into a typed
``Settings`` object. The object is constructed once via :func:`get_settings`
and cached at module level — never reach into ``os.environ`` directly from
business code.

Env-var contract mirrors :file:`python/.env.example`. Keeping the contract
narrow makes the future Cloud Run / Vercel cutover trivial: ops only has to
set these vars in the new runtime.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["production", "staging", "local"]


class Settings(BaseSettings):
    """Runtime configuration loaded from env vars + ``.env``.

    All fields have sensible defaults so the service can boot in a CI/test
    environment without a populated ``.env``. Readiness (``/readyz``) is
    where we surface "you're missing keys" — the service still STARTS so
    Cloud Run / kubelet probes can distinguish liveness from readiness.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Runtime environment ──
    environment: Environment = Field(default="local", description="Deployment env tier.")

    # ── Supabase (telemetry writes) ──
    supabase_url: str = Field(default="", description="https://<project>.supabase.co")
    supabase_service_role_key: str = Field(default="", description="Service-role JWT.")
    supabase_jwt_audience: str = Field(
        default="authenticated",
        description="Required audience on Supabase user access tokens.",
    )

    # ── Provider API keys ──
    anthropic_api_key: str = Field(default="", description="Claude API key (sk-ant-...).")
    openai_api_key: str = Field(default="", description="OpenAI API key (sk-proj-...).")

    # ── Upstash Redis (cross-instance breaker + semantic cache) ──
    # Empty defaults so the service still BOOTS in CI/test. When empty the
    # breaker fails OPEN→CLOSED (never blocks) and the cache is a no-op.
    upstash_redis_rest_url: str = Field(
        default="", description="Upstash Redis REST endpoint. Empty disables breaker store."
    )
    upstash_redis_rest_token: str = Field(default="", description="Upstash Redis REST token.")

    # ── Azure Cognitive Services (Voice 1b — Indian-accent TTS) ──
    # Same posture as Anthropic/OpenAI: empty defaults so the service still
    # BOOTS in CI/test. /readyz surfaces voice-tts readiness; the TTS
    # handler itself returns 503 SERVICE_MISCONFIGURED when the key is
    # missing so callers don't pay the latency to discover that.
    azure_speech_key: str = Field(
        default="",
        description="Azure Cognitive Services Speech subscription key.",
    )
    azure_speech_region: str = Field(
        default="centralindia",
        description="Azure Speech region (e.g. centralindia). Empty disables TTS.",
    )

    # ── Observability ──
    sentry_dsn: str = Field(default="", description="Empty disables Sentry.")
    log_level: str = Field(default="INFO", description="Stdlib log level.")

    # ── HTTP layer ──
    allowed_origins: str = Field(
        default="http://localhost:3000",
        description="Comma-separated CORS origins. Do NOT use '*' in prod.",
    )
    port: int = Field(default=8080, description="Uvicorn bind port (Cloud Run = 8080).")

    # ── Currency conversion (mirrors USD_TO_INR in TS telemetry.ts) ──
    usd_to_inr: float = Field(default=83.0, description="USD→INR rate used for inr_cost rows.")

    @field_validator("allowed_origins")
    @classmethod
    def _no_wildcard_in_prod(cls, v: str, info: ValidationInfo) -> str:
        env = info.data.get("environment", "local")
        if env == "production" and "*" in v:
            raise ValueError("ALLOWED_ORIGINS must not contain '*' in production")
        return v

    @field_validator("port")
    @classmethod
    def _port_in_range(cls, v: int) -> int:
        if v < 1 or v > 65535:
            raise ValueError(f"PORT out of range: {v}")
        return v

    # ── Derived helpers ──
    def allowed_origins_list(self) -> list[str]:
        """Comma-split + strip + drop empties."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    def is_production(self) -> bool:
        return self.environment == "production"

    def supabase_jwt_issuer(self) -> str:
        """Canonical issuer for access tokens minted by this Supabase project."""
        return f"{self.supabase_url.rstrip('/')}/auth/v1"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Module-level cached Settings.

    Cached because Settings reads the env on construction, and we want one
    canonical snapshot per process. Tests that need a fresh read should call
    ``get_settings.cache_clear()``.
    """
    # Pytest runs inside this repo with a local `.env` checked in for
    # developer convenience. That file can otherwise mask the "missing key"
    # branches the test suite intentionally exercises, so we skip dotenv
    # loading only while pytest is active.
    if os.getenv("PYTEST_CURRENT_TEST"):
        return Settings(_env_file=None)
    return Settings()
