"""End-to-end integration tests for ``POST /v1/classify`` (Foxy perception).

Uses ``fastapi.testclient.TestClient`` so the full app pipeline (auth override,
router, MOL orchestrator, error mapping) is exercised. Provider HTTP calls are
mocked via respx so no real OpenAI/Anthropic requests fire — proving the
classification genuinely runs in the Python service.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from services.ai.api.auth import require_active_student
from services.ai.api.main import create_app

_STUDENT_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture()
def classify_student_dependency():
    """Authorize a fixed active student (id + grade) for the classify route."""

    async def _resolve() -> dict[str, object]:
        return {"id": _STUDENT_ID, "grade": "8", "preferred_subject": None}

    return _resolve


@pytest.fixture()
def client(classify_student_dependency) -> TestClient:
    app = create_app()
    app.dependency_overrides[require_active_student] = classify_student_dependency
    return TestClient(app)


def _valid_body(**overrides) -> dict:
    body = {
        "student_id": _STUDENT_ID,
        "grade": "8",
        "subject": "Science",
        "chapter_number": 6,
        "student_message": "What is photosynthesis?",
        "foxy_answer": "Plants make food using sunlight.",
    }
    body.update(overrides)
    return body


@pytest.fixture()
def provider_returns_classification(respx_mock):
    """Both providers return a valid classification JSON as the message content."""
    classification = (
        '{"topic_label":"Photosynthesis","bloom_level":"understand",'
        '"misconception_code":null,"struggle_signal":"none","intent":"ask_concept"}'
    )
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-classify",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": classification},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 40, "completion_tokens": 18},
            },
        )
    )
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": classification}],
                "usage": {"input_tokens": 40, "output_tokens": 18},
                "stop_reason": "end_turn",
            },
        )
    )
    return classification


def test_classify_happy_path(
    client: TestClient, provider_returns_classification, mock_supabase_client
):
    res = client.post("/v1/classify", json=_valid_body())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["topic_label"] == "Photosynthesis"
    assert body["bloom_level"] == "understand"
    assert body["misconception_code"] is None
    assert body["struggle_signal"] == "none"
    assert body["intent"] == "ask_concept"


def test_classify_student_scope_mismatch_is_403(
    client: TestClient, provider_returns_classification
):
    """A request for a DIFFERENT student_id than the verified profile is denied."""
    res = client.post(
        "/v1/classify", json=_valid_body(student_id="22222222-2222-2222-2222-222222222222")
    )
    assert res.status_code == 403
    assert res.json()["detail"]["error"] == "STUDENT_SCOPE_MISMATCH"


def test_classify_grade_mismatch_is_403(client: TestClient, provider_returns_classification):
    """A request grade that disagrees with the profile grade is denied (P5/P12)."""
    res = client.post("/v1/classify", json=_valid_body(grade="10"))
    assert res.status_code == 403
    assert res.json()["detail"]["error"] == "STUDENT_GRADE_MISMATCH"


def test_classify_unparseable_model_output_is_502(
    client: TestClient, respx_mock, mock_supabase_client
):
    """A model that returns non-JSON prose → 502 so the Node client no-ops."""
    prose = "Sorry, I cannot classify this."
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-junk",
                "model": "gpt-4o-mini",
                "choices": [
                    {"message": {"role": "assistant", "content": prose}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 8},
            },
        )
    )
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": prose}],
                "usage": {"input_tokens": 10, "output_tokens": 8},
                "stop_reason": "end_turn",
            },
        )
    )
    res = client.post("/v1/classify", json=_valid_body())
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "CLASSIFICATION_UNPARSEABLE"


def test_classify_rejects_extra_fields(client: TestClient):
    res = client.post("/v1/classify", json=_valid_body(sneaky="x"))
    assert res.status_code == 422
