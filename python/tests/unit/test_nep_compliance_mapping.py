"""Unit tests for the pure NEP / NCF mapping helpers.

REG-101 contract: these pure transformations are the canonical TS-to-Python
parity surface for nep-compliance. If a future change drifts NEP threshold
boundaries, behavior-rating math, or term boundaries, these tests fail.
"""

from __future__ import annotations

from datetime import UTC, datetime

from services.ai.business.nep_compliance.mapping import (
    COMPETENCY_ADVANCED_THRESHOLD,
    COMPETENCY_DEVELOPING_THRESHOLD,
    COMPETENCY_PROFICIENT_THRESHOLD,
    CONSISTENCY_BENCHMARK_DAYS,
    CURIOSITY_BENCHMARK_QUESTIONS,
    SELF_REGULATION_BENCHMARK_DAYS,
    STUDY_REGULARITY_BENCHMARK_DAYS,
    compute_behavior_rating,
    get_academic_year,
    get_current_term,
    mastery_to_competency_level,
)


def test_thresholds_match_ts_verbatim():
    assert COMPETENCY_ADVANCED_THRESHOLD == 85
    assert COMPETENCY_PROFICIENT_THRESHOLD == 65
    assert COMPETENCY_DEVELOPING_THRESHOLD == 40
    assert CONSISTENCY_BENCHMARK_DAYS == 30
    assert CURIOSITY_BENCHMARK_QUESTIONS == 500
    assert SELF_REGULATION_BENCHMARK_DAYS == 90
    assert STUDY_REGULARITY_BENCHMARK_DAYS == 30


def test_mastery_to_competency_advanced():
    assert mastery_to_competency_level(85) == "advanced"
    assert mastery_to_competency_level(100) == "advanced"


def test_mastery_to_competency_proficient():
    assert mastery_to_competency_level(65) == "proficient"
    assert mastery_to_competency_level(84) == "proficient"


def test_mastery_to_competency_developing():
    assert mastery_to_competency_level(40) == "developing"
    assert mastery_to_competency_level(64) == "developing"


def test_mastery_to_competency_beginning():
    assert mastery_to_competency_level(0) == "beginning"
    assert mastery_to_competency_level(39) == "beginning"


def test_behavior_rating_zero_max_returns_none():
    assert compute_behavior_rating(5, 0) is None


def test_behavior_rating_full_value_returns_5():
    assert compute_behavior_rating(30, 30) == 5
    assert compute_behavior_rating(100, 30) == 5  # capped


def test_behavior_rating_minimum_1():
    assert compute_behavior_rating(1, 1000) == 1


def test_behavior_rating_zero_value_returns_1():
    # Math.ceil(0 * 5) == 0, but max(1, 0) == 1.
    assert compute_behavior_rating(0, 30) == 1


def test_academic_year_april_to_march_boundary():
    apr = datetime(2026, 4, 1, tzinfo=UTC)
    assert get_academic_year(apr) == "2026-2027"
    mar = datetime(2026, 3, 31, tzinfo=UTC)
    assert get_academic_year(mar) == "2025-2026"


def test_current_term_april_to_september_is_term_1():
    for month in [4, 5, 6, 7, 8, 9]:
        now = datetime(2026, month, 15, tzinfo=UTC)
        assert get_current_term(now) == "Term 1"


def test_current_term_october_to_march_is_term_2():
    for month in [10, 11, 12, 1, 2, 3]:
        now = datetime(2026, month, 15, tzinfo=UTC)
        assert get_current_term(now) == "Term 2"
