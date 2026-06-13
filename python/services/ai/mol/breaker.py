"""Cross-instance circuit breaker (Upstash Redis) — A3.

State machine, keyed by ``(provider, task_type)``:

    CLOSED --(FAILURE_THRESHOLD fails within FAILURE_WINDOW_SECONDS)--> OPEN
    OPEN   --(OPEN_TTL_SECONDS elapsed; OPEN marker expires)--------->  HALF-OPEN
    HALF-OPEN --(SUCCESS_THRESHOLD consecutive successes)----------->   CLOSED
    HALF-OPEN --(any failure)-------------------------------------->    OPEN

FAIL-OPEN contract: when the Redis client is None (unconfigured / unreachable)
``can_request`` returns True and the recorders are no-ops, so the breaker
never blocks a live request on store failure (spec A3 risk mitigation).

Redis keys (string values, all TTL-bounded):
    mol:cb:{provider}:{task}:failures  → INCR counter, TTL=FAILURE_WINDOW
    mol:cb:{provider}:{task}:state     → "open" while the OPEN window is live,
        TTL=OPEN_TTL. When this key EXPIRES the breaker is eligible to probe.
    mol:cb:{provider}:{task}:tripped   → "1" from the first trip until a true
        CLOSE. Outlives ``state``'s TTL so a post-expiry ``can_request`` knows
        to enter HALF-OPEN (probe) rather than treating the breaker as CLOSED.
    mol:cb:{provider}:{task}:halfopen  → "1" while a probe is in flight.
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


def _k(provider: str, task: str, suffix: str) -> str:
    return f"mol:cb:{provider}:{task}:{suffix}"


async def can_request(provider: str, task: str) -> bool:
    """Return True iff a request to ``provider`` for ``task`` is permitted."""
    redis = get_redis_client()
    if redis is None:
        return True  # FAIL-OPEN
    try:
        half = await redis.get(_k(provider, task, "halfopen"))
        if half == "1":
            # A probe is already in flight — block any concurrent request.
            return False
        state = await redis.get(_k(provider, task, "state"))
        if state == "open":
            # OPEN window still live (state marker has not yet expired) ⇒ block.
            return False
        tripped = await redis.get(_k(provider, task, "tripped"))
        if tripped == "1":
            # OPEN marker has expired but the breaker has not CLOSED. Promote
            # to HALF-OPEN: let exactly one probe through, mark it in-flight,
            # and reset the success counter for this probe cycle.
            await redis.set(_k(provider, task, "halfopen"), "1", ex=OPEN_TTL_SECONDS)
            await redis.set(_k(provider, task, "successes"), "0", ex=OPEN_TTL_SECONDS)
            return True
        # Fully CLOSED (never tripped, or already recovered) ⇒ allow.
        return True
    except Exception as err:  # noqa: BLE001 — never block on store failure
        logger.warning("mol.breaker.can_request_failed", provider=provider, task=task, error=str(err))
        return True  # FAIL-OPEN


async def record_failure(provider: str, task: str) -> None:
    """Record a provider failure; trip OPEN at FAILURE_THRESHOLD."""
    redis = get_redis_client()
    if redis is None:
        return
    try:
        half = await redis.get(_k(provider, task, "halfopen"))
        if half == "1":
            # Failure during a probe ⇒ straight back to OPEN.
            await redis.set(_k(provider, task, "state"), "open", ex=OPEN_TTL_SECONDS)
            await redis.set(_k(provider, task, "tripped"), "1", ex=OPEN_TTL_SECONDS)
            await redis.delete(_k(provider, task, "halfopen"))
            await redis.delete(_k(provider, task, "successes"))
            return
        count = await redis.incr(_k(provider, task, "failures"))
        await redis.expire(_k(provider, task, "failures"), FAILURE_WINDOW_SECONDS)
        if count >= FAILURE_THRESHOLD:
            await redis.set(_k(provider, task, "state"), "open", ex=OPEN_TTL_SECONDS)
            await redis.set(_k(provider, task, "tripped"), "1", ex=OPEN_TTL_SECONDS)
    except Exception as err:  # noqa: BLE001
        logger.warning("mol.breaker.record_failure_failed", provider=provider, task=task, error=str(err))


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
        logger.warning("mol.breaker.record_success_failed", provider=provider, task=task, error=str(err))
