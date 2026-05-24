"""Feature-flag reader — Python twin of :file:`feature-flag.ts`.

Reads ``public.feature_flags`` via a service-role HTTP fetch with a 5-minute
per-process cache. Mirrors:
- :func:`is_flag_enabled` → TS ``isFlagEnabled``
- :func:`get_flag_envelope` → TS ``getFlagEnvelope`` (C4 metadata reader)
- :func:`_reset_flag_cache` → TS ``_resetFlagCache`` (test-only)

All gating policy lives at the call site — this module is the I/O layer
ONLY. The TS source makes the same split deliberately so shadow-routing
can use a non-standard ``hash(request_id + task_type) % 100`` rollout
without the base reader knowing about it.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

from ..config import get_settings

logger = structlog.get_logger(__name__)

_TTL_SECONDS = 5 * 60


@dataclass
class FlagRow:
    flag_name: str
    is_enabled: bool
    target_environments: list[str] | None
    rollout_percentage: int | None
    metadata: dict[str, Any] | None


# Per-process cache. Async-safe via the lock below.
_cache: list[FlagRow] | None = None
_cache_expiry: float = 0.0
_cache_lock = asyncio.Lock()


async def _load() -> list[FlagRow]:
    global _cache, _cache_expiry
    now = time.monotonic()
    if _cache is not None and now < _cache_expiry:
        return _cache

    async with _cache_lock:
        # Double-checked under lock — another waiter may have loaded.
        if _cache is not None and now < _cache_expiry:
            return _cache

        s = get_settings()
        if not s.supabase_url or not s.supabase_service_role_key:
            # Behave like the TS reader: return whatever cache we have
            # (possibly empty) and leave expiry as-is so we keep retrying.
            return _cache or []

        url = (
            f"{s.supabase_url}/rest/v1/feature_flags"
            "?select=flag_name,is_enabled,target_environments,rollout_percentage,metadata"
        )
        headers = {
            "apikey": s.supabase_service_role_key,
            "Authorization": f"Bearer {s.supabase_service_role_key}",
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(url, headers=headers)
            if res.status_code >= 400:
                logger.warning("feature_flag.load_failed", status=res.status_code)
                return _cache or []
            data = res.json()
        except Exception as err:  # noqa: BLE001 — defensive parity with TS
            logger.warning("feature_flag.load_threw", error=str(err))
            return _cache or []

        _cache = [
            FlagRow(
                flag_name=row.get("flag_name", ""),
                is_enabled=bool(row.get("is_enabled", False)),
                target_environments=row.get("target_environments"),
                rollout_percentage=row.get("rollout_percentage"),
                metadata=row.get("metadata"),
            )
            for row in data
            if isinstance(row, dict)
        ]
        _cache_expiry = now + _TTL_SECONDS
        return _cache


def _in_rollout_bucket(student_id: str, percent: int) -> bool:
    """Deterministic 0..99 bucket. Mirrors TS implementation (DJB-2 mod 100)."""
    h = 0
    for ch in student_id:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
        # Convert to signed 32-bit so we match JS's ``| 0`` semantics.
        if h >= 0x80000000:
            h -= 0x100000000
    return abs(h) % 100 < percent


async def is_flag_enabled(
    flag_name: str,
    *,
    student_id: str | None = None,
    environment: str | None = None,
) -> bool:
    """Resolve a feature flag for a given context."""
    flags = await _load()
    f = next((x for x in flags if x.flag_name == flag_name), None)
    if f is None or not f.is_enabled:
        return False

    if f.target_environments:
        env = environment or get_settings().environment
        if env not in f.target_environments:
            return False

    if isinstance(f.rollout_percentage, int) and f.rollout_percentage < 100:
        if not student_id:
            return False
        return _in_rollout_bucket(student_id, f.rollout_percentage)

    return True


async def get_flag_envelope(flag_name: str) -> dict[str, Any]:
    """Read a flag's full envelope (is_enabled + metadata).

    Mirrors TS ``getFlagEnvelope``: returns
    ``{"is_enabled": bool, "metadata": {...}}``. Never throws. Returns
    ``{"is_enabled": False, "metadata": {}}`` when the flag is missing.

    The caller owns gating policy — this helper does NOT apply
    ``target_environments`` / ``rollout_percentage`` filtering.
    """
    flags = await _load()
    f = next((x for x in flags if x.flag_name == flag_name), None)
    if f is None:
        return {"is_enabled": False, "metadata": {}}
    meta = f.metadata if isinstance(f.metadata, dict) else {}
    return {"is_enabled": bool(f.is_enabled), "metadata": meta}


def _reset_flag_cache() -> None:
    """Test-only: clear the in-process flag cache."""
    global _cache, _cache_expiry
    _cache = None
    _cache_expiry = 0.0
