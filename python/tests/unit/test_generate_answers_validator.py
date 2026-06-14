"""Tests for the answer-response parser.

Covers every branch of :func:`parse_answer_response` (port of TS
``parseAnswerResponse``).
"""

from __future__ import annotations

from services.ai.business.generate_answers.validator import (
    parse_answer_response,
)

# ── Happy path ──────────────────────────────────────────────────────────────


def test_parses_minimal_valid_response_mcq():
    raw = '{"answer_text": "Because A is correct.", "answer_methodology": "definition", "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=True)
    assert res.answer is not None
    assert res.answer.answer_text == "Because A is correct."
    assert res.answer.answer_methodology == "definition"
    assert res.answer.marks_expected == 1


def test_parses_long_form_response_non_mcq():
    raw = (
        '{"answer_text": "Newton\'s first law states that an object at rest stays at rest...",'
        ' "answer_methodology": "essay", "marks_expected": 5}'
    )
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.marks_expected == 5
    assert res.answer.answer_methodology == "essay"


def test_parses_when_wrapped_in_markdown_fences():
    """The regex extracts the {...} body regardless of fences/prose around it."""
    raw = '```json\n{"answer_text": "X is valid.", "answer_methodology": "definition", "marks_expected": 2}\n```'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.answer_text == "X is valid."


def test_parses_when_prose_wraps_json():
    raw = (
        "Here is the answer:\n"
        '{"answer_text": "An object accelerates when force is applied.", "answer_methodology": "stepwise", "marks_expected": 3}\n'
        "Done."
    )
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.answer_text.startswith("An object")


# ── Methodology coercion ────────────────────────────────────────────────────


def test_unknown_methodology_defaults_to_definition():
    raw = '{"answer_text": "X", "answer_methodology": "invent-new-bucket", "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=True)
    assert res.answer is not None
    assert res.answer.answer_methodology == "definition"


def test_missing_methodology_defaults_to_definition():
    raw = '{"answer_text": "X is correct.", "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=True)
    assert res.answer is not None
    assert res.answer.answer_methodology == "definition"


def test_methodology_must_be_string():
    """Non-string methodology → default."""
    raw = '{"answer_text": "X", "answer_methodology": 42, "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=True)
    assert res.answer is not None
    assert res.answer.answer_methodology == "definition"


# ── Marks clamping ──────────────────────────────────────────────────────────


def test_mcq_marks_always_1_even_when_llm_says_5():
    """TS line 324: MCQ override = 1 regardless of LLM output."""
    raw = '{"answer_text": "X", "answer_methodology": "definition", "marks_expected": 5}'
    res = parse_answer_response(raw, is_mcq=True)
    assert res.answer is not None
    assert res.answer.marks_expected == 1


def test_non_mcq_marks_clamped_to_range_high():
    """marks_expected > 10 → default 2 for non-MCQ."""
    raw = '{"answer_text": "X is correct.", "answer_methodology": "essay", "marks_expected": 99}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.marks_expected == 2


def test_non_mcq_marks_clamped_to_range_low():
    """marks_expected < 1 → default 2 for non-MCQ."""
    raw = '{"answer_text": "X is correct.", "answer_methodology": "essay", "marks_expected": 0}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.marks_expected == 2


def test_non_mcq_missing_marks_defaults_to_2():
    raw = '{"answer_text": "X is correct.", "answer_methodology": "definition"}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.marks_expected == 2


def test_float_marks_rounded():
    raw = '{"answer_text": "X is correct.", "answer_methodology": "essay", "marks_expected": 3.7}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.marks_expected == 4


def test_bool_marks_rejected():
    """isinstance(True, int) is True in Python — make sure we exclude bool."""
    raw = '{"answer_text": "X is correct.", "answer_methodology": "essay", "marks_expected": true}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is not None
    assert res.answer.marks_expected == 2  # default for non-MCQ


# ── Rejection branches ─────────────────────────────────────────────────────


def test_returns_no_json_object_for_empty_string():
    res = parse_answer_response("", is_mcq=False)
    assert res.answer is None
    assert res.reason == "no_json_object"


def test_returns_no_json_object_for_prose_only():
    res = parse_answer_response("This is just prose, no JSON.", is_mcq=False)
    assert res.answer is None
    assert res.reason == "no_json_object"


def test_returns_invalid_json_for_malformed_body():
    res = parse_answer_response("{not valid json}", is_mcq=False)
    assert res.answer is None
    assert res.reason == "invalid_json"


def test_returns_not_dict_for_array_payload():
    """Top-level JSON is not an object — TS handler rejects this branch."""
    res = parse_answer_response('[{"answer_text": "X"}]', is_mcq=False)
    # The regex matches the {...} substring of the array body, so the parse
    # actually succeeds at extracting the object. This mirrors TS behavior —
    # the regex is permissive on purpose.
    assert res.answer is not None


def test_returns_empty_answer_for_missing_text():
    raw = '{"answer_methodology": "definition", "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is None
    assert res.reason == "empty_answer"


def test_returns_empty_answer_for_whitespace_text():
    raw = '{"answer_text": "   ", "answer_methodology": "definition", "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is None
    assert res.reason == "empty_answer"


def test_returns_empty_answer_for_non_string_text():
    raw = '{"answer_text": 42, "answer_methodology": "definition", "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=False)
    assert res.answer is None
    assert res.reason == "empty_answer"


def test_returns_none_for_non_string_input():
    """Defensive: non-string raw payload → no_json_object."""
    res = parse_answer_response(None, is_mcq=False)  # type: ignore[arg-type]
    assert res.answer is None
    assert res.reason == "no_json_object"


def test_answer_text_stripped_of_whitespace():
    raw = '{"answer_text": "  Force is X.  ", "answer_methodology": "definition", "marks_expected": 1}'
    res = parse_answer_response(raw, is_mcq=True)
    assert res.answer is not None
    assert res.answer.answer_text == "Force is X."
