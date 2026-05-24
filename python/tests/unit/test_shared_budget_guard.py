"""Tests for ``services.ai.shared.budget_guard``.

Coverage targets:
- Under-cap: sum < cap → returns True
- Over-cap: sum >= cap → returns False
- Supabase unavailable: fail-open returns True with a log
- Invalid cap (≤ 0): fail-open returns True with a log
- Env var override: DAILY_AI_BUDGET_INR_CAP is respected
- Tenant-scope without tenant_id: fail-open returns True
- Query error: fail-open returns True (degrade gracefully)
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from postgrest.exceptions import APIError as PostgrestAPIError

from services.ai.shared import budget_guard
from services.ai.shared.budget_guard import (
    DEFAULT_DAILY_CAP_INR,
    check_daily_budget,
)


class _FakeResultRows:
    """Stand-in for postgrest result with .data list."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.data = rows


class _FakeQuery:
    """Mirrors the slice of postgrest we use in budget_guard."""

    def __init__(self, rows: list[dict[str, Any]] | Exception) -> None:
        self._rows = rows

    def select(self, _: str) -> _FakeQuery:
        return self

    def gte(self, _col: str, _val: str) -> _FakeQuery:
        return self

    def lt(self, _col: str, _val: str) -> _FakeQuery:
        return self

    def eq(self, _col: str, _val: str) -> _FakeQuery:
        return self

    async def execute(self) -> _FakeResultRows:
        if isinstance(self._rows, Exception):
            raise self._rows
        return _FakeResultRows(self._rows)


class _FakeClient:
    def __init__(self, rows: list[dict[str, Any]] | Exception) -> None:
        self._rows = rows

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self._rows)


def _patch_client(monkeypatch: pytest.MonkeyPatch, client: Any) -> None:
    monkeypatch.setattr("services.ai.shared.budget_guard.get_service_client", lambda: client)


# ── Under cap → True ──────────────────────────────────────────────────────────


async def test_under_cap_returns_true(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [{"inr_cost": 100.0}, {"inr_cost": 50.0}]  # total 150
    _patch_client(monkeypatch, _FakeClient(rows))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is True


# ── At/over cap → False ───────────────────────────────────────────────────────


async def test_at_cap_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cap is exclusive: total == cap counts as over."""
    rows = [{"inr_cost": 500.0}, {"inr_cost": 500.0}]  # total 1000
    _patch_client(monkeypatch, _FakeClient(rows))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is False


async def test_over_cap_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [{"inr_cost": 600.0}, {"inr_cost": 500.0}]  # total 1100
    _patch_client(monkeypatch, _FakeClient(rows))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is False


# ── Empty result → under cap → True ───────────────────────────────────────────


async def test_empty_rows_under_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_client(monkeypatch, _FakeClient([]))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is True


async def test_null_inr_cost_treated_as_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [{"inr_cost": None}, {"inr_cost": 200.0}, {"inr_cost": None}]
    _patch_client(monkeypatch, _FakeClient(rows))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is True


# ── Fail-open paths ───────────────────────────────────────────────────────────


async def test_no_supabase_client_fails_open(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_client(monkeypatch, None)
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is True


async def test_query_exception_fails_open_postgrest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PostgREST API errors are explicit fail-open by contract."""
    err = PostgrestAPIError({"message": "supabase down", "code": "500"})
    _patch_client(monkeypatch, _FakeClient(err))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is True


async def test_query_exception_fails_open_httpx(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Network-layer errors (httpx.RequestError) are explicit fail-open."""
    err = httpx.ConnectError("connection refused")
    _patch_client(monkeypatch, _FakeClient(err))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    assert out is True


async def test_await_on_non_awaitable_fails_open_loudly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If ``await query.execute()`` ever raises TypeError (sync client returned
    by accident), budget_guard logs the bug distinctly and still fails open so
    the cap does not break user traffic."""
    err = TypeError("object dict can't be used in 'await' expression")
    _patch_client(monkeypatch, _FakeClient(err))
    out = await check_daily_budget(scope="org", cap_inr=1000.0)
    # Fail-open preserved (user contract), but the log call is distinct.
    assert out is True


async def test_unexpected_exception_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RuntimeError (or any non-listed exception) is NOT silently swallowed.

    The previous bare ``except Exception`` masked bugs; the fix restricts
    fail-open to PostgrestAPIError + httpx.RequestError + TypeError so
    other failures surface immediately during development.
    """
    _patch_client(monkeypatch, _FakeClient(RuntimeError("unexpected")))
    with pytest.raises(RuntimeError, match="unexpected"):
        await check_daily_budget(scope="org", cap_inr=1000.0)


async def test_invalid_cap_fails_open(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_client(monkeypatch, _FakeClient([{"inr_cost": 100.0}]))
    out = await check_daily_budget(scope="org", cap_inr=0.0)
    assert out is True

    out2 = await check_daily_budget(scope="org", cap_inr=-1.0)
    assert out2 is True


async def test_tenant_scope_without_id_fails_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_client(monkeypatch, _FakeClient([{"inr_cost": 100.0}]))
    out = await check_daily_budget(scope="tenant", cap_inr=1000.0)
    assert out is True


# ── Env var override ──────────────────────────────────────────────────────────


async def test_env_cap_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DAILY_AI_BUDGET_INR_CAP", "150")
    _patch_client(monkeypatch, _FakeClient([{"inr_cost": 200.0}]))
    # Env says cap=150; rows total 200 > 150 → False
    out = await check_daily_budget(scope="org")
    assert out is False


async def test_invalid_env_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DAILY_AI_BUDGET_INR_CAP", "not-a-number")
    _patch_client(monkeypatch, _FakeClient([{"inr_cost": 100.0}]))
    out = await check_daily_budget(scope="org")
    # Default cap is much higher than 100, so under-cap → True
    assert out is True


async def test_default_cap_constant() -> None:
    """Sanity: the documented default is 5000."""
    assert DEFAULT_DAILY_CAP_INR == 5000.0


# ── Today-window math ────────────────────────────────────────────────────────-


async def test_today_iso_format(monkeypatch: pytest.MonkeyPatch) -> None:
    """The window helper produces an ISO date string (YYYY-MM-DD)."""
    iso = budget_guard._today_utc_iso()
    assert len(iso) == 10
    assert iso[4] == "-" and iso[7] == "-"


# ── Tenant_id passed when scope='tenant' does NOT raise ──────────────────────


async def test_tenant_scope_with_id_runs_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """scope='tenant' with an id should query (Phase 2 floor returns all rows)."""
    rows = [{"inr_cost": 100.0}]
    _patch_client(monkeypatch, _FakeClient(rows))
    out = await check_daily_budget(scope="tenant", cap_inr=1000.0, tenant_id="t-1")
    assert out is True
