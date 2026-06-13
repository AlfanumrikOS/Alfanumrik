"""Cross-instance circuit-breaker tests — Redis-backed state machine.

The fake Redis below is TTL-FAITHFUL: it models per-key expiry against a
fake monotonic clock the test controls via ``advance()``. This is the whole
point of the A3 review fix — the previous fake ignored ``ex=`` entirely and
the expiry-dependent tests faked OPEN-window expiry by DELETING ONLY the
``state`` key (a window real Upstash never produces because the buggy breaker
set ``state`` and ``tripped`` with the SAME TTL, so they expired together).

With a real clock, the expired-OPEN window only exists if ``tripped`` is given
a strictly longer TTL than ``state`` — exactly the property under test.
"""

from __future__ import annotations

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
from services.ai.mol.redis_client import get_redis_client


def test_redis_client_is_none_when_unconfigured():
    """No UPSTASH_REDIS_REST_URL → get_redis_client() returns None (fail-open)."""
    assert get_redis_client() is None


class _FakeRedis:
    """TTL-faithful in-memory stand-in for the Upstash async client.

    Each key is stored as ``(value, expires_at | None)`` against a fake
    monotonic clock (``self.now``). A key with ``expires_at`` is treated as
    absent once ``self.now >= expires_at`` (lazy eviction on read). Tests
    advance wall-clock time deterministically via :meth:`advance` — this is
    how OPEN-window expiry is simulated, NOT by manually deleting keys.
    """

    def __init__(self) -> None:
        # key -> (value, expires_at | None)
        self.store: dict[str, tuple[str, float | None]] = {}
        self.now: float = 0.0

    # ── clock control ────────────────────────────────────────────────────
    def advance(self, seconds: float) -> None:
        """Move the fake clock forward, triggering lazy TTL eviction on next read."""
        self.now += seconds

    # ── eviction helper ──────────────────────────────────────────────────
    def _live(self, key: str):
        entry = self.store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at is not None and self.now >= expires_at:
            # Expired — evict and report absent (matches Upstash TTL semantics).
            self.store.pop(key, None)
            return None
        return value

    # ── Upstash async surface ────────────────────────────────────────────
    async def get(self, key: str):
        return self._live(key)

    async def set(self, key: str, value, ex: int | None = None):  # noqa: A003
        expires_at = (self.now + ex) if ex is not None else None
        self.store[key] = (str(value), expires_at)

    async def incr(self, key: str) -> int:
        current = self._live(key)
        n = int(current) + 1 if current is not None else 1
        # INCR preserves an existing TTL; a fresh key starts with no expiry
        # until EXPIRE is set (the breaker always pairs INCR + EXPIRE).
        prior = self.store.get(key)
        expires_at = prior[1] if (prior is not None and current is not None) else None
        self.store[key] = (str(n), expires_at)
        return n

    async def expire(self, key: str, seconds: int) -> bool:
        entry = self.store.get(key)
        if entry is None:
            return False
        value, _ = entry
        self.store[key] = (value, self.now + seconds)
        return True

    async def delete(self, *keys: str):
        for k in keys:
            self.store.pop(k, None)


@pytest.fixture()
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(breaker_mod, "get_redis_client", lambda: fake)
    return fake


# ─── 1. CLOSED allows ─────────────────────────────────────────────────────────


async def test_closed_breaker_allows_requests(fake_redis):
    assert await can_request("openai", "explanation") is True


# ─── 2. 3 failures → OPEN, blocks while OPEN window is live ────────────────────


async def test_three_failures_block_while_open_window_live(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    # OPEN window is LIVE (clock has NOT advanced past OPEN_TTL) ⇒ block.
    assert await can_request("openai", "explanation") is False
    # Still blocked partway through the OPEN window.
    fake_redis.advance(OPEN_TTL_SECONDS - 1)
    assert await can_request("openai", "explanation") is False


# ─── 3. keyed by (provider, task) ──────────────────────────────────────────────


async def test_open_circuit_keyed_by_provider_and_task(fake_redis):
    """OPEN on (openai, explanation) does NOT open (openai, reasoning)."""
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False
    assert await can_request("openai", "reasoning") is True


# ─── 4. OPEN expired → exactly ONE probe (HALF-OPEN) ───────────────────────────


async def test_open_expired_allows_exactly_one_probe(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False

    # Advance past OPEN_TTL: the `state` key expires, but `tripped` (TTL 3600)
    # is still live → the breaker enters HALF-OPEN, NOT fully-CLOSED.
    fake_redis.advance(OPEN_TTL_SECONDS + 1)

    # First probe after expiry is allowed (HALF-OPEN single probe).
    assert await can_request("openai", "explanation") is True
    # A concurrent second probe is blocked while the first is in flight.
    assert await can_request("openai", "explanation") is False


# ─── 5. 2 successes in HALF-OPEN → CLOSE, counters cleared ─────────────────────


async def test_two_successes_in_half_open_close_the_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    fake_redis.advance(OPEN_TTL_SECONDS + 1)
    await can_request("openai", "explanation")  # enter HALF-OPEN (one probe)

    for _ in range(SUCCESS_THRESHOLD):
        await record_success("openai", "explanation")

    # CLOSED again: a fresh request is allowed and NOT consumed as a probe.
    assert await can_request("openai", "explanation") is True
    # All breaker keys cleared on true CLOSE.
    assert fake_redis.store.get("mol:cb:openai:explanation:failures") is None
    assert fake_redis.store.get("mol:cb:openai:explanation:state") is None
    assert fake_redis.store.get("mol:cb:openai:explanation:tripped") is None
    assert fake_redis.store.get("mol:cb:openai:explanation:halfopen") is None
    assert fake_redis.store.get("mol:cb:openai:explanation:successes") is None


# ─── 6. failure in HALF-OPEN → reopen, blocked until next expiry ───────────────


async def test_failure_in_half_open_reopens_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    fake_redis.advance(OPEN_TTL_SECONDS + 1)
    await can_request("openai", "explanation")  # HALF-OPEN probe in flight

    # Probe fails ⇒ straight back to OPEN.
    await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False

    # Still blocked partway through the fresh OPEN window.
    fake_redis.advance(OPEN_TTL_SECONDS - 1)
    assert await can_request("openai", "explanation") is False

    # After the NEW OPEN window expires, HALF-OPEN re-arms (single probe again).
    fake_redis.advance(2)  # cross OPEN_TTL boundary
    assert await can_request("openai", "explanation") is True


# ─── 7. one success in HALF-OPEN is not enough to close ────────────────────────


async def test_single_success_in_half_open_does_not_close(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    fake_redis.advance(OPEN_TTL_SECONDS + 1)
    await can_request("openai", "explanation")  # HALF-OPEN probe

    await record_success("openai", "explanation")  # 1 success (< SUCCESS_THRESHOLD)

    # Not yet CLOSED: tripped is still live, halfopen probe still tracked.
    assert fake_redis.store.get("mol:cb:openai:explanation:tripped") is not None
    # A second success now closes it.
    await record_success("openai", "explanation")
    assert await can_request("openai", "explanation") is True
    assert fake_redis.store.get("mol:cb:openai:explanation:tripped") is None


# ─── 8. fail-open when Redis unreachable ───────────────────────────────────────


async def test_fail_open_when_redis_unreachable(monkeypatch):
    """No Redis client → can_request returns True (CLOSED), never blocks."""
    monkeypatch.setattr(breaker_mod, "get_redis_client", lambda: None)
    assert await can_request("openai", "explanation") is True
    # record_* are no-ops when fail-open — must not raise.
    await record_failure("openai", "explanation")
    await record_success("openai", "explanation")
