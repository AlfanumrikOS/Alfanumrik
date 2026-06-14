"""Cross-instance circuit breaker (Upstash Redis) — A3.

State machine, keyed by ``(provider, task_type)``:

    CLOSED --(FAILURE_THRESHOLD fails within FAILURE_WINDOW_SECONDS)--> OPEN
    OPEN   --(OPEN_TTL_SECONDS elapsed; `state` marker expires)----->   HALF-OPEN
    HALF-OPEN --(SUCCESS_THRESHOLD consecutive successes)----------->   CLOSED
    HALF-OPEN --(any failure)-------------------------------------->    OPEN

FAIL-OPEN contract: when the Redis client is None (unconfigured / unreachable)
``can_request`` returns True and the recorders are no-ops, so the breaker
never blocks a live request on store failure (spec A3 risk mitigation).

Two-TTL design (the load-bearing invariant — A3 review fix):
    The OPEN→HALF-OPEN transition relies on a window where ``state`` has expired
    but ``tripped`` is still alive. That window only exists if ``tripped`` is
    given a STRICTLY LONGER TTL than ``state``. Setting both with the same TTL
    (the original bug) made them expire together — so a post-expiry
    ``can_request`` saw neither key and treated the breaker as fully CLOSED,
    SKIPPING HALF-OPEN entirely (no single-probe gating, no 2-success close, no
    reopen-on-probe-failure). ``tripped`` therefore uses ``TRIPPED_TTL_SECONDS``
    (>> ``OPEN_TTL_SECONDS``), and ``state`` uses ``OPEN_TTL_SECONDS``.

Redis keys (string values, all TTL-bounded):
    mol:cb:{provider}:{task}:failures  → INCR counter, TTL=FAILURE_WINDOW.
    mol:cb:{provider}:{task}:state     → "open" while the OPEN window is live,
        TTL=OPEN_TTL_SECONDS. When this key EXPIRES the breaker is eligible to
        probe (provided ``tripped`` is still alive).
    mol:cb:{provider}:{task}:tripped   → "1" from the first trip until a true
        CLOSE, TTL=TRIPPED_TTL_SECONDS. Because its TTL is far longer than
        ``state``'s, there is a real "expired-OPEN" window (``state`` gone,
        ``tripped`` live) that a post-expiry ``can_request`` reads as the
        HALF-OPEN trigger. Cleared on a true CLOSE; the long TTL is a self-heal
        safety net so a missed CLOSE (instance crash mid-probe) cannot orphan
        the key forever — it simply re-arms HALF-OPEN at worst.
    mol:cb:{provider}:{task}:halfopen  → "1" while a probe is in flight,
        TTL=OPEN_TTL_SECONDS.
    mol:cb:{provider}:{task}:successes → INCR counter during HALF-OPEN.
"""

from __future__ import annotations

import structlog

from .redis_client import get_redis_client

logger = structlog.get_logger(__name__)

FAILURE_THRESHOLD = 3
FAILURE_WINDOW_SECONDS = 10
OPEN_TTL_SECONDS = 30
SUCCESS_THRESHOLD = 2
# `tripped` MUST outlive `state` so the "expired-OPEN" window (state gone,
# tripped live) exists — that window is the HALF-OPEN trigger. Must be
# >> OPEN_TTL_SECONDS. Cleared on true CLOSE; the long horizon is a self-heal
# guard against a missed CLOSE orphaning the marker.
TRIPPED_TTL_SECONDS = 3600


def _k(provider: str, task: str, suffix: str) -> str:
    return f"mol:cb:{provider}:{task}:{suffix}"


async def can_request(provider: str, task: str) -> bool:
    """Return True iff a request to ``provider`` for ``task`` is permitted."""
    redis = get_redis_client()
    if redis is None:
        return True  # FAIL-OPEN
    try:
        state = await redis.get(_k(provider, task, "state"))
        if state == "open":
            # OPEN window still live (`state` marker has not yet expired) ⇒ block.
            return False
        tripped = await redis.get(_k(provider, task, "tripped"))
        if tripped == "1":
            # `state` has expired but `tripped` is still live = "expired-OPEN".
            # Promote to HALF-OPEN.
            half = await redis.get(_k(provider, task, "halfopen"))
            if half == "1":
                # A probe is already in flight — block any concurrent request.
                return False
            # Let exactly ONE probe through: mark it in-flight and reset the
            # success counter for this probe cycle.
            await redis.set(_k(provider, task, "halfopen"), "1", ex=OPEN_TTL_SECONDS)
            await redis.set(_k(provider, task, "successes"), "0", ex=OPEN_TTL_SECONDS)
            return True
        # Fully CLOSED (never tripped, or already recovered) ⇒ allow.
        return True
    except Exception as err:  # noqa: BLE001 — never block on store failure
        logger.warning(
            "mol.breaker.can_request_failed", provider=provider, task=task, error=str(err)
        )
        return True  # FAIL-OPEN


async def record_failure(provider: str, task: str) -> None:
    """Record a provider failure; trip OPEN at FAILURE_THRESHOLD."""
    redis = get_redis_client()
    if redis is None:
        return
    try:
        half = await redis.get(_k(provider, task, "halfopen"))
        if half == "1":
            # Failure during a probe ⇒ straight back to OPEN. Re-arm BOTH the
            # short-lived OPEN window AND the long-lived tripped marker so the
            # expired-OPEN→HALF-OPEN window exists again after this window ends.
            await redis.set(_k(provider, task, "state"), "open", ex=OPEN_TTL_SECONDS)
            await redis.set(_k(provider, task, "tripped"), "1", ex=TRIPPED_TTL_SECONDS)
            await redis.delete(_k(provider, task, "halfopen"))
            await redis.delete(_k(provider, task, "successes"))
            return
        count = await redis.incr(_k(provider, task, "failures"))
        await redis.expire(_k(provider, task, "failures"), FAILURE_WINDOW_SECONDS)
        if count >= FAILURE_THRESHOLD:
            # Trip OPEN. `state` (short TTL) blocks while live; `tripped` (long
            # TTL) outlives it so the post-expiry HALF-OPEN probe can fire.
            await redis.set(_k(provider, task, "state"), "open", ex=OPEN_TTL_SECONDS)
            await redis.set(_k(provider, task, "tripped"), "1", ex=TRIPPED_TTL_SECONDS)
    except Exception as err:  # noqa: BLE001
        logger.warning(
            "mol.breaker.record_failure_failed", provider=provider, task=task, error=str(err)
        )


async def record_success(provider: str, task: str) -> None:
    """Record a provider success; CLOSE after SUCCESS_THRESHOLD in HALF-OPEN."""
    redis = get_redis_client()
    if redis is None:
        return
    try:
        half = await redis.get(_k(provider, task, "halfopen"))
        if half == "1":
            n = await redis.incr(_k(provider, task, "successes"))
            if n >= SUCCESS_THRESHOLD:
                # CLOSE: clear all breaker keys for this (provider, task).
                await redis.delete(
                    _k(provider, task, "failures"),
                    _k(provider, task, "state"),
                    _k(provider, task, "tripped"),
                    _k(provider, task, "halfopen"),
                    _k(provider, task, "successes"),
                )
            return
        # Normal CLOSED success: reset the failure counter.
        await redis.set(_k(provider, task, "failures"), "0", ex=FAILURE_WINDOW_SECONDS)
    except Exception as err:  # noqa: BLE001
        logger.warning(
            "mol.breaker.record_success_failed", provider=provider, task=task, error=str(err)
        )
