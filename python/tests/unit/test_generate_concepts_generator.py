"""Tests for the MoL-routed concept generator.

We mock :func:`services.ai.business.generate_concepts.generator._call_mol`
so the generator's behaviour is exercised without touching the network.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.generate_concepts.generator import (
    GENERATION_MAX_TOKENS,
    call_mol_for_concepts,
)
from services.ai.mol.errors import MolError
from services.ai.mol.types import MolResult, TokenUsage


def _mol_result(text: str) -> MolResult:
    return MolResult(
        text=text,
        provider="openai",
        model="gpt-4o-mini",
        task_type="concept_explanation",
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
        return _mol_result('[{"title":"x"}]')

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.generator._call_mol",
        fake_call_mol,
    )

    text = await call_mol_for_concepts(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="math",
        request_id="rid-1",
    )
    assert text == '[{"title":"x"}]'
    assert captured["req"].task_type == "concept_explanation"
    assert captured["req"].config.preferred_provider == "openai"
    assert captured["req"].config.system_prompt_override == "sys"
    assert captured["req"].config.max_tokens_override == GENERATION_MAX_TOKENS
    # Student-id is synthetic + admin-namespaced (mirrors TS index.ts:346).
    sid = captured["req"].student_context.student_id
    assert sid == "admin-generate-concepts-10-math"
    assert captured["req"].student_context.grade == "10"
    assert captured["req"].student_context.subject == "math"


@pytest.mark.asyncio
async def test_generator_uses_user_prompt_as_input_instruction(
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict[str, Any] = {}

    async def fake_call_mol(req):
        captured["req"] = req
        return _mol_result("[{}]")

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.generator._call_mol",
        fake_call_mol,
    )
    await call_mol_for_concepts(
        system_prompt="SYS",
        user_prompt="USR-body",
        grade="9",
        subject="science",
        request_id="rid-x",
    )
    assert captured["req"].input.instruction == "USR-body"


@pytest.mark.asyncio
async def test_generator_max_tokens_override(monkeypatch: pytest.MonkeyPatch):
    """Custom max_tokens override is respected."""
    captured: dict[str, Any] = {}

    async def fake_call_mol(req):
        captured["req"] = req
        return _mol_result("[]")

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.generator._call_mol",
        fake_call_mol,
    )
    await call_mol_for_concepts(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="math",
        request_id="rid",
        max_tokens=2048,
    )
    assert captured["req"].config.max_tokens_override == 2048


# ── Failure paths ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generator_returns_empty_on_mol_error(monkeypatch: pytest.MonkeyPatch):
    """MolError must NOT propagate — TS path logs + returns '' so the parser
    produces a None-rejection that becomes a per-chapter failure."""

    async def fake_call_mol(req):
        del req
        raise MolError("NO_PROVIDER_AVAILABLE", "all providers down")

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.generator._call_mol",
        fake_call_mol,
    )
    text = await call_mol_for_concepts(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="math",
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
        "services.ai.business.generate_concepts.generator._call_mol",
        fake_call_mol,
    )
    text = await call_mol_for_concepts(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="math",
        request_id="rid",
    )
    assert text == ""


@pytest.mark.asyncio
async def test_generator_returns_empty_when_mol_text_is_empty(
    monkeypatch: pytest.MonkeyPatch,
):
    """MoL returning empty text → generator returns ''."""

    async def fake_call_mol(req):
        del req
        return _mol_result("")

    monkeypatch.setattr(
        "services.ai.business.generate_concepts.generator._call_mol",
        fake_call_mol,
    )
    text = await call_mol_for_concepts(
        system_prompt="sys",
        user_prompt="usr",
        grade="10",
        subject="math",
        request_id="rid",
    )
    assert text == ""


# ── Constants ───────────────────────────────────────────────────────────────


def test_generation_max_tokens_pinned_at_4096():
    """Pinned: matches TS index.ts:758 ``4096``."""
    assert GENERATION_MAX_TOKENS == 4096
