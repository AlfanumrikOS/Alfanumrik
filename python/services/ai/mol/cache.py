"""Semantic (exact-match) cache for MOL answers — A4.

Keyed on ``(task_type, grade, subject, normalized_query)`` with a TTL. The
cache short-circuits BEFORE any provider call (consistent with the Foxy
single-retrieval contract, REG-50). Backed by Upstash Redis; fails open
(every lookup is a miss) when Redis is unconfigured.

Conservative by design (design-spec risk row):
- exact-match key, not embedding similarity (pgvector match is a follow-up);
- short default TTL;
- ``should_cache`` REFUSES to store low-confidence (a fallback occurred) or
  personalized (chat_history present) outputs.

P13: the cache is PII-free. The raw query is SHA-256-hashed into the key (never
stored verbatim), and the key is intentionally NOT scoped by ``student_id`` —
dedup is cross-student by design. The skip-rules guarantee personalized
(chat_history) answers are never written, so no student-identifiable content
can be cached or leaked between students.
"""

from __future__ import annotations

import hashlib
import re

import structlog

from .redis_client import get_redis_client

logger = structlog.get_logger(__name__)

DEFAULT_TTL_SECONDS = 6 * 60 * 60  # 6h
_WS_RE = re.compile(r"\s+")


def _normalize(query: str) -> str:
    return _WS_RE.sub(" ", query.strip().lower())


def cache_key(task_type: str, *, grade: str, subject: str | None, query: str) -> str:
    """Stable Redis key for an answer. PII-free: the raw query is hashed."""
    canonical = f"{task_type}|{grade}|{subject or '_'}|{_normalize(query)}"
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    return f"mol:cache:{digest}"


async def get_cached(key: str) -> str | None:
    """Return the cached answer text, or None (miss / Redis down)."""
    redis = get_redis_client()
    if redis is None:
        return None
    try:
        return await redis.get(key)
    except Exception as err:  # noqa: BLE001 — cache miss on any store failure
        logger.warning("mol.cache.get_failed", error=str(err))
        return None


async def set_cached(key: str, text: str, *, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
    """Store an answer with a TTL. No-op when Redis is unconfigured."""
    redis = get_redis_client()
    if redis is None:
        return
    try:
        await redis.set(key, text, ex=ttl_seconds)
    except Exception as err:  # noqa: BLE001
        logger.warning("mol.cache.set_failed", error=str(err))


def should_cache(*, fallback_count: int, has_chat_history: bool) -> bool:
    """Only cache clean, stateless, high-confidence answers.

    Skip-rules: a fallback occurred (low-confidence) OR the answer is
    personalized by conversation history (chat_history present) — never store
    either.
    """
    if fallback_count > 0:
        return False
    return not has_chat_history
