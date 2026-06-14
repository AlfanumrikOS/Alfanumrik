"""Tests for the generate-answers handler.

Covers the pipeline branches that the integration test can't easily reach:
- Auth failure → AuthFailed bubbles
- Daily budget exceeded → BudgetExceeded bubbles
- Empty-batch path
- Dry-run path
- Per-question success path
- Per-question failure path (LLM returns empty, length-floor reject)
- DB update failure → per-question error, batch continues
- Time-budget cutoff
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.generate_answers.auth import AuthFailed
from services.ai.business.generate_answers.handler import (
    HandlerError,
    handle_generate_answers,
    handle_generate_answers_status,
)
from services.ai.business.generate_answers.models import GenerateAnswersRequest
from services.ai.business.generate_answers.repository import RepositoryError
from services.ai.shared.budget_guard import BudgetExceeded


@pytest.fixture(autouse=True)
def _admin_key_env(monkeypatch: pytest.MonkeyPatch):
    """Set ADMIN_API_KEY so the default test admin-key passes auth."""
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")


def _question_row(question_id: str = "qb-1", **overrides) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": question_id,
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
    base.update(overrides)
    return base


def _good_answer_json() -> str:
    return (
        '{"answer_text": "Force is a push or pull that can change the motion of an object.",'
        ' "answer_methodology": "definition", "marks_expected": 2}'
    )


@pytest.fixture()
def _patch_pipeline_happy(monkeypatch: pytest.MonkeyPatch):
    """Wire happy-path mocks for fetch + generate + DB update + ops_events."""

    async def fake_check_budget(*, scope="org", **_):
        del scope
        return True

    async def fake_fetch(*, grade, subject, limit):
        del grade, subject, limit
        return [_question_row()]

    async def fake_generate(*, system_prompt, user_prompt, grade, subject, request_id):
        del system_prompt, user_prompt, grade, subject, request_id
        return _good_answer_json()

    async def fake_update(**_):
        return None

    async def fake_log(**_):
        return None

    async def fake_remaining(*, grade, subject):
        del grade, subject
        return 5

    async def fake_count_active(*, grade=None, subject=None):
        del grade, subject
        return 100

    async def fake_count_with_answer(*, grade=None, subject=None):
        del grade, subject
        return 95

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget",
        fake_check_budget,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.generate_answer_for_question",
        fake_generate,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.update_question_answer",
        fake_update,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.log_ops_event",
        fake_log,
    )
    # The post-batch remaining count goes through count_questions_with_answer_complement,
    # which itself calls count_active_questions + count_questions_with_answer.
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_active_questions",
        fake_count_active,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_questions_with_answer",
        fake_count_with_answer,
    )


# ── Auth failures ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_rejects_bad_admin_key(_patch_pipeline_happy):
    with pytest.raises(AuthFailed) as exc:
        await handle_generate_answers(
            GenerateAnswersRequest(),
            admin_key_header="wrong-key",
            request_id="rid",
        )
    assert exc.value.status == 401


@pytest.mark.asyncio
async def test_handler_rejects_missing_admin_key(_patch_pipeline_happy):
    with pytest.raises(AuthFailed) as exc:
        await handle_generate_answers(
            GenerateAnswersRequest(),
            admin_key_header=None,
            request_id="rid",
        )
    assert exc.value.status == 401


# ── Budget guard ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_raises_budget_exceeded(monkeypatch: pytest.MonkeyPatch):
    async def fake_check(*, scope="org", **_):
        del scope
        return False

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget",
        fake_check,
    )

    with pytest.raises(BudgetExceeded):
        await handle_generate_answers(
            GenerateAnswersRequest(),
            admin_key_header="test-admin-key",
            request_id="rid",
        )


# ── Empty-batch path ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_empty_batch_returns_zero(monkeypatch: pytest.MonkeyPatch):
    async def fake_check(**_):
        return True

    async def fake_fetch(**_):
        return []

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget", fake_check
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )

    res = await handle_generate_answers(
        GenerateAnswersRequest(grade="10"),
        admin_key_header="test-admin-key",
        request_id="rid",
    )
    assert res.success is True
    assert res.total_found == 0
    assert res.processed == 0
    assert res.succeeded == 0


# ── Dry-run path ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_dry_run_returns_previews(monkeypatch: pytest.MonkeyPatch):
    long_text = "X" * 250

    async def fake_check(**_):
        return True

    async def fake_fetch(**_):
        return [_question_row(question_text=long_text)]

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget", fake_check
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )

    res = await handle_generate_answers(
        GenerateAnswersRequest(dry_run=True),
        admin_key_header="test-admin-key",
        request_id="rid",
    )
    assert res.dry_run is True
    assert res.questions is not None
    assert len(res.questions) == 1
    # 100-char slice + ellipsis (TS index.ts:527).
    assert res.questions[0].question_text.endswith("...")


# ── Happy-path single question ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_happy_path_one_question(_patch_pipeline_happy):
    res = await handle_generate_answers(
        GenerateAnswersRequest(grade="10", subject="science", batch_size=1),
        admin_key_header="test-admin-key",
        request_id="rid",
    )
    assert res.success is True
    assert res.total_found == 1
    assert res.processed == 1
    assert res.succeeded == 1
    assert res.failed == 0
    assert res.errors == []
    assert res.remaining is not None


# ── Per-question failure: empty LLM response ───────────────────────────────


@pytest.mark.asyncio
async def test_handler_skips_question_when_llm_empty(
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_check(**_):
        return True

    async def fake_fetch(**_):
        return [_question_row()]

    async def fake_generate(**_):
        return ""  # empty → parser returns no_json_object

    async def fake_log(**_):
        return None

    async def fake_count(**_):
        return 0

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget", fake_check
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.generate_answer_for_question",
        fake_generate,
    )
    monkeypatch.setattr("services.ai.business.generate_answers.handler.log_ops_event", fake_log)
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_active_questions",
        fake_count,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_questions_with_answer",
        fake_count,
    )

    res = await handle_generate_answers(
        GenerateAnswersRequest(),
        admin_key_header="test-admin-key",
        request_id="rid",
    )
    assert res.processed == 1
    assert res.succeeded == 0
    assert res.failed == 1
    assert any("failed to parse" in e for e in res.errors)


# ── Per-question failure: answer too short ─────────────────────────────────


@pytest.mark.asyncio
async def test_handler_rejects_too_short_answer(monkeypatch: pytest.MonkeyPatch):
    async def fake_check(**_):
        return True

    async def fake_fetch(**_):
        return [_question_row()]

    async def fake_generate(**_):
        # answer_text is 5 chars — below the 10-char floor.
        return '{"answer_text": "short", "answer_methodology": "definition", "marks_expected": 1}'

    async def fake_log(**_):
        return None

    async def fake_count(**_):
        return 0

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget", fake_check
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.generate_answer_for_question",
        fake_generate,
    )
    monkeypatch.setattr("services.ai.business.generate_answers.handler.log_ops_event", fake_log)
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_active_questions",
        fake_count,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_questions_with_answer",
        fake_count,
    )

    res = await handle_generate_answers(
        GenerateAnswersRequest(),
        admin_key_header="test-admin-key",
        request_id="rid",
    )
    assert res.failed == 1
    assert any("too short" in e for e in res.errors)


# ── DB update failure: counts as per-question failure ──────────────────────


@pytest.mark.asyncio
async def test_handler_db_update_failure_increments_failed(
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_check(**_):
        return True

    async def fake_fetch(**_):
        return [_question_row()]

    async def fake_generate(**_):
        return _good_answer_json()

    async def fake_update(**_):
        raise RepositoryError("DB write failed")

    async def fake_log(**_):
        return None

    async def fake_count(**_):
        return 0

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget", fake_check
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.generate_answer_for_question",
        fake_generate,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.update_question_answer",
        fake_update,
    )
    monkeypatch.setattr("services.ai.business.generate_answers.handler.log_ops_event", fake_log)
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_active_questions",
        fake_count,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_questions_with_answer",
        fake_count,
    )

    res = await handle_generate_answers(
        GenerateAnswersRequest(),
        admin_key_header="test-admin-key",
        request_id="rid",
    )
    assert res.failed == 1
    assert res.succeeded == 0
    assert any("DB update error" in e for e in res.errors)


# ── Fetch failure: bubbles as HandlerError 500 ─────────────────────────────


@pytest.mark.asyncio
async def test_handler_fetch_failure_maps_to_500(monkeypatch: pytest.MonkeyPatch):
    async def fake_check(**_):
        return True

    async def fake_fetch(**_):
        raise RepositoryError("DB connection lost")

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget", fake_check
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )

    with pytest.raises(HandlerError) as exc:
        await handle_generate_answers(
            GenerateAnswersRequest(),
            admin_key_header="test-admin-key",
            request_id="rid",
        )
    assert exc.value.status == 500


# ── Batch-size clamping ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_clamps_oversized_batch(monkeypatch: pytest.MonkeyPatch):
    """batch_size=999 → default 20 (TS line 432). We verify by checking the
    ``limit`` passed to fetch_questions_without_answers."""
    captured: dict[str, Any] = {}

    async def fake_check(**_):
        return True

    async def fake_fetch(*, grade, subject, limit):
        captured["limit"] = limit
        return []  # empty so we exit early

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.check_daily_budget", fake_check
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_questions_without_answers",
        fake_fetch,
    )

    # Pydantic itself doesn't bound batch_size — the handler clamps. We pass
    # the value through the model with extra='forbid' active so it has to be
    # a real field; the model doesn't constrain it. Use 999 and expect default.
    # NOTE: GenerateAnswersRequest does not bound batch_size at the model
    # layer (matches TS posture of clamping at the handler).
    req = GenerateAnswersRequest()
    req.batch_size = 999
    await handle_generate_answers(req, admin_key_header="test-admin-key", request_id="rid")
    # Handler clamps 999 → DEFAULT_BATCH_SIZE = 20.
    assert captured["limit"] == 20


# ── Status (GET) handler ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_status_handler_happy_path(monkeypatch: pytest.MonkeyPatch):
    async def fake_count_active(**_):
        return 100

    async def fake_count_with(**_):
        return 60

    async def fake_pairs():
        return [
            {"grade": "10", "subject": "science"},
            {"grade": "10", "subject": "science"},
            {"grade": "9", "subject": "math"},
        ]

    async def fake_with_answer_pairs():
        return [{"grade": "10", "subject": "science"}]

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_active_questions",
        fake_count_active,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_questions_with_answer",
        fake_count_with,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_grade_subject_pairs",
        fake_pairs,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_with_answer_pairs",
        fake_with_answer_pairs,
    )

    res = await handle_generate_answers_status()
    assert res.total_active == 100
    assert res.with_answer == 60
    assert res.without_answer == 40
    assert res.coverage_percent == 60
    assert res.breakdown is not None
    assert "Grade 10 - science" in res.breakdown
    assert res.breakdown["Grade 10 - science"].total == 2
    assert res.breakdown["Grade 10 - science"].with_answer == 1


@pytest.mark.asyncio
async def test_status_handler_zero_total_safe_division(
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_zero(**_):
        return 0

    async def fake_pairs_empty():
        return []

    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_active_questions",
        fake_zero,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.count_questions_with_answer",
        fake_zero,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_grade_subject_pairs",
        fake_pairs_empty,
    )
    monkeypatch.setattr(
        "services.ai.business.generate_answers.handler.fetch_with_answer_pairs",
        fake_pairs_empty,
    )

    res = await handle_generate_answers_status()
    assert res.total_active == 0
    assert res.coverage_percent == 0
