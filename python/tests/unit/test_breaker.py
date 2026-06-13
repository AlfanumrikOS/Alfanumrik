"""Cross-instance circuit-breaker tests — Redis-backed state machine."""

from __future__ import annotations

from services.ai.mol.redis_client import get_redis_client


def test_redis_client_is_none_when_unconfigured():
    """No UPSTASH_REDIS_REST_URL → get_redis_client() returns None (fail-open)."""
    assert get_redis_client() is None


import pytest

from services.ai.mol import breaker as breaker_mod
from services.ai.mol.breaker import (
    FAILURE_THRESHOLD,
    OPEN_TTL_SECONDS,
    SUCCESS_THRESHOLD,
    can_request,
    record_failure,
    record_success,
)


class _FakeRedis:
    """In-memory stand-in for the Upstash async client used by the breaker."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex: int | None = None):  # noqa: A003
        self.store[key] = str(value)

    async def incr(self, key: str) -> int:
        n = int(self.store.get(key, "0")) + 1
        self.store[key] = str(n)
        return n

    async def expire(self, key: str, seconds: int):
        return True

    async def delete(self, *keys: str):
        for k in keys:
            self.store.pop(k, None)


@pytest.fixture()
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(breaker_mod, "get_redis_client", lambda: fake)
    return fake


async def test_closed_breaker_allows_requests(fake_redis):
    assert await can_request("openai", "explanation") is True


async def test_three_failures_open_the_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False


async def test_open_circuit_keyed_by_provider_and_task(fake_redis):
    """OPEN on (openai, explanation) does NOT open (openai, reasoning)."""
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False
    assert await can_request("openai", "reasoning") is True


async def test_open_transitions_to_half_open_after_ttl(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    # Simulate OPEN-window expiry by deleting the OPEN marker (Upstash TTL).
    await fake_redis.delete("mol:cb:openai:explanation:state")
    # First probe after expiry is allowed (HALF-OPEN).
    assert await can_request("openai", "explanation") is True


async def test_two_successes_in_half_open_close_the_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    await fake_redis.delete("mol:cb:openai:explanation:state")
    await can_request("openai", "explanation")  # enter HALF-OPEN
    for _ in range(SUCCESS_THRESHOLD):
        await record_success("openai", "explanation")
    assert await can_request("openai", "explanation") is True
    # Failure counter reset after CLOSE.
    assert fake_redis.store.get("mol:cb:openai:explanation:failures") in (None, "0")


async def test_failure_in_half_open_reopens_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    await fake_redis.delete("mol:cb:openai:explanation:state")
    await can_request("openai", "explanation")  # HALF-OPEN probe
    await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False


async def test_fail_open_when_redis_unreachable(monkeypatch):
    """No Redis client → can_request returns True (CLOSED), never blocks."""
    monkeypatch.setattr(breaker_mod, "get_redis_client", lambda: None)
    assert await can_request("openai", "explanation") is True
    # record_* are no-ops when fail-open — must not raise.
    await record_failure("openai", "explanation")
    await record_success("openai", "explanation")
