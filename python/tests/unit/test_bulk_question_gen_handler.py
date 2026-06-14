"""Tests for the handler.handle_bulk_question_gen composition function.

These cover the branches the integration test can't easily hit:
- Circuit breaker open/half-open transitions
- Oracle rejection path (mocked grader returns mismatch)
- Empty-candidates path
- Repository failure → HandlerError 500
- Unexpected exception → HandlerError 500
"""

from __future__ import annotations

import pytest

from services.ai.business.bulk_question_gen import handler as handler_mod
from services.ai.business.bulk_question_gen.generator import GenerationError
from services.ai.business.bulk_question_gen.handler import (
    CircuitOpen,
    HandlerError,
    handle_bulk_question_gen,
    reset_circuit_breaker,
)
from services.ai.business.bulk_question_gen.models import (
    BulkQuestionGenRequest,
    CandidateQuestion,
)
from services.ai.business.bulk_question_gen.oracle import OracleResult, clear_oracle_cache
from services.ai.business.bulk_question_gen.repository import RepositoryError


@pytest.fixture(autouse=True)
def _reset_state():
    reset_circuit_breaker()
    clear_oracle_cache()
    yield
    reset_circuit_breaker()
    clear_oracle_cache()


@pytest.fixture()
def _patch_admin_auth(monkeypatch: pytest.MonkeyPatch):
    """Bypass auth — every test in this file is about handler internals."""

    async def fake_verify(_header):
        return {"auth_user_id": "u", "admin_level": "admin"}

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.verify_admin",
        fake_verify,
    )


def _req(**overrides) -> BulkQuestionGenRequest:
    base = {
        "grade": "8",
        "subject": "science",
        "chapter": "Force",
        "count": 1,
        "difficulty": 3,
        "bloom_level": "remember",
    }
    base.update(overrides)
    return BulkQuestionGenRequest(**base)


def _candidate() -> CandidateQuestion:
    return CandidateQuestion(
        question_text="What is force?",
        options=["push or pull", "energy", "distance", "speed"],
        correct_answer_index=0,
        explanation="Force is a push or pull applied to an object.",
        hint="Think about what changes motion.",
        difficulty=3,
        bloom_level="remember",
    )


# ── Circuit breaker ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_opens_breaker_on_generation_failure(
    _patch_admin_auth, monkeypatch: pytest.MonkeyPatch
):
    """3 generation failures in a row → breaker opens; 4th call → CircuitOpen."""

    async def always_fail(req, *, request_id):
        del req, request_id
        raise GenerationError("simulated")

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.generate_candidates",
        always_fail,
    )

    for _ in range(3):
        with pytest.raises(HandlerError):
            await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
    # 4th call: breaker is open.
    with pytest.raises(CircuitOpen):
        await handle_bulk_question_gen(_req(), authorization_header="Bearer x")


@pytest.mark.asyncio
async def test_handler_closes_breaker_on_success(
    _patch_admin_auth, monkeypatch: pytest.MonkeyPatch
):
    """One generation success after the breaker is closed → state stays closed."""

    async def gen_one(req, *, request_id):
        del request_id
        return [_candidate()]

    async def grade_ok(_c):
        return OracleResult(ok=True, llm_calls=1)

    async def insert_ok(accepted, request):
        del accepted, request
        return []

    async def log_noop(**_):
        return None

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.generate_candidates", gen_one
    )
    monkeypatch.setattr("services.ai.business.bulk_question_gen.handler.grade_candidate", grade_ok)
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.insert_questions", insert_ok
    )
    monkeypatch.setattr("services.ai.business.bulk_question_gen.handler.log_ops_event", log_noop)

    res = await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
    assert res.generated == 1


# ── Empty / no-candidates path ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_empty_candidates_returns_zero(
    _patch_admin_auth, monkeypatch: pytest.MonkeyPatch
):
    async def empty(req, *, request_id):
        del req, request_id
        return []

    monkeypatch.setattr("services.ai.business.bulk_question_gen.handler.generate_candidates", empty)
    res = await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
    assert res.generated == 0
    assert res.inserted == 0
    assert res.questions == []
    assert res.warning


# ── Oracle rejection path ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_oracle_rejection_increments_counter(
    _patch_admin_auth, monkeypatch: pytest.MonkeyPatch
):
    async def gen_one(req, *, request_id):
        del request_id
        return [_candidate()]

    async def grade_reject(_c):
        return OracleResult(ok=False, category="llm_mismatch", reason="off", llm_calls=1)

    async def insert_ok(accepted, request):
        del accepted, request
        return []

    async def log_noop(**_):
        return None

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.generate_candidates", gen_one
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.grade_candidate", grade_reject
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.insert_questions", insert_ok
    )
    monkeypatch.setattr("services.ai.business.bulk_question_gen.handler.log_ops_event", log_noop)

    res = await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
    assert res.generated == 1
    assert res.oracle_evaluated == 1
    assert res.oracle_rejected == 1
    assert res.inserted == 0


# ── Repository failure ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_repository_failure_maps_to_500(
    _patch_admin_auth, monkeypatch: pytest.MonkeyPatch
):
    async def gen_one(req, *, request_id):
        del request_id
        return [_candidate()]

    async def grade_ok(_c):
        return OracleResult(ok=True, llm_calls=1)

    async def insert_fail(accepted, request):
        del accepted, request
        raise RepositoryError("simulated db crash")

    async def log_noop(**_):
        return None

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.generate_candidates", gen_one
    )
    monkeypatch.setattr("services.ai.business.bulk_question_gen.handler.grade_candidate", grade_ok)
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.insert_questions", insert_fail
    )
    monkeypatch.setattr("services.ai.business.bulk_question_gen.handler.log_ops_event", log_noop)

    with pytest.raises(HandlerError) as exc:
        await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
    assert exc.value.status == 500


# ── Bad-subject cross-check ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_bad_subject_for_grade(_patch_admin_auth):
    # 'physics' is not a valid CBSE grade-8 subject.
    with pytest.raises(HandlerError) as exc:
        await handle_bulk_question_gen(
            _req(subject="physics", grade="8"),
            authorization_header="Bearer x",
        )
    assert exc.value.status == 400


# ── Unexpected exception → 500 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handler_unexpected_exception_maps_to_500(
    _patch_admin_auth, monkeypatch: pytest.MonkeyPatch
):
    async def gen_explode(req, *, request_id):
        del req, request_id
        raise RuntimeError("unexpected internal error")

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.generate_candidates",
        gen_explode,
    )
    with pytest.raises(HandlerError) as exc:
        await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
    assert exc.value.status == 500


# ── Circuit breaker half-open recovery (timing-based) ──────────────────────


@pytest.mark.asyncio
async def test_handler_breaker_transitions_open_then_halfopen(
    _patch_admin_auth, monkeypatch: pytest.MonkeyPatch
):
    """Open after 3 failures, then time-fudged → half-open allows one probe."""

    async def always_fail(req, *, request_id):
        del req, request_id
        raise GenerationError("simulated")

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.handler.generate_candidates",
        always_fail,
    )
    for _ in range(3):
        with pytest.raises(HandlerError):
            await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
    # Now open. Confirm the next call returns CircuitOpen.
    with pytest.raises(CircuitOpen):
        await handle_bulk_question_gen(_req(), authorization_header="Bearer x")

    # Time-warp: rewind last_failure_at past the reset timeout. Access the
    # module-level breaker directly.
    breaker = handler_mod._breaker  # noqa: SLF001 — test-internal access
    breaker.last_failure_at = 0.0  # ancient history
    # Now half-open allows one probe; the probe fails → state stays open.
    with pytest.raises(HandlerError):
        await handle_bulk_question_gen(_req(), authorization_header="Bearer x")
