"""Shared pytest fixtures.

- ``settings``: a fresh :class:`services.ai.config.Settings` instance per test
  with provider keys set so :meth:`is_configured` returns True.
- ``mock_supabase_client``: a fake telemetry sink that captures every insert
  payload so tests can assert on the row shape without touching the network.
- ``mock_anthropic`` / ``mock_openai``: respx fixtures pre-loaded with
  realistic 200 responses; per-test overrides land in the test body.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi import Request

# ─── Environment + settings ──────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _env_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wipe + re-seed env vars so every test starts from a known state.

    Provider keys are populated by default; tests that exercise the
    "missing key" branch should explicitly delenv() them.
    """
    for k in list(os.environ.keys()):
        if k.startswith(
            (
                "ENVIRONMENT",
                "SUPABASE_",
                "ANTHROPIC_",
                "OPENAI_",
                "SENTRY_",
                "LOG_LEVEL",
                "ALLOWED_ORIGINS",
                "PORT",
                "USD_TO_INR",
                "UPSTASH_",
            )
        ):
            monkeypatch.delenv(k, raising=False)

    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-key")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-openai-key")
    monkeypatch.setenv("USD_TO_INR", "83")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")

    # Force the cached Settings + Supabase client to rebuild against the new env.
    from services.ai.api.auth import _reset_auth_cache
    from services.ai.config import get_settings
    from services.ai.db.supabase import reset_service_client
    from services.ai.mol.feature_flag import _reset_flag_cache

    get_settings.cache_clear()
    _reset_auth_cache()
    reset_service_client()
    _reset_flag_cache()

    from services.ai.mol.redis_client import reset_redis_client

    reset_redis_client()


# ─── Supabase fake (telemetry sink) ──────────────────────────────────────────


class _FakeQuery:
    """Mirrors the slice of the postgrest API we use in telemetry.py."""

    def __init__(self, sink: list[dict[str, Any]]) -> None:
        self._sink = sink
        self._pending_row: dict[str, Any] | None = None

    def insert(self, row: dict[str, Any]) -> _FakeQuery:
        self._pending_row = row
        return self

    def select(self, _columns: str) -> _FakeQuery:
        return self

    def limit(self, _n: int) -> _FakeQuery:
        return self

    async def execute(self) -> dict[str, Any]:
        if self._pending_row is not None:
            self._sink.append(self._pending_row)
            self._pending_row = None
        return {"status_code": 200, "data": []}


class _FakeSupabase:
    """Drop-in for postgrest.AsyncPostgrestClient — captures inserts in-memory."""

    def __init__(self) -> None:
        self.inserts: list[dict[str, Any]] = []

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self.inserts)


@pytest.fixture()
def mock_supabase_client(monkeypatch: pytest.MonkeyPatch) -> _FakeSupabase:
    """Patch :mod:`services.ai.db.supabase` to return a fake.

    Use this when the test needs to assert on the telemetry row that
    :func:`record_mol_request` would have written.
    """
    fake = _FakeSupabase()
    monkeypatch.setattr(
        "services.ai.db.supabase.get_service_client",
        lambda: fake,
    )
    # The orchestrator imports get_service_client through telemetry.py's
    # lazy import (`from ..db.supabase import get_service_client`), so
    # patching the source module is enough.
    return fake


@pytest.fixture()
def matching_student_dependency():
    """Authorize the student identifier carried by a MoL behavior test body."""

    async def _resolve(request: Request) -> dict[str, object]:
        body = await request.json()
        context = body.get("student_context")
        student_id = context.get("student_id", "") if isinstance(context, dict) else ""
        grade = context.get("grade", "") if isinstance(context, dict) else ""
        return {"id": student_id, "grade": grade, "preferred_subject": None}

    return _resolve


# ─── HTTP mocks ──────────────────────────────────────────────────────────────


@pytest.fixture()
def respx_mock() -> Iterator[respx.MockRouter]:
    """Per-test respx router. Assertions on call counts go here.

    ``assert_all_mocked=False`` lets the test register a subset of routes
    and ignore unexpected calls (we use this for the failure-path tests
    where the orchestrator may try multiple providers).
    ``assert_all_called=False`` matches: we don't require every registered
    mock to fire.
    """
    with respx.mock(assert_all_called=False, assert_all_mocked=False) as router:
        yield router


@pytest.fixture()
def anthropic_success(respx_mock: respx.MockRouter) -> respx.Route:
    """Pre-load a 200 from the Claude Messages endpoint."""
    return respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Pass-1 reply."}],
                "usage": {"input_tokens": 11, "output_tokens": 7},
                "stop_reason": "end_turn",
            },
        )
    )


@pytest.fixture()
def openai_success(respx_mock: respx.MockRouter) -> respx.Route:
    """Pre-load a 200 from the OpenAI chat-completions endpoint."""
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "OpenAI reply."},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 14, "completion_tokens": 9},
            },
        )
    )


# ─── Feature flag fake — short-circuit network reads in unit tests ──────────


@pytest.fixture(autouse=True)
def _disable_flag_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force ``is_flag_enabled`` to always return False in tests.

    Routing weights also default to empty — so the router behavior under
    test is the deterministic BASE_MATRIX path. Tests that exercise the
    openai_default / hybrid branches override this fixture locally.
    """

    async def _fake_flag(_name: str, **_kwargs: Any) -> bool:
        return False

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _fake_flag)
