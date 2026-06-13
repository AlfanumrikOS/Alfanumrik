"""Lazy Upstash Redis REST client shared by the breaker + semantic cache.

Cloud Run is multi-instance, so per-process state (the TS in-worker breaker
map) cannot be shared. This module hands out one cached Upstash REST client
per process. When Upstash is not configured it returns ``None`` and every
caller is contractually required to FAIL-OPEN (breaker CLOSED, cache empty).
"""

from __future__ import annotations

from typing import Any

import structlog

from ..config import get_settings

logger = structlog.get_logger(__name__)

_client: Any | None = None
_init_attempted = False


def get_redis_client() -> Any | None:
    """Return a cached Upstash Redis client, or ``None`` if unconfigured."""
    global _client, _init_attempted
    if _client is not None:
        return _client
    if _init_attempted:
        return None

    _init_attempted = True
    s = get_settings()
    if not s.upstash_redis_rest_url or not s.upstash_redis_rest_token:
        logger.debug("mol.redis.skipped", reason="no_credentials")
        return None

    try:
        from upstash_redis.asyncio import Redis

        _client = Redis(url=s.upstash_redis_rest_url, token=s.upstash_redis_rest_token)
        logger.info("mol.redis.initialized")
        return _client
    except Exception as err:  # noqa: BLE001 — breaker must never break startup
        logger.warning("mol.redis.init_failed", error=str(err))
        return None


def reset_redis_client() -> None:
    """Test-only: clear the cached client + re-arm the init attempt."""
    global _client, _init_attempted
    _client = None
    _init_attempted = False
