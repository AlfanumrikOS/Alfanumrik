"""Tests for the Pydantic request / response models.

Covers the wire-contract shape that the TS Edge proxy will forward as-is.
Any drift in field names or types breaks the cutover.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.generate_answers.models import (
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
    VALID_METHODOLOGIES,
    DryRunQuestionPreview,
    GenerateAnswersRequest,
    GenerateAnswersResponse,
    GenerateAnswersStatusResponse,
    GeneratedAnswer,
    StatusBreakdownEntry,
)

# ── Request envelope ────────────────────────────────────────────────────────


def test_request_accepts_empty_body():
    """TS handler tolerates an empty body — all fields optional."""
    req = GenerateAnswersRequest()
    assert req.grade is None
    assert req.subject is None
    assert req.batch_size is None
    assert req.dry_run is None


def test_request_accepts_full_body():
    req = GenerateAnswersRequest(
        grade="10",
        subject="science",
        batch_size=15,
        dry_run=False,
    )
    assert req.grade == "10"
    assert req.subject == "science"
    assert req.batch_size == 15
    assert req.dry_run is False


def test_request_rejects_extra_fields():
    """REG-73: extra='forbid' on request envelopes."""
    with pytest.raises(ValidationError):
        GenerateAnswersRequest(grade="10", unknown_field="x")  # type: ignore[call-arg]


def test_request_grade_optional_as_none():
    """grade=None means 'no grade filter' (TS path also tolerates absent)."""
    req = GenerateAnswersRequest(grade=None)
    assert req.grade is None


def test_request_dry_run_default_is_none():
    req = GenerateAnswersRequest()
    assert req.dry_run is None


# ── GeneratedAnswer ─────────────────────────────────────────────────────────


def test_generated_answer_happy_path():
    a = GeneratedAnswer(
        answer_text="Force is a push or pull.",
        answer_methodology="definition",
        marks_expected=1,
    )
    assert a.answer_methodology in VALID_METHODOLOGIES


def test_generated_answer_rejects_invalid_marks_high():
    with pytest.raises(ValidationError):
        GeneratedAnswer(
            answer_text="x",
            answer_methodology="definition",
            marks_expected=11,
        )


def test_generated_answer_rejects_invalid_marks_low():
    with pytest.raises(ValidationError):
        GeneratedAnswer(
            answer_text="x",
            answer_methodology="definition",
            marks_expected=0,
        )


def test_generated_answer_rejects_extra_fields():
    with pytest.raises(ValidationError):
        GeneratedAnswer(  # type: ignore[call-arg]
            answer_text="x",
            answer_methodology="definition",
            marks_expected=2,
            unknown="y",
        )


# ── Response envelopes ──────────────────────────────────────────────────────


def test_response_dry_run_shape():
    """Dry-run response carries previews + zero counters."""
    res = GenerateAnswersResponse(
        success=True,
        total_found=3,
        elapsed_ms=42,
        dry_run=True,
        questions=[
            DryRunQuestionPreview(
                id="qb-1",
                grade="10",
                subject="science",
                question_type_v2="mcq",
                question_text="Q1...",
            )
        ],
    )
    assert res.dry_run is True
    assert res.processed == 0
    assert res.questions is not None
    assert len(res.questions) == 1


def test_response_normal_shape():
    res = GenerateAnswersResponse(
        success=True,
        total_found=2,
        processed=2,
        succeeded=2,
        failed=0,
        errors=[],
        elapsed_ms=42,
        remaining=10,
        dry_run=False,
    )
    assert res.success is True
    assert res.remaining == 10
    assert res.questions is None


def test_status_response_shape():
    res = GenerateAnswersStatusResponse(
        total_active=100,
        with_answer=60,
        without_answer=40,
        coverage_percent=60,
        breakdown={
            "Grade 10 - science": StatusBreakdownEntry(total=50, with_answer=30, without_answer=20),
        },
    )
    assert res.coverage_percent == 60
    assert res.breakdown is not None
    assert "Grade 10 - science" in res.breakdown


def test_status_response_no_breakdown():
    res = GenerateAnswersStatusResponse(
        total_active=0,
        with_answer=0,
        without_answer=0,
        coverage_percent=0,
    )
    assert res.breakdown is None


def test_dry_run_preview_truncation_via_dict_payload():
    """Preview text format mirrors TS slice(0, 100) + ellipsis convention."""
    preview = DryRunQuestionPreview(
        id="qb-1",
        grade="10",
        subject="science",
        question_text="x" * 110,
    )
    # The model itself does not truncate — the handler does. We only assert
    # the model accepts the long string.
    assert len(preview.question_text) == 110


# ── Constants ───────────────────────────────────────────────────────────────


def test_batch_size_constants():
    assert MAX_BATCH_SIZE == 50
    assert DEFAULT_BATCH_SIZE == 20


def test_valid_methodologies_set():
    expected = (
        "definition",
        "stepwise",
        "diagram",
        "derivation",
        "essay",
        "numerical",
        "comparison",
        "analysis",
    )
    assert expected == VALID_METHODOLOGIES
