"""Async Supabase service-role client.

We use ``postgrest`` (the underpinning of supabase-py) directly rather than
the full ``supabase`` package — Phase 0 only needs PostgREST writes against
``mol_request_logs``, and the slimmer dep keeps cold start fast.

The client is constructed lazily and cached per-process. Tests patch this
module via :func:`reset_service_client` to inject a fake.
"""

from __future__ import annotations

from typing import Any

import structlog

from ..config import get_settings

logger = structlog.get_logger(__name__)

# Module-level singleton. ``None`` means "not yet attempted" OR "Supabase not
# configured" — :func:`get_service_client` distinguishes the two.
_client: Any | None = None
_init_attempted = False


def get_service_client() -> Any | None:
    """Return a cached async PostgREST client, or ``None`` if not configurable.

    Returning ``None`` instead of raising lets the telemetry writer degrade
    gracefully in local dev / pytest where Supabase is intentionally absent.
    """
    global _client, _init_attempted
    if _client is not None:
        return _client
    if _init_attempted:
        return None

    _init_attempted = True
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        logger.debug("supabase.client.skipped", reason="no_credentials")
        return None

    try:
        from postgrest import AsyncPostgrestClient

        # PostgREST endpoint lives at /rest/v1 on the Supabase project URL.
        rest_url = s.supabase_url.rstrip("/") + "/rest/v1"
        _client = AsyncPostgrestClient(
            rest_url,
            headers={
                "apikey": s.supabase_service_role_key,
                "Authorization": f"Bearer {s.supabase_service_role_key}",
            },
        )
        logger.info("supabase.client.initialized")
        return _client
    except Exception as err:  # noqa: BLE001 — telemetry must never break startup
        logger.warning("supabase.client.init_failed", error=str(err))
        return None


def reset_service_client() -> None:
    """Test-only: clear the cached client (and re-arm the init attempt)."""
    global _client, _init_attempted
    _client = None
    _init_attempted = False


async def ping_supabase() -> bool:
    """Lightweight readiness probe — used by ``/readyz``.

    Sends a HEAD-equivalent request against ``mol_request_logs?select=*&limit=0``
    via PostgREST. Returns True iff Supabase responded 2xx.
    """
    client = get_service_client()
    if client is None:
        return False
    try:
        # ``.limit(0)`` returns an empty payload but still hits PostgREST,
        # which is the cheapest way to validate URL + service-role key.
        await client.table("mol_request_logs").select("request_id").limit(0).execute()
        return True
    except Exception as err:  # noqa: BLE001 — readiness, not user-facing
        logger.debug("supabase.ping_failed", error=str(err))
        return False
