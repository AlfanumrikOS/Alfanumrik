"""Tests for the Pydantic request / response models.

Covers the wire-contract shape that the TS Edge proxy forwards as-is.
Any drift in field names or types breaks the cutover.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.generate_concepts.models import (
    DEFAULT_BATCH_SIZE,
    DEFAULT_BLOOM_LEVEL,
    DEFAULT_DIFFICULTY,
    MAX_BATCH_SIZE,
    VALID_BLOOM_LEVELS,
    VALID_DIFFICULTIES,
    ChapterInfo,
    ChapterPreview,
    ConceptInsertRow,
    GeneratedConcept,
    GenerateConceptsRequest,
    GenerateConceptsResponse,
    GenerateConceptsStatusResponse,
    StatusBreakdownEntry,
)

# ── GenerateConceptsRequest ─────────────────────────────────────────────────


def test_request_accepts_empty_body():
    """TS handler tolerates an empty body — all fields optional."""
    req = GenerateConceptsRequest()
    assert req.grade is None
    assert req.subject is None
    assert req.batch_size is None
    assert req.dry_run is None


def test_request_accepts_full_body():
    req = GenerateConceptsRequest(
        grade="10",
        subject="science",
        batch_size=5,
        dry_run=False,
    )
    assert req.grade == "10"
    assert req.subject == "science"
    assert req.batch_size == 5
    assert req.dry_run is False


def test_request_rejects_extra_fields():
    """REG-73: extra='forbid' on request envelopes."""
    with pytest.raises(ValidationError):
        GenerateConceptsRequest(grade="10", unknown_field="x")  # type: ignore[call-arg]


def test_request_rejects_integer_grade():
    """P5: grades are strings — an integer must NOT be coerced."""
    with pytest.raises((ValidationError, TypeError)):
        GenerateConceptsRequest(grade=10)  # type: ignore[arg-type]


def test_request_grade_optional_as_none():
    """grade=None means 'no grade filter'."""
    req = GenerateConceptsRequest(grade=None)
    assert req.grade is None


def test_request_dry_run_default_is_none():
    req = GenerateConceptsRequest()
    assert req.dry_run is None


# ── ChapterInfo ─────────────────────────────────────────────────────────────


def test_chapter_info_full_round_trip():
    chapter = ChapterInfo(
        rag_grade="Grade 10",
        rag_subject="Mathematics",
        grade="10",
        subject="math",
        chapter_number=1,
        chapter_title="Real Numbers",
    )
    assert chapter.grade == "10"
    assert chapter.rag_grade == "Grade 10"


def test_chapter_info_rejects_extra_fields():
    with pytest.raises(ValidationError):
        ChapterInfo(  # type: ignore[call-arg]
            rag_grade="Grade 10",
            rag_subject="Mathematics",
            grade="10",
            subject="math",
            chapter_number=1,
            chapter_title="Real Numbers",
            unknown="x",
        )


# ── ChapterPreview ──────────────────────────────────────────────────────────


def test_chapter_preview_shape():
    preview = ChapterPreview(
        grade="10",
        subject="math",
        chapter_number=2,
        chapter_title="Polynomials",
    )
    assert preview.chapter_number == 2


# ── GeneratedConcept ────────────────────────────────────────────────────────


def test_generated_concept_happy_path():
    c = GeneratedConcept(
        title="Test",
        learning_objective="Define X",
        explanation="X is a thing.",
        example_title="Example",
        example_content="An X works like Y.",
        difficulty=2,
        bloom_level="understand",
    )
    assert c.difficulty == 2
    assert c.bloom_level == "understand"
    # Defaults
    assert c.common_mistakes == []
    assert c.key_formula is None


def test_generated_concept_rejects_difficulty_below_1():
    with pytest.raises(ValidationError):
        GeneratedConcept(
            title="Test",
            learning_objective="x",
            explanation="x",
            example_title="x",
            example_content="x",
            difficulty=0,
            bloom_level="understand",
        )


def test_generated_concept_rejects_difficulty_above_3():
    with pytest.raises(ValidationError):
        GeneratedConcept(
            title="Test",
            learning_objective="x",
            explanation="x",
            example_title="x",
            example_content="x",
            difficulty=5,
            bloom_level="understand",
        )


def test_generated_concept_rejects_invalid_bloom():
    """bloom_level outside the 4-value Literal must fail."""
    with pytest.raises(ValidationError):
        GeneratedConcept(
            title="Test",
            learning_objective="x",
            explanation="x",
            example_title="x",
            example_content="x",
            bloom_level="meta_cognition",  # type: ignore[arg-type]
        )


# ── ConceptInsertRow ────────────────────────────────────────────────────────


def test_concept_insert_row_minimum_fields():
    row = ConceptInsertRow(
        grade="10",
        subject="math",
        chapter_number=1,
        chapter_title="Real Numbers",
        concept_number=1,
        title="Rational Numbers",
        slug="rational-numbers",
        learning_objective="Define rational numbers.",
        explanation="A rational number is...",
        example_title="Example 1",
        example_content="3/4 is rational because...",
    )
    assert row.is_active is True
    assert row.source == "ncert_2025"
    assert row.estimated_minutes == 5
    assert row.bloom_level == DEFAULT_BLOOM_LEVEL
    assert row.difficulty == DEFAULT_DIFFICULTY


def test_concept_insert_row_grade_is_string():
    """P5: grade column is a string. The model accepts strings only."""
    row = ConceptInsertRow(
        grade="11",
        subject="physics",
        chapter_number=1,
        chapter_title="Units",
        concept_number=1,
        title="Force",
        slug="force",
        learning_objective="x",
        explanation="x",
        example_title="x",
        example_content="x",
    )
    assert isinstance(row.grade, str)
    assert row.grade == "11"


# ── Response envelopes ──────────────────────────────────────────────────────


def test_response_dry_run_shape():
    res = GenerateConceptsResponse(
        success=True,
        total_found=3,
        elapsed_ms=42,
        dry_run=True,
        chapters=[
            ChapterPreview(
                grade="10",
                subject="math",
                chapter_number=1,
                chapter_title="Real Numbers",
            )
        ],
    )
    assert res.dry_run is True
    assert res.processed == 0
    assert res.chapters is not None
    assert len(res.chapters) == 1


def test_response_normal_shape():
    res = GenerateConceptsResponse(
        success=True,
        total_found=5,
        processed=5,
        succeeded=4,
        failed=1,
        skipped=0,
        errors=["one error"],
        elapsed_ms=42,
        remaining=10,
        dry_run=False,
    )
    assert res.success is True
    assert res.remaining == 10
    assert res.chapters is None


def test_status_response_shape():
    res = GenerateConceptsStatusResponse(
        total_chapters=100,
        with_concepts=60,
        without_concepts=40,
        coverage_percent=60,
        breakdown={
            "Grade 10 - math": StatusBreakdownEntry(
                total=50, with_concepts=30, without_concepts=20
            ),
        },
    )
    assert res.coverage_percent == 60
    assert "Grade 10 - math" in res.breakdown


def test_status_response_empty_breakdown():
    res = GenerateConceptsStatusResponse(
        total_chapters=0,
        with_concepts=0,
        without_concepts=0,
        coverage_percent=0,
    )
    assert res.breakdown == {}


# ── Constants ───────────────────────────────────────────────────────────────


def test_batch_size_constants():
    assert MAX_BATCH_SIZE == 15
    assert DEFAULT_BATCH_SIZE == 5


def test_valid_bloom_levels_canonical():
    assert VALID_BLOOM_LEVELS == ("remember", "understand", "apply", "analyze")


def test_valid_difficulties_canonical():
    assert VALID_DIFFICULTIES == (1, 2, 3)


def test_default_difficulty_and_bloom():
    assert DEFAULT_DIFFICULTY == 2
    assert DEFAULT_BLOOM_LEVEL == "understand"
