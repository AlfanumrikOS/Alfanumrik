"""Tests for ``services.ai.shared.retry``.

Coverage targets:
- happy path: 1st call succeeds, no sleep
- retryable failure on 1st attempt, success on 2nd: returns success
- max-attempts exhaustion: re-raises the LAST underlying exception
  (not tenacity.RetryError)
- non-retryable failure: re-raises immediately, no retries
- custom ``should_retry`` predicate is honored
- validation: invalid arg combos raise ValueError at decoration time
"""

from __future__ import annotations

import asyncio

import pytest

from services.ai.shared.retry import retry_with_backoff


class _Counter:
    """Helper — counts calls so we can assert retry attempts."""

    def __init__(self) -> None:
        self.calls = 0


# ── Happy path ────────────────────────────────────────────────────────────────


async def test_first_call_succeeds_no_retry() -> None:
    """A function that succeeds on attempt 1 returns immediately."""
    c = _Counter()

    @retry_with_backoff(max_attempts=3, base_delay=0.001)
    async def fn() -> str:
        c.calls += 1
        return "ok"

    out = await fn()
    assert out == "ok"
    assert c.calls == 1


# ── Retry-then-success ────────────────────────────────────────────────────────


async def test_retryable_failure_then_success() -> None:
    """Fail with a retryable error once, succeed on retry."""
    c = _Counter()

    @retry_with_backoff(max_attempts=3, base_delay=0.001)
    async def fn() -> str:
        c.calls += 1
        if c.calls < 2:
            raise TimeoutError("simulated transient")
        return "ok"

    out = await fn()
    assert out == "ok"
    assert c.calls == 2


# ── Exhaustion ────────────────────────────────────────────────────────────────


async def test_max_attempts_exhaustion_reraises_underlying() -> None:
    """After max_attempts, we re-raise the underlying error (not RetryError)."""
    c = _Counter()

    @retry_with_backoff(max_attempts=2, base_delay=0.001)
    async def fn() -> str:
        c.calls += 1
        raise TimeoutError("never succeeds")

    with pytest.raises(TimeoutError, match="never succeeds"):
        await fn()
    assert c.calls == 2


# ── Non-retryable bails immediately ───────────────────────────────────────────


async def test_non_retryable_error_no_retry() -> None:
    """A programming bug (e.g. KeyError) should NOT trigger retries."""
    c = _Counter()

    @retry_with_backoff(max_attempts=5, base_delay=0.001)
    async def fn() -> str:
        c.calls += 1
        raise KeyError("not a transient")

    with pytest.raises(KeyError):
        await fn()
    # Default predicate returns False for KeyError → no retries beyond first.
    assert c.calls == 1


# ── Status-code-encoded errors ────────────────────────────────────────────────


async def test_status_503_in_message_is_retryable() -> None:
    """Default predicate retries when the error message contains a 5xx code."""
    c = _Counter()

    @retry_with_backoff(max_attempts=3, base_delay=0.001)
    async def fn() -> str:
        c.calls += 1
        if c.calls < 3:
            raise RuntimeError("Anthropic 503 (overloaded)")
        return "ok"

    out = await fn()
    assert out == "ok"
    assert c.calls == 3


async def test_status_400_is_not_retryable() -> None:
    """A 4xx error in the message should NOT trigger retries."""
    c = _Counter()

    @retry_with_backoff(max_attempts=5, base_delay=0.001)
    async def fn() -> str:
        c.calls += 1
        raise RuntimeError("OpenAI 400 (bad request)")

    with pytest.raises(RuntimeError):
        await fn()
    assert c.calls == 1


# ── Custom predicate ──────────────────────────────────────────────────────────


async def test_custom_predicate_controls_retry() -> None:
    """Caller-supplied predicate overrides the default."""
    c = _Counter()

    def always_retry(_exc: BaseException) -> bool:
        return True

    @retry_with_backoff(max_attempts=3, base_delay=0.001, should_retry=always_retry)
    async def fn() -> str:
        c.calls += 1
        if c.calls < 3:
            raise KeyError("would not normally retry")
        return "ok"

    out = await fn()
    assert out == "ok"
    assert c.calls == 3


# ── Validation ────────────────────────────────────────────────────────────────


def test_zero_max_attempts_raises_value_error() -> None:
    with pytest.raises(ValueError, match="max_attempts"):
        retry_with_backoff(max_attempts=0)


def test_negative_base_delay_raises_value_error() -> None:
    with pytest.raises(ValueError, match="base_delay"):
        retry_with_backoff(base_delay=-1.0)


# ── Wrapper preserves identity ────────────────────────────────────────────────


async def test_wrapper_preserves_function_metadata() -> None:
    """__name__/__qualname__/__doc__ should survive wrapping."""

    @retry_with_backoff()
    async def my_named_function() -> str:
        """Doc string preserved."""
        return "x"

    assert my_named_function.__name__ == "my_named_function"
    assert my_named_function.__doc__ == "Doc string preserved."


# ── Concurrent calls don't share state ────────────────────────────────────────


async def test_concurrent_decorated_calls_are_independent() -> None:
    """Two concurrent invocations of the same decorated fn don't share counters."""
    c1 = _Counter()
    c2 = _Counter()

    @retry_with_backoff(max_attempts=3, base_delay=0.001)
    async def fn(counter: _Counter) -> int:
        counter.calls += 1
        if counter.calls < 2:
            raise TimeoutError("transient")
        return counter.calls

    a, b = await asyncio.gather(fn(c1), fn(c2))
    assert a == 2
    assert b == 2
    assert c1.calls == 2
    assert c2.calls == 2
