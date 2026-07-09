"""Tests for the voice student JWT verification flow.

Mirrors :file:`tests/unit/test_bulk_question_gen_auth.py` but against the
``students`` table instead of ``admin_users``. Network calls are mocked
via respx + a fake postgrest client.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from services.ai.business.voice.auth import (
    AuthFailed,
    StudentAuthResult,
    verify_student,
)


@pytest.fixture()
def _supabase_url(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key-stub")
    from services.ai.config import get_settings

    get_settings.cache_clear()
    return "https://test.supabase.co"


class _FakeStudentsClient:
    """Mimics postgrest's chain for the students-table lookup."""

    def __init__(self, rows: list[dict[str, Any]] | None) -> None:
        self._rows = rows
        self._pending_filters: dict[str, Any] = {}

    def table(self, _name: str) -> _FakeStudentsClient:
        return self

    def select(self, _columns: str) -> _FakeStudentsClient:
        return self

    def eq(self, k: str, v: Any) -> _FakeStudentsClient:
        self._pending_filters[k] = v
        return self

    def limit(self, _n: int) -> _FakeStudentsClient:
        return self

    async def execute(self) -> dict[str, Any]:
        return {"data": self._rows or [], "status_code": 200}


def _install_students_client(monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]] | None):
    fake = _FakeStudentsClient(rows)
    monkeypatch.setattr(
        "services.ai.business.voice.auth.get_service_client",
        lambda: fake,
    )
    return fake


# ── Header shape rejections ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_missing_header():
    with pytest.raises(AuthFailed) as exc:
        await verify_student(None)
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_rejects_non_bearer_header():
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Basic abc")
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_rejects_empty_bearer():
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer    ")
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_fails_closed_when_no_supabase_configured():
    """No SUPABASE_URL → 503 (service misconfigured)."""
    # _env_isolation in conftest wipes SUPABASE_URL.
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 503


@pytest.mark.asyncio
async def test_fails_closed_when_supabase_service_role_is_missing(
    monkeypatch: pytest.MonkeyPatch,
):
    """Missing service-role key must surface as 503, not a token rejection."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    from services.ai.config import get_settings

    get_settings.cache_clear()

    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 503


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
    _install_students_client(monkeypatch, rows=[])
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer invalid-jwt")
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
    _install_students_client(monkeypatch, rows=[])
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_rejects_non_json_response(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, text="not json")
    )
    _install_students_client(monkeypatch, rows=[])
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_rejects_response_missing_id(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"email": "x@y"})
    )
    _install_students_client(monkeypatch, rows=[])
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 401


# ── students lookup ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_when_user_not_in_students_table(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid"})
    )
    _install_students_client(monkeypatch, rows=[])  # no student row
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 403


@pytest.mark.asyncio
async def test_accepts_active_student(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid-1"})
    )
    fake = _install_students_client(
        monkeypatch,
        rows=[
            {
                "id": "student-uuid-1",
                "grade": "8",
                "preferred_language": "hi",
            }
        ],
    )
    result = await verify_student("Bearer some-jwt")
    assert isinstance(result, StudentAuthResult)
    assert result.ok is True
    assert result.student_id == "student-uuid-1"
    assert result.auth_user_id == "user-uuid-1"
    assert result.grade == "8"
    assert result.preferred_language == "hi"
    # Auth filter applied is_active=true.
    assert fake._pending_filters.get("is_active") is True


@pytest.mark.asyncio
async def test_accepts_when_preferred_language_missing(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    """A student with no preferred_language field still authenticates."""
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid"})
    )
    _install_students_client(
        monkeypatch,
        rows=[{"id": "student-uuid", "grade": "10"}],
    )
    result = await verify_student("Bearer some-jwt")
    assert result.preferred_language is None
    assert result.grade == "10"


@pytest.mark.asyncio
async def test_rejects_when_no_supabase_client(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    """get_service_client() returns None → 403 (treat as student-not-found)."""
    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid"})
    )
    monkeypatch.setattr(
        "services.ai.business.voice.auth.get_service_client",
        lambda: None,
    )
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 403


@pytest.mark.asyncio
async def test_rejects_when_students_query_errors(
    respx_mock: respx.MockRouter,
    _supabase_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    """A Supabase query error is masked → 403 (still student-not-found)."""

    class _ErrorClient:
        def table(self, _n):
            return self

        def select(self, _c):
            return self

        def eq(self, _k, _v):
            return self

        def limit(self, _n):
            return self

        async def execute(self):
            raise RuntimeError("postgrest is sad")

    respx_mock.get(f"{_supabase_url}/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": "user-uuid"})
    )
    monkeypatch.setattr(
        "services.ai.business.voice.auth.get_service_client",
        lambda: _ErrorClient(),
    )
    with pytest.raises(AuthFailed) as exc:
        await verify_student("Bearer some-jwt")
    assert exc.value.status == 403
