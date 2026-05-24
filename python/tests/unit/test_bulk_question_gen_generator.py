"""Tests for the MoL-routed MCQ generator.

We mock :func:`services.ai.business.bulk_question_gen.generator.generate_response`
so the generator's behaviour is exercised without touching the network.
The MoL framework itself is tested independently in tests/unit/test_router.py.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from services.ai.business.bulk_question_gen.generator import (
    GenerationError,
    generate_candidates,
)
from services.ai.business.bulk_question_gen.models import BulkQuestionGenRequest
from services.ai.mol.errors import MolError
from services.ai.mol.types import MolResult, TokenUsage


def _request(**overrides) -> BulkQuestionGenRequest:
    base = {
        "grade": "8",
        "subject": "science",
        "chapter": "Force and Pressure",
        "count": 2,
        "difficulty": 3,
        "bloom_level": "remember",
    }
    base.update(overrides)
    return BulkQuestionGenRequest(**base)


def _mol_result(text: str) -> MolResult:
    """Build a minimal MolResult — only ``text`` is read by the generator."""
    return MolResult(
        text=text,
        provider="openai",
        model="gpt-4o-mini",
        task_type="quiz_generation",
        latency_ms=42,
        tokens=TokenUsage(prompt=100, completion=200),
        usd_cost=1.35e-5,
        inr_cost=0.0011,
        fallback_count=0,
        passes=1,
        request_id="rid-test",
        failure_chain=[],
    )


def _valid_questions_json(count: int = 2) -> str:
    items: list[dict[str, Any]] = []
    for i in range(count):
        items.append(
            {
                "question_text": f"What is question {i}?",
                "options": [f"opt-{i}-a", f"opt-{i}-b", f"opt-{i}-c", f"opt-{i}-d"],
                "correct_answer_index": 0,
                "explanation": f"Because answer {i} is correct.",
                "hint": f"Think about {i}.",
                "difficulty": 3,
                "bloom_level": "remember",
            }
        )
    return json.dumps(items)


# ── Happy path ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generator_parses_candidates(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_generate_response(req):
        captured["req"] = req
        return _mol_result(_valid_questions_json(count=3))

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.generator.generate_response",
        fake_generate_response,
    )
    candidates = await generate_candidates(_request(count=3), request_id="rid-1")
    assert len(candidates) == 3
    assert candidates[0].question_text == "What is question 0?"
    assert candidates[0].options == ["opt-0-a", "opt-0-b", "opt-0-c", "opt-0-d"]
    assert candidates[2].correct_answer_index == 0


@pytest.mark.asyncio
async def test_generator_sends_correct_task_type_and_provider(
    monkeypatch: pytest.MonkeyPatch,
):
    """Assert task_type='quiz_generation' and preferred_provider='openai'."""
    captured: dict[str, Any] = {}

    async def fake_generate_response(req):
        captured["req"] = req
        return _mol_result(_valid_questions_json(count=1))

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.generator.generate_response",
        fake_generate_response,
    )
    await generate_candidates(_request(count=1), request_id="rid-x")

    req = captured["req"]
    assert req.task_type == "quiz_generation"
    assert req.config.preferred_provider == "openai"
    assert req.config.surface == "quiz"
    # System prompt override is set (and bypasses the Phase-0 stub builder).
    assert req.config.system_prompt_override is not None
    assert "CBSE" in req.config.system_prompt_override
    # student_id is a synthetic admin-namespaced UUID.
    assert req.student_context.student_id.startswith("admin-bulk-question-gen-")
    assert req.student_context.grade == "8"
    # request_id flows through.
    assert req.config.request_id == "rid-x"
    # Max tokens override is the 8192 cap.
    assert req.config.max_tokens_override == 8192


@pytest.mark.asyncio
async def test_generator_skips_non_dict_items(monkeypatch: pytest.MonkeyPatch):
    """Mixed array with valid + bad items → valid items are returned."""
    payload = json.dumps(
        [
            {
                "question_text": "Q1",
                "options": ["a", "b", "c", "d"],
                "correct_answer_index": 0,
                "explanation": "Why",
                "hint": "Think",
                "difficulty": 3,
                "bloom_level": "remember",
            },
            "not a dict",
            42,
        ]
    )

    async def fake_generate_response(req):
        del req
        return _mol_result(payload)

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.generator.generate_response",
        fake_generate_response,
    )
    candidates = await generate_candidates(_request(), request_id="r")
    assert len(candidates) == 1
    assert candidates[0].question_text == "Q1"


# ── Failure paths ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generator_raises_on_mol_error(monkeypatch: pytest.MonkeyPatch):
    async def fake_generate_response(req):
        del req
        raise MolError("NO_PROVIDER_AVAILABLE", "all providers down")

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.generator.generate_response",
        fake_generate_response,
    )
    with pytest.raises(GenerationError) as exc_info:
        await generate_candidates(_request(), request_id="r")
    assert exc_info.value.mol_code == "NO_PROVIDER_AVAILABLE"
    assert "NO_PROVIDER_AVAILABLE" in str(exc_info.value)


@pytest.mark.asyncio
async def test_generator_raises_on_unparseable_response(monkeypatch: pytest.MonkeyPatch):
    async def fake_generate_response(req):
        del req
        return _mol_result("not valid json at all")

    monkeypatch.setattr(
        "services.ai.business.bulk_question_gen.generator.generate_response",
        fake_generate_response,
    )
    with pytest.raises(GenerationError, match="unparseable"):
        await generate_candidates(_request(), request_id="r")
