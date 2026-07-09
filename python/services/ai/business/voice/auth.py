"""Student JWT verification for ``POST /v1/voice/transcribe``.

Sibling of :mod:`services.ai.business.bulk_question_gen.auth`, but on a
DIFFERENT auth path — voice is student-facing and queries the
``students`` table instead of ``admin_users``.

Flow (mirrors the admin path so the security posture is identical):
  1. Extract ``Bearer <token>`` from the Authorization header.
  2. Verify the JWT by calling Supabase Auth's ``/auth/v1/user`` endpoint.
     The Supabase auth API derives the user identity from the bearer JWT;
     we authenticate using the service-role key as the ``apikey`` header.
  3. Look up ``students`` by ``auth_user_id`` filtered to ``is_active=true``.
  4. Return :class:`StudentAuthResult` with the student id + grade +
     preferred_language so the route can pass language context to Whisper
     and the handler can include grade in ops_events telemetry.

Any failure → :class:`AuthFailed`. The route maps to 401/403/503. We do
NOT log the token, email, name, or phone — P13 demands this is forensic
quiet; only the auth_user_id (UUID, not PII per the existing convention
elsewhere in the codebase) and the failure mode are emitted.
"""

from __future__ import annotations

import httpx
import structlog
from pydantic import BaseModel, ConfigDict, Field

from ...config import get_settings
from ...db.supabase import get_service_client

logger = structlog.get_logger(__name__)


class AuthFailed(Exception):
    """Raised on any auth failure. Carries an HTTP status hint for the route."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


class StudentAuthResult(BaseModel):
    """Successful student authentication result.

    Used by :func:`transcribe_audio` to:
      - Pass ``preferred_language`` as a language hint to Whisper when the
        caller didn't supply one (improves accuracy on short clips).
      - Tag ``ops_events`` rows with ``student_id`` + ``grade`` for the
        super-admin voice dashboard (no name/email — P13).
    """

    model_config = ConfigDict(extra="forbid")

    ok: bool = Field(..., description="True when the caller is an active student.")
    student_id: str | None = Field(
        default=None, description="``students.id`` UUID. Not PII per existing convention."
    )
    auth_user_id: str | None = Field(
        default=None, description="``auth.users.id`` UUID. Returned for log correlation."
    )
    grade: str | None = Field(
        default=None,
        description="P5: string '6'..'12' or other free-text grade. Used in ops_events.",
    )
    preferred_language: str | None = Field(
        default=None,
        description="'en' | 'hi' | 'hinglish'. Used as the Whisper language hint.",
    )
    error: str | None = Field(
        default=None, description="When ok=False, the failure reason (route maps to HTTP)."
    )


async def verify_student(authorization_header: str | None) -> StudentAuthResult:
    """Verify the request comes from an active student.

    Returns:
        :class:`StudentAuthResult` with ``ok=True`` on success, otherwise
        raises :class:`AuthFailed` so the route can return the right
        4xx/5xx — mirrors the bulk-question-gen pattern.

    Raises:
        :class:`AuthFailed` with ``status=401`` on missing/invalid token,
        ``status=403`` when the user is not an active student,
        ``status=503`` when Supabase is unreachable / misconfigured.
    """
    # 1. Header shape — match the admin path verbatim.
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise AuthFailed("Missing or invalid Authorization header", status=401)
    token = authorization_header[len("Bearer ") :].strip()
    if not token:
        raise AuthFailed("Missing or invalid Authorization header", status=401)

    # 2. Supabase config check — fail-CLOSED if not configured (503).
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise AuthFailed("Supabase not configured", status=503)

    # 3. Verify the JWT against Supabase Auth.
    user_id = await _resolve_user_id(token)
    if user_id is None:
        raise AuthFailed("Invalid or expired token", status=401)

    # 4. Look up the students row.
    row = await _lookup_student(user_id)
    if row is None:
        # Either no row OR is_active=false. Same 403 either way so we
        # don't reveal "is this an admin trying to use a student endpoint"
        # vs "deactivated student" — P13-adjacent enumeration prevention.
        raise AuthFailed("Student account not found or inactive", status=403)

    return StudentAuthResult(
        ok=True,
        student_id=str(row["id"]),
        auth_user_id=user_id,
        grade=row.get("grade"),
        preferred_language=row.get("preferred_language"),
    )


# ── Helpers ─────────────────────────────────────────────────────────────────


async def _resolve_user_id(token: str) -> str | None:
    """Call ``GET /auth/v1/user`` with the caller's bearer token.

    Identical posture to ``bulk_question_gen.auth._resolve_user_id`` —
    intentionally duplicated rather than shared so the admin and student
    paths can diverge later (different audit log routing, different
    cache lifetime, different rate limiting) without one path's change
    silently affecting the other.
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
        # Network failure — fail-CLOSED at the auth layer (caller raises 401).
        # We log only the error class, never the token.
        logger.warning("voice.auth.network_error", error=str(err))
        return None
    if res.status_code != 200:
        # 401/403/etc — token is invalid; log status only.
        logger.info("voice.auth.token_rejected", status=res.status_code)
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


async def _lookup_student(user_id: str) -> dict | None:
    """Query ``students`` for ``auth_user_id=user_id AND is_active=true``.

    Selects only the columns we need: ``id``, ``grade``, ``preferred_language``.
    We deliberately do NOT pull name/email/phone — they're never used in the
    voice flow and pulling them risks accidentally logging PII downstream.

    Returns the row dict or None.
    """
    client = get_service_client()
    if client is None:
        logger.warning("voice.auth.no_supabase_client")
        return None
    try:
        result = (
            await client.table("students")
            .select("id,grade,preferred_language")
            .eq("auth_user_id", user_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception as err:  # noqa: BLE001 — surface as auth failure
        # Same posture as bulk_question_gen.auth — broad except is acceptable
        # at the auth boundary because we map anything to a generic 4xx/5xx.
        logger.warning("voice.auth.lookup_failed", error=str(err))
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
