"""Tests for the question_bank repository helpers.

We patch :func:`services.ai.db.supabase.get_service_client` with a fake client
so no network or DB I/O happens.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.generate_answers.repository import (
    RepositoryError,
    count_active_questions,
    count_questions_with_answer,
    fetch_grade_subject_pairs,
    fetch_questions_without_answers,
    fetch_with_answer_pairs,
    update_question_answer,
)


class _FakeQuery:
    """Mimics enough of the postgrest builder for the repository's chains."""

    def __init__(self, response: dict[str, Any]) -> None:
        self._response = response

    def select(self, *_args, **_kwargs) -> _FakeQuery:
        return self

    def eq(self, _k: str, _v: Any) -> _FakeQuery:
        return self

    @property
    def not_(self) -> _FakeQuery:
        return self

    def is_(self, _k: str, _v: Any) -> _FakeQuery:
        return self

    def order(self, _col: str, *, desc=False) -> _FakeQuery:
        del desc
        return self

    def limit(self, _n: int) -> _FakeQuery:
        return self

    def update(self, _payload: dict[str, Any]) -> _FakeQuery:
        return self

    async def execute(self) -> dict[str, Any]:
        return self._response


class _FakeClient:
    def __init__(self, response: dict[str, Any]) -> None:
        self._response = response

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self._response)


def _install_client(monkeypatch: pytest.MonkeyPatch, response: dict[str, Any]):
    fake = _FakeClient(response)
    monkeypatch.setattr(
        "services.ai.business.generate_answers.repository.get_service_client",
        lambda: fake,
    )
    return fake


def _install_none(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "services.ai.business.generate_answers.repository.get_service_client",
        lambda: None,
    )


# ── fetch_questions_without_answers ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_returns_rows(monkeypatch: pytest.MonkeyPatch):
    rows = [{"id": "qb-1", "question_text": "Q1"}]
    _install_client(monkeypatch, {"data": rows, "status_code": 200})
    out = await fetch_questions_without_answers(grade="10", subject="science", limit=5)
    assert out == rows


@pytest.mark.asyncio
async def test_fetch_with_none_filters(monkeypatch: pytest.MonkeyPatch):
    _install_client(monkeypatch, {"data": [], "status_code": 200})
    out = await fetch_questions_without_answers(grade=None, subject=None, limit=20)
    assert out == []


@pytest.mark.asyncio
async def test_fetch_raises_repository_error_on_db_failure(
    monkeypatch: pytest.MonkeyPatch,
):
    class _ErrorClient:
        def table(self, _n):
            class _Q:
                def select(self, *a, **k):
                    return self

                def eq(self, *a, **k):
                    return self

                @property
                def not_(self):
                    return self

                def is_(self, *a, **k):
                    return self

                def order(self, *a, **k):
                    return self

                def limit(self, *a, **k):
                    return self

                async def execute(self):
                    raise RuntimeError("DB connection lost")

            return _Q()

    monkeypatch.setattr(
        "services.ai.business.generate_answers.repository.get_service_client",
        lambda: _ErrorClient(),
    )
    with pytest.raises(RepositoryError):
        await fetch_questions_without_answers(grade=None, subject=None, limit=10)


@pytest.mark.asyncio
async def test_fetch_raises_when_supabase_unconfigured(monkeypatch: pytest.MonkeyPatch):
    _install_none(monkeypatch)
    with pytest.raises(RepositoryError):
        await fetch_questions_without_answers(grade=None, subject=None, limit=10)


# ── update_question_answer ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_question_happy_path(monkeypatch: pytest.MonkeyPatch):
    _install_client(monkeypatch, {"data": [], "status_code": 204})
    # Should not raise.
    await update_question_answer(
        question_id="qb-1",
        answer_text="answer body that is long enough",
        answer_methodology="definition",
        marks_expected=2,
    )


@pytest.mark.asyncio
async def test_update_question_raises_when_supabase_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
):
    _install_none(monkeypatch)
    with pytest.raises(RepositoryError):
        await update_question_answer(
            question_id="qb-1",
            answer_text="x" * 100,
            answer_methodology="definition",
            marks_expected=2,
        )


@pytest.mark.asyncio
async def test_update_question_raises_on_db_failure(monkeypatch: pytest.MonkeyPatch):
    class _ErrorClient:
        def table(self, _n):
            class _Q:
                def update(self, _p):
                    return self

                def eq(self, *a, **k):
                    return self

                async def execute(self):
                    raise RuntimeError("DB write failed")

            return _Q()

    monkeypatch.setattr(
        "services.ai.business.generate_answers.repository.get_service_client",
        lambda: _ErrorClient(),
    )
    with pytest.raises(RepositoryError):
        await update_question_answer(
            question_id="qb-1",
            answer_text="x" * 100,
            answer_methodology="definition",
            marks_expected=2,
        )


# ── count_active_questions ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_count_active_returns_count(monkeypatch: pytest.MonkeyPatch):
    class _CountResp:
        def __init__(self):
            self.count = 42
            self.data = []

    class _Q:
        def select(self, *a, **k):
            return self

        def eq(self, *a, **k):
            return self

        async def execute(self):
            return _CountResp()

    class _Client:
        def table(self, _n):
            return _Q()

    monkeypatch.setattr(
        "services.ai.business.generate_answers.repository.get_service_client",
        lambda: _Client(),
    )
    n = await count_active_questions(grade="10")
    assert n == 42


@pytest.mark.asyncio
async def test_count_active_returns_zero_when_count_missing(
    monkeypatch: pytest.MonkeyPatch,
):
    _install_client(monkeypatch, {"data": []})  # no 'count' key
    n = await count_active_questions()
    assert n == 0


@pytest.mark.asyncio
async def test_count_active_raises_on_db_failure(monkeypatch: pytest.MonkeyPatch):
    class _Err:
        def table(self, _n):
            class _Q:
                def select(self, *a, **k):
                    return self

                def eq(self, *a, **k):
                    return self

                async def execute(self):
                    raise RuntimeError("boom")

            return _Q()

    monkeypatch.setattr(
        "services.ai.business.generate_answers.repository.get_service_client",
        lambda: _Err(),
    )
    with pytest.raises(RepositoryError):
        await count_active_questions()


# ── count_questions_with_answer ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_count_with_answer_returns_count(monkeypatch: pytest.MonkeyPatch):
    _install_client(monkeypatch, {"data": [], "count": 7})
    n = await count_questions_with_answer(grade="10", subject="science")
    assert n == 7


@pytest.mark.asyncio
async def test_count_with_answer_raises_when_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
):
    _install_none(monkeypatch)
    with pytest.raises(RepositoryError):
        await count_questions_with_answer()


# ── fetch_grade_subject_pairs ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_pairs_returns_rows(monkeypatch: pytest.MonkeyPatch):
    rows = [{"grade": "10", "subject": "science"}, {"grade": "9", "subject": "math"}]
    _install_client(monkeypatch, {"data": rows, "status_code": 200})
    out = await fetch_grade_subject_pairs()
    assert out == rows


@pytest.mark.asyncio
async def test_fetch_pairs_returns_empty_on_no_data(monkeypatch: pytest.MonkeyPatch):
    _install_client(monkeypatch, {"data": []})
    out = await fetch_grade_subject_pairs()
    assert out == []


@pytest.mark.asyncio
async def test_fetch_pairs_raises_on_db_failure(monkeypatch: pytest.MonkeyPatch):
    class _Err:
        def table(self, _n):
            class _Q:
                def select(self, *a, **k):
                    return self

                def eq(self, *a, **k):
                    return self

                async def execute(self):
                    raise RuntimeError("boom")

            return _Q()

    monkeypatch.setattr(
        "services.ai.business.generate_answers.repository.get_service_client",
        lambda: _Err(),
    )
    with pytest.raises(RepositoryError):
        await fetch_grade_subject_pairs()


# ── fetch_with_answer_pairs ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_with_answer_pairs_returns_rows(monkeypatch: pytest.MonkeyPatch):
    rows = [{"grade": "10", "subject": "science"}]
    _install_client(monkeypatch, {"data": rows})
    out = await fetch_with_answer_pairs()
    assert out == rows


@pytest.mark.asyncio
async def test_fetch_with_answer_pairs_raises_when_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
):
    _install_none(monkeypatch)
    with pytest.raises(RepositoryError):
        await fetch_with_answer_pairs()
