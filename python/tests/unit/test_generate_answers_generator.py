"""Tests for the MoL-routed answer generator.

We mock :func:`services.ai.business.generate_answers.generator._call_mol` so
the generator's behaviour is exercised without touching the network.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.generate_answers.generator import (
    generate_answer_for_question,
)
from services.ai.mol.errors import MolError
from services.ai.mol.types import MolResult, TokenUsage


def _mol_result(text: str) -> MolResult:
    """Build a minimal MolResult — only ``text`` is read by the generator."""
    return MolResult(
        text=text,
        provider="openai",
        model="gpt-4o-mini",
        task_type="explanation",
        latency_ms=42,
        tokens=TokenUsage(prompt=100, completion=200),
        usd_cost=1e-5,
        inr_cost=8.3e-4,
        fallback_count=0,
        passes=1,
        request_id="rid-test",
        failure_chain=[],
    )


# ── Happy path ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generator_returns_text_on_success(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_call_mol(req):
        captured["req"] = req
        return _mol_result(
            '{"answer_text": "Force is a push or pull.", "answer_methodology": "definition", "marks_expected": 1}'
        )

    monkeypatch.setattr(
        "services.ai.business.generate_answers.generator._call_mol",
        fake_call_mol,
    )

    text = await generate_answer_for_question(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="science",
        request_id="rid-1",
    )
    assert "answer_text" in text
    assert captured["req"].task_type == "explanation"
    assert captured["req"].config.preferred_provider == "openai"
    assert captured["req"].config.system_prompt_override == "sys"
    assert captured["req"].config.max_tokens_override == 800
    # Student-id is synthetic + admin-namespaced (mirrors TS line 145).
    sid = captured["req"].student_context.student_id
    assert sid == "admin-generate-answers-10-science"
    assert captured["req"].student_context.grade == "10"
    assert captured["req"].student_context.subject == "science"


@pytest.mark.asyncio
async def test_generator_uses_user_prompt_as_input_instruction(
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict[str, Any] = {}

    async def fake_call_mol(req):
        captured["req"] = req
        return _mol_result('{"answer_text": "x", "answer_methodology": "definition", "marks_expected": 1}')

    monkeypatch.setattr(
        "services.ai.business.generate_answers.generator._call_mol",
        fake_call_mol,
    )
    await generate_answer_for_question(
        system_prompt="SYS",
        user_prompt="USR-instruction-body",
        grade="9",
        subject="math",
        request_id="rid-x",
    )
    assert captured["req"].input.instruction == "USR-instruction-body"


# ── Failure paths ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generator_returns_empty_on_mol_error(monkeypatch: pytest.MonkeyPatch):
    """MolError must NOT propagate — TS path logs + returns '' so the parser
    produces an empty-answer rejection that becomes a per-question failure."""

    async def fake_call_mol(req):
        del req
        raise MolError("NO_PROVIDER_AVAILABLE", "all providers down")

    monkeypatch.setattr(
        "services.ai.business.generate_answers.generator._call_mol",
        fake_call_mol,
    )
    text = await generate_answer_for_question(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="science",
        request_id="rid",
    )
    assert text == ""


@pytest.mark.asyncio
async def test_generator_returns_empty_on_runtime_error(monkeypatch: pytest.MonkeyPatch):
    """Any non-MolError must also not propagate (defense in depth)."""

    async def fake_call_mol(req):
        del req
        raise RuntimeError("transient failure")

    monkeypatch.setattr(
        "services.ai.business.generate_answers.generator._call_mol",
        fake_call_mol,
    )
    text = await generate_answer_for_question(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="science",
        request_id="rid",
    )
    assert text == ""


@pytest.mark.asyncio
async def test_generator_returns_empty_when_mol_text_is_none(
    monkeypatch: pytest.MonkeyPatch,
):
    """MoL returning None/empty text → generator returns ''."""

    async def fake_call_mol(req):
        del req
        return _mol_result("")

    monkeypatch.setattr(
        "services.ai.business.generate_answers.generator._call_mol",
        fake_call_mol,
    )
    text = await generate_answer_for_question(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="science",
        request_id="rid",
    )
    assert text == ""
