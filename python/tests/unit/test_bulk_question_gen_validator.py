"""Tests for the P6 + P11 validator.

Covers every rejection category in :mod:`services.ai.business.bulk_question_gen.validator`
plus the JSON-array extractor used to parse LLM responses.
"""

from __future__ import annotations

import pytest

from services.ai.business.bulk_question_gen.models import CandidateQuestion
from services.ai.business.bulk_question_gen.validator import (
    extract_json_array,
    validate_candidate,
)

# ── Fixture helpers ─────────────────────────────────────────────────────────


def _good_candidate(**overrides) -> CandidateQuestion:
    base = {
        "question_text": "What is the SI unit of force?",
        "options": ["newton", "joule", "watt", "pascal"],
        "correct_answer_index": 0,
        "explanation": "Force is measured in newtons in the SI system. 1 N = 1 kg·m/s².",
        "hint": "Named after a famous physicist.",
        "difficulty": 3,
        "bloom_level": "remember",
    }
    base.update(overrides)
    return CandidateQuestion(**base)


# ── Accept path ─────────────────────────────────────────────────────────────


def test_validator_accepts_valid_candidate():
    r = validate_candidate(_good_candidate())
    assert r.ok is True
    assert r.category == ""
    assert r.reason == ""


def test_validator_accepts_uppercase_bloom():
    r = validate_candidate(_good_candidate(bloom_level="UNDERSTAND"))
    # The validator lowercases on comparison so this is accepted.
    assert r.ok is True


# ── P6 question-text rejections ─────────────────────────────────────────────


def test_validator_rejects_empty_question_text():
    r = validate_candidate(_good_candidate(question_text=""))
    assert r.ok is False
    assert r.category == "p6_text_empty"


def test_validator_rejects_whitespace_only_question_text():
    r = validate_candidate(_good_candidate(question_text="   "))
    assert r.ok is False
    assert r.category == "p6_text_empty"


@pytest.mark.parametrize("placeholder", ["{{topic}}", "Fill the [BLANK] here"])
def test_validator_rejects_placeholder_in_question_text(placeholder: str):
    r = validate_candidate(_good_candidate(question_text=placeholder))
    assert r.ok is False
    assert r.category == "p6_text_placeholder"


# ── P6 option rejections ────────────────────────────────────────────────────


def test_validator_rejects_three_options():
    r = validate_candidate(_good_candidate(options=["a", "b", "c"]))
    assert r.ok is False
    assert r.category == "p6_options_count"


def test_validator_rejects_five_options():
    r = validate_candidate(_good_candidate(options=["a", "b", "c", "d", "e"]))
    assert r.ok is False
    assert r.category == "p6_options_count"


def test_validator_rejects_empty_option():
    r = validate_candidate(_good_candidate(options=["a", "", "c", "d"]))
    assert r.ok is False
    assert r.category == "p6_option_empty"


def test_validator_rejects_non_distinct_options_case_insensitive():
    """REG-54 / P6: options must be distinct ignoring case."""
    r = validate_candidate(_good_candidate(options=["Newton", "newton", "joule", "watt"]))
    assert r.ok is False
    assert r.category == "p6_options_not_distinct"


def test_validator_rejects_non_distinct_options_after_strip():
    r = validate_candidate(_good_candidate(options=["a ", "a", "b", "c"]))
    assert r.ok is False
    assert r.category == "p6_options_not_distinct"


# ── P6 correct_answer_index rejections ──────────────────────────────────────


@pytest.mark.parametrize("idx", [-1, 4, 99])
def test_validator_rejects_out_of_range_index(idx: int):
    r = validate_candidate(_good_candidate(correct_answer_index=idx))
    assert r.ok is False
    assert r.category == "p6_correct_index"


# ── P6 explanation / hint / difficulty / bloom rejections ───────────────────


def test_validator_rejects_empty_explanation():
    r = validate_candidate(_good_candidate(explanation=""))
    assert r.ok is False
    assert r.category == "p6_explanation_empty"


def test_validator_rejects_empty_hint():
    r = validate_candidate(_good_candidate(hint=""))
    assert r.ok is False
    assert r.category == "p6_hint_empty"


@pytest.mark.parametrize("diff", [0, 6, -1, 100])
def test_validator_rejects_invalid_difficulty(diff: int):
    r = validate_candidate(_good_candidate(difficulty=diff))
    assert r.ok is False
    assert r.category == "p6_difficulty"


def test_validator_rejects_invalid_bloom_level():
    r = validate_candidate(_good_candidate(bloom_level="invent_new_taxonomy"))
    assert r.ok is False
    assert r.category == "p6_bloom_level"


# ── P11 arithmetic-consistency check ────────────────────────────────────────


def test_validator_rejects_arithmetic_inconsistency():
    """Final number in explanation matches option index 1, but the stored
    answer is at index 0. Stored option ('seven') does NOT appear in the
    explanation — high-precision rule fires → reject.

    We pick option text that does NOT appear anywhere in the explanation
    so rule 3 (stored-answer-mentioned trust) cannot save the candidate.
    """
    c = _good_candidate(
        question_text="What is the value of X?",
        options=["seven", "10", "fifteen", "twenty"],
        correct_answer_index=0,  # stored answer is "seven"
        # Final number is "10" → matches option 1. "seven" never appears.
        explanation="Working through the algebra step by step gives us the value 10",
    )
    r = validate_candidate(c)
    assert r.ok is False, f"expected reject, got {r}"
    assert r.category == "p11_arithmetic_inconsistency"


def test_validator_accepts_when_stored_answer_appears_in_explanation():
    """High-precision variant rule 3: if the stored answer is mentioned in
    the explanation, we trust it even if the final number matches a
    different option."""
    c = _good_candidate(
        question_text="Inverse of +5?",
        options=["5", "-5", "10", "-10"],
        correct_answer_index=1,
        # Final number is '10' (matches option 2), but '-5' (the stored
        # answer) appears in the explanation — so we trust the answer.
        explanation="5 × (-5) = -25, so the additive inverse of +5 is -5; verification: 10 - 10 = 0",
    )
    r = validate_candidate(c)
    assert r.ok is True, f"expected accept, got {r}"


def test_validator_accepts_when_final_number_matches_stored_answer():
    """When explanation's final number matches the stored answer index,
    accept (no contradiction)."""
    c = _good_candidate(
        question_text="Speed?",
        options=["5", "10", "15", "20"],
        correct_answer_index=1,  # answer = '10'
        explanation="Using v = u + at, v = 0 + 2 * 5 = 10",
    )
    r = validate_candidate(c)
    assert r.ok is True


def test_validator_accepts_when_explanation_has_no_numbers():
    c = _good_candidate(
        explanation="Force is named after Sir Isaac Newton, the famous physicist.",
    )
    r = validate_candidate(c)
    assert r.ok is True


# ── extract_json_array ──────────────────────────────────────────────────────


def test_extract_json_array_plain():
    raw = '[{"question_text": "X"}]'
    parsed = extract_json_array(raw)
    assert parsed == [{"question_text": "X"}]


def test_extract_json_array_with_markdown_fences():
    raw = '```json\n[{"a": 1}]\n```'
    parsed = extract_json_array(raw)
    assert parsed == [{"a": 1}]


def test_extract_json_array_with_prose():
    raw = 'Here is the response:\n[{"a": 1}, {"b": 2}]\nThanks!'
    parsed = extract_json_array(raw)
    assert parsed == [{"a": 1}, {"b": 2}]


def test_extract_json_array_returns_none_on_unparseable():
    assert extract_json_array("not json at all") is None
    assert extract_json_array("[not a valid array}") is None
    assert extract_json_array('{"not": "an array"}') is None


def test_extract_json_array_returns_none_on_empty_string():
    assert extract_json_array("") is None
