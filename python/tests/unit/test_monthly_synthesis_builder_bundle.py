"""Unit tests for the pure bundle helpers.

REG-79 contract: these pure transformations are the canonical TS-to-Python
parity surface for monthly-synthesis-builder. If a future change drifts
month-boundary math, mastery-counter rules, or chapter-cap behavior, these
tests fail and quality MUST reject.
"""

from __future__ import annotations

from services.ai.business.monthly_synthesis_builder.bundle import (
    CHAPTERS_IN_MOCK_SUMMARY_CAP,
    CHAPTERS_TOUCHED_SOFT_CAP,
    MASTERY_IMPROVED_THRESHOLD,
    MOCK_QUESTIONS_CAP,
    MOCK_QUESTIONS_PER_CHAPTER,
    TARGET_DIFFICULTY_V1,
    compute_mastery_counters,
    derive_chapter_mock_summary,
    derive_chapters_touched,
    month_boundaries_of,
)

# Constants pinning


def test_constants_match_ts_verbatim():
    """TARGET_DIFFICULTY_V1 + caps must match TS source byte-for-byte."""
    assert TARGET_DIFFICULTY_V1 == 0.55
    assert MOCK_QUESTIONS_PER_CHAPTER == 2
    assert MOCK_QUESTIONS_CAP == 20
    assert MASTERY_IMPROVED_THRESHOLD == 0.5
    assert CHAPTERS_TOUCHED_SOFT_CAP == 12
    assert CHAPTERS_IN_MOCK_SUMMARY_CAP == 6


# month_boundaries_of


def test_month_boundaries_returns_iso_with_Z_suffix():
    bounds = month_boundaries_of("2026-05")
    assert bounds is not None
    start, end = bounds
    assert start == "2026-05-01T00:00:00Z"
    assert end == "2026-06-01T00:00:00Z"


def test_month_boundaries_handles_december_rollover():
    bounds = month_boundaries_of("2026-12")
    assert bounds is not None
    start, end = bounds
    assert start == "2026-12-01T00:00:00Z"
    assert end == "2027-01-01T00:00:00Z"


def test_month_boundaries_rejects_bad_shape():
    assert month_boundaries_of("2026") is None
    assert month_boundaries_of("2026-5") is None
    assert month_boundaries_of("2026/05") is None
    assert month_boundaries_of("") is None


def test_month_boundaries_rejects_out_of_range_month():
    assert month_boundaries_of("2026-00") is None
    assert month_boundaries_of("2026-13") is None


# compute_mastery_counters


def test_compute_mastery_counters_empty_input():
    assert compute_mastery_counters([]) == (0, 0, 0)


def test_compute_mastery_counters_mastered_level():
    rows = [
        {"mastery_level": "mastered", "mastery_probability": 0.9, "total_attempts": 5},
        {"mastery_level": "learning", "mastery_probability": 0.3, "total_attempts": 2},
        {"mastery_level": "mastered", "mastery_probability": 0.95, "total_attempts": 10},
    ]
    mastered, improved, regressed = compute_mastery_counters(rows)
    assert mastered == 2
    assert regressed == 0


def test_compute_mastery_counters_improved_requires_threshold_and_attempts():
    rows = [
        {"mastery_probability": 0.6, "total_attempts": 5},  # qualifies
        {"mastery_probability": 0.51, "total_attempts": 1},  # qualifies (>0.5, >0 attempts)
        {
            "mastery_probability": 0.5,
            "total_attempts": 5,
        },  # equals threshold, not strictly greater - excluded
        {"mastery_probability": 0.9, "total_attempts": 0},  # no attempts - excluded
        {"mastery_probability": None, "total_attempts": 5},  # None probability - excluded
    ]
    _, improved, _ = compute_mastery_counters(rows)
    assert improved == 2


def test_compute_mastery_counters_regressed_always_zero_v1():
    """TS v1 simplification: regression detection needs historical snapshots."""
    rows = [{"mastery_level": "regressed", "mastery_probability": 0.1, "total_attempts": 10}]
    _, _, regressed = compute_mastery_counters(rows)
    assert regressed == 0


# derive_chapters_touched


def test_derive_chapters_touched_dedups_preserving_first_seen_order():
    rows = [
        {"title": "Photosynthesis"},
        {"title": "Mitosis"},
        {"title": "Photosynthesis"},
        {"title": "Cell Wall"},
    ]
    result = derive_chapters_touched(rows)
    assert result == ["Photosynthesis", "Mitosis", "Cell Wall"]


def test_derive_chapters_touched_skips_empty_and_non_string():
    rows = [
        {"title": "Algebra"},
        {"title": ""},
        {"title": None},
        {"title": 42},
        {"title": "Geometry"},
    ]
    result = derive_chapters_touched(rows)
    assert result == ["Algebra", "Geometry"]


def test_derive_chapters_touched_caps_at_soft_limit():
    rows = [{"title": f"Chapter {i}"} for i in range(20)]
    result = derive_chapters_touched(rows)
    assert len(result) == CHAPTERS_TOUCHED_SOFT_CAP
    assert result[0] == "Chapter 0"
    assert result[-1] == f"Chapter {CHAPTERS_TOUCHED_SOFT_CAP - 1}"


# derive_chapter_mock_summary


def test_derive_chapter_mock_summary_returns_none_when_empty():
    assert derive_chapter_mock_summary([]) is None


def test_derive_chapter_mock_summary_caps_chapters_and_questions():
    chapters = [f"Ch {i}" for i in range(15)]
    summary = derive_chapter_mock_summary(chapters)
    assert summary is not None
    assert len(summary["chapters"]) == CHAPTERS_IN_MOCK_SUMMARY_CAP
    # totalQuestions = min(20, 15*2) = 20 (capped)
    assert summary["totalQuestions"] == MOCK_QUESTIONS_CAP
    assert summary["targetDifficulty"] == TARGET_DIFFICULTY_V1


def test_derive_chapter_mock_summary_below_cap():
    chapters = ["A", "B", "C"]
    summary = derive_chapter_mock_summary(chapters)
    assert summary is not None
    assert summary["chapters"] == ["A", "B", "C"]
    assert summary["totalQuestions"] == 6  # 3 chapters * 2 questions
    assert summary["targetDifficulty"] == TARGET_DIFFICULTY_V1
