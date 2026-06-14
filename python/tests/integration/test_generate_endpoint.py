"""End-to-end integration tests against the FastAPI ``/v1/generate`` route.

Uses ``fastapi.testclient.TestClient`` so the full app pipeline (middleware,
CORS, request-id binding, error mapping) is exercised. Provider HTTP calls
are mocked via respx so no real Anthropic / OpenAI requests fire.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from services.ai.api.main import create_app


@pytest.fixture()
def client() -> TestClient:
    """Fresh app + TestClient per test (clean lifespan state)."""
    app = create_app()
    return TestClient(app)


# ─── Health endpoints ───────────────────────────────────────────────────────


def test_live_always_returns_200(client: TestClient):
    res = client.get("/live")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_readyz_returns_degraded_when_no_supabase(client: TestClient):
    """No SUPABASE_URL → readyz returns 503 with checks payload."""
    res = client.get("/readyz")
    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "degraded"
    assert body["checks"]["supabase"] is False
    assert body["checks"]["providers"] is True  # both keys set in conftest


# ─── /v1/generate happy path ────────────────────────────────────────────────


@pytest.fixture()
def openai_default_route(respx_mock):
    """Pre-loaded 200 for the default explanation chain's primary provider."""
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-int",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "Integration reply."},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 8},
            },
        )
    )


def test_generate_happy_path_returns_mol_result(
    client: TestClient, openai_default_route, mock_supabase_client
):
    """POST /v1/generate with a valid envelope returns a MolResult."""
    payload = {
        "task_type": "explanation",
        "input": {"question": "What is photosynthesis?"},
        "student_context": {
            "student_id": "11111111-1111-1111-1111-111111111111",
            "grade": "8",
            "language": "en",
            "subject": "biology",
        },
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["text"] == "Integration reply."
    assert body["provider"] == "openai"
    assert body["model"] == "gpt-4o-mini"
    assert body["task_type"] == "explanation"
    assert body["tokens"] == {"prompt": 12, "completion": 8}
    assert body["passes"] == 1
    assert body["request_id"]
    # USD cost: 12/1e6 * 0.15 + 8/1e6 * 0.60 = 1.8e-6 + 4.8e-6 = 6.6e-6.
    # The orchestrator rounds to 6-decimal USD precision (matches TS
    # ``Math.round(usd*1e6)/1e6``), so 6.6e-6 → 7e-6 on the wire.
    assert body["usd_cost"] == pytest.approx(7e-6, rel=1e-6)


def test_generate_writes_one_telemetry_row(
    client: TestClient, openai_default_route, mock_supabase_client
):
    payload = {
        "task_type": "explanation",
        "input": {"question": "What is photosynthesis?"},
        "student_context": {
            "student_id": "22222222-2222-2222-2222-222222222222",
            "grade": "8",
        },
    }
    client.post("/v1/generate", json=payload)
    assert len(mock_supabase_client.inserts) == 1
    row = mock_supabase_client.inserts[0]
    assert row["student_id"] == "22222222-2222-2222-2222-222222222222"
    assert row["task_type"] == "explanation"
    assert row["provider"] == "openai"
    assert row["passes"] == 1
    assert row["prompt_tokens"] == 12
    assert row["completion_tokens"] == 8


def test_generate_echoes_request_id_header(
    client: TestClient, openai_default_route, mock_supabase_client
):
    """The X-Request-Id response header must mirror the bound request id."""
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "abc", "grade": "8"},
    }
    res = client.post(
        "/v1/generate",
        json=payload,
        headers={"X-Request-Id": "custom-rid-123"},
    )
    assert res.headers.get("x-request-id") == "custom-rid-123"


# ─── Error mapping ──────────────────────────────────────────────────────────


def test_generate_400_when_input_block_empty(client: TestClient):
    """No question/topic/instruction/image_url → 400 INVALID_INPUT."""
    payload = {
        "task_type": "explanation",
        "input": {},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 400
    body = res.json()
    assert body["detail"]["code"] == "INVALID_INPUT"


def test_generate_422_when_envelope_malformed(client: TestClient):
    """Missing student_context → Pydantic 422 (handled by FastAPI itself)."""
    res = client.post(
        "/v1/generate",
        json={"task_type": "explanation", "input": {"question": "?"}},
    )
    assert res.status_code == 422


def test_generate_502_when_all_providers_fail(client: TestClient, respx_mock, mock_supabase_client):
    """All providers in the chain return 500 → 502 NO_PROVIDER_AVAILABLE."""
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(500)
    )
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(return_value=httpx.Response(500))
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 502
    body = res.json()
    assert body["detail"]["code"] == "NO_PROVIDER_AVAILABLE"
    # Failure telemetry row must still be written for forensics.
    assert len(mock_supabase_client.inserts) == 1
    failure_row = mock_supabase_client.inserts[0]
    assert failure_row["passes"] == 0
    assert failure_row["failure_chain"]


# ─── A2: ff_mol_deterministic_priority wiring ────────────────────────────────


def test_generate_reads_deterministic_priority_flag(
    client, openai_default_route, mock_supabase_client, monkeypatch
):
    """The orchestrator MUST read ff_mol_deterministic_priority on every call."""
    seen: list[str] = []

    async def _flag(name, **kwargs):
        seen.append(name)
        return False

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "33333333-3333-3333-3333-333333333333", "grade": "8"},
    }
    client.post("/v1/generate", json=payload)
    assert "ff_mol_deterministic_priority" in seen


def test_generate_uses_openai_primary_when_deterministic_flag_on(
    client, openai_default_route, mock_supabase_client, monkeypatch
):
    """When ff_mol_deterministic_priority is ON, OpenAI is the primary provider."""

    async def _flag(name, **kwargs):
        return name == "ff_mol_deterministic_priority"

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)
    payload = {
        "task_type": "reasoning",
        "input": {"question": "Prove the Pythagoras theorem."},
        "student_context": {"student_id": "33333333-3333-3333-3333-333333333333", "grade": "9"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["provider"] == "openai"


# ─── A3: ff_mol_circuit_breaker_v1 wiring ────────────────────────────────────


def test_generate_skips_open_breaker_provider(
    client: TestClient, respx_mock, mock_supabase_client, monkeypatch
):
    """When the OpenAI breaker is OPEN for the task, the orchestrator skips
    OpenAI and resolves on the Anthropic fallback rung."""
    from services.ai.mol import breaker as breaker_mod

    async def _flag(name, **kwargs):
        return name in ("ff_mol_circuit_breaker_v1", "ff_mol_deterministic_priority")

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)

    async def _can_request(provider, task):
        return provider != "openai"  # OpenAI breaker OPEN

    monkeypatch.setattr(breaker_mod, "can_request", _can_request)
    monkeypatch.setattr(breaker_mod, "record_failure", lambda *a, **k: _noop())
    monkeypatch.setattr(breaker_mod, "record_success", lambda *a, **k: _noop())

    # OpenAI is the deterministic-primary AND would succeed if called — so the
    # ONLY way the result resolves on Anthropic is the breaker skipping OpenAI
    # without an HTTP call. This makes the RED meaningful: un-wired, the result
    # would be "openai".
    openai_route = respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-breaker",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "OpenAI reply."},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 4, "completion_tokens": 2},
            },
        )
    )
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Anthropic fallback."}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "stop_reason": "end_turn",
            },
        )
    )
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["provider"] == "anthropic"
    # OpenAI must be skipped WITHOUT an HTTP call (breaker OPEN), not merely
    # tried-and-failed. A real network hit would mean the gate did nothing.
    assert not openai_route.called


def test_breaker_ignores_non_retryable_4xx_but_counts_5xx(
    client: TestClient, respx_mock, mock_supabase_client, monkeypatch
):
    """A3 health-signal gating: only provider-HEALTH failures trip the breaker.

    A non-retryable 4xx (client/input error) on OpenAI must NOT call
    ``record_failure`` (and the request falls through to the Anthropic rung),
    while a retryable 5xx MUST call ``record_failure``.
    """
    from services.ai.mol import breaker as breaker_mod

    async def _flag(name, **kwargs):
        return name in ("ff_mol_circuit_breaker_v1", "ff_mol_deterministic_priority")

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)

    # Spy on the breaker recorders. can_request stays CLOSED (allow all) so
    # the only behavior under test is which failures get *recorded*.
    recorded_failures: list[tuple[str, str]] = []

    async def _can_request(provider, task):
        return True

    async def _record_failure(provider, task):
        recorded_failures.append((provider, task))

    async def _record_success(provider, task):
        return None

    monkeypatch.setattr(breaker_mod, "can_request", _can_request)
    monkeypatch.setattr(breaker_mod, "record_failure", _record_failure)
    monkeypatch.setattr(breaker_mod, "record_success", _record_success)

    # ── Case 1: OpenAI 400 (non-retryable 4xx) → must NOT record, falls to Anthropic.
    openai_400 = respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(400, json={"error": {"message": "bad request"}})
    )
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Anthropic fallback."}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "stop_reason": "end_turn",
            },
        )
    )
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    # Fell through to anthropic after the OpenAI 400.
    assert res.json()["provider"] == "anthropic"
    assert openai_400.called
    # The non-retryable 4xx must NOT have been counted toward the breaker.
    assert ("openai", "explanation") not in recorded_failures

    # ── Case 2: OpenAI 503 (retryable 5xx) → MUST record_failure.
    recorded_failures.clear()
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(503)
    )
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Anthropic fallback."}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "stop_reason": "end_turn",
            },
        )
    )
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    # A retryable provider-health failure MUST be recorded (at least once;
    # the 503 rung gets 1 retry, so it may be recorded twice — both count).
    assert ("openai", "explanation") in recorded_failures


# ─── A4: ff_mol_cost_cap_v1 wiring ──────────────────────────────────────────


def test_generate_429_when_cost_cap_exceeded(
    client: TestClient, respx_mock, mock_supabase_client, monkeypatch
):
    """When ff_mol_cost_cap_v1 is ON and the worst-case estimate exceeds the
    per-task ceiling, the route returns 429 COST_CAP_EXCEEDED and NO provider
    HTTP call fires (the cap is enforced BEFORE the provider call).

    Setup: task_type 'evaluation' (₹2.0 ceiling), preferred_provider 'anthropic'
    so the anthropic rung is primary, and max_tokens_override 5_000_000 so the
    worst-case completion estimate balloons past the ceiling.
    """

    async def _flag(name, **kwargs):
        return name == "ff_mol_cost_cap_v1"

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)

    # Register both provider routes so we can assert NEITHER was called.
    openai_route = respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-should-not-fire",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "Should not fire."},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 4, "completion_tokens": 2},
            },
        )
    )
    anthropic_route = respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Should not fire."}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "stop_reason": "end_turn",
            },
        )
    )

    payload = {
        "task_type": "evaluation",
        "input": {"question": "Is 7 prime?", "options": ["yes", "no"]},
        "student_context": {
            "student_id": "44444444-4444-4444-4444-444444444444",
            "grade": "8",
        },
        "config": {
            "preferred_provider": "anthropic",
            "max_tokens_override": 5_000_000,
        },
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 429, res.text
    body = res.json()
    assert body["detail"]["code"] == "COST_CAP_EXCEEDED"
    # The cap must fire BEFORE any provider call.
    assert not openai_route.called
    assert not anthropic_route.called


# ─── A4: ff_mol_semantic_cache short-circuit ────────────────────────────────


def test_generate_serves_from_cache_without_provider_call(
    client: TestClient, respx_mock, mock_supabase_client, monkeypatch
):
    """A cache hit short-circuits before any provider HTTP call."""
    from services.ai.mol import cache as cache_mod  # noqa: F401

    async def _flag(name, **kwargs):
        return name == "ff_mol_semantic_cache"

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)

    async def _get_cached(key):
        return "Cached answer."

    monkeypatch.setattr("services.ai.mol.orchestrator.get_cached", _get_cached)
    openai_route = respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [], "usage": {}})
    )
    payload = {
        "task_type": "explanation",
        "input": {"question": "What is force?"},
        "student_context": {"student_id": "x", "grade": "8", "subject": "science"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["text"] == "Cached answer."
    assert openai_route.call_count == 0


async def _noop():
    return None
