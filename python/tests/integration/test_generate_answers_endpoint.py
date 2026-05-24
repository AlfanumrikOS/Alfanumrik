"""Integration tests for ``POST /v1/generate-answers`` + ``GET /v1/generate-answers``.

Uses ``fastapi.testclient.TestClient`` so the full pipeline runs (middleware,
CORS, request-id binding, error mapping). Provider HTTP calls + DB queries
are mocked so no network or DB I/O occurs.

The TS Edge proxy forwards requests verbatim, so these tests pin the
HTTP-level contract that the cutover relies on.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from services.ai.api.main import create_app


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Fresh app + TestClient with admin key + Supabase URL configured."""
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key-stub")
    from services.ai.config import get_settings

    get_settings.cache_clear()
    return TestClient(create_app())


# ── Fake DB client ──────────────────────────────────────────────────────────


class _FakeDbClient:
    """Mimics enough of postgrest's chain for fetch + update + ops_events writes.

    Tracks:
        - ``fetched_questions``: rows returned by question_bank SELECT.
        - ``updates``: payloads passed to question_bank UPDATE.
        - ``ops``: ops_events insert payloads.
    """

    def __init__(self, questions: list[dict[str, Any]] | None) -> None:
        self.fetched_questions = questions or []
        self.updates: list[dict[str, Any]] = []
        self.ops: list[dict[str, Any]] = []
        self._table: str | None = None
        self._mode: str | None = None
        self._update_payload: dict[str, Any] | None = None
        self._update_filter: dict[str, Any] = {}
        self._count_total = len(questions or [])

    def table(self, name: str) -> _FakeDbClient:
        self._table = name
        self._mode = None
        self._update_payload = None
        self._update_filter = {}
        return self

    def select(self, _cols: str, *, count=None, head=None) -> _FakeDbClient:
        del count, head
        self._mode = "select"
        return self

    def eq(self, k: str, v: Any) -> _FakeDbClient:
        if self._mode == "update":
            self._update_filter[k] = v
        return self

    @property
    def not_(self) -> _FakeDbClient:
        return self

    def is_(self, _k: str, _v: Any) -> _FakeDbClient:
        return self

    def order(self, _col: str, *, desc=False) -> _FakeDbClient:
        del desc
        return self

    def limit(self, _n: int) -> _FakeDbClient:
        return self

    def insert(self, row: dict[str, Any]) -> _FakeDbClient:
        # ops_events inserts.
        self._mode = "insert"
        self._update_payload = row
        return self

    def update(self, payload: dict[str, Any]) -> _FakeDbClient:
        self._mode = "update"
        self._update_payload = payload
        return self

    async def execute(self) -> dict[str, Any]:
        table = self._table
        mode = self._mode
        payload = self._update_payload
        self._update_payload = None

        if table == "question_bank" and mode == "update" and payload is not None:
            self.updates.append({"filter": dict(self._update_filter), "payload": payload})
            self._update_filter = {}
            return {"data": [payload], "status_code": 200}
        if table == "question_bank" and mode == "select":
            return {
                "data": list(self.fetched_questions),
                "status_code": 200,
                "count": self._count_total,
            }
        if table == "ops_events" and mode == "insert" and payload is not None:
            self.ops.append(payload)
            return {"data": [payload], "status_code": 201}
        if table == "mol_request_logs":
            return {"data": [], "status_code": 200}
        return {"data": [], "status_code": 200}

    @property
    def count(self) -> int:
        return self._count_total


class _FakeDbClientWithCount(_FakeDbClient):
    """Variant that returns count alongside data when count='exact' is used."""

    def select(self, _cols: str, *, count=None, head=None) -> _FakeDbClient:
        del head
        self._mode = "select"
        self._count_total = len(self.fetched_questions)
        return self

    async def execute(self) -> dict[str, Any]:
        # For COUNT-style queries, the handler reads `.count` directly off the
        # result object — we expose it via a dict key here.
        base = await super().execute()
        if "count" not in base:
            base["count"] = self._count_total
        return base


def _install_fake_db(
    monkeypatch: pytest.MonkeyPatch,
    questions: list[dict[str, Any]] | None,
) -> _FakeDbClientWithCount:
    fake = _FakeDbClientWithCount(questions)
    for target in [
        "services.ai.business.generate_answers.repository.get_service_client",
        "services.ai.business.generate_answers.ops_events.get_service_client",
        "services.ai.db.supabase.get_service_client",
    ]:
        monkeypatch.setattr(target, lambda f=fake: f)
    return fake


def _mock_openai_with_answer(
    respx_mock: respx.MockRouter,
    answer_text: str = "Force is a push or pull applied to an object. It can change motion.",
) -> respx.Route:
    payload = {
        "answer_text": answer_text,
        "answer_methodology": "definition",
        "marks_expected": 2,
    }
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-int",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": json.dumps(payload)},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 200, "completion_tokens": 80},
            },
        )
    )


def _question_row(qid: str = "qb-1") -> dict[str, Any]:
    return {
        "id": qid,
        "question_text": "What is force?",
        "subject": "science",
        "grade": "10",
        "chapter_number": 8,
        "difficulty": 2,
        "bloom_level": "remember",
        "question_type_v2": "short_answer",
        "options": None,
        "correct_answer_index": None,
        "explanation": "A push or pull.",
    }


# ── Happy path POST ─────────────────────────────────────────────────────────


def test_post_happy_path_one_question(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Admin posts → 1 question fetched → MoL answers → DB UPDATE happens."""
    _mock_openai_with_answer(respx_mock)
    fake_db = _install_fake_db(monkeypatch, questions=[_question_row()])

    res = client.post(
        "/v1/generate-answers",
        headers={"x-admin-key": "test-admin-key"},
        json={
            "grade": "10",
            "subject": "science",
            "batch_size": 1,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    assert body["total_found"] == 1
    assert body["processed"] == 1
    assert body["succeeded"] == 1
    assert body["failed"] == 0

    # DB invariant: the UPDATE includes verification_state='pending'.
    assert len(fake_db.updates) >= 1
    update_payload = fake_db.updates[0]["payload"]
    assert update_payload["verification_state"] == "pending"
    assert update_payload["answer_methodology"] == "definition"
    assert update_payload["marks_expected"] == 2
    assert update_payload["answer_text"].startswith("Force is")

    # ops_events emitted at least one 'quiz.answer_generated'.
    success_events = [e for e in fake_db.ops if e["category"] == "quiz.answer_generated"]
    assert len(success_events) >= 1


# ── Auth failures ──────────────────────────────────────────────────────────


def test_post_401_when_no_admin_key(client: TestClient):
    res = client.post(
        "/v1/generate-answers",
        json={"grade": "10"},
    )
    assert res.status_code == 401, res.text
    body = res.json()
    assert body["detail"]["code"] == "AUTH_FAILED"


def test_post_401_when_wrong_admin_key(client: TestClient):
    res = client.post(
        "/v1/generate-answers",
        headers={"x-admin-key": "wrong-key"},
        json={"grade": "10"},
    )
    assert res.status_code == 401
    body = res.json()
    assert body["detail"]["code"] == "AUTH_FAILED"


# ── Validation failures ─────────────────────────────────────────────────────


def test_post_422_when_extra_fields(client: TestClient):
    """REG-73: extra='forbid' on request envelope."""
    res = client.post(
        "/v1/generate-answers",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": "10", "not_a_real_field": True},
    )
    assert res.status_code == 422


def test_post_with_no_body_returns_2xx(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    """No-body POST: TS path tolerates this — all fields optional.

    We install an empty fake DB so the handler short-circuits on the
    empty-batch path (success=True, total_found=0) rather than trying to
    hit the real Supabase.
    """
    _install_fake_db(monkeypatch, questions=[])

    res = client.post(
        "/v1/generate-answers",
        headers={"x-admin-key": "test-admin-key"},
        json={},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    assert body["total_found"] == 0


# ── Dry-run ────────────────────────────────────────────────────────────────


def test_post_dry_run_returns_previews(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """dry_run=true → previews only, no LLM call, no DB UPDATE."""
    openai_route = _mock_openai_with_answer(respx_mock)
    fake_db = _install_fake_db(monkeypatch, questions=[_question_row("qb-dry")])

    res = client.post(
        "/v1/generate-answers",
        headers={"x-admin-key": "test-admin-key"},
        json={
            "grade": "10",
            "subject": "science",
            "dry_run": True,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["dry_run"] is True
    assert body["total_found"] == 1
    assert body["processed"] == 0
    assert body["succeeded"] == 0
    assert body["questions"] is not None
    assert body["questions"][0]["id"] == "qb-dry"

    # Crucial: no LLM call, no UPDATE on a dry run.
    assert openai_route.called is False
    assert fake_db.updates == []


# ── Empty-batch path ───────────────────────────────────────────────────────


def test_post_empty_batch(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """No matching question_bank rows → success with zero counts."""
    openai_route = _mock_openai_with_answer(respx_mock)
    _install_fake_db(monkeypatch, questions=[])

    res = client.post(
        "/v1/generate-answers",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": "10"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["total_found"] == 0
    assert body["processed"] == 0
    assert openai_route.called is False


# ── GET status endpoint ────────────────────────────────────────────────────


def test_get_status_401_without_admin_key(client: TestClient):
    res = client.get("/v1/generate-answers")
    assert res.status_code == 401


def test_get_status_returns_coverage_shape(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    """GET returns coverage stats with the expected envelope."""
    _install_fake_db(monkeypatch, questions=[_question_row("qb-a"), _question_row("qb-b")])

    res = client.get(
        "/v1/generate-answers",
        headers={"x-admin-key": "test-admin-key"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "total_active" in body
    assert "with_answer" in body
    assert "without_answer" in body
    assert "coverage_percent" in body
