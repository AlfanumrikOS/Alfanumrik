"""Unit tests for the Foxy perception pydantic models (Phase 1C)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.foxy_perception.models import (
    ClassifyTurnRequest,
    TurnClassificationResponse,
)

# ── ClassifyTurnRequest ──────────────────────────────────────────────────────


def test_request_accepts_valid_body():
    req = ClassifyTurnRequest(
        student_id="11111111-1111-1111-1111-111111111111",
        grade="8",
        subject="Science",
        chapter_number=6,
        student_message="What is photosynthesis?",
        foxy_answer="Plants make food using sunlight.",
    )
    assert req.grade == "8"
    assert req.chapter_number == 6


def test_request_chapter_number_optional():
    req = ClassifyTurnRequest(
        student_id="s1",
        grade="8",
        subject="Science",
        student_message="hi",
        foxy_answer="hello",
    )
    assert req.chapter_number is None


def test_request_rejects_extra_fields():
    with pytest.raises(ValidationError):
        ClassifyTurnRequest(
            student_id="s1",
            grade="8",
            subject="Science",
            student_message="hi",
            foxy_answer="hello",
            sneaky="nope",  # extra="forbid"
        )


def test_request_rejects_empty_message():
    with pytest.raises(ValidationError):
        ClassifyTurnRequest(
            student_id="s1",
            grade="8",
            subject="Science",
            student_message="",
            foxy_answer="hello",
        )


def test_request_grade_must_be_nonempty_string():
    with pytest.raises(ValidationError):
        ClassifyTurnRequest(
            student_id="s1",
            grade="   ",
            subject="Science",
            student_message="hi",
            foxy_answer="hello",
        )


# ── TurnClassificationResponse ───────────────────────────────────────────────


def test_response_defaults_are_safe():
    resp = TurnClassificationResponse()
    assert resp.topic_label is None
    assert resp.bloom_level is None
    assert resp.misconception_code is None
    assert resp.struggle_signal == "none"
    assert resp.intent == "unknown"


def test_response_accepts_valid_enums():
    resp = TurnClassificationResponse(
        topic_label="Negative Numbers",
        bloom_level="apply",
        misconception_code="sign_error",
        struggle_signal="repeated_wrong",
        intent="check_answer",
    )
    assert resp.bloom_level == "apply"
    assert resp.struggle_signal == "repeated_wrong"


def test_response_rejects_bad_bloom():
    with pytest.raises(ValidationError):
        TurnClassificationResponse(bloom_level="synthesize")


def test_response_rejects_bad_struggle():
    with pytest.raises(ValidationError):
        TurnClassificationResponse(struggle_signal="panicking")
