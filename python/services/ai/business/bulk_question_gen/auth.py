"""Admin JWT verification — port of TS ``verifyAdminAuth``.

Source: ``supabase/functions/bulk-question-gen/index.ts:157-201``.

Flow:
  1. Extract ``Bearer <token>`` from the Authorization header.
  2. Verify the JWT by calling Supabase Auth's ``/auth/v1/user`` endpoint
     with the user's token (anon key as the apikey header). Returns the
     authenticated user's UUID.
  3. Look up ``admin_users`` by ``auth_user_id`` with ``is_active=true``.
  4. Allow when ``admin_level`` ∈ {'admin', 'super_admin'}.

Any failure → :class:`AuthFailed` (caller maps to 401/403). We do NOT log
the token or the email — both are sensitive (P13).
"""

from __future__ import annotations

import httpx
import structlog

from ...config import get_settings
from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)

_ALLOWED_ADMIN_LEVELS = frozenset({"admin", "super_admin"})


class AuthFailed(Exception):
    """Raised on any auth failure. Carries an HTTP status hint for the route."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


async def verify_admin(authorization_header: str | None) -> dict:
    """Verify the request comes from an active admin user.

    Returns:
        ``{"auth_user_id": <uuid>, "admin_level": "admin"|"super_admin"}``.

    Raises:
        :class:`AuthFailed` with status=401 on missing/invalid token, or
        status=403 when the user is not an active admin.
    """
    # 1. Header shape
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise AuthFailed("Missing or invalid Authorization header", status=401)
    token = authorization_header[len("Bearer ") :].strip()
    if not token:
        raise AuthFailed("Missing or invalid Authorization header", status=401)

    # 2. Verify against Supabase Auth.
    s = get_settings()
    if not s.supabase_url:
        # Service is misconfigured — fail closed.
        raise AuthFailed("Supabase not configured", status=503)

    user_id = await _resolve_user_id(token)
    if user_id is None:
        raise AuthFailed("Invalid or expired token", status=401)

    # 3. Look up admin_users via service-role client.
    admin = await _lookup_admin(user_id)
    if admin is None:
        raise AuthFailed("Admin access required", status=403)
    if admin.get("admin_level") not in _ALLOWED_ADMIN_LEVELS:
        raise AuthFailed("Admin access required", status=403)
    return {"auth_user_id": user_id, "admin_level": admin["admin_level"]}


# ── Helpers ─────────────────────────────────────────────────────────────────


async def _resolve_user_id(token: str) -> str | None:
    """Call ``GET /auth/v1/user`` with the caller's bearer token.

    Uses ``apikey: <service_role>`` (any valid project key works for this
    endpoint; the user identity comes from the Bearer JWT). We do NOT call
    the service-role-only Admin API here — that would let a stolen
    service-role key impersonate any user.
    """
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        return None
    url = f"{s.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {
        "apikey": s.supabase_service_role_key,
        "Authorization": f"Bearer {token}",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers)
    except httpx.HTTPError as err:
        logger.warning("bulk_question_gen.auth.network_error", error=str(err))
        return None
    if res.status_code != 200:
        # 401/403/etc — token is invalid; log status only (no body, no token).
        logger.info(
            "bulk_question_gen.auth.token_rejected",
            status=res.status_code,
        )
        return None
    try:
        body = res.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    user_id = body.get("id")
    if not isinstance(user_id, str) or not user_id:
        return None
    return user_id


async def _lookup_admin(user_id: str) -> dict | None:
    """Query ``admin_users`` for ``auth_user_id=user_id AND is_active=true``.

    Returns the row dict (only ``admin_level`` is read; everything else is
    intentionally untouched so we don't leak email/name into logs).
    """
    client = get_service_client()
    if client is None:
        # No Supabase configured — fail closed (caller treats as 503).
        logger.warning("bulk_question_gen.auth.no_supabase_client")
        return None
    try:
        result = (
            await client.table("admin_users")
            .select("admin_level")
            .eq("auth_user_id", user_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception as err:  # noqa: BLE001 — surface as auth failure
        logger.warning(
            "bulk_question_gen.auth.lookup_failed",
            error=str(err),
        )
        return None
    rows = getattr(result, "data", None)
    if rows is None and isinstance(result, dict):
        rows = result.get("data")
    if not rows or not isinstance(rows, list):
        return None
    first = rows[0]
    if not isinstance(first, dict):
        return None
    return first
