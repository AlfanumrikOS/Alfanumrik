"""Unit tests for the Pydantic models.

The TS Edge Function validates exactly two fields (student_id, synthesis_month)
and returns labels like "missing_student_id" / "invalid_synthesis_month". Our
Pydantic validators must match TS rejection conditions byte-for-byte.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.monthly_synthesis_builder.models import (
    BuildResponse,
    BuildSynthesisRequest,
    ChapterMockSummary,
    MasteryDelta,
    SynthesisBundle,
)


def test_request_accepts_valid_shape():
    req = BuildSynthesisRequest(student_id="abc-123", synthesis_month="2026-05")
    assert req.student_id == "abc-123"
    assert req.synthesis_month == "2026-05"


def test_request_rejects_empty_student_id():
    with pytest.raises(ValidationError):
        BuildSynthesisRequest(student_id="", synthesis_month="2026-05")


def test_request_rejects_bad_month_format():
    bad_months = ["2026", "2026-5", "2026/05", "26-05", "may-2026", ""]
    for m in bad_months:
        with pytest.raises(ValidationError):
            BuildSynthesisRequest(student_id="x", synthesis_month=m)


def test_request_rejects_out_of_range_month():
    with pytest.raises(ValidationError):
        BuildSynthesisRequest(student_id="x", synthesis_month="2026-00")
    with pytest.raises(ValidationError):
        BuildSynthesisRequest(student_id="x", synthesis_month="2026-13")


def test_request_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        BuildSynthesisRequest(
            student_id="x",
            synthesis_month="2026-05",
            extra_field="should_be_rejected",
        )


def test_bundle_wire_shape_camelCase_keys():
    """Wire keys MUST be camelCase to match TS consumer."""
    bundle = SynthesisBundle(
        monthLabel="2026-05",
        weeklyArtifactIds=["a", "b"],
        masteryDelta=MasteryDelta(
            chaptersTouched=["X"], topicsMastered=1, topicsImproved=2, topicsRegressed=0
        ),
        chapterMockSummary=None,
    )
    dumped = bundle.model_dump()
    assert "monthLabel" in dumped
    assert "weeklyArtifactIds" in dumped
    assert "masteryDelta" in dumped
    assert "chaptersTouched" in dumped["masteryDelta"]
    assert "topicsMastered" in dumped["masteryDelta"]
    assert dumped["chapterMockSummary"] is None


def test_chapter_mock_summary_default_target_difficulty():
    summary = ChapterMockSummary(chapters=["A"], totalQuestions=2)
    assert summary.targetDifficulty == 0.55


def test_build_response_default_already_exists_false():
    bundle = SynthesisBundle(
        monthLabel="2026-05",
        weeklyArtifactIds=[],
        masteryDelta=MasteryDelta(),
    )
    resp = BuildResponse(id="abc", bundle=bundle)
    assert resp.alreadyExists is False


def test_mastery_delta_negative_counts_rejected():
    with pytest.raises(ValidationError):
        MasteryDelta(topicsMastered=-1)


def test_chapter_mock_summary_difficulty_bounds():
    with pytest.raises(ValidationError):
        ChapterMockSummary(chapters=[], totalQuestions=0, targetDifficulty=-0.1)
    with pytest.raises(ValidationError):
        ChapterMockSummary(chapters=[], totalQuestions=0, targetDifficulty=1.5)
