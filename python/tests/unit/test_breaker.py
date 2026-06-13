"""Cross-instance circuit-breaker tests — Redis-backed state machine."""

from __future__ import annotations

from services.ai.mol.redis_client import get_redis_client


def test_redis_client_is_none_when_unconfigured():
    """No UPSTASH_REDIS_REST_URL → get_redis_client() returns None (fail-open)."""
    assert get_redis_client() is None
