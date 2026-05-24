"""Tests for the oracle admission gate (temperature=0 Claude call).

We patch :class:`AnthropicProvider.call` so the test doesn't hit the network,
and we explicitly assert ``temperature=0`` and the cache behaviour.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.bulk_question_gen.models import CandidateQuestion
from services.ai.business.bulk_question_gen.oracle import (
    OracleResult,
    clear_oracle_cache,
    get_cached_result,
    grade_candidate,
    make_candidate_cache_key,
    parse_llm_grader_response,
    set_cached_result,
)
from services.ai.mol.types import ProviderResponse, TokenUsage


@pytest.fixture(autouse=True)
def _reset_oracle_cache():
    """Wipe the oracle cache between tests so we get deterministic call counts."""
    clear_oracle_cache()
    yield
    clear_oracle_cache()


def _candidate() -> CandidateQuestion:
    return CandidateQuestion(
        question_text="What is 2 + 2?",
        options=["3", "4", "5", "6"],
        correct_answer_index=1,
        explanation="2 + 2 = 4. Basic arithmetic.",
        hint="Count on your fingers.",
        difficulty=1,
        bloom_level="remember",
    )


def _provider_response(text: str) -> ProviderResponse:
    return ProviderResponse(
        text=text,
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        tokens=TokenUsage(prompt=200, completion=20),
        finish_reason="end_turn",
        raw=None,
    )


# ── Cache key & cache get/set ───────────────────────────────────────────────


def test_cache_key_is_stable_for_same_candidate():
    c1 = _candidate()
    c2 = _candidate()
    assert make_candidate_cache_key(c1) == make_candidate_cache_key(c2)


def test_cache_key_changes_when_options_change():
    c1 = _candidate()
    c2 = _candidate()
    c2 = CandidateQuestion(
        **{**c1.model_dump(), "options": ["1", "2", "3", "4"]},
    )
    assert make_candidate_cache_key(c1) != make_candidate_cache_key(c2)


def test_cache_get_returns_none_for_missing_key():
    assert get_cached_result("never-inserted") is None


def test_cache_get_set_roundtrip():
    r = OracleResult(ok=True, llm_calls=1)
    set_cached_result("k", r)
    assert get_cached_result("k") is r


# ── parse_llm_grader_response ───────────────────────────────────────────────


def test_parse_consistent_verdict():
    parsed = parse_llm_grader_response(
        '{"verdict":"consistent","reasoning":"Explanation matches option 1."}'
    )
    assert parsed is not None
    assert parsed.verdict == "consistent"
    assert parsed.reasoning == "Explanation matches option 1."


def test_parse_mismatch_with_suggested_index():
    parsed = parse_llm_grader_response(
        '{"verdict":"mismatch","reasoning":"R","suggested_correct_index":2}'
    )
    assert parsed is not None
    assert parsed.verdict == "mismatch"
    assert parsed.suggested_correct_index == 2


def test_parse_strips_markdown_fences():
    parsed = parse_llm_grader_response(
        '```json\n{"verdict":"ambiguous","reasoning":"unclear"}\n```'
    )
    assert parsed is not None
    assert parsed.verdict == "ambiguous"


def test_parse_returns_none_for_unparseable():
    assert parse_llm_grader_response("not json") is None


def test_parse_returns_none_for_invalid_verdict():
    assert parse_llm_grader_response('{"verdict":"yes"}') is None


def test_parse_clamps_out_of_range_suggested_index():
    """suggested_correct_index outside 0..3 is dropped (set to None)."""
    parsed = parse_llm_grader_response(
        '{"verdict":"mismatch","reasoning":"x","suggested_correct_index":99}'
    )
    assert parsed is not None
    assert parsed.suggested_correct_index is None


# ── grade_candidate — Anthropic call patched ────────────────────────────────


@pytest.mark.asyncio
async def test_grade_candidate_consistent_returns_ok(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_call(**kwargs):
        captured["kwargs"] = kwargs
        return _provider_response(
            '{"verdict":"consistent","reasoning":"matches"}'
        )

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.call",
        fake_call,
    )
    # Force is_configured to True regardless of env (the conftest already
    # sets a fake API key, but this is defensive).
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.is_configured",
        lambda: True,
    )

    result = await grade_candidate(_candidate())
    assert result.ok is True
    assert result.llm_calls == 1
    # ASSERTION: temperature=0 was passed.
    assert captured["kwargs"]["temperature"] == 0
    # ASSERTION: the model is claude-haiku-4-5.
    assert captured["kwargs"]["model"] == "claude-haiku-4-5-20251001"
    # ASSERTION: max_tokens is the small grader cap.
    assert captured["kwargs"]["max_tokens"] == 256


@pytest.mark.asyncio
async def test_grade_candidate_mismatch_returns_rejection(monkeypatch: pytest.MonkeyPatch):
    async def fake_call(**kwargs):
        del kwargs
        return _provider_response(
            '{"verdict":"mismatch","reasoning":"option 2 actually","suggested_correct_index":2}'
        )

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.call",
        fake_call,
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.is_configured",
        lambda: True,
    )

    result = await grade_candidate(_candidate())
    assert result.ok is False
    assert result.category == "llm_mismatch"
    assert result.suggested_correct_index == 2


@pytest.mark.asyncio
async def test_grade_candidate_ambiguous_returns_rejection(monkeypatch: pytest.MonkeyPatch):
    async def fake_call(**kwargs):
        del kwargs
        return _provider_response('{"verdict":"ambiguous","reasoning":"unclear"}')

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.call",
        fake_call,
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.is_configured",
        lambda: True,
    )

    result = await grade_candidate(_candidate())
    assert result.ok is False
    assert result.category == "llm_ambiguous"


@pytest.mark.asyncio
async def test_grade_candidate_caches_repeat_calls(monkeypatch: pytest.MonkeyPatch):
    """Same candidate twice → second call is a cache hit; provider called once."""
    call_count = {"n": 0}

    async def fake_call(**kwargs):
        del kwargs
        call_count["n"] += 1
        return _provider_response('{"verdict":"consistent","reasoning":"x"}')

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.call",
        fake_call,
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.is_configured",
        lambda: True,
    )

    r1 = await grade_candidate(_candidate())
    r2 = await grade_candidate(_candidate())
    assert r1.ok is True
    assert r2.ok is True
    assert call_count["n"] == 1, "second call should hit the cache"


@pytest.mark.asyncio
async def test_grade_candidate_fail_closed_on_network_error(monkeypatch: pytest.MonkeyPatch):
    """Provider throws → llm_grader_unavailable, NOT cached."""

    async def fake_call(**kwargs):
        del kwargs
        raise RuntimeError("network down")

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.call",
        fake_call,
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.is_configured",
        lambda: True,
    )

    r1 = await grade_candidate(_candidate())
    assert r1.ok is False
    assert r1.category == "llm_grader_unavailable"

    # Cache MUST be empty so retries can re-try the network.
    assert get_cached_result(make_candidate_cache_key(_candidate())) is None


@pytest.mark.asyncio
async def test_grade_candidate_when_provider_not_configured(monkeypatch: pytest.MonkeyPatch):
    """No API key → returns llm_grader_unavailable with llm_calls=0."""
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.is_configured",
        lambda: False,
    )
    result = await grade_candidate(_candidate())
    assert result.ok is False
    assert result.category == "llm_grader_unavailable"
    assert result.llm_calls == 0


@pytest.mark.asyncio
async def test_grade_candidate_unparseable_response(monkeypatch: pytest.MonkeyPatch):
    async def fake_call(**kwargs):
        del kwargs
        return _provider_response("not json at all")

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.call",
        fake_call,
    )
    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.oracle._anthropic.is_configured",
        lambda: True,
    )

    result = await grade_candidate(_candidate())
    assert result.ok is False
    assert result.category == "llm_ambiguous"
