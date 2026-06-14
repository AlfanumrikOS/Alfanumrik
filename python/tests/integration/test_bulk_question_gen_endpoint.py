"""Integration tests for ``POST /v1/bulk-question-gen``.

Uses ``fastapi.testclient.TestClient`` so the full app pipeline (middleware,
CORS, request-id binding, error mapping) fires. Provider HTTP calls + DB
inserts are mocked so no network or DB I/O occurs.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from services.ai.api.main import create_app
from services.ai.business.bulk_question_gen.handler import reset_circuit_breaker
from services.ai.business.bulk_question_gen.oracle import clear_oracle_cache


@pytest.fixture(autouse=True)
def _reset_breaker_and_cache():
    reset_circuit_breaker()
    clear_oracle_cache()
    yield
    reset_circuit_breaker()
    clear_oracle_cache()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Fresh app + TestClient with Supabase URL configured (otherwise auth fails closed)."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key-stub")
    from services.ai.config import get_settings

    get_settings.cache_clear()
    return TestClient(create_app())


# ── Fake DB client for the request lifecycle ────────────────────────────────


class _FakeDbClient:
    """Mimics enough of postgrest's chain for the handler's DB writes.

    - ``admin_users.select(...).eq(...).eq(...).limit(...).execute()`` →
      configurable rows.
    - ``question_bank.insert(...).execute()`` → returns the inserted rows
      with synthetic ids; captures the inserted payloads on `inserts`.
    - ``ops_events.insert(...).execute()`` → fire-and-forget; captures on `ops`.
    """

    def __init__(self, admin_rows: list[dict[str, Any]]) -> None:
        self.admin_rows = admin_rows
        self.inserts: list[dict[str, Any]] = []
        self.ops: list[dict[str, Any]] = []
        self._current_table: str | None = None
        self._pending: list[dict[str, Any]] | None = None

    def table(self, name: str) -> _FakeDbClient:
        self._current_table = name
        return self

    def select(self, _columns: str) -> _FakeDbClient:
        return self

    def eq(self, _k: str, _v: Any) -> _FakeDbClient:
        return self

    def limit(self, _n: int) -> _FakeDbClient:
        return self

    def insert(self, rows) -> _FakeDbClient:
        # rows can be a single dict or a list of dicts.
        if isinstance(rows, dict):
            self._pending = [rows]
        else:
            self._pending = list(rows)
        return self

    async def execute(self) -> dict[str, Any]:
        table = self._current_table
        pending = self._pending
        self._pending = None

        if pending is not None and table == "question_bank":
            self.inserts.extend(pending)
            # Synthesize an id for each inserted row.
            returned = [{**row, "id": f"qb-{i}"} for i, row in enumerate(pending)]
            return {"data": returned, "status_code": 201}
        if pending is not None and table == "ops_events":
            self.ops.extend(pending)
            return {"data": pending, "status_code": 201}
        if pending is not None and table == "mol_request_logs":
            # telemetry — irrelevant for these tests but keep the fake happy.
            return {"data": pending, "status_code": 201}
        if table == "admin_users":
            return {"data": self.admin_rows, "status_code": 200}
        return {"data": [], "status_code": 200}


def _install_fake_db(monkeypatch: pytest.MonkeyPatch, admin_rows: list[dict[str, Any]] | None):
    fake = _FakeDbClient(admin_rows or [])
    # The auth module imports get_service_client directly.
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.auth.get_service_client",
        lambda: fake,
    )
    # Repository + ops_events + MoL telemetry all go through get_service_client.
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.repository.get_service_client",
        lambda: fake,
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.ops_events.get_service_client",
        lambda: fake,
    )
    monkeypatch.setattr(
        "services.ai.db.supabase.get_service_client",
        lambda: fake,
    )
    return fake


def _mock_supabase_auth(respx_mock: respx.MockRouter, user_id: str = "user-uuid"):
    return respx_mock.get("https://test.supabase.co/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": user_id})
    )


def _mock_openai_with_questions(respx_mock: respx.MockRouter, count: int = 2):
    items = []
    for i in range(count):
        items.append(
            {
                "question_text": f"Q{i} about CBSE chapter?",
                "options": [f"alpha-{i}", f"beta-{i}", f"gamma-{i}", f"delta-{i}"],
                "correct_answer_index": 0,
                "explanation": f"Because alpha-{i} is the correct answer.",
                "hint": f"Think about question {i}.",
                "difficulty": 3,
                "bloom_level": "remember",
            }
        )
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-int",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": json.dumps(items)},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 200, "completion_tokens": 500},
            },
        )
    )


def _mock_anthropic_oracle_consistent(respx_mock: respx.MockRouter):
    """Oracle grader returns 'consistent' for every candidate."""
    return respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [
                    {
                        "type": "text",
                        "text": '{"verdict":"consistent","reasoning":"matches"}',
                    }
                ],
                "usage": {"input_tokens": 200, "output_tokens": 20},
                "stop_reason": "end_turn",
            },
        )
    )


# ── Happy path ──────────────────────────────────────────────────────────────


def test_bulk_question_gen_happy_path(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Admin posts → 2 questions generated → both oracle-accepted → both inserted."""
    _mock_supabase_auth(respx_mock)
    _mock_openai_with_questions(respx_mock, count=2)
    _mock_anthropic_oracle_consistent(respx_mock)
    fake_db = _install_fake_db(monkeypatch, admin_rows=[{"admin_level": "admin"}])

    res = client.post(
        "/v1/bulk-question-gen",
        headers={"Authorization": "Bearer test-jwt"},
        json={
            "grade": "8",
            "subject": "science",
            "chapter": "Force and Pressure",
            "count": 2,
            "difficulty": 3,
            "bloom_level": "remember",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["generated"] == 2
    assert body["inserted"] == 2
    assert body["rejected"] == 0
    assert body["oracle_evaluated"] == 2
    assert body["oracle_rejected"] == 0
    assert len(body["questions"]) == 2
    assert body["questions"][0]["grade"] == "8"
    assert body["questions"][0]["subject"] == "science"

    # DB invariant: every inserted row is verification_state='pending'.
    assert len(fake_db.inserts) == 2
    for row in fake_db.inserts:
        assert row["verification_state"] == "pending"
        assert row["verified_against_ncert"] is False
        assert row["is_active"] is False
        assert row["source"] == "ai_generated"
        assert row["grade"] == "8"  # P5: string

    # Ops events fired (2 evaluated + 0 rejected = 2 entries).
    eval_events = [e for e in fake_db.ops if e["category"] == "quiz.oracle_evaluated"]
    assert len(eval_events) == 2


# ── Auth failures ──────────────────────────────────────────────────────────


def test_bulk_question_gen_401_when_no_authorization(client: TestClient):
    res = client.post(
        "/v1/bulk-question-gen",
        json={
            "grade": "8",
            "subject": "science",
            "chapter": "X",
        },
    )
    # FastAPI's Header(...) requirement → 422 when entirely missing; but the
    # auth check produces 401 when the header is present-but-invalid. We
    # accept either as a not-500 sentinel.
    assert res.status_code in (401, 422), res.text


def test_bulk_question_gen_401_when_supabase_rejects_token(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get("https://test.supabase.co/auth/v1/user").mock(return_value=httpx.Response(401))
    _install_fake_db(monkeypatch, admin_rows=[])
    res = client.post(
        "/v1/bulk-question-gen",
        headers={"Authorization": "Bearer bad-jwt"},
        json={"grade": "8", "subject": "science", "chapter": "X"},
    )
    assert res.status_code == 401
    body = res.json()
    assert body["detail"]["code"] == "AUTH_FAILED"


def test_bulk_question_gen_403_when_user_not_admin(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    _mock_supabase_auth(respx_mock)
    _install_fake_db(monkeypatch, admin_rows=[])
    res = client.post(
        "/v1/bulk-question-gen",
        headers={"Authorization": "Bearer test-jwt"},
        json={"grade": "8", "subject": "science", "chapter": "X"},
    )
    assert res.status_code == 403


# ── Validation failures ─────────────────────────────────────────────────────


def test_bulk_question_gen_422_when_grade_invalid(client: TestClient):
    res = client.post(
        "/v1/bulk-question-gen",
        headers={"Authorization": "Bearer test-jwt"},
        json={"grade": "5", "subject": "science", "chapter": "X"},  # grade 5 not allowed
    )
    assert res.status_code == 422


def test_bulk_question_gen_422_when_count_exceeds_50(client: TestClient):
    res = client.post(
        "/v1/bulk-question-gen",
        headers={"Authorization": "Bearer test-jwt"},
        json={
            "grade": "8",
            "subject": "science",
            "chapter": "X",
            "count": 999,
        },
    )
    assert res.status_code == 422


def test_bulk_question_gen_400_when_subject_invalid_for_grade(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Physics is not a CBSE grade-8 subject — handler returns 400."""
    _mock_supabase_auth(respx_mock)
    _install_fake_db(monkeypatch, admin_rows=[{"admin_level": "admin"}])
    res = client.post(
        "/v1/bulk-question-gen",
        headers={"Authorization": "Bearer test-jwt"},
        json={"grade": "8", "subject": "physics", "chapter": "X"},
    )
    assert res.status_code == 400


# ── Generator failure ──────────────────────────────────────────────────────


def test_bulk_question_gen_503_when_llm_unparseable(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """LLM returns garbage → 503 (GenerationError → HandlerError 503)."""
    _mock_supabase_auth(respx_mock)
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "x",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "not json"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )
    )
    _install_fake_db(monkeypatch, admin_rows=[{"admin_level": "admin"}])
    res = client.post(
        "/v1/bulk-question-gen",
        headers={"Authorization": "Bearer test-jwt"},
        json={"grade": "8", "subject": "science", "chapter": "X", "count": 1},
    )
    assert res.status_code == 503
    body = res.json()
    assert body["detail"]["code"] == "HANDLER_ERROR"
