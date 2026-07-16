"""Unit tests for the Foxy perception classifier (Phase 1C).

We monkeypatch
``services.ai.business.foxy_perception.classifier.generate_response`` so the
classifier's parse/coerce/fail-safe behaviour is exercised without touching the
network. Mirrors the test_generate_concepts_generator convention.
"""

from __future__ import annotations

import pytest

from services.ai.business.foxy_perception.classifier import (
    ClassificationError,
    _coerce,
    _extract_json_object,
    classify_turn,
)
from services.ai.mol.errors import MolError
from services.ai.mol.types import MolResult, TokenUsage


def _mol_result(text: str) -> MolResult:
    return MolResult(
        text=text,
        provider="openai",
        model="gpt-4o-mini",
        task_type="evaluation",
        latency_ms=20,
        tokens=TokenUsage(prompt=50, completion=20),
        usd_cost=1e-6,
        inr_cost=8.3e-5,
        fallback_count=0,
        passes=1,
        request_id="rid-test",
        failure_chain=[],
    )


# ── _extract_json_object ─────────────────────────────────────────────────────


def test_extract_plain_json_object():
    obj = _extract_json_object('{"intent":"ask_concept"}')
    assert obj == {"intent": "ask_concept"}


def test_extract_json_from_fenced_block():
    text = '```json\n{"intent":"check_answer","bloom_level":"apply"}\n```'
    obj = _extract_json_object(text)
    assert obj["intent"] == "check_answer"
    assert obj["bloom_level"] == "apply"


def test_extract_json_wrapped_in_prose():
    text = 'Here is the classification: {"intent":"ask_concept"} — done.'
    assert _extract_json_object(text) == {"intent": "ask_concept"}


def test_extract_raises_on_no_json():
    with pytest.raises(ClassificationError):
        _extract_json_object("no json here at all")


def test_extract_raises_on_non_object_json():
    with pytest.raises(ClassificationError):
        _extract_json_object("[1, 2, 3]")


def test_extract_raises_on_broken_json():
    with pytest.raises(ClassificationError):
        _extract_json_object('{"intent": ')


# ── _coerce ──────────────────────────────────────────────────────────────────
#
# PARITY (Phase 1C): these _coerce assertions are mirrored 1:1 by the TS
# coercion-parity suite at apps/host/src/__tests__/api/foxy/
# perception-coercion-parity.test.ts (which pins coerceBloom / coerceMisconception
# / coerceStruggle / coerceIntent against the SAME shapes). The two layers are
# defence-in-depth; keep them in lock-step so neither language accepts a shape the
# other would reject.


def test_coerce_normalizes_bloom_to_lowercase():
    out = _coerce({"bloom_level": "APPLY", "intent": "x"})
    assert out.bloom_level == "apply"


def test_coerce_drops_unknown_bloom():
    out = _coerce({"bloom_level": "synthesize"})
    assert out.bloom_level is None


def test_coerce_keeps_valid_misconception_code():
    out = _coerce({"misconception_code": "sign_error"})
    assert out.misconception_code == "sign_error"


def test_coerce_drops_free_text_misconception():
    out = _coerce({"misconception_code": "The student thinks minus minus is minus"})
    assert out.misconception_code is None


def test_coerce_drops_none_string_misconception():
    assert _coerce({"misconception_code": "none"}).misconception_code is None
    assert _coerce({"misconception_code": ""}).misconception_code is None


def test_coerce_unknown_struggle_becomes_none():
    assert _coerce({"struggle_signal": "panicking"}).struggle_signal == "none"


def test_coerce_valid_struggle_kept():
    assert _coerce({"struggle_signal": "repeated_wrong"}).struggle_signal == "repeated_wrong"


def test_coerce_intent_snake_cased_and_bounded():
    out = _coerce({"intent": "  Check The Answer  "})
    assert out.intent == "check_the_answer"


def test_coerce_empty_intent_defaults_unknown():
    assert _coerce({"intent": ""}).intent == "unknown"
    assert _coerce({}).intent == "unknown"


def test_coerce_topic_label_trimmed_or_none():
    assert _coerce({"topic_label": "  Negative Numbers "}).topic_label == "Negative Numbers"
    assert _coerce({"topic_label": ""}).topic_label is None


# ── classify_turn (with mocked generate_response) ────────────────────────────


@pytest.mark.asyncio
async def test_classify_turn_happy_path(monkeypatch: pytest.MonkeyPatch):
    captured = {}

    async def fake_generate(req):
        captured["req"] = req
        return _mol_result(
            '{"topic_label":"Photosynthesis","bloom_level":"understand",'
            '"misconception_code":null,"struggle_signal":"none",'
            '"intent":"ask_concept"}'
        )

    monkeypatch.setattr(
        "services.ai.business.foxy_perception.classifier.generate_response",
        fake_generate,
    )

    out = await classify_turn(
        student_id="11111111-1111-1111-1111-111111111111",
        grade="8",
        subject="Science",
        chapter_number=6,
        student_message="What is photosynthesis?",
        foxy_answer="Plants make food using sunlight.",
        request_id="rid-1",
    )
    assert out.topic_label == "Photosynthesis"
    assert out.bloom_level == "understand"
    assert out.misconception_code is None
    assert out.struggle_signal == "none"
    assert out.intent == "ask_concept"
    # Routed as a cheap evaluation task on the OpenAI (gpt-4o-mini) primary.
    assert captured["req"].task_type == "evaluation"
    assert captured["req"].config.preferred_provider == "openai"
    assert captured["req"].config.max_tokens_override == 256
    assert captured["req"].student_context.grade == "8"


@pytest.mark.asyncio
async def test_classify_turn_propagates_mol_error(monkeypatch: pytest.MonkeyPatch):
    async def boom(_req):
        raise MolError("NO_PROVIDER_AVAILABLE", "all providers failed")

    monkeypatch.setattr(
        "services.ai.business.foxy_perception.classifier.generate_response",
        boom,
    )
    with pytest.raises(MolError):
        await classify_turn(
            student_id="11111111-1111-1111-1111-111111111111",
            grade="8",
            subject="Science",
            chapter_number=None,
            student_message="hi",
            foxy_answer="hello",
            request_id="rid-2",
        )


@pytest.mark.asyncio
async def test_classify_turn_raises_on_unparseable_output(monkeypatch: pytest.MonkeyPatch):
    async def junk(_req):
        return _mol_result("I could not classify this turn, sorry.")

    monkeypatch.setattr(
        "services.ai.business.foxy_perception.classifier.generate_response",
        junk,
    )
    with pytest.raises(ClassificationError):
        await classify_turn(
            student_id="11111111-1111-1111-1111-111111111111",
            grade="8",
            subject="Science",
            chapter_number=None,
            student_message="hi",
            foxy_answer="hello",
            request_id="rid-3",
        )
