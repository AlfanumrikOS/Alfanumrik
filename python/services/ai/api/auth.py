"""Shared, fail-closed Supabase authentication dependencies.

Asymmetric Supabase access tokens are verified locally against the project's
JWKS with explicit algorithm, issuer, audience, expiry, role, and subject
checks. Legacy HS256 access tokens cannot be verified from public JWKS; those
are sent to the project-specific Supabase Auth ``/auth/v1/user`` endpoint,
which performs signature and expiry verification without exposing the JWT
signing secret to this service.

Only the signed ``sub`` and ``role`` claims are used. User-editable
``user_metadata`` is deliberately never used for authorization.
"""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx
import jwt
import structlog
from fastapi import Depends, Header, HTTPException, status
from jwt import InvalidTokenError

from ..config import get_settings
from ..db.supabase import get_service_client

logger = structlog.get_logger(__name__)

_ASYMMETRIC_ALGORITHMS = frozenset({"ES256", "RS256"})
_LEGACY_ALGORITHM = "HS256"
_JWKS_CACHE_TTL_SECONDS = 10 * 60
_AUTH_HTTP_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True, slots=True)
class VerifiedSupabaseUser:
    """Minimal verified identity safe to pass into authorization checks."""

    auth_user_id: str
    role: str
    session_id: str | None = None


class AuthFailure(Exception):
    """Internal authentication failure with an intentionally safe HTTP status."""

    def __init__(self, *, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True, slots=True)
class _JwksCacheEntry:
    keys_by_id: dict[str, dict[str, Any]]
    expires_at: float


_jwks_cache: dict[str, _JwksCacheEntry] = {}


def _reset_auth_cache() -> None:
    """Clear the in-process JWKS cache (test and key-rotation support)."""
    _jwks_cache.clear()


def _unauthenticated() -> AuthFailure:
    return AuthFailure(
        status_code=status.HTTP_401_UNAUTHORIZED,
        code="INVALID_OR_EXPIRED_TOKEN",
    )


def _unavailable() -> AuthFailure:
    return AuthFailure(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="AUTH_SERVICE_UNAVAILABLE",
    )


def _extract_bearer_token(authorization_header: str | None) -> str:
    if not authorization_header:
        raise AuthFailure(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHENTICATION_REQUIRED",
        )
    scheme, separator, token = authorization_header.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise AuthFailure(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHENTICATION_REQUIRED",
        )
    return token.strip()


def _validated_principal(claims: dict[str, Any]) -> VerifiedSupabaseUser:
    subject = claims.get("sub")
    role = claims.get("role")
    if not isinstance(subject, str) or not subject:
        raise _unauthenticated()
    try:
        UUID(subject)
    except ValueError as err:
        raise _unauthenticated() from err
    # User access only. In particular, do not accept anon or service-role JWTs
    # as an end-user identity even if their signature is otherwise valid.
    if role != "authenticated":
        raise _unauthenticated()
    session_id = claims.get("session_id")
    return VerifiedSupabaseUser(
        auth_user_id=subject,
        role=role,
        session_id=session_id if isinstance(session_id, str) else None,
    )


def _expected_audience_present(claims: dict[str, Any], expected: str) -> bool:
    audience = claims.get("aud")
    if isinstance(audience, str):
        return audience == expected
    if isinstance(audience, list):
        return expected in audience and all(isinstance(item, str) for item in audience)
    return False


def _normalized_grade(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = " ".join(value.strip().lower().replace("-", " ").split())
    for prefix in ("grade ", "class ", "standard ", "std "):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :].strip()
            break
    if normalized.isdigit():
        return str(int(normalized))
    return normalized or None


def enforce_student_grade_scope(
    requested_grade: str,
    student: dict[str, Any],
) -> str:
    """Require request grade to match the server-owned active profile grade."""
    authoritative_grade = student.get("grade")
    requested = _normalized_grade(requested_grade)
    authoritative = _normalized_grade(authoritative_grade)
    if authoritative is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "AUTHORIZATION_SERVICE_UNAVAILABLE"},
        )
    if requested != authoritative:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "STUDENT_GRADE_MISMATCH"},
        )
    return authoritative


async def _fetch_jwks(*, force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    settings = get_settings()
    if not settings.supabase_url:
        raise _unavailable()
    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    cached = _jwks_cache.get(jwks_url)
    if not force_refresh and cached and cached.expires_at > time.monotonic():
        return cached.keys_by_id

    try:
        async with httpx.AsyncClient(timeout=_AUTH_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(jwks_url)
    except httpx.HTTPError as err:
        logger.warning("auth.jwks_fetch_failed", error_type=type(err).__name__)
        raise _unavailable() from err
    if response.status_code != status.HTTP_200_OK:
        logger.warning("auth.jwks_rejected", status=response.status_code)
        raise _unavailable()
    try:
        body = response.json()
    except ValueError as err:
        raise _unavailable() from err
    raw_keys = body.get("keys") if isinstance(body, dict) else None
    if not isinstance(raw_keys, list):
        raise _unavailable()

    keys_by_id: dict[str, dict[str, Any]] = {}
    for raw_key in raw_keys:
        if not isinstance(raw_key, dict):
            continue
        key_id = raw_key.get("kid")
        if isinstance(key_id, str) and key_id:
            keys_by_id[key_id] = raw_key
    if not keys_by_id:
        # A project still using only a legacy symmetric key legitimately has
        # no public verification keys. HS256 follows the Auth endpoint path.
        raise _unavailable()
    _jwks_cache[jwks_url] = _JwksCacheEntry(
        keys_by_id=keys_by_id,
        expires_at=time.monotonic() + _JWKS_CACHE_TTL_SECONDS,
    )
    return keys_by_id


async def _verify_asymmetric_token(
    token: str,
    *,
    algorithm: str,
    key_id: str,
) -> VerifiedSupabaseUser:
    keys = await _fetch_jwks()
    raw_key = keys.get(key_id)
    if raw_key is None:
        # Key rotation can make a still-live process's cache stale. Refresh
        # exactly once before rejecting the token.
        keys = await _fetch_jwks(force_refresh=True)
        raw_key = keys.get(key_id)
    if raw_key is None:
        raise _unauthenticated()
    if raw_key.get("alg") not in (None, algorithm):
        raise _unauthenticated()

    try:
        verification_key = jwt.PyJWK.from_dict(raw_key, algorithm=algorithm).key
    except (InvalidTokenError, ValueError, TypeError) as err:
        logger.warning("auth.jwks_key_invalid", key_id=key_id)
        raise _unavailable() from err

    settings = get_settings()
    try:
        claims = jwt.decode(
            token,
            key=verification_key,
            algorithms=[algorithm],
            audience=settings.supabase_jwt_audience,
            issuer=settings.supabase_jwt_issuer(),
            leeway=10,
            options={"require": ["sub", "role", "iss", "aud", "iat", "exp"]},
        )
    except InvalidTokenError as err:
        raise _unauthenticated() from err
    if not isinstance(claims, dict):
        raise _unauthenticated()
    return _validated_principal(claims)


def _read_payload_after_remote_verification(token: str) -> dict[str, Any]:
    """Read claims only after Supabase Auth verified a legacy token.

    This is not a signature-verification step. It exists solely to apply the
    same issuer/audience/role checks as the JWKS path after the project Auth
    endpoint has already verified the HS256 signature and expiry.
    """

    parts = token.split(".")
    if len(parts) != 3:
        raise _unauthenticated()
    payload_segment = parts[1]
    payload_segment += "=" * (-len(payload_segment) % 4)
    try:
        raw_payload = base64.urlsafe_b64decode(payload_segment.encode("ascii"))
        claims = json.loads(raw_payload)
    except (ValueError, UnicodeError) as err:
        raise _unauthenticated() from err
    if not isinstance(claims, dict):
        raise _unauthenticated()
    return claims


async def _verify_legacy_token(token: str) -> VerifiedSupabaseUser:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise _unavailable()
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {token}",
    }
    try:
        async with httpx.AsyncClient(timeout=_AUTH_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as err:
        logger.warning("auth.legacy_verify_failed", error_type=type(err).__name__)
        raise _unavailable() from err
    if response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    ):
        raise _unauthenticated()
    if response.status_code != status.HTTP_200_OK:
        logger.warning("auth.legacy_verify_rejected", status=response.status_code)
        raise _unavailable()
    try:
        user = response.json()
    except ValueError as err:
        raise _unavailable() from err
    user_id = user.get("id") if isinstance(user, dict) else None
    if not isinstance(user_id, str) or not user_id:
        raise _unavailable()

    claims = _read_payload_after_remote_verification(token)
    if claims.get("sub") != user_id:
        raise _unauthenticated()
    if claims.get("iss") != settings.supabase_jwt_issuer():
        raise _unauthenticated()
    if not _expected_audience_present(claims, settings.supabase_jwt_audience):
        raise _unauthenticated()
    return _validated_principal(claims)


async def verify_supabase_access_token(token: str) -> VerifiedSupabaseUser:
    """Verify one Supabase user access token and return its minimal identity."""
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as err:
        raise _unauthenticated() from err
    algorithm = header.get("alg") if isinstance(header, dict) else None
    if algorithm in _ASYMMETRIC_ALGORITHMS:
        key_id = header.get("kid")
        if not isinstance(key_id, str) or not key_id:
            raise _unauthenticated()
        return await _verify_asymmetric_token(token, algorithm=algorithm, key_id=key_id)
    if algorithm == _LEGACY_ALGORITHM:
        return await _verify_legacy_token(token)
    # Explicitly rejects alg=none and all algorithms not issued by Supabase.
    raise _unauthenticated()


async def require_verified_user(
    authorization: str | None = Header(default=None),
) -> VerifiedSupabaseUser:
    """FastAPI dependency for any authenticated Supabase end user."""
    try:
        token = _extract_bearer_token(authorization)
        return await verify_supabase_access_token(token)
    except AuthFailure as err:
        raise HTTPException(
            status_code=err.status_code,
            detail={"error": err.code},
            headers={"WWW-Authenticate": "Bearer"} if err.status_code == 401 else None,
        ) from err


async def require_active_student(
    user: VerifiedSupabaseUser = Depends(require_verified_user),
) -> dict[str, Any]:
    """Resolve the verified auth user to exactly one active student profile."""
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "AUTHORIZATION_SERVICE_UNAVAILABLE"},
        )
    try:
        result = (
            await client.table("students")
            .select("id,grade,preferred_subject")
            .eq("auth_user_id", user.auth_user_id)
            .eq("is_active", True)
            .is_("deleted_at", "null")
            .limit(2)
            .execute()
        )
    except Exception as err:  # noqa: BLE001 - fail closed on authorization I/O
        logger.warning("auth.student_lookup_failed", error_type=type(err).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "AUTHORIZATION_SERVICE_UNAVAILABLE"},
        ) from err
    rows = getattr(result, "data", None)
    if rows is None and isinstance(result, dict):
        rows = result.get("data")
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        if isinstance(rows, list) and len(rows) > 1:
            logger.error("auth.multiple_active_student_profiles")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "ACTIVE_STUDENT_REQUIRED"},
        )
    student = rows[0]
    student_id = student.get("id")
    if not isinstance(student_id, str) or not student_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "AUTHORIZATION_SERVICE_UNAVAILABLE"},
        )
    return {
        "id": student_id,
        "grade": student.get("grade"),
        "preferred_subject": student.get("preferred_subject"),
    }
