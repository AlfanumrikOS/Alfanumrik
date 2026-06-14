"""Bearer JWT - guardian verification for POST /v1/parent-report-generator.

P13: never trust body.parent_id - resolve guardian id from the JWT's
auth_user_id. Mirrors TS lines 605-622 verbatim.
"""

from __future__ import annotations

import httpx
import structlog
from pydantic import BaseModel, ConfigDict, Field

from ...config import get_settings
from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)


class AuthFailed(Exception):
    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


class GuardianAuthResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    guardian_id: str | None = Field(default=None)
    auth_user_id: str | None = Field(default=None)
    error: str | None = Field(default=None)


async def verify_guardian(authorization_header: str | None) -> GuardianAuthResult:
    """Verify Bearer JWT - return GuardianAuthResult or raise AuthFailed.

    Posture mirrors voice.auth.verify_student: 401 for missing/bad token,
    403 for no guardian profile, 503 for misconfig.
    """
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise AuthFailed("Missing or invalid Authorization header", status=401)
    token = authorization_header[len("Bearer ") :].strip()
    if not token:
        raise AuthFailed("Missing or invalid Authorization header", status=401)

    s = get_settings()
    if not s.supabase_url:
        raise AuthFailed("Supabase not configured", status=503)

    user_id = await _resolve_user_id(token)
    if user_id is None:
        raise AuthFailed("Invalid or expired token", status=401)

    guardian_row = await _lookup_guardian(user_id)
    if guardian_row is None:
        raise AuthFailed("No guardian profile for this user", status=403)

    return GuardianAuthResult(ok=True, guardian_id=str(guardian_row["id"]), auth_user_id=user_id)


async def _resolve_user_id(token: str) -> str | None:
    s = get_settings()
    if not s.supabase_service_role_key:
        return None
    url = f"{s.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers)
    except httpx.HTTPError as err:
        logger.warning("parent_report.auth.network_error", error=str(err))
        return None
    if res.status_code != 200:
        return None
    try:
        body = res.json()
    except ValueError:
        return None
    user_id = body.get("id") if isinstance(body, dict) else None
    return user_id if isinstance(user_id, str) and user_id else None


async def _lookup_guardian(user_id: str) -> dict | None:
    client = get_service_client()
    if client is None:
        return None
    try:
        result = (
            await client.table("guardians")
            .select("id")
            .eq("auth_user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return None
    data = getattr(result, "data", None)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict):
        return data
    return None
