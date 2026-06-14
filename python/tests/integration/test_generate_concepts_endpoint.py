"""Integration tests for ``POST /v1/generate-concepts`` + ``GET /v1/generate-concepts``.

Uses ``fastapi.testclient.TestClient`` so the full pipeline runs (middleware,
CORS, request-id binding, error mapping). Provider HTTP calls + DB queries
are mocked so no network or DB I/O occurs.

Async contract (PR #931): ``POST /v1/generate-concepts`` was refactored to be
asynchronous. The route now verifies auth + the route-level budget guard,
schedules the heavy generation via FastAPI ``BackgroundTasks``, and returns
``202 Accepted`` + ``{"status": "queued", "request_id": <rid>}`` immediately.
The result envelope (success / total_found / chapters / inserts) is produced
INSIDE the background task and is no longer part of the HTTP response.

Consequently these tests pin two distinct layers:
  - The HTTP wire contract (202 + queued payload, plus auth/validation
    failures that still surface at the response).
  - The WORK the background task performs — driven by awaiting the real
    background task :func:`_run_generate_concepts_task` with the fake DB
    installed, then asserting on the fake DB's recorded inserts / ops.

The TS Edge proxy forwards requests verbatim, so these tests pin the
HTTP-level contract that the cutover relies on. REG-76 pins the
``test_post_persisted_chapters_carry_grade_as_string`` test in particular
(P5 — grade-as-string contract, relocated from the now-swallowed response
onto the rows the background task writes to ``chapter_concepts``).
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from services.ai.api.main import create_app
from services.ai.api.v1.generate_concepts import _run_generate_concepts_task
from services.ai.business.generate_concepts.handler import (
    HandlerError,
    handle_generate_concepts,
)
from services.ai.business.generate_concepts.models import GenerateConceptsRequest
from services.ai.business.generate_concepts.repository import RepositoryError
from services.ai.shared.budget_guard import BudgetExceeded


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
    """Mimics enough of postgrest's chain for our calls.

    Tracks:
        - ``inserts``: chapter_concepts INSERT payloads (P5 grade-as-string asserted on these)
        - ``ops``: ops_events INSERT payloads
    """

    def __init__(
        self,
        rag_chunks: list[dict[str, Any]] | None = None,
        existing_concepts: list[dict[str, Any]] | None = None,
        questions: list[dict[str, Any]] | None = None,
        diagrams: list[dict[str, Any]] | None = None,
        rag_rpc_chunks: list[str] | None = None,
    ) -> None:
        self._rag_chunks_rows = rag_chunks or []
        self._existing_concepts_rows = existing_concepts or []
        self._questions_rows = questions or []
        self._diagrams_rows = diagrams or []
        self._rag_rpc_chunks = rag_rpc_chunks or []
        self.inserts: list[Any] = []
        self.ops: list[dict[str, Any]] = []
        self._table: str | None = None
        self._mode: str | None = None
        self._payload: Any = None

    def table(self, name: str) -> _FakeDbClient:
        self._table = name
        self._mode = None
        self._payload = None
        return self

    def rpc(self, _name: str, _params: dict[str, Any]) -> _FakeDbClient:
        self._table = "_rpc"
        self._mode = "rpc"
        self._payload = None
        return self

    def select(self, *_args, **_kwargs) -> _FakeDbClient:
        self._mode = self._mode or "select"
        return self

    def eq(self, _k: str, _v: Any) -> _FakeDbClient:
        return self

    def gte(self, _k: str, _v: Any) -> _FakeDbClient:
        return self

    def lt(self, _k: str, _v: Any) -> _FakeDbClient:
        return self

    def or_(self, _expr: str) -> _FakeDbClient:
        return self

    def order(self, *_args, **_kwargs) -> _FakeDbClient:
        return self

    def limit(self, _n: int) -> _FakeDbClient:
        return self

    def insert(self, payload: Any) -> _FakeDbClient:
        self._mode = "insert"
        self._payload = payload
        return self

    async def execute(self) -> dict[str, Any]:
        table = self._table
        mode = self._mode
        payload = self._payload

        if mode == "insert" and payload is not None:
            if table == "chapter_concepts":
                self.inserts.append(payload)
            elif table == "ops_events":
                self.ops.append(payload)
            return {"data": [payload], "status_code": 201}

        if table == "_rpc":
            return {
                "data": [{"content": c} for c in self._rag_rpc_chunks],
                "status_code": 200,
            }

        if table == "rag_content_chunks":
            return {"data": list(self._rag_chunks_rows), "status_code": 200}
        if table == "chapter_concepts":
            return {"data": list(self._existing_concepts_rows), "status_code": 200}
        if table == "question_bank":
            return {"data": list(self._questions_rows), "status_code": 200}
        if table == "content_media":
            return {"data": list(self._diagrams_rows), "status_code": 200}
        if table == "mol_request_logs":
            return {"data": [], "status_code": 200}

        return {"data": [], "status_code": 200}


def _install_fake_db(
    monkeypatch: pytest.MonkeyPatch,
    fake: _FakeDbClient,
) -> _FakeDbClient:
    for target in [
        "services.ai.business.generate_concepts.repository.get_service_client",
        "services.ai.business.generate_concepts.ops_events.get_service_client",
        "services.ai.db.supabase.get_service_client",
    ]:
        monkeypatch.setattr(target, lambda f=fake: f)
    return fake


def _mock_openai_with_concepts(
    respx_mock: respx.MockRouter,
    *,
    n: int = 3,
) -> respx.Route:
    """Stub the OpenAI chat-completions endpoint with n valid concepts."""
    concepts = [
        {
            "title": f"Concept {i}",
            "learning_objective": "Define the thing.",
            "explanation": "It is a thing students should understand.",
            "example_title": "Example",
            "example_content": "Here is one worked example.",
            "difficulty": 2,
            "bloom_level": "understand",
            "common_mistakes": ["m1"],
            "key_formula": None,
        }
        for i in range(n)
    ]
    payload_text = json.dumps(concepts)
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-int",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": payload_text},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 300, "completion_tokens": 400},
            },
        )
    )


# ── Auth failures (still surface at the HTTP response, before scheduling) ────


def test_post_401_when_no_admin_key(client: TestClient):
    res = client.post(
        "/v1/generate-concepts",
        json={"grade": "10"},
    )
    assert res.status_code == 401
    body = res.json()
    assert body["detail"]["code"] == "AUTH_FAILED"


def test_post_401_when_wrong_admin_key(client: TestClient):
    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "wrong-key"},
        json={"grade": "10"},
    )
    assert res.status_code == 401


def test_post_503_when_admin_key_env_empty(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "anything"},
        json={},
    )
    assert res.status_code == 503


# ── Validation failures ─────────────────────────────────────────────────────


def test_post_422_when_extra_fields(client: TestClient):
    """REG-73: extra='forbid' on request envelope."""
    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": "10", "not_a_real_field": True},
    )
    assert res.status_code == 422


def test_post_422_when_grade_is_integer(client: TestClient):
    """P5: grade integer must be rejected at the wire layer."""
    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": 10},
    )
    assert res.status_code == 422


def test_post_empty_body_returns_2xx(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Async contract: empty body → 202 Accepted + queued envelope.

    The route schedules the work and returns immediately. The empty-batch
    result shape (success / total_found=0) is no longer in the response; it
    is verified at the work layer in ``test_task_empty_batch_does_no_work``.
    """
    fake = _FakeDbClient()  # No candidate chapters.
    _install_fake_db(monkeypatch, fake)
    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
        json={},
    )
    assert res.status_code == 202
    body = res.json()
    assert body["status"] == "queued"
    assert "request_id" in body
    assert isinstance(body["request_id"], str)


# ── Dry-run path ───────────────────────────────────────────────────────────


def test_post_dry_run_returns_202(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """dry_run=true POST still returns the async 202 + queued envelope.

    The dry-run preview list used to live in the HTTP response; under the
    async contract it is produced (and discarded) by the background task.
    The "previews only — no LLM call, no INSERT" guarantee is asserted at
    the work layer in ``test_task_dry_run_does_no_llm_call_or_insert``.
    """
    fake = _FakeDbClient(
        rag_chunks=[
            {
                "grade": "Grade 10",
                "subject": "Mathematics",
                "chapter_number": 1,
                "chapter_title": "Real Numbers",
            }
        ],
        existing_concepts=[],
    )
    _install_fake_db(monkeypatch, fake)
    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": "10", "subject": "math", "dry_run": True},
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["status"] == "queued"
    assert "request_id" in body


async def test_task_dry_run_does_no_llm_call_or_insert(
    monkeypatch: pytest.MonkeyPatch, respx_mock: respx.MockRouter
):
    """Background task on a dry_run request → previews only, no LLM, no INSERT.

    Relocated from the old POST result-shape assertion: the dry-run path
    must short-circuit before any LLM call and must not write any rows.
    """
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")
    openai_route = _mock_openai_with_concepts(respx_mock)
    fake = _FakeDbClient(
        rag_chunks=[
            {
                "grade": "Grade 10",
                "subject": "Mathematics",
                "chapter_number": 1,
                "chapter_title": "Real Numbers",
            }
        ],
        existing_concepts=[],
    )
    _install_fake_db(monkeypatch, fake)

    await _run_generate_concepts_task(
        GenerateConceptsRequest(grade="10", subject="math", dry_run=True),
        "test-admin-key",
        "rid-dry-run",
    )

    # Positive evidence the task actually ran (not silently swallowed):
    # the batch-started telemetry fires before the dry-run short-circuit.
    assert len(fake.ops) >= 1
    # Crucial: no LLM call, no INSERT on a dry run.
    assert openai_route.called is False
    assert fake.inserts == []


# ── Happy path ──────────────────────────────────────────────────────────────


def test_post_happy_path_returns_202(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Admin POST with candidate chapters → async 202 + queued envelope."""
    fake = _FakeDbClient(
        rag_chunks=[
            {
                "grade": "Grade 10",
                "subject": "Mathematics",
                "chapter_number": 1,
                "chapter_title": "Real Numbers",
            }
        ],
        existing_concepts=[],
    )
    _install_fake_db(monkeypatch, fake)
    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": "10", "subject": "math", "batch_size": 1},
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["status"] == "queued"
    assert "request_id" in body


async def test_task_happy_path_one_chapter_inserts_concepts(
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Background task: 1 chapter → MoL returns 3 concepts → INSERT happens.

    Relocated from the old POST result-shape assertion (success / processed
    / succeeded). The work is now verified by awaiting the real background
    task and asserting on the fake DB's recorded inserts + ops.
    """
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")
    _mock_openai_with_concepts(respx_mock)
    fake = _FakeDbClient(
        rag_chunks=[
            {
                "grade": "Grade 10",
                "subject": "Mathematics",
                "chapter_number": 1,
                "chapter_title": "Real Numbers",
            }
        ],
        existing_concepts=[],
        questions=[
            {
                "id": "q1",
                "question_text": "What is a rational number?",
                "options": None,
                "correct_answer_index": None,
                "explanation": None,
            }
        ],
        diagrams=[],
        rag_rpc_chunks=["chunk 1", "chunk 2", "chunk 3", "chunk 4"],
    )
    _install_fake_db(monkeypatch, fake)

    await _run_generate_concepts_task(
        GenerateConceptsRequest(grade="10", subject="math", batch_size=1),
        "test-admin-key",
        "rid-happy",
    )

    # Confirm INSERT carried 3 concepts to chapter_concepts.
    assert len(fake.inserts) == 1
    insert_rows = fake.inserts[0]
    assert isinstance(insert_rows, list)
    assert len(insert_rows) == 3
    # ops_events row(s) emitted for batch start + chapter success + batch complete.
    assert len(fake.ops) >= 2


def test_post_returns_grade_as_string_in_response_chapters(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    """REG-76 (POST half): the async POST returns 202 + queued envelope.

    The grade-as-string contract that this test name historically pinned is
    relocated onto the persisted insert rows in
    ``test_task_persisted_chapters_carry_grade_as_string`` — the row data the
    background task actually writes. The wire-level POST half just confirms
    the async contract.
    """
    fake = _FakeDbClient(
        rag_chunks=[
            {
                "grade": "Grade 10",
                "subject": "Mathematics",
                "chapter_number": 3,
                "chapter_title": "Pair of Linear Equations",
            }
        ],
        existing_concepts=[],
    )
    _install_fake_db(monkeypatch, fake)

    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": "10", "subject": "math", "dry_run": True},
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["status"] == "queued"


async def test_task_persisted_chapters_carry_grade_as_string(
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """REG-76: P5 — grade column on persisted insert rows MUST remain a string.

    Relocated from the now-swallowed response previews onto the rows the
    background task writes to ``chapter_concepts``. A regression where
    ConceptInsertRow accepted int grades would surface here as
    ``isinstance(grade, int)``. Grades must remain ``"6".."12"`` strings.
    """
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")
    _mock_openai_with_concepts(respx_mock)
    fake = _FakeDbClient(
        rag_chunks=[
            {
                "grade": "Grade 10",
                "subject": "Mathematics",
                "chapter_number": 3,
                "chapter_title": "Pair of Linear Equations",
            }
        ],
        existing_concepts=[],
        questions=[],
        diagrams=[],
        rag_rpc_chunks=["chunk 1", "chunk 2", "chunk 3", "chunk 4"],
    )
    _install_fake_db(monkeypatch, fake)

    await _run_generate_concepts_task(
        GenerateConceptsRequest(grade="10", subject="math", batch_size=1),
        "test-admin-key",
        "rid-reg76",
    )

    # The full (non-dry-run) pipeline ran → rows were written.
    assert len(fake.inserts) == 1
    insert_rows = fake.inserts[0]
    assert isinstance(insert_rows, list)
    assert insert_rows  # at least one row persisted
    for row in insert_rows:
        # P5: every grade field on the persisted row is a string "10".
        assert isinstance(row["grade"], str)
        assert row["grade"] == "10"


# ── Empty-batch path ───────────────────────────────────────────────────────


def test_post_empty_batch_returns_202(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """No candidate chapters → async POST still returns 202 + queued."""
    fake = _FakeDbClient(rag_chunks=[], existing_concepts=[])
    _install_fake_db(monkeypatch, fake)

    res = client.post(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
        json={"grade": "10"},
    )
    assert res.status_code == 202
    body = res.json()
    assert body["status"] == "queued"


async def test_task_empty_batch_does_no_work(
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Background task with no candidate chapters → no LLM call, no INSERT.

    Relocated from the old POST result-shape assertion (success / total_found
    == 0). Zero candidates means the empty-batch shortcut fires before any
    LLM call or write.
    """
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")
    openai_route = _mock_openai_with_concepts(respx_mock)
    fake = _FakeDbClient(rag_chunks=[], existing_concepts=[])
    _install_fake_db(monkeypatch, fake)

    await _run_generate_concepts_task(
        GenerateConceptsRequest(grade="10"),
        "test-admin-key",
        "rid-empty",
    )

    # Positive evidence the task actually ran (not silently swallowed):
    # the batch-started telemetry fires before the empty-batch short-circuit.
    assert len(fake.ops) >= 1
    assert openai_route.called is False
    assert fake.inserts == []


# ── GET status endpoint ────────────────────────────────────────────────────


def test_get_status_401_without_admin_key(client: TestClient):
    res = client.get("/v1/generate-concepts")
    assert res.status_code == 401


def test_get_status_returns_coverage_shape(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    """GET returns coverage stats with the expected envelope."""
    fake = _FakeDbClient(
        rag_chunks=[
            {"grade": "Grade 10", "subject": "Mathematics", "chapter_number": 1},
            {"grade": "Grade 10", "subject": "Mathematics", "chapter_number": 2},
            {"grade": "Grade 9", "subject": "Science", "chapter_number": 1},
        ],
        existing_concepts=[
            {"grade": "10", "subject": "math", "chapter_number": 1},
        ],
    )
    _install_fake_db(monkeypatch, fake)

    res = client.get(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_chapters"] == 3
    assert body["with_concepts"] == 1
    assert body["without_concepts"] == 2
    assert "coverage_percent" in body
    assert "breakdown" in body
    # The breakdown uses "Grade <n> - <subject>" keys.
    assert "Grade 10 - math" in body["breakdown"]


def test_get_status_503_when_admin_env_missing(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    res = client.get(
        "/v1/generate-concepts",
        headers={"x-admin-key": "anything"},
    )
    assert res.status_code == 503


# ── Exception mapping at the HANDLER layer (now inside the background task) ──


async def test_handler_raises_429_when_budget_exceeded(monkeypatch: pytest.MonkeyPatch):
    """Daily budget guard returning False → BudgetExceeded inside the handler.

    Under the async contract the budget cap is enforced inside the background
    task, not on the POST response. We therefore call the handler directly and
    assert it raises ``BudgetExceeded`` (the route maps this to HTTP 429 on the
    synchronous paths that still surface it). Mirrors the old
    ``test_post_429_when_budget_exceeded`` intent at the work layer.
    """
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")

    async def fake_check(**_):
        return False

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.handler.check_daily_budget",
        fake_check,
    )

    with pytest.raises(BudgetExceeded):
        await handle_generate_concepts(
            GenerateConceptsRequest(grade="10"),
            admin_key_header="test-admin-key",
            request_id="rid-budget",
        )


async def test_handler_raises_500_on_fetch_error(monkeypatch: pytest.MonkeyPatch):
    """RepositoryError from fetch → handler raises HandlerError(status=500).

    Under the async contract a DB read failure happens inside the background
    task, not on the POST response. We call the handler directly and assert it
    raises ``HandlerError`` with status 500 (the route maps this to HTTP 500 on
    the synchronous paths that still surface it). Mirrors the old
    ``test_post_500_on_handler_error`` intent at the work layer.
    """
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")

    async def fake_check(**_):
        return True

    async def fake_fetch(**_):
        raise RepositoryError("DB unreachable")

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.handler.check_daily_budget",
        fake_check,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_concepts.handler.fetch_chapters_without_concepts",
        fake_fetch,
    )

    with pytest.raises(HandlerError) as exc:
        await handle_generate_concepts(
            GenerateConceptsRequest(),
            admin_key_header="test-admin-key",
            request_id="rid-fetch-fail",
        )
    assert exc.value.status == 500


def test_get_500_on_handler_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    """GET path also surfaces HandlerError 500 (DB read failed in coverage overview)."""

    async def fake_overview():
        raise RepositoryError("coverage query failed")

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.handler.get_coverage_overview",
        fake_overview,
    )
    res = client.get(
        "/v1/generate-concepts",
        headers={"x-admin-key": "test-admin-key"},
    )
    assert res.status_code == 500
    body = res.json()
    assert body["detail"]["code"] == "HANDLER_ERROR"
