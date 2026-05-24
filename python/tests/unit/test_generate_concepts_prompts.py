"""Tests for the prompt builders.

The prompts are ported byte-for-byte from TS so we check the key invariants:
- Grade + subject appear in the system prompt.
- 4-tier Bloom + 3-band difficulty mentioned in the system prompt.
- RAG content truncated to MAX_RAG_CHARS.
- Diagrams section appears only when refs are non-empty.
- Sample question section appears only when one is provided.
"""

from __future__ import annotations

from services.ai.business.generate_concepts.models import ChapterInfo
from services.ai.business.generate_concepts.prompts import (
    MAX_RAG_CHARS,
    MIN_RAG_CHUNKS,
    build_system_prompt,
    build_user_prompt,
)


def _chapter(**overrides) -> ChapterInfo:
    base = {
        "rag_grade": "Grade 10",
        "rag_subject": "Mathematics",
        "grade": "10",
        "subject": "math",
        "chapter_number": 1,
        "chapter_title": "Real Numbers",
    }
    base.update(overrides)
    return ChapterInfo(**base)


# ── System prompt ───────────────────────────────────────────────────────────


def test_system_prompt_includes_grade_and_subject():
    p = build_system_prompt(grade="10", subject="science")
    assert "Class 10 science" in p


def test_system_prompt_mentions_bloom_levels():
    """All 4 Bloom levels must be listed for the LLM to pick from."""
    p = build_system_prompt(grade="10", subject="math")
    for level in ("remember", "understand", "apply", "analyze"):
        assert level in p


def test_system_prompt_mentions_difficulty_band():
    p = build_system_prompt(grade="7", subject="science")
    # The string "1/2/3" appears in TS index.ts:424 (difficulty band).
    assert "1/2/3" in p


def test_system_prompt_demands_json_output():
    p = build_system_prompt(grade="9", subject="english")
    assert "valid JSON array" in p
    assert "No markdown" in p


def test_system_prompt_mentions_required_fields():
    """All 9 per-concept fields must appear in the LLM contract."""
    p = build_system_prompt(grade="10", subject="science")
    for field in (
        "title",
        "learning_objective",
        "explanation",
        "key_formula",
        "example_title",
        "example_content",
        "common_mistakes",
        "difficulty",
        "bloom_level",
    ):
        assert field in p


def test_system_prompt_specifies_3_to_6_concepts():
    """Mirrors the 3-6 range that parseConceptsResponse later enforces."""
    p = build_system_prompt(grade="10", subject="math")
    assert "3-6" in p


# ── User prompt — header ────────────────────────────────────────────────────


def test_user_prompt_includes_chapter_header():
    chapter = _chapter(
        chapter_title="Quadratic Equations", chapter_number=4
    )
    p = build_user_prompt(chapter, ["sample chunk text"] * 3, [], None)
    assert "Quadratic Equations" in p
    assert "Chapter 4" in p
    assert "GRADE: 10" in p
    assert "SUBJECT: math" in p


def test_user_prompt_includes_ncert_content_section():
    chapter = _chapter()
    chunks = ["This is the first chunk.", "Second chunk content."]
    p = build_user_prompt(chapter, chunks, [], None)
    assert "=== NCERT CONTENT ===" in p
    assert "=== END CONTENT ===" in p
    assert "This is the first chunk." in p
    assert "Second chunk content." in p


def test_user_prompt_joins_chunks_with_separator():
    chapter = _chapter()
    chunks = ["A", "B", "C"]
    p = build_user_prompt(chapter, chunks, [], None)
    # Mirrors TS index.ts:437 \n\n---\n\n separator.
    assert "A\n\n---\n\nB\n\n---\n\nC" in p


# ── User prompt — RAG truncation ────────────────────────────────────────────


def test_user_prompt_truncates_long_rag_content():
    """RAG content longer than MAX_RAG_CHARS gets sliced."""
    chapter = _chapter()
    # Single huge chunk well over the cap.
    chunks = ["X" * (MAX_RAG_CHARS + 1000)]
    p = build_user_prompt(chapter, chunks, [], None)
    # The "=== NCERT CONTENT ===" and following content is bounded.
    # The slice cuts EXACTLY at MAX_RAG_CHARS so the body contains exactly
    # MAX_RAG_CHARS Xs (the separators are not present for a single chunk).
    assert "X" * MAX_RAG_CHARS in p
    # Confirm the prompt does NOT contain the full (cap + 1000) string.
    assert "X" * (MAX_RAG_CHARS + 1) not in p


def test_user_prompt_short_content_not_truncated():
    chapter = _chapter()
    chunks = ["short content"]
    p = build_user_prompt(chapter, chunks, [], None)
    assert "short content" in p


# ── User prompt — diagrams branch ───────────────────────────────────────────


def test_user_prompt_includes_diagrams_when_present():
    chapter = _chapter()
    diagrams = [
        {"media_type": "image", "caption": "Photosynthesis diagram", "url": "x"},
        {"media_type": "video", "caption": None, "url": None},
    ]
    p = build_user_prompt(chapter, ["chunk"] * 3, diagrams, None)
    assert "=== DIAGRAMS IN THIS CHAPTER ===" in p
    assert "[image] Photosynthesis diagram" in p
    # None caption fallback.
    assert "[video] Untitled" in p


def test_user_prompt_skips_diagrams_block_when_empty():
    chapter = _chapter()
    p = build_user_prompt(chapter, ["c1", "c2", "c3"], [], None)
    assert "=== DIAGRAMS" not in p


# ── User prompt — sample question branch ────────────────────────────────────


def test_user_prompt_includes_sample_question_when_provided():
    chapter = _chapter()
    sample = {
        "question_text": "What is force?",
        "options": ["A push", "A pull", "Both A and B", "Neither"],
    }
    p = build_user_prompt(chapter, ["chunk"] * 3, [], sample)
    assert "=== SAMPLE QUESTION ===" in p
    assert "What is force?" in p
    assert "Options: A) A push | B) A pull | C) Both A and B | D) Neither" in p


def test_user_prompt_skips_sample_question_when_none():
    chapter = _chapter()
    p = build_user_prompt(chapter, ["c"] * 3, [], None)
    assert "=== SAMPLE" not in p


def test_user_prompt_sample_question_without_options():
    chapter = _chapter()
    sample = {"question_text": "Open-ended question?"}
    p = build_user_prompt(chapter, ["c"] * 3, [], sample)
    assert "Open-ended question?" in p
    # The "Options:" prefix should NOT appear when options is absent.
    assert "Options:" not in p


def test_user_prompt_sample_question_empty_options_list():
    chapter = _chapter()
    sample = {"question_text": "Q", "options": []}
    p = build_user_prompt(chapter, ["c"] * 3, [], sample)
    assert "Q" in p
    # Empty options → no "Options:" line.
    assert "Options:" not in p


# ── Constants ───────────────────────────────────────────────────────────────


def test_min_rag_chunks_is_3():
    """Pinned: 3-chunk minimum before we even attempt generation."""
    assert MIN_RAG_CHUNKS == 3


def test_max_rag_chars_is_5000():
    """Pinned: 5000-char cap on RAG context budget per chapter."""
    assert MAX_RAG_CHARS == 5000
