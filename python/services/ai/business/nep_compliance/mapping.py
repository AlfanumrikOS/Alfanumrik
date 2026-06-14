"""Pure (no I/O) NEP 2020 + NCF 2023 mapping helpers.

Ports of TS helpers:
- mastery_to_competency_level: NEP 2020 4-level (beginning/developing/proficient/advanced)
- compute_behavior_rating: 1-5 rating from raw metric / max benchmark
- get_academic_year: Indian academic year string (April-March boundary)
- get_current_term: 'Term 1' or 'Term 2' based on month

Constants for thresholds + benchmarks live at module level for unit-testing.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

# NEP 2020 competency thresholds (TS lines 79-82).
COMPETENCY_ADVANCED_THRESHOLD = 85
COMPETENCY_PROFICIENT_THRESHOLD = 65
COMPETENCY_DEVELOPING_THRESHOLD = 40

# Behavior-rating benchmarks (TS lines 286-295).
CONSISTENCY_BENCHMARK_DAYS = 30
CURIOSITY_BENCHMARK_QUESTIONS = 500
SELF_REGULATION_BENCHMARK_DAYS = 90

# Holistic indicators (TS lines 297-308).
STUDY_REGULARITY_BENCHMARK_DAYS = 30


def mastery_to_competency_level(avg_mastery_pct: float) -> str:
    """Map average mastery percentage to NEP 2020 competency level."""
    if avg_mastery_pct >= COMPETENCY_ADVANCED_THRESHOLD:
        return "advanced"
    if avg_mastery_pct >= COMPETENCY_PROFICIENT_THRESHOLD:
        return "proficient"
    if avg_mastery_pct >= COMPETENCY_DEVELOPING_THRESHOLD:
        return "developing"
    return "beginning"


def compute_behavior_rating(value: float, maximum: float) -> int | None:
    """Derive 1-5 behavior rating from raw metric vs benchmark.

    Returns None when max<=0 (avoid division-by-zero ambiguity). TS lines 88-92.
    """
    if maximum <= 0:
        return None
    ratio = min(value / maximum, 1)
    return max(1, math.ceil(ratio * 5))


def get_academic_year(now: datetime | None = None) -> str:
    """Indian academic year (April-March): 'YYYY-(YYYY+1)'.

    Optional `now` injection for testing — defaults to current UTC.
    """
    n = now if now is not None else datetime.now(UTC)
    if n.month >= 4:
        return f"{n.year}-{n.year + 1}"
    return f"{n.year - 1}-{n.year}"


def get_current_term(now: datetime | None = None) -> str:
    """Return 'Term 1' (Apr-Sep) or 'Term 2' (Oct-Mar).

    Optional `now` injection for testing.
    """
    n = now if now is not None else datetime.now(UTC)
    return "Term 1" if 4 <= n.month <= 9 else "Term 2"


# CBSE Board Exam Structure - shared between math and science for now (TS lines 118-133).
CBSE_EXAM_SECTIONS: dict[str, list[dict[str, str]]] = {
    "mathematics": [
        {"section": "Section A - MCQs", "marks": "20"},
        {"section": "Section B - Short Answer I", "marks": "10"},
        {"section": "Section C - Short Answer II", "marks": "18"},
        {"section": "Section D - Long Answer", "marks": "20"},
        {"section": "Section E - Case-based", "marks": "12"},
    ],
    "science": [
        {"section": "Section A - MCQs", "marks": "20"},
        {"section": "Section B - Short Answer I", "marks": "10"},
        {"section": "Section C - Short Answer II", "marks": "18"},
        {"section": "Section D - Long Answer", "marks": "20"},
        {"section": "Section E - Case-based", "marks": "12"},
    ],
}
