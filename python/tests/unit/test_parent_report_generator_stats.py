"""Unit tests for compute_weekly_stats + template builders.

REG-102 pins the wire-shape parity for WeeklyStats and the template-path
copy structure (bilingual) so a regression on either would be caught
before the cutover ramps.
"""

from __future__ import annotations

from services.ai.business.parent_report_generator.stats import compute_weekly_stats
from services.ai.business.parent_report_generator.templates import (
    build_concerns,
    build_highlights,
    build_period_label,
    build_suggestion,
    build_template_report,
)


# compute_weekly_stats


def test_compute_stats_empty_inputs_returns_zero_counters():
    s = compute_weekly_stats([], [], None, [])
    assert s["quizzes_completed"] == 0
    assert s["avg_score"] == 0
    assert s["xp_earned"] == 0
    assert s["time_spent_minutes"] == 0
    assert s["topics_mastered"] == 0
    assert s["streak"] == 0
    assert s["foxy_sessions"] == 0
    assert s["subjects_studied"] == []
    assert s["chapters_covered"] == []


def test_compute_stats_avg_score_rounds():
    quiz = [{"score_percent": 50, "subject": "math"}, {"score_percent": 80, "subject": "math"}]
    s = compute_weekly_stats(quiz, [], None, [])
    assert s["avg_score"] == 65
    assert s["quizzes_completed"] == 2
    assert s["subjects_studied"] == ["math"]


def test_compute_stats_time_quiz_plus_foxy_seconds_to_minutes():
    quiz = [{"time_taken_seconds": 90, "score_percent": 0}]
    foxy = [{"time_taken_seconds": 150, "score_percent": 0}]
    s = compute_weekly_stats(quiz, foxy, None, [])
    # (90 + 150) / 60 = 4
    assert s["time_spent_minutes"] == 4


def test_compute_stats_topics_mastered_threshold_at_0_8():
    mastery = [
        {"mastery_level": 0.79},  # below
        {"mastery_level": 0.8},   # at threshold (inclusive)
        {"mastery_level": 0.95},  # above
    ]
    s = compute_weekly_stats([], [], None, mastery)
    assert s["topics_mastered"] == 2


def test_compute_stats_learning_profile_xp_and_streak():
    profile = {"xp_total": 250, "streak_days": 4}
    s = compute_weekly_stats([], [], profile, [])
    assert s["xp_earned"] == 250
    assert s["streak"] == 4


def test_compute_stats_chapters_from_nested_topic_titles():
    mastery = [
        {"topics": {"title": "Algebra"}, "mastery_level": 0.9},
        {"topics": {"title": "Algebra"}, "mastery_level": 0.5},  # dup
        {"topics": {"title": "Geometry"}, "mastery_level": 0.85},
        {"topics": None, "mastery_level": 0.9},  # null topic skipped
    ]
    s = compute_weekly_stats([], [], None, mastery)
    assert s["chapters_covered"] == ["Algebra", "Geometry"]


# Template builders


def test_period_label_en_hi():
    assert build_period_label("en") == "This week"
    assert build_period_label("hi") == "इस सप्ताह"


def test_highlights_high_performer_en():
    stats = {"quizzes_completed": 6, "avg_score": 90, "streak": 5, "topics_mastered": 3, "xp_earned": 200}
    h = build_highlights(stats, "en")
    assert any("6 quizzes" in s for s in h)
    assert any("90%" in s for s in h)
    assert any("5-day" in s for s in h)


def test_highlights_high_performer_hi():
    stats = {"quizzes_completed": 6, "avg_score": 90, "streak": 5, "topics_mastered": 3, "xp_earned": 200}
    h = build_highlights(stats, "hi")
    assert any("6 क्विज़" in s for s in h)
    assert any("90%" in s for s in h)


def test_highlights_zero_state_returns_placeholder():
    stats = {"quizzes_completed": 0, "avg_score": 0, "streak": 0, "topics_mastered": 0, "xp_earned": 0}
    h = build_highlights(stats, "en")
    assert len(h) == 1
    assert "Started" in h[0]


def test_concerns_low_score_en():
    stats = {"quizzes_completed": 2, "avg_score": 55, "time_spent_minutes": 30, "streak": 0}
    c = build_concerns(stats, "en")
    assert any("Fewer quizzes" in s for s in c)
    assert any("55%" in s for s in c)
    assert any("Low study time" in s for s in c)
    assert any("No active learning streak" in s for s in c)


def test_suggestion_strong_performer():
    s = build_suggestion({"avg_score": 90}, "en", "Aanya")
    assert "Aanya" in s
    assert "great" in s.lower() or "challenge" in s.lower()


def test_suggestion_uses_fallback_name_when_blank():
    s = build_suggestion({"avg_score": 90}, "en", "")
    assert "your child" in s


def test_full_template_report_shape():
    stats = {"quizzes_completed": 5, "avg_score": 70, "xp_earned": 100, "time_spent_minutes": 90, "topics_mastered": 2, "streak": 3, "foxy_sessions": 2, "subjects_studied": ["math"], "chapters_covered": ["Algebra"]}
    r = build_template_report(stats, "en", "Aanya")
    assert "period" in r
    assert isinstance(r["highlights"], list)
    assert isinstance(r["concerns"], list)
    assert "suggestion" in r
    assert r["stats"] == stats
