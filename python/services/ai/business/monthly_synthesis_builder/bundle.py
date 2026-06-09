"""Pure (no I/O) helpers for the synthesis bundle.

Ports the TS helpers in ``index.ts``:
- :func:`month_boundaries_of` mirrors ``monthBoundariesOf`` (half-open
  ``[startIso, endIso)`` interval used throughout pedagogy-v2).
- :func:`compute_mastery_counters` is the TS list-comprehension carved out
  as a pure function for unit-testability.
- :func:`derive_chapters_touched` mirrors the Set+slice(12) ordering.
- :func:`derive_chapter_mock_summary` mirrors lines 168-174 (cap 20, target 0.55).

Constants exposed at module level so callers (and tests) can reference them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

TARGET_DIFFICULTY_V1: float = 0.55
MOCK_QUESTIONS_PER_CHAPTER: int = 2
MOCK_QUESTIONS_CAP: int = 20
MASTERY_IMPROVED_THRESHOLD: float = 0.5
CHAPTERS_TOUCHED_SOFT_CAP: int = 12
CHAPTERS_IN_MOCK_SUMMARY_CAP: int = 6


def month_boundaries_of(month_label: str) -> tuple[str, str] | None:
    """Return ``(start_iso, end_iso)`` for the half-open month interval, or None.

    Matches the TS helper in shape and timezone (UTC). Returns None for any
    label not matching ``YYYY-MM`` or whose month is outside 01..12.
    """
    if len(month_label) != 7 or month_label[4] != "-":
        return None
    try:
        year = int(month_label[:4])
        month = int(month_label[5:])
    except ValueError:
        return None
    if month < 1 or month > 12:
        return None

    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)

    return (
        start.isoformat().replace("+00:00", "Z"),
        end.isoformat().replace("+00:00", "Z"),
    )


def compute_mastery_counters(cm_rows: list[dict[str, Any]]) -> tuple[int, int, int]:
    """Return ``(topics_mastered, topics_improved, topics_regressed)``.

    Pure transformation of the concept_mastery row set. "Regressed" is
    hard-coded 0 (TS v1 simplification — see TS index.ts:146-149 comment).
    """
    topics_mastered = sum(1 for r in cm_rows if r.get("mastery_level") == "mastered")
    topics_improved = sum(
        1
        for r in cm_rows
        if (r.get("mastery_probability") or 0) > MASTERY_IMPROVED_THRESHOLD
        and (r.get("total_attempts") or 0) > 0
    )
    topics_regressed = 0
    return topics_mastered, topics_improved, topics_regressed


def derive_chapters_touched(topic_rows: list[dict[str, Any]]) -> list[str]:
    """Extract unique non-empty topic titles, capped at the soft limit.

    TS uses ``new Set(...)`` + slice(12). Python dict preserves insertion
    order so a dict-based dedup keeps the same ordering as the TS Set.
    """
    seen: dict[str, None] = {}
    for r in topic_rows:
        title = r.get("title") or ""
        if isinstance(title, str) and title:
            seen.setdefault(title, None)
    return list(seen.keys())[:CHAPTERS_TOUCHED_SOFT_CAP]


def derive_chapter_mock_summary(chapters_touched: list[str]) -> dict[str, Any] | None:
    """Return the chapter-mock summary dict, or None if no chapters were touched.

    TS lines 168-174: chapters capped at 6, totalQuestions at
    min(20, len(chapters) * 2), targetDifficulty fixed at 0.55.
    """
    if not chapters_touched:
        return None
    return {
        "chapters": chapters_touched[:CHAPTERS_IN_MOCK_SUMMARY_CAP],
        "totalQuestions": min(
            MOCK_QUESTIONS_CAP,
            len(chapters_touched) * MOCK_QUESTIONS_PER_CHAPTER,
        ),
        "targetDifficulty": TARGET_DIFFICULTY_V1,
    }
