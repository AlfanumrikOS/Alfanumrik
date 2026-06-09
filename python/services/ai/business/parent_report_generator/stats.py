"""Pure (no I/O) WeeklyStats computation.

Ports TS computeWeeklyStats (lines 240-298). Pure function so the rejection
of malformed input is testable without Supabase.
"""

from __future__ import annotations

from typing import Any


def compute_weekly_stats(
    quiz_sessions: list[dict[str, Any]],
    foxy_sessions: list[dict[str, Any]],
    learning_profile: dict[str, Any] | None,
    mastery_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build WeeklyStats dict from the 4 input row sets. TS lines 240-298."""
    quizzes_completed = len(quiz_sessions)
    score_total = sum((q.get("score_percent") or 0) for q in quiz_sessions)
    avg_score = (
        round(score_total / quizzes_completed) if quizzes_completed > 0 else 0
    )
    xp_earned = (learning_profile or {}).get("xp_total") if learning_profile else None
    xp_earned = xp_earned or 0
    # Quiz time + foxy time (seconds) -> minutes.
    quiz_seconds = sum((q.get("time_taken_seconds") or 0) for q in quiz_sessions)
    foxy_seconds = sum((f.get("time_taken_seconds") or 0) for f in foxy_sessions)
    time_spent_minutes = round((quiz_seconds + foxy_seconds) / 60)
    topics_mastered = sum(
        1 for m in mastery_rows if (m.get("mastery_level") or 0) >= 0.8
    )
    streak = (learning_profile or {}).get("streak_days") if learning_profile else None
    streak = streak or 0

    subjects: set[str] = set()
    for q in quiz_sessions:
        s = q.get("subject")
        if isinstance(s, str) and s:
            subjects.add(s)
    chapters: set[str] = set()
    for m in mastery_rows:
        topics_obj = m.get("topics")
        if isinstance(topics_obj, dict):
            t = topics_obj.get("title")
            if isinstance(t, str) and t:
                chapters.add(t)

    return {
        "quizzes_completed": quizzes_completed,
        "avg_score": max(0, min(100, avg_score)),
        "xp_earned": xp_earned,
        "time_spent_minutes": time_spent_minutes,
        "topics_mastered": topics_mastered,
        "streak": streak,
        "foxy_sessions": len(foxy_sessions),
        "subjects_studied": sorted(subjects),
        "chapters_covered": sorted(chapters),
    }
