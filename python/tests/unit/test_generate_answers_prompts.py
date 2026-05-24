"""Tests for the prompt builders.

The prompts are ported byte-for-byte from TS so we check the key invariants:
- Grade + subject appear in the system prompt.
- RAG context branch includes the "MUST ground" instruction.
- Empty RAG branch includes the WARNING text.
- MCQ branch includes options + correct-letter mapping.
- Non-MCQ branch includes the "estimate marks_expected" instruction.
"""

from __future__ import annotations

from services.ai.business.generate_answers.prompts import (
    build_system_prompt,
    build_user_prompt,
)

# ── System prompt — RAG branch ─────────────────────────────────────────────


def test_system_prompt_includes_grade_and_subject():
    p = build_system_prompt(grade="10", subject="science", rag_context=None)
    assert "Class 10 science" in p
    assert "Grade 10" not in p  # Note: TS uses 'Class', not 'Grade', in this prompt.


def test_system_prompt_with_rag_context_grounds():
    rag = "Photosynthesis converts sunlight into chemical energy via chlorophyll."
    p = build_system_prompt(grade="7", subject="science", rag_context=rag)
    assert rag in p
    assert "MUST ground your answer in the NCERT content above" in p
    assert "WARNING" not in p


def test_system_prompt_without_rag_context_warns():
    p = build_system_prompt(grade="9", subject="math", rag_context=None)
    assert "WARNING: No NCERT reference material" in p
    assert 'Add a note: "Answer should be verified against NCERT textbook."' in p


def test_system_prompt_empty_rag_string_takes_warning_branch():
    """Empty string is falsy → warning branch (mirrors TS truthy check)."""
    p = build_system_prompt(grade="6", subject="english", rag_context="")
    assert "WARNING" in p


# ── User prompt — MCQ branch ────────────────────────────────────────────────


def _question_base(**overrides):
    base = {
        "id": "qb-1",
        "question_text": "What is force?",
        "subject": "science",
        "grade": "10",
        "chapter_number": 8,
        "difficulty": 2,
        "bloom_level": "remember",
        "question_type_v2": "short_answer",
        "options": None,
        "correct_answer_index": None,
        "explanation": None,
    }
    base.update(overrides)
    return base


def test_user_prompt_mcq_includes_options_block():
    q = _question_base(
        question_type_v2="mcq",
        options=["Push or pull", "Speed", "Distance", "Mass"],
        correct_answer_index=0,
    )
    p = build_user_prompt(q)
    assert "OPTIONS: A) Push or pull | B) Speed | C) Distance | D) Mass" in p
    assert "CORRECT ANSWER: A) Push or pull" in p
    assert "For this MCQ:" in p
    assert "Set marks_expected to 1" in p


def test_user_prompt_mcq_with_correct_index_2():
    q = _question_base(
        question_type_v2="mcq",
        options=["A", "B", "C", "D"],
        correct_answer_index=2,
    )
    p = build_user_prompt(q)
    assert "CORRECT ANSWER: C) C" in p


def test_user_prompt_mcq_without_correct_index_skips_options():
    """If correct_answer_index is None, the options block is suppressed.

    This branch fires when ``correct_index`` is None even with options
    present — mirrors TS line 259 ``correctIndex !== null && correctIndex !== undefined``.
    """
    q = _question_base(
        question_type_v2="mcq",
        options=["A", "B", "C", "D"],
        correct_answer_index=None,
    )
    p = build_user_prompt(q)
    assert "OPTIONS:" not in p
    assert "CORRECT ANSWER:" not in p


def test_user_prompt_non_mcq_estimates_marks():
    q = _question_base(question_type_v2="long_answer")
    p = build_user_prompt(q)
    assert "Estimate appropriate marks_expected" in p
    assert "For this MCQ:" not in p


# ── User prompt — explanation block ────────────────────────────────────────


def test_user_prompt_includes_explanation_when_present():
    q = _question_base(explanation="Force is a push or pull on an object.")
    p = build_user_prompt(q)
    assert "EXISTING EXPLANATION: Force is a push or pull on an object." in p


def test_user_prompt_omits_explanation_when_absent():
    q = _question_base(explanation=None)
    p = build_user_prompt(q)
    assert "EXISTING EXPLANATION:" not in p


def test_user_prompt_omits_explanation_when_empty_string():
    q = _question_base(explanation="")
    p = build_user_prompt(q)
    assert "EXISTING EXPLANATION:" not in p


# ── User prompt — required JSON output instruction ─────────────────────────


def test_user_prompt_includes_json_output_instruction():
    q = _question_base()
    p = build_user_prompt(q)
    assert "Output ONLY valid JSON (no markdown, no code fences):" in p
    assert "answer_text" in p
    assert "answer_methodology" in p
    assert "marks_expected" in p


def test_user_prompt_includes_methodology_enum():
    q = _question_base()
    p = build_user_prompt(q)
    for m in (
        "definition",
        "stepwise",
        "diagram",
        "derivation",
        "essay",
        "numerical",
        "comparison",
        "analysis",
    ):
        assert m in p


# ── User prompt — None-tolerance for question_bank fields ──────────────────


def test_user_prompt_handles_unknown_difficulty():
    q = _question_base(difficulty=None)
    p = build_user_prompt(q)
    assert "DIFFICULTY: unknown" in p


def test_user_prompt_handles_unknown_bloom_level():
    q = _question_base(bloom_level=None)
    p = build_user_prompt(q)
    assert "BLOOM LEVEL: unknown" in p


def test_user_prompt_handles_unknown_type():
    q = _question_base(question_type_v2=None)
    p = build_user_prompt(q)
    assert "TYPE: unknown" in p
