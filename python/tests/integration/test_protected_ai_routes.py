"""Integration coverage for the Python AI route authorization boundary."""

from __future__ import annotations

import time
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from services.ai.api.auth import require_active_student
from services.ai.api.main import create_app
from services.ai.business.nep_compliance import NepComplianceResponse

OWNED_STUDENT_ID = "11111111-1111-4111-8111-111111111111"
OTHER_STUDENT_ID = "22222222-2222-4222-8222-222222222222"


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        (
            "post",
            "/v1/generate",
            {
                "task_type": "explanation",
                "input": {"question": "What is photosynthesis?"},
                "student_context": {"student_id": OWNED_STUDENT_ID, "grade": "8"},
            },
        ),
        (
            "post",
            "/v1/generate/stream",
            {
                "task_type": "explanation",
                "input": {"question": "What is photosynthesis?"},
                "student_context": {"student_id": OWNED_STUDENT_ID, "grade": "8"},
            },
        ),
        ("post", "/v1/foxy-tutor", {"question": "Explain gravity."}),
        (
            "post",
            "/v1/quiz-generator",
            {
                "action": "generate",
                "student_id": OWNED_STUDENT_ID,
                "subject": "science",
                "grade": "8",
            },
        ),
        (
            "post",
            "/v1/nep-compliance",
            {"action": "get_hpc", "student_id": OWNED_STUDENT_ID},
        ),
        ("get", "/cme/revision_due", None),
    ],
)
def test_protected_routes_reject_missing_bearer_token(
    client: TestClient,
    method: str,
    path: str,
    payload: dict[str, Any] | None,
) -> None:
    response = (
        client.request(method, path, json=payload)
        if payload is not None
        else client.request(method, path)
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "AUTHENTICATION_REQUIRED"
    assert response.headers["www-authenticate"] == "Bearer"


def test_cme_rejects_unsigned_identity_token(client: TestClient) -> None:
    now = int(time.time())
    forged_token = jwt.encode(
        {
            "sub": OWNED_STUDENT_ID,
            "role": "authenticated",
            "iss": "https://attacker.invalid/auth/v1",
            "aud": "authenticated",
            "iat": now,
            "exp": now + 300,
        },
        key="",
        algorithm="none",
    )

    response = client.get(
        "/cme/revision_due",
        headers={"Authorization": f"Bearer {forged_token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "INVALID_OR_EXPIRED_TOKEN"


def test_liveness_remains_available_without_user_auth(client: TestClient) -> None:
    response = client.get("/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.fixture()
def owned_student_client() -> TestClient:
    app = create_app()

    async def _owned_student() -> dict[str, object]:
        return {
            "id": OWNED_STUDENT_ID,
            "grade": "Grade 08",
            "preferred_subject": "science",
        }

    app.dependency_overrides[require_active_student] = _owned_student
    return TestClient(app)


def test_generate_rejects_request_for_another_student(
    owned_student_client: TestClient,
) -> None:
    response = owned_student_client.post(
        "/v1/generate",
        json={
            "task_type": "explanation",
            "input": {"question": "What is photosynthesis?"},
            "student_context": {"student_id": OTHER_STUDENT_ID, "grade": "8"},
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "STUDENT_SCOPE_MISMATCH"


def test_quiz_rejects_request_for_another_student(
    owned_student_client: TestClient,
) -> None:
    response = owned_student_client.post(
        "/v1/quiz-generator",
        json={
            "action": "generate",
            "student_id": OTHER_STUDENT_ID,
            "subject": "science",
            "grade": "8",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "STUDENT_SCOPE_MISMATCH"


@pytest.mark.parametrize("path", ["/v1/generate", "/v1/quiz-generator"])
def test_student_routes_reject_request_for_another_grade(
    owned_student_client: TestClient,
    path: str,
) -> None:
    if path == "/v1/generate":
        payload = {
            "task_type": "explanation",
            "input": {"question": "Explain a grade-nine topic."},
            "student_context": {"student_id": OWNED_STUDENT_ID, "grade": "9"},
        }
    else:
        payload = {
            "action": "generate",
            "student_id": OWNED_STUDENT_ID,
            "subject": "science",
            "grade": "9",
        }

    response = owned_student_client.post(path, json=payload)

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "STUDENT_GRADE_MISMATCH"


def test_quiz_handler_receives_canonical_server_owned_grade(
    owned_student_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, str] = {}

    async def _generate_quiz(_supabase, request):
        captured["grade"] = request.grade
        return {"questions": [], "meta": {}}

    monkeypatch.setattr(
        "services.ai.business.quiz_generator.router.generate_quiz",
        _generate_quiz,
    )

    response = owned_student_client.post(
        "/v1/quiz-generator",
        json={
            "action": "generate",
            "student_id": OWNED_STUDENT_ID,
            "subject": "science",
            "grade": "Class 8",
        },
    )

    assert response.status_code == 200
    assert captured["grade"] == "8"


def test_nep_compliance_uses_authenticated_student_not_body_id(
    owned_student_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, str] = {}

    async def _handler(
        payload,
        *,
        authenticated_student_id: str,
        request_id: str,
    ) -> NepComplianceResponse:
        del payload, request_id
        captured["student_id"] = authenticated_student_id
        return NepComplianceResponse(success=True)

    monkeypatch.setattr(
        "services.ai.api.v1.nep_compliance.handle_nep_compliance",
        _handler,
    )

    response = owned_student_client.post(
        "/v1/nep-compliance",
        json={"action": "get_hpc", "student_id": OTHER_STUDENT_ID},
    )

    assert response.status_code == 200
    assert captured["student_id"] == OWNED_STUDENT_ID
