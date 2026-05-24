"""Tests for grade / subject normalization (Python twin of TS module).

Covers every branch of :func:`normalize_grade`, :func:`normalize_subject`,
and :func:`slugify`. The SUBJECT_MAP itself is a constant — we assert on
key coverage so a TS-side addition without a Python-side mirror is a
visible test failure.
"""

from __future__ import annotations

import pytest

from services.ai.business.generate_concepts.normalize import (
    SUBJECT_MAP,
    normalize_grade,
    normalize_subject,
    raw_subject_for,
    slugify,
)

# ── normalize_grade ─────────────────────────────────────────────────────────


def test_normalize_grade_strips_prefix():
    assert normalize_grade("Grade 10") == "10"


def test_normalize_grade_strips_lowercase_prefix():
    """Mirrors TS index.ts:102 — case-insensitive regex /^Grade\\s+/i."""
    assert normalize_grade("grade 8") == "8"


def test_normalize_grade_passthrough_when_no_prefix():
    assert normalize_grade("10") == "10"


def test_normalize_grade_trailing_whitespace_trimmed():
    """Trailing whitespace AFTER number is trimmed (TS .trim() at end)."""
    assert normalize_grade("Grade 8  ") == "8"


def test_normalize_grade_internal_whitespace_collapsed():
    """``Grade  8`` (two internal spaces) → regex matches Grade\\s+ greedily, leaves '8'."""
    assert normalize_grade("Grade  8") == "8"


def test_normalize_grade_leading_whitespace_breaks_prefix_strip():
    """``  Grade 10`` does NOT match /^Grade/ anchor — TS index.ts:102 parity.

    The TS regex is ``/^Grade\\s+/i`` — the leading whitespace prevents
    the match, so the raw input is only trimmed. This is the same Python
    behavior; pinning it explicitly so a future "be helpful" patch
    doesn't accidentally diverge from the TS contract.
    """
    out = normalize_grade("  Grade 10")
    # ``re.sub(/^Grade\\s+/, '', '  Grade 10').strip() == 'Grade 10'``
    assert out == "Grade 10"


def test_normalize_grade_empty_string_passes_through():
    assert normalize_grade("") == ""


def test_normalize_grade_handles_extra_whitespace_only():
    assert normalize_grade("   ") == ""


def test_normalize_grade_rejects_non_string():
    """P5: grades are strings — integer input must raise immediately."""
    with pytest.raises(TypeError):
        normalize_grade(10)  # type: ignore[arg-type]


def test_normalize_grade_preserves_two_digit_grade():
    """Class 11 / 12 — must NOT collapse to single digits."""
    assert normalize_grade("Grade 11") == "11"
    assert normalize_grade("Grade 12") == "12"


# ── normalize_subject ───────────────────────────────────────────────────────


def test_normalize_subject_known_full_word():
    assert normalize_subject("Mathematics") == "math"


def test_normalize_subject_case_insensitive():
    assert normalize_subject("MATHEMATICS") == "math"
    assert normalize_subject("mathematics") == "math"


def test_normalize_subject_multi_word_known():
    assert normalize_subject("Social Studies") == "social_studies"
    assert normalize_subject("Computer Science") == "computer_science"


def test_normalize_subject_unknown_collapses_whitespace():
    """Unknown subject → snake_case fallback (lowercased, whitespace → _).

    Mirrors TS index.ts:127 ``key.replace(/\\s+/g, '_')``.
    """
    assert normalize_subject("Foreign Languages") == "foreign_languages"


def test_normalize_subject_single_word_unknown_lowercased():
    assert normalize_subject("Drama") == "drama"


def test_normalize_subject_strips_whitespace():
    assert normalize_subject("  Mathematics  ") == "math"


def test_normalize_subject_rejects_non_string():
    with pytest.raises(TypeError):
        normalize_subject(42)  # type: ignore[arg-type]


def test_subject_map_contains_canonical_keys():
    """All 17 canonical subjects must be present.

    A TS-side addition that bumps the map but doesn't update this Python
    twin would be caught by this assertion. Same for accidental deletions.
    """
    expected = {
        "mathematics",
        "science",
        "physics",
        "chemistry",
        "biology",
        "english",
        "hindi",
        "sanskrit",
        "social studies",
        "computer science",
        "informatics practices",
        "history",
        "geography",
        "economics",
        "political science",
        "accountancy",
        "business studies",
    }
    assert set(SUBJECT_MAP.keys()) == expected


def test_subject_map_values_match_db_short_form():
    """Spot-check that canonical mappings haven't drifted.

    These are the values that land in ``chapter_concepts.subject`` and
    ``question_bank.subject``; a drift would break joins across both
    tables and the chapter-coverage view.
    """
    assert SUBJECT_MAP["mathematics"] == "math"
    assert SUBJECT_MAP["social studies"] == "social_studies"
    assert SUBJECT_MAP["business studies"] == "business_studies"


# ── slugify ─────────────────────────────────────────────────────────────────


def test_slugify_lowercases_and_replaces_spaces():
    assert slugify("Newton First Law") == "newton-first-law"


def test_slugify_collapses_multiple_special_chars():
    assert slugify("Newton's First Law!") == "newton-s-first-law"


def test_slugify_strips_leading_and_trailing_hyphens():
    assert slugify("---test---") == "test"


def test_slugify_empty_string():
    assert slugify("") == ""


def test_slugify_non_string_returns_empty():
    """Defensive: non-string input → empty string."""
    assert slugify(None) == ""  # type: ignore[arg-type]
    assert slugify(42) == ""  # type: ignore[arg-type]


def test_slugify_handles_unicode():
    """Non-ASCII characters fall under the non-alnum regex and get hyphenated."""
    # The regex is [^a-z0-9]+ — accents and Devanagari chars collapse to "-".
    out = slugify("Physics — Mechanics")
    assert out == "physics-mechanics"


def test_slugify_collapses_internal_whitespace_runs():
    assert slugify("a   b") == "a-b"


# ── raw_subject_for ─────────────────────────────────────────────────────────


def test_raw_subject_for_known_normalized():
    assert raw_subject_for("math") == "Mathematics"


def test_raw_subject_for_unknown_falls_back_titlecase():
    assert raw_subject_for("drama") == "Drama"


def test_raw_subject_for_empty_string():
    assert raw_subject_for("") == ""


def test_raw_subject_for_preserves_multi_word_capitalization():
    """social_studies → 'Social studies' (matches TS .charAt(0).upper() + slice(1))."""
    out = raw_subject_for("social_studies")
    assert out == "Social studies"
