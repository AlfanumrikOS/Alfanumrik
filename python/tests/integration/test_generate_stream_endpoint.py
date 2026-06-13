"""SSE streaming endpoint tests — A6."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from services.ai.api.main import create_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture()
def openai_stream_route(respx_mock):
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-stream",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Force is a push or pull.",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 6},
            },
        )
    )


def test_stream_returns_sse_content_type(client, openai_stream_route, mock_supabase_client):
    payload = {
        "task_type": "explanation",
        "input": {"question": "What is force?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    with client.stream("POST", "/v1/generate/stream", json=payload) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        body = "".join(res.iter_text())
    assert "event: token" in body
    assert "event: done" in body
    assert "Force is a push or pull." in body


def test_stream_done_event_carries_request_id(client, openai_stream_route, mock_supabase_client):
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    with client.stream("POST", "/v1/generate/stream", json=payload) as res:
        body = "".join(res.iter_text())
    assert "request_id" in body


def test_stream_invalid_input_emits_error_event(client, mock_supabase_client):
    """Empty input block streams an error event, not a 500."""
    payload = {
        "task_type": "explanation",
        "input": {},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    with client.stream("POST", "/v1/generate/stream", json=payload) as res:
        body = "".join(res.iter_text())
    assert "event: error" in body
    assert "INVALID_INPUT" in body
