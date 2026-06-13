"""Semantic cache tests — A4."""

from __future__ import annotations

import pytest

from services.ai.mol import cache as cache_mod
from services.ai.mol.cache import cache_key, get_cached, set_cached, should_cache


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex: int | None = None):  # noqa: A003
        self.store[key] = str(value)


@pytest.fixture()
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(cache_mod, "get_redis_client", lambda: fake)
    return fake


def test_cache_key_normalizes_query_and_includes_context():
    a = cache_key("explanation", grade="8", subject="science", query="  What is FORCE? ")
    b = cache_key("explanation", grade="8", subject="science", query="what is force?")
    assert a == b  # case + whitespace normalized
    c = cache_key("explanation", grade="9", subject="science", query="what is force?")
    assert a != c  # grade is part of the key


async def test_cache_miss_then_hit(fake_redis):
    key = cache_key("explanation", grade="8", subject="science", query="what is force")
    assert await get_cached(key) is None
    await set_cached(key, "Force is a push or pull.", ttl_seconds=3600)
    assert await get_cached(key) == "Force is a push or pull."


async def test_get_cached_returns_none_when_redis_unconfigured(monkeypatch):
    monkeypatch.setattr(cache_mod, "get_redis_client", lambda: None)
    key = cache_key("explanation", grade="8", subject="x", query="q")
    assert await get_cached(key) is None  # no Redis ⇒ always miss


def test_should_cache_skips_when_fallback_occurred():
    # fallback_count > 0 ⇒ low-confidence answer; never cache.
    assert should_cache(fallback_count=1, has_chat_history=False) is False


def test_should_cache_skips_personalized_chat_history():
    assert should_cache(fallback_count=0, has_chat_history=True) is False


def test_should_cache_allows_clean_stateless_answer():
    assert should_cache(fallback_count=0, has_chat_history=False) is True
