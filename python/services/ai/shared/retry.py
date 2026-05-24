"""Retry-with-backoff decorator for upstream provider HTTP calls.

Wraps `tenacity` with sensible defaults so business modules can decorate
provider calls without re-deriving the backoff math. Mirrors the TS-side
``p-retry`` defaults that the Edge Functions use.

Scope (Phase 2): provider HTTP calls (Anthropic, OpenAI, Supabase
PostgREST writes). Out of scope: business-logic retries — those belong
in the orchestrator's per-target retry loop in
:mod:`services.ai.mol.orchestrator`.

Adoption pattern:

    from services.ai.shared.retry import retry_with_backoff

    class AnthropicProvider:
        @retry_with_backoff()  # uses defaults: 3 attempts, 0.5-8s
        async def _http_call(self, ...):
            ...

The decorator is purely additive — it does not modify return values,
swallow exceptions on exhaustion, or change call-site semantics. On
final failure it re-raises the underlying exception so the orchestrator's
retry/circuit-breaker logic stays authoritative.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import structlog
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

logger = structlog.get_logger(__name__)

T = TypeVar("T")

# Default retry policy for provider HTTP calls.
# - 3 attempts total (1 initial + 2 retries) matches TS p-retry config.
# - 0.5s base with full-jitter exponential backoff up to 8s caps the
#   thundering-herd risk during a provider rate-limit storm.
# - max_attempts=3 keeps total wall-time bounded at ~10s worst case so
#   we never starve the per-request 300s Cloud Run timeout.
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_BASE_DELAY_S = 0.5
DEFAULT_MAX_DELAY_S = 8.0


def _default_should_retry(exc: BaseException) -> bool:
    """Decide whether ``exc`` is retryable.

    Conservative default: retry on common transient errors, NOT on
    programming bugs. Reuses the orchestrator's status-classification
    convention via the exception's string representation (status codes
    show up as ``Provider 503 (...)`` or similar).

    The caller can override by passing ``should_retry`` to the decorator.
    """
    name = type(exc).__name__
    if name in {"TimeoutError", "ConnectError", "ReadTimeout", "WriteTimeout"}:
        return True
    # httpx connection-level errors typically carry these substrings.
    msg = str(exc).lower()
    if any(token in msg for token in ("timed out", "connection", "rate limit", "429")):
        return True
    # 5xx HTTP statuses encoded in the message (orchestrator convention).
    return any(str(code) in msg for code in (500, 502, 503, 504, 529))


def retry_with_backoff(
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    base_delay: float = DEFAULT_BASE_DELAY_S,
    max_delay: float = DEFAULT_MAX_DELAY_S,
    should_retry: Callable[[BaseException], bool] | None = None,
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """Decorator: retry an async callable with jittered exponential backoff.

    Args:
        max_attempts: total attempts (including the first). Must be ≥ 1.
        base_delay: initial backoff in seconds (first retry).
        max_delay: cap on a single backoff in seconds (jitter still applies).
        should_retry: predicate over the raised exception. Defaults to
            :func:`_default_should_retry`. Return True to retry, False to
            re-raise immediately.

    Returns:
        Decorator that wraps an ``async def`` and returns the same shape.

    Raises:
        ValueError: if ``max_attempts < 1`` or ``base_delay < 0``.
        The underlying exception: on final attempt failure (NOT a
            ``tenacity.RetryError`` — we unwrap so callers see the real
            failure they can classify).
    """
    if max_attempts < 1:
        raise ValueError(f"max_attempts must be >= 1, got {max_attempts}")
    if base_delay < 0:
        raise ValueError(f"base_delay must be >= 0, got {base_delay}")

    predicate = should_retry or _default_should_retry

    def decorator(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            attempt = 0
            try:
                async for tenacity_attempt in AsyncRetrying(
                    stop=stop_after_attempt(max_attempts),
                    wait=wait_exponential_jitter(initial=base_delay, max=max_delay),
                    retry=retry_if_exception(predicate),
                    reraise=True,
                ):
                    with tenacity_attempt:
                        attempt += 1
                        try:
                            return await fn(*args, **kwargs)
                        except Exception as err:
                            # Only log on non-final attempts that will retry;
                            # the final raise is observed by the caller's
                            # error handler so we don't double-log.
                            if attempt < max_attempts and predicate(err):
                                logger.warning(
                                    "retry.attempt_failed",
                                    fn=fn.__qualname__,
                                    attempt=attempt,
                                    max_attempts=max_attempts,
                                    error=str(err),
                                )
                            raise
            except RetryError as e:
                # Defense in depth — reraise=True should already unwrap.
                if e.last_attempt and e.last_attempt.failed:
                    underlying = e.last_attempt.exception()
                    if underlying is not None:
                        raise underlying from None
                raise
            # Unreachable but satisfies type checker — AsyncRetrying always
            # returns from within the `with` block or raises.
            raise RuntimeError("retry_with_backoff exhausted without return")  # pragma: no cover

        # Preserve qualname so logs / Sentry traces show the wrapped fn.
        wrapper.__name__ = fn.__name__
        wrapper.__qualname__ = fn.__qualname__
        wrapper.__doc__ = fn.__doc__
        return wrapper

    return decorator
