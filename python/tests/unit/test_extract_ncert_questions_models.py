"""Unit tests for the Pydantic models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.extract_ncert_questions.models import (
    ExtractedChapter,
    ExtractRequest,
    ExtractResponse,
    ExtractStatusResponse,
)


def test_request_defaults():
    r = ExtractRequest()
    assert r.grade is None
    assert r.subject is None
    assert r.batch_size == 3
    assert r.dry_run is False


def test_request_batch_size_clamp():
    with pytest.raises(ValidationError):
        ExtractRequest(batch_size=0)
    with pytest.raises(ValidationError):
        ExtractRequest(batch_size=11)


def test_request_grade_coerced_to_string():
    r = ExtractRequest(grade="7")
    assert r.grade == "7"
    assert isinstance(r.grade, str)


def test_request_empty_grade_becomes_none():
    r = ExtractRequest(grade="")
    assert r.grade is None


def test_response_default_phase_2_stub_true():
    r = ExtractResponse()
    assert r.phase_2_stub is True
    assert r.success is True


def test_response_dry_run_chapters_optional():
    r = ExtractResponse(
        total_found=2,
        dry_run=True,
        chapters=[
            ExtractedChapter(grade="7", subject="math", chapter_number=1, chapter_title="x"),
            ExtractedChapter(grade="7", subject="math", chapter_number=2, chapter_title="y"),
        ],
    )
    assert len(r.chapters or []) == 2


def test_extracted_chapter_p5_grade_must_be_string():
    c = ExtractedChapter(grade="7", subject="math", chapter_number=1, chapter_title="x")
    assert isinstance(c.grade, str)


def test_status_response_default_zeros():
    s = ExtractStatusResponse()
    assert s.total_chapters == 0
    assert s.coverage_percent == 0
    assert s.breakdown == {}


def test_status_response_coverage_bounds():
    with pytest.raises(ValidationError):
        ExtractStatusResponse(coverage_percent=-1)
    with pytest.raises(ValidationError):
        ExtractStatusResponse(coverage_percent=101)


def test_request_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        ExtractRequest(unknown_field="x")
