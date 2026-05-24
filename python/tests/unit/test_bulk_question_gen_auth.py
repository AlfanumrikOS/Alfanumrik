"""Tests for the admin JWT verification flow.

We mock the network calls (Supabase Auth + admin_users PostgREST) so the
test never hits the real backend.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from services.ai.business.bulk_question_gen.auth import AuthFailed, verify_admin


@pytest.fixture()
def _supabase_url(monkeypatch: pytest.MonkeyPatch):
    """Set a fake Supabase URL + service key so the auth call attempts to fire."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key-stub")
    from services.ai.config import get_settings

    get_settings.cache_clear()
    return "https://test.supabase.co"


class _FakeAdminClient:
    """Mimics postgrest's chain for admin_users lookup."""

    def __init__(self, rows: list[dict[str, Any]] | None) -> None:
        self._rows = rows
        self._pending_filters: dict[str, Any] = {}

    def table(self, _name: str) -> _FakeAdminClient:
        return self

    def select(self, _columns: str) -> _FakeAdminClient:
        return self

    def eq(self, k: str, v: Any) -> _FakeAdminClient:
        self._pending_filters[k] = v
        return self

    def limit(self, _n: int) -> _FakeAdminClient:
        return self

    async def execute(self) -> dict[str, Any]:
        return {"data": self._rows or [], "status_code": 200}


def _install_admin_client(monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]] | None):
    fake = _FakeAdminClient(rows)
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.auth.get_service_client",
        lambda: fake,
    )
    return fake


# ── Header shape rejections ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_missing_header():
    with pytest.raises(AuthFailed) as exc:
        await verify_admin(None)
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_rejects_non_bearer_header():
    with pytest.raises(AuthFailed) as exc:
        await verify_admin("Basic abc")
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_rejects_empty_bearer():
    with pytest.raises(AuthFailed) as exc:
        await verify_admin("Bearer ")
    assert exc.value.status == 401


# ── Supabase Auth response handling ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_invalid_token(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(401, json={"error": "invalid_token"})
    )
    _install_admin_client(monkeypatch, rows=[])
    with pytest.raises(AuthFailed) as exc:
        await verify_admin("Bearer invalid-jwt-here")
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_rejects_network_failure(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        side_effect=httpx.ConnectError("network down")
    )
    _install_admin_client(monkeypatch, rows=[])
    with pytest.raises(AuthFailed) as exc:
        await verify_admin("Bearer some-jwt")
    assert exc.value.status == 401


# ── admin_users lookup ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_when_user_not_in_admin_users(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid-here"})
    )
    _install_admin_client(monkeypatch, rows=[])  # no admin row
    with pytest.raises(AuthFailed) as exc:
        await verify_admin("Bearer some-jwt")
    assert exc.value.status == 403


@pytest.mark.asyncio
async def test_rejects_when_admin_level_wrong(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid"})
    )
    _install_admin_client(monkeypatch, rows=[{"admin_level": "moderator"}])
    with pytest.raises(AuthFailed) as exc:
        await verify_admin("Bearer some-jwt")
    assert exc.value.status == 403


@pytest.mark.asyncio
async def test_accepts_admin(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid"})
    )
    _install_admin_client(monkeypatch, rows=[{"admin_level": "admin"}])
    result = await verify_admin("Bearer some-jwt")
    assert result == {"auth_user_id": "user-uuid", "admin_level": "admin"}


@pytest.mark.asyncio
async def test_accepts_super_admin(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid"})
    )
    _install_admin_client(monkeypatch, rows=[{"admin_level": "super_admin"}])
    result = await verify_admin("Bearer some-jwt")
    assert result["admin_level"] == "super_admin"


@pytest.mark.asyncio
async def test_fails_closed_when_no_supabase_configured():
    """No SUPABASE_URL → 503 (service misconfigured)."""
    # _env_isolation in conftest already wipes SUPABASE_URL.
    with pytest.raises(AuthFailed) as exc:
        await verify_admin("Bearer some-jwt")
    assert exc.value.status == 503
