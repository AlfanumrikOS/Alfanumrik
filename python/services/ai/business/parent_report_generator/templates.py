"""Bilingual template-based weekly report (port of TS buildFallbackReport).

The TS Edge function uses these templates as the failover when Claude is
unavailable. The Python port uses them as the primary path - Phase 2.5 will
add the LLM-shaped variant via MoL.

P12: all copy is age-appropriate (CBSE grades 6-12 parent-facing).
P13: never embeds student PII beyond the first name passed in by caller.
"""

from __future__ import annotations

from typing import Any


def build_period_label(language: str) -> str:
    """Return 'This week' / 'इस सप्ताह' for the period field."""
    return "इस सप्ताह" if language == "hi" else "This week"


def build_highlights(stats: dict[str, Any], language: str) -> list[str]:
    """Build highlights array - achievements worth celebrating."""
    h: list[str] = []
    if language == "hi":
        if stats.get("quizzes_completed", 0) >= 5:
            h.append(f"{stats['quizzes_completed']} क्विज़ पूरी कीं")
        if stats.get("avg_score", 0) >= 80:
            h.append(f"उत्कृष्ट औसत स्कोर: {stats['avg_score']}%")
        if stats.get("streak", 0) >= 3:
            h.append(f"लगातार {stats['streak']} दिन सीखा")
        if stats.get("topics_mastered", 0) > 0:
            h.append(f"{stats['topics_mastered']} नए विषयों में निपुणता")
        if stats.get("xp_earned", 0) >= 100:
            h.append(f"{stats['xp_earned']} XP अर्जित किया")
    else:
        if stats.get("quizzes_completed", 0) >= 5:
            h.append(f"Completed {stats['quizzes_completed']} quizzes this week")
        if stats.get("avg_score", 0) >= 80:
            h.append(f"Excellent average score of {stats['avg_score']}%")
        if stats.get("streak", 0) >= 3:
            h.append(f"Maintained a {stats['streak']}-day learning streak")
        if stats.get("topics_mastered", 0) > 0:
            h.append(f"Mastered {stats['topics_mastered']} new topics")
        if stats.get("xp_earned", 0) >= 100:
            h.append(f"Earned {stats['xp_earned']} XP")
    if not h:
        h.append(
            "अध्ययन यात्रा शुरू हो गई है" if language == "hi" else "Started the learning journey"
        )
    return h


def build_concerns(stats: dict[str, Any], language: str) -> list[str]:
    """Build concerns array - areas needing attention."""
    c: list[str] = []
    if language == "hi":
        if stats.get("quizzes_completed", 0) < 3:
            c.append("इस सप्ताह कम क्विज़ की गईं")
        if stats.get("avg_score", 0) < 60 and stats.get("quizzes_completed", 0) > 0:
            c.append(f"औसत स्कोर {stats['avg_score']}% - अभ्यास की आवश्यकता")
        if stats.get("time_spent_minutes", 0) < 60:
            c.append("कम अध्ययन समय")
        if stats.get("streak", 0) == 0:
            c.append("कोई लगातार स्ट्रीक नहीं")
    else:
        if stats.get("quizzes_completed", 0) < 3:
            c.append("Fewer quizzes attempted this week")
        if stats.get("avg_score", 0) < 60 and stats.get("quizzes_completed", 0) > 0:
            c.append(f"Average score of {stats['avg_score']}% - practice recommended")
        if stats.get("time_spent_minutes", 0) < 60:
            c.append("Low study time logged")
        if stats.get("streak", 0) == 0:
            c.append("No active learning streak")
    return c


def build_suggestion(stats: dict[str, Any], language: str, student_name: str) -> str:
    """Build a single suggestion line. TS index.ts ~lines 368-410."""
    name = student_name or ("आपके बच्चे" if language == "hi" else "your child")
    avg = stats.get("avg_score", 0)
    if language == "hi":
        if avg >= 80:
            return f"{name} शानदार प्रदर्शन कर रहे हैं! कठिन प्रश्नों की चुनौती दें।"
        if avg >= 60:
            return f"{name} अच्छी प्रगति कर रहे हैं। नियमित अभ्यास जारी रखें।"
        return f"{name} को मूलभूत अवधारणाओं पर अधिक अभ्यास की आवश्यकता है।"
    if avg >= 80:
        return f"{name} is doing great! Challenge them with harder questions."
    if avg >= 60:
        return f"{name} is making good progress. Keep up regular practice."
    return f"{name} needs more practice on foundational concepts."


def build_template_report(
    stats: dict[str, Any], language: str, student_name: str
) -> dict[str, Any]:
    """Full template-based WeeklyReport (the TS buildFallbackReport equivalent)."""
    return {
        "period": build_period_label(language),
        "highlights": build_highlights(stats, language),
        "concerns": build_concerns(stats, language),
        "suggestion": build_suggestion(stats, language, student_name),
        "stats": stats,
    }
