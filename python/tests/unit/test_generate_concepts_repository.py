"""Tests for the generate-concepts repository helpers.

Mocks :func:`services.ai.db.supabase.get_service_client` with a fake
client so no network or DB I/O happens.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.generate_concepts.repository import (
    RepositoryError,
    fetch_chapter_questions,
    fetch_chapters_without_concepts,
    fetch_diagram_refs,
    fetch_rag_chunks,
    get_coverage_overview,
    insert_chapter_concepts,
)


class _FakeQuery:
    """Mimics enough of postgrest's chained builder for our calls."""

    def __init__(self, response: dict[str, Any] | None = None) -> None:
        self._response = response or {"data": [], "status_code": 200}
        self._pending_payload: dict[str, Any] | list[Any] | None = None

    def select(self, *_args, **_kwargs) -> _FakeQuery:
        return self

    def eq(self, _k: str, _v: Any) -> _FakeQuery:
        return self

    def or_(self, _expr: str) -> _FakeQuery:
        return self

    def order(self, _col: str, *, desc=False) -> _FakeQuery:
        del desc
        return self

    def limit(self, _n: int) -> _FakeQuery:
        return self

    def insert(self, payload: list[Any] | dict[str, Any]) -> _FakeQuery:
        self._pending_payload = payload
        return self

    async def execute(self) -> dict[str, Any]:
        return self._response


class _FakeClient:
    """Minimal client surface — table() and rpc()."""

    def __init__(
        self,
        table_responses: dict[str, dict[str, Any]] | None = None,
        rpc_response: dict[str, Any] | None = None,
    ) -> None:
        self._table_responses = table_responses or {}
        self._rpc_response = rpc_response or {"data": [], "status_code": 200}
        self.inserts: dict[str, list[Any]] = {}

    def table(self, name: str) -> _FakeQuery:
        resp = self._table_responses.get(name, {"data": [], "status_code": 200})
        q = _FakeQuery(resp)
        # We capture the insert payload via a sentinel — see test below.
        original_insert = q.insert

        def wrapped_insert(payload):
            self.inserts.setdefault(name, []).append(payload)
            return original_insert(payload)

        q.insert = wrapped_insert  # type: ignore[method-assign]
        return q

    def rpc(self, _name: str, _params: dict[str, Any]) -> _FakeQuery:
        return _FakeQuery(self._rpc_response)


def _install(monkeypatch: pytest.MonkeyPatch, client: Any) -> Any:
    monkeypatch.setattr(
        "services.ai.business.generate_concepts.repository.get_service_client",
        lambda: client,
    )
    return client


# ── fetch_chapters_without_concepts ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_chapters_returns_missing_ones(monkeypatch: pytest.MonkeyPatch):
    """Two chapters in rag_content_chunks, one already has concepts → 1 missing."""
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {
                "data": [
                    {
                        "grade": "Grade 10",
                        "subject": "Mathematics",
                        "chapter_number": 1,
                        "chapter_title": "Real Numbers",
                    },
                    {
                        "grade": "Grade 10",
                        "subject": "Mathematics",
                        "chapter_number": 2,
                        "chapter_title": "Polynomials",
                    },
                ],
            },
            "chapter_concepts": {
                "data": [
                    {"grade": "10", "subject": "math", "chapter_number": 1},
                ],
            },
        }
    )
    _install(monkeypatch, client)
    out = await fetch_chapters_without_concepts(
        grade=None, subject=None, limit=10
    )
    assert len(out) == 1
    assert out[0].chapter_number == 2
    # Both raw and normalized fields populated correctly.
    assert out[0].rag_grade == "Grade 10"
    assert out[0].grade == "10"
    assert out[0].subject == "math"


@pytest.mark.asyncio
async def test_fetch_chapters_empty_returns_empty_list(monkeypatch: pytest.MonkeyPatch):
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {"data": []},
            "chapter_concepts": {"data": []},
        }
    )
    _install(monkeypatch, client)
    out = await fetch_chapters_without_concepts(
        grade=None, subject=None, limit=5
    )
    assert out == []


@pytest.mark.asyncio
async def test_fetch_chapters_limits_result_count(monkeypatch: pytest.MonkeyPatch):
    """Even if 3 chapters are missing, limit=1 returns only 1."""
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {
                "data": [
                    {
                        "grade": "Grade 10",
                        "subject": "Mathematics",
                        "chapter_number": i,
                        "chapter_title": f"Ch {i}",
                    }
                    for i in range(1, 4)
                ],
            },
            "chapter_concepts": {"data": []},
        }
    )
    _install(monkeypatch, client)
    out = await fetch_chapters_without_concepts(
        grade=None, subject=None, limit=1
    )
    assert len(out) == 1


@pytest.mark.asyncio
async def test_fetch_chapters_with_filters_applied(monkeypatch: pytest.MonkeyPatch):
    """grade + subject filters don't crash the chain (we don't assert on the
    .or_() string contents — that's a postgrest implementation detail). The
    test confirms the code path that builds the filter is reached."""
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {
                "data": [
                    {
                        "grade": "Grade 10",
                        "subject": "Mathematics",
                        "chapter_number": 1,
                        "chapter_title": "C1",
                    }
                ],
            },
            "chapter_concepts": {"data": []},
        }
    )
    _install(monkeypatch, client)
    out = await fetch_chapters_without_concepts(
        grade="10", subject="math", limit=5
    )
    assert len(out) == 1


@pytest.mark.asyncio
async def test_fetch_chapters_raises_when_client_none(monkeypatch: pytest.MonkeyPatch):
    _install(monkeypatch, None)
    with pytest.raises(RepositoryError):
        await fetch_chapters_without_concepts(
            grade=None, subject=None, limit=5
        )


@pytest.mark.asyncio
async def test_fetch_chapters_skips_malformed_rows(monkeypatch: pytest.MonkeyPatch):
    """Rows missing required fields are skipped silently (TS-side parity)."""
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {
                "data": [
                    # Good row.
                    {
                        "grade": "Grade 10",
                        "subject": "Mathematics",
                        "chapter_number": 1,
                        "chapter_title": "OK",
                    },
                    # Bad: missing chapter_number.
                    {"grade": "Grade 10", "subject": "Mathematics"},
                    # Bad: chapter_number is string.
                    {
                        "grade": "Grade 10",
                        "subject": "Mathematics",
                        "chapter_number": "two",
                    },
                ],
            },
            "chapter_concepts": {"data": []},
        }
    )
    _install(monkeypatch, client)
    out = await fetch_chapters_without_concepts(
        grade=None, subject=None, limit=10
    )
    # Only 1 good row survives.
    assert len(out) == 1
    assert out[0].chapter_number == 1


@pytest.mark.asyncio
async def test_fetch_chapters_negative_limit_clamped_to_zero(
    monkeypatch: pytest.MonkeyPatch,
):
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {
                "data": [
                    {
                        "grade": "Grade 10",
                        "subject": "Mathematics",
                        "chapter_number": 1,
                        "chapter_title": "C1",
                    }
                ],
            },
            "chapter_concepts": {"data": []},
        }
    )
    _install(monkeypatch, client)
    out = await fetch_chapters_without_concepts(
        grade=None, subject=None, limit=-5
    )
    assert out == []


# ── fetch_rag_chunks ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_content_list(
    monkeypatch: pytest.MonkeyPatch,
):
    client = _FakeClient(
        rpc_response={
            "data": [
                {"content": "First chunk"},
                {"content": "Second chunk"},
                {"content": ""},  # filtered out
            ]
        }
    )
    _install(monkeypatch, client)
    out = await fetch_rag_chunks(
        rag_grade="Grade 10", rag_subject="Mathematics", chapter_number=1
    )
    assert out == ["First chunk", "Second chunk"]


@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_single_string(
    monkeypatch: pytest.MonkeyPatch,
):
    """RPC returning a single string (not a list) → wrapped in a list."""
    client = _FakeClient(rpc_response={"data": "all content here"})
    _install(monkeypatch, client)
    out = await fetch_rag_chunks(
        rag_grade="Grade 10", rag_subject="Mathematics", chapter_number=1
    )
    assert out == ["all content here"]


@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_empty_on_no_data(
    monkeypatch: pytest.MonkeyPatch,
):
    client = _FakeClient(rpc_response={"data": None})
    _install(monkeypatch, client)
    out = await fetch_rag_chunks(
        rag_grade="Grade 10", rag_subject="Mathematics", chapter_number=1
    )
    assert out == []


@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_empty_when_client_none(
    monkeypatch: pytest.MonkeyPatch,
):
    _install(monkeypatch, None)
    out = await fetch_rag_chunks(
        rag_grade="Grade 10", rag_subject="Mathematics", chapter_number=1
    )
    assert out == []


@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_empty_on_rpc_error(
    monkeypatch: pytest.MonkeyPatch,
):
    class _ErrorClient:
        def rpc(self, *_a, **_k):
            class _Q:
                async def execute(self):
                    raise RuntimeError("RPC failed")

            return _Q()

    _install(monkeypatch, _ErrorClient())
    out = await fetch_rag_chunks(
        rag_grade="Grade 10", rag_subject="Mathematics", chapter_number=1
    )
    assert out == []


# ── fetch_chapter_questions ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_chapter_questions_returns_rows(monkeypatch: pytest.MonkeyPatch):
    rows = [
        {
            "id": "q1",
            "question_text": "Q?",
            "options": ["A", "B", "C", "D"],
            "correct_answer_index": 0,
            "explanation": "...",
        }
    ]
    client = _FakeClient(table_responses={"question_bank": {"data": rows}})
    _install(monkeypatch, client)
    out = await fetch_chapter_questions(
        grade="10", subject="math", chapter_number=1
    )
    assert out == rows


@pytest.mark.asyncio
async def test_fetch_chapter_questions_returns_empty_when_client_none(
    monkeypatch: pytest.MonkeyPatch,
):
    _install(monkeypatch, None)
    out = await fetch_chapter_questions(
        grade="10", subject="math", chapter_number=1
    )
    assert out == []


# ── fetch_diagram_refs ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_diagram_refs_returns_rows(monkeypatch: pytest.MonkeyPatch):
    rows = [{"media_type": "image", "caption": "Diagram 1", "url": "https://x"}]
    client = _FakeClient(table_responses={"content_media": {"data": rows}})
    _install(monkeypatch, client)
    out = await fetch_diagram_refs(
        grade="10", subject="math", chapter_number=1
    )
    assert out == rows


@pytest.mark.asyncio
async def test_fetch_diagram_refs_returns_empty_when_client_none(
    monkeypatch: pytest.MonkeyPatch,
):
    _install(monkeypatch, None)
    out = await fetch_diagram_refs(
        grade="10", subject="math", chapter_number=1
    )
    assert out == []


# ── insert_chapter_concepts ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_insert_chapter_concepts_happy_path(monkeypatch: pytest.MonkeyPatch):
    client = _FakeClient(
        table_responses={"chapter_concepts": {"data": [], "status_code": 201}}
    )
    _install(monkeypatch, client)
    ok, err = await insert_chapter_concepts(
        [{"grade": "10", "title": "X"}]
    )
    assert ok is True
    assert err is None
    # Confirm the insert payload reached the fake client.
    assert len(client.inserts.get("chapter_concepts", [])) == 1


@pytest.mark.asyncio
async def test_insert_chapter_concepts_empty_list_returns_success(
    monkeypatch: pytest.MonkeyPatch,
):
    client = _FakeClient()
    _install(monkeypatch, client)
    ok, err = await insert_chapter_concepts([])
    assert ok is True
    assert err is None


@pytest.mark.asyncio
async def test_insert_chapter_concepts_returns_error_when_client_none(
    monkeypatch: pytest.MonkeyPatch,
):
    _install(monkeypatch, None)
    ok, err = await insert_chapter_concepts(
        [{"grade": "10", "title": "X"}]
    )
    assert ok is False
    assert err is not None


@pytest.mark.asyncio
async def test_insert_chapter_concepts_returns_error_on_db_failure(
    monkeypatch: pytest.MonkeyPatch,
):
    class _ErrorClient:
        def table(self, _n):
            class _Q:
                def insert(self, _p):
                    return self

                async def execute(self):
                    raise RuntimeError("DB write failed")

            return _Q()

    _install(monkeypatch, _ErrorClient())
    ok, err = await insert_chapter_concepts(
        [{"grade": "10", "title": "X"}]
    )
    assert ok is False
    assert "DB write failed" in (err or "")


# ── get_coverage_overview ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_coverage_overview_happy_path(monkeypatch: pytest.MonkeyPatch):
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {
                "data": [
                    {"grade": "Grade 10", "subject": "Mathematics", "chapter_number": 1},
                    {"grade": "Grade 10", "subject": "Mathematics", "chapter_number": 1},
                    {"grade": "Grade 10", "subject": "Mathematics", "chapter_number": 2},
                    {"grade": "Grade 9", "subject": "Science", "chapter_number": 1},
                ],
            },
            "chapter_concepts": {
                "data": [
                    {"grade": "10", "subject": "math", "chapter_number": 1},
                ],
            },
        }
    )
    _install(monkeypatch, client)
    out = await get_coverage_overview()
    # 3 distinct chapters; 1 with concepts.
    assert out.total_chapters == 3
    assert out.with_concepts == 1
    assert out.without_concepts == 2
    assert out.coverage_percent == round((1 / 3) * 100)
    # Breakdown buckets exist.
    assert "Grade 10 - math" in out.breakdown
    assert out.breakdown["Grade 10 - math"].total == 2
    assert out.breakdown["Grade 10 - math"].with_concepts == 1


@pytest.mark.asyncio
async def test_get_coverage_overview_zero_chapters(monkeypatch: pytest.MonkeyPatch):
    client = _FakeClient(
        table_responses={
            "rag_content_chunks": {"data": []},
            "chapter_concepts": {"data": []},
        }
    )
    _install(monkeypatch, client)
    out = await get_coverage_overview()
    assert out.total_chapters == 0
    assert out.coverage_percent == 0
    assert out.breakdown == {}


@pytest.mark.asyncio
async def test_get_coverage_overview_raises_when_client_none(
    monkeypatch: pytest.MonkeyPatch,
):
    _install(monkeypatch, None)
    with pytest.raises(RepositoryError):
        await get_coverage_overview()


@pytest.mark.asyncio
async def test_get_coverage_overview_raises_on_chunk_query_failure(
    monkeypatch: pytest.MonkeyPatch,
):
    class _ErrorClient:
        def table(self, _n):
            class _Q:
                def select(self, *a, **k):
                    return self

                def limit(self, *a, **k):
                    return self

                async def execute(self):
                    raise RuntimeError("chunk read failed")

            return _Q()

    _install(monkeypatch, _ErrorClient())
    with pytest.raises(RepositoryError):
        await get_coverage_overview()
