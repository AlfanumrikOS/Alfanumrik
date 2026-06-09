"""Bearer JWT - student verification (same pattern as voice.auth)."""

from __future__ import annotations

import httpx
import structlog
from pydantic import BaseModel, ConfigDict

from ...config import get_settings
from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)


class AuthFailed(Exception):
    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


class StudentAuthResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    student_id: str | None = None
    auth_user_id: str | None = None


async def verify_student(authorization_header: str | None) -> StudentAuthResult:
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise AuthFailed("missing_auth", status=401)
    token = authorization_header[len("Bearer ") :].strip()
    if not token:
        raise AuthFailed("missing_auth", status=401)
    s = get_settings()
    if not s.supabase_url:
        raise AuthFailed("server_misconfigured", status=503)
    user_id = await _resolve_user_id(token)
    if user_id is None:
        raise AuthFailed("invalid_token", status=401)
    student_row = await _lookup_student(user_id)
    if student_row is None:
        raise AuthFailed("student_not_found", status=403)
    return StudentAuthResult(
        ok=True, student_id=str(student_row["id"]), auth_user_id=user_id
    )


async def _resolve_user_id(token: str) -> str | None:
    s = get_settings()
    if not s.supabase_service_role_key:
        return None
    url = f"{s.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers)
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    try:
        body = res.json()
    except ValueError:
        return None
    user_id = body.get("id") if isinstance(body, dict) else None
    return user_id if isinstance(user_id, str) and user_id else None


async def _lookup_student(user_id: str) -> dict | None:
    client = get_service_client()
    if client is None:
        return None
    try:
        result = (
            await client.table("students")
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
