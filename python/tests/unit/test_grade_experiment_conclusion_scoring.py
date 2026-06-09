"""Tests for the rule-based scoring helpers."""

from __future__ import annotations

from services.ai.business.grade_experiment_conclusion.scoring import (
    COIN_REWARDS,
    DEVELOPING_MAX,
    PROFICIENT_MAX,
    WEAK_MAX,
    coin_award_for_tier,
    score_conclusion,
    total_to_tier,
)


def test_tier_boundaries_match_ts():
    assert WEAK_MAX == 4
    assert DEVELOPING_MAX == 7
    assert PROFICIENT_MAX == 10


def test_coin_rewards_match_ts():
    assert COIN_REWARDS == {
        "weak": 0,
        "developing": 5,
        "proficient": 15,
        "strong": 30,
    }


def test_total_to_tier_boundaries():
    assert total_to_tier(0) == "weak"
    assert total_to_tier(4) == "weak"
    assert total_to_tier(5) == "developing"
    assert total_to_tier(7) == "developing"
    assert total_to_tier(8) == "proficient"
    assert total_to_tier(10) == "proficient"
    assert total_to_tier(11) == "strong"
    assert total_to_tier(12) == "strong"


def test_short_text_scores_weak():
    result = score_conclusion("too short")
    assert result["tier"] == "weak"
    assert result["total"] <= 4
    assert coin_award_for_tier(result["tier"]) == 0


def test_empty_text_scores_weak():
    result = score_conclusion("")
    assert result["tier"] == "weak"
    assert result["total"] <= 4


def test_method_keywords_boost_r2():
    text = "first I prepared the apparatus, then I measured, next step was observation"
    result = score_conclusion(text)
    # Multiple method keywords should give r2 > 0.
    assert result["r2_method"]["score"] >= 1


def test_evidence_keywords_boost_r3():
    text = "I observed the data because the result clearly showed therefore my hypothesis held"
    result = score_conclusion(text)
    assert result["r3_evidence"]["score"] >= 1


def test_long_rich_text_scores_strong():
    text = (
        "First, we set up the apparatus and recorded our observations. "
        "Then we measured the temperature data at regular intervals. "
        "The result was that observed temperature increased because the pressure was rising; "
        "this hypothesis held because our data showed evidence of consistent trial outcomes. "
        "Therefore, we conclude the predicted relationship was correct in this experiment. " * 2
    )
    result = score_conclusion(text)
    assert result["total"] >= 8
    assert result["tier"] in ("proficient", "strong")


def test_feedback_present_for_all_tiers():
    for tier_text in ["", "x" * 50, "x" * 150, "x" * 500]:
        result = score_conclusion(tier_text)
        assert result["feedback_en"]
        assert result["feedback_hi"]


def test_all_criteria_in_0_3_range():
    text = "x" * 600
    result = score_conclusion(text)
    for key in ("r1_question", "r2_method", "r3_evidence", "r4_conclusion"):
        score = result[key]["score"]
        assert 0 <= score <= 3
