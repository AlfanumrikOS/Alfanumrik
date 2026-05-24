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


def test_generate_502_when_all_providers_fail(
    client: TestClient, respx_mock, mock_supabase_client
):
    """All providers in the chain return 500 → 502 NO_PROVIDER_AVAILABLE."""
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(500)
    )
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(500)
    )
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
