"""Runtime tests for the shared Supabase authentication boundary."""

from __future__ import annotations

import json
import time
from types import SimpleNamespace
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from services.ai.api import auth
from services.ai.config import get_settings

SUPABASE_URL = "https://phase0-auth-test.supabase.co"
USER_ID = "11111111-1111-4111-8111-111111111111"
SESSION_ID = "22222222-2222-4222-8222-222222222222"
KEY_ID = "phase0-rs256-key"


@pytest.fixture(scope="module")
def signing_material() -> tuple[Any, dict[str, Any]]:
    """Create one local RSA key pair and its public JWK."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk.update({"kid": KEY_ID, "alg": "RS256", "use": "sig"})
    return private_key, public_jwk


def _configure_supabase(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key")
    monkeypatch.setenv("SUPABASE_JWT_AUDIENCE", "authenticated")
    get_settings.cache_clear()
    auth._reset_auth_cache()


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": USER_ID,
        "role": "authenticated",
        "iss": f"{SUPABASE_URL}/auth/v1",
        "aud": "authenticated",
        "iat": now - 10,
        "exp": now + 300,
        "session_id": SESSION_ID,
    }
    claims.update(overrides)
    return claims


def _asymmetric_token(private_key: Any, **overrides: Any) -> str:
    return jwt.encode(
        _claims(**overrides),
        private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )


@pytest.mark.asyncio
async def test_valid_rs256_token_is_verified_against_project_jwks(
    monkeypatch: pytest.MonkeyPatch,
    respx_mock,
    signing_material: tuple[Any, dict[str, Any]],
) -> None:
    _configure_supabase(monkeypatch)
    private_key, public_jwk = signing_material
    jwks_route = respx_mock.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": [public_jwk]})
    )

    principal = await auth.verify_supabase_access_token(_asymmetric_token(private_key))

    assert principal.auth_user_id == USER_ID
    assert principal.role == "authenticated"
    assert principal.session_id == SESSION_ID
    assert jwks_route.call_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "claim_overrides",
    [
        {"iss": "https://attacker.invalid/auth/v1"},
        {"aud": "another-audience"},
        {"iat": int(time.time()) - 600, "exp": int(time.time()) - 300},
        {"role": "service_role"},
    ],
    ids=["wrong-issuer", "wrong-audience", "expired", "service-role"],
)
async def test_invalid_rs256_claims_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
    respx_mock,
    signing_material: tuple[Any, dict[str, Any]],
    claim_overrides: dict[str, Any],
) -> None:
    _configure_supabase(monkeypatch)
    private_key, public_jwk = signing_material
    respx_mock.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": [public_jwk]})
    )

    with pytest.raises(auth.AuthFailure) as failure:
        await auth.verify_supabase_access_token(_asymmetric_token(private_key, **claim_overrides))

    assert failure.value.status_code == 401


@pytest.mark.asyncio
async def test_unsigned_token_is_rejected_before_network(
    monkeypatch: pytest.MonkeyPatch,
    respx_mock,
) -> None:
    _configure_supabase(monkeypatch)
    token = jwt.encode(_claims(), key="", algorithm="none")

    with pytest.raises(auth.AuthFailure) as failure:
        await auth.verify_supabase_access_token(token)

    assert failure.value.status_code == 401
    assert not respx_mock.calls


@pytest.mark.asyncio
async def test_legacy_hs256_token_uses_supabase_auth_verification(
    monkeypatch: pytest.MonkeyPatch,
    respx_mock,
) -> None:
    _configure_supabase(monkeypatch)
    token = jwt.encode(
        _claims(),
        "legacy-test-signing-secret-at-least-32-bytes",
        algorithm="HS256",
    )
    verify_route = respx_mock.get(f"{SUPABASE_URL}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": USER_ID})
    )

    principal = await auth.verify_supabase_access_token(token)

    assert principal.auth_user_id == USER_ID
    assert verify_route.call_count == 1
    request = verify_route.calls[0].request
    assert request.headers["authorization"] == f"Bearer {token}"
    assert request.headers["apikey"] == "server-only-test-key"


@pytest.mark.asyncio
async def test_legacy_hs256_token_rejected_by_supabase_is_unauthorized(
    monkeypatch: pytest.MonkeyPatch,
    respx_mock,
) -> None:
    _configure_supabase(monkeypatch)
    token = jwt.encode(
        _claims(),
        "wrong-legacy-signing-secret-at-least-32-bytes",
        algorithm="HS256",
    )
    respx_mock.get(f"{SUPABASE_URL}/auth/v1/user").mock(
        return_value=httpx.Response(401, json={"message": "invalid JWT"})
    )

    with pytest.raises(auth.AuthFailure) as failure:
        await auth.verify_supabase_access_token(token)

    assert failure.value.status_code == 401


@pytest.mark.asyncio
async def test_jwks_network_failure_is_service_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    respx_mock,
    signing_material: tuple[Any, dict[str, Any]],
) -> None:
    _configure_supabase(monkeypatch)
    private_key, _ = signing_material
    respx_mock.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json").mock(
        side_effect=httpx.ConnectError("offline")
    )

    with pytest.raises(auth.AuthFailure) as failure:
        await auth.verify_supabase_access_token(_asymmetric_token(private_key))

    assert failure.value.status_code == 503


class _StudentQuery:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.filters: list[tuple[str, str, Any]] = []

    def select(self, columns: str) -> _StudentQuery:
        self.filters.append(("select", columns, None))
        return self

    def eq(self, column: str, value: Any) -> _StudentQuery:
        self.filters.append(("eq", column, value))
        return self

    def is_(self, column: str, value: Any) -> _StudentQuery:
        self.filters.append(("is", column, value))
        return self

    def limit(self, value: int) -> _StudentQuery:
        self.filters.append(("limit", "", value))
        return self

    async def execute(self) -> SimpleNamespace:
        return SimpleNamespace(data=self.rows)


class _StudentClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.query = _StudentQuery(rows)

    def table(self, name: str) -> _StudentQuery:
        assert name == "students"
        return self.query


@pytest.mark.asyncio
async def test_active_student_is_resolved_from_verified_auth_subject(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _StudentClient([{"id": "student-1", "grade": "8", "preferred_subject": "science"}])
    monkeypatch.setattr(auth, "get_service_client", lambda: client)
    user = auth.VerifiedSupabaseUser(auth_user_id=USER_ID, role="authenticated")

    student = await auth.require_active_student(user)

    assert student == {
        "id": "student-1",
        "grade": "8",
        "preferred_subject": "science",
    }
    assert ("eq", "auth_user_id", USER_ID) in client.query.filters
    assert ("eq", "is_active", True) in client.query.filters
    assert ("is", "deleted_at", "null") in client.query.filters
    assert ("limit", "", 2) in client.query.filters


@pytest.mark.asyncio
async def test_missing_active_student_profile_is_forbidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth, "get_service_client", lambda: _StudentClient([]))
    user = auth.VerifiedSupabaseUser(auth_user_id=USER_ID, role="authenticated")

    with pytest.raises(HTTPException) as failure:
        await auth.require_active_student(user)

    assert failure.value.status_code == 403
    assert failure.value.detail == {"error": "ACTIVE_STUDENT_REQUIRED"}


def test_grade_scope_normalizes_common_profile_labels() -> None:
    student = {"id": "student-1", "grade": "Grade 08"}

    authoritative = auth.enforce_student_grade_scope("Class 8", student)

    assert authoritative == "8"
