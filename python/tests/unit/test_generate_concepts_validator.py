"""Tests for the concept-response parser.

Covers every branch of :func:`parse_concepts_response` (port of TS
``parseConceptsResponse``). Four of these tests are pinned by REG-76 —
they catch any regression in the P6 quality gate before the Edge proxy
splits traffic between TS and Python implementations.
"""

from __future__ import annotations

import json

from services.ai.business.generate_concepts.validator import parse_concepts_response


def _make_concept(
    title: str = "Concept",
    learning_objective: str = "Learn it",
    explanation: str = "This is the explanation.",
    example_title: str = "Example",
    example_content: str = "Worked example body.",
    difficulty: int | str | float | None = 2,
    bloom_level: str | None = "understand",
    common_mistakes: list[str] | None = None,
    key_formula: str | None = None,
) -> dict:
    """Build one concept dict for the JSON array."""
    out = {
        "title": title,
        "learning_objective": learning_objective,
        "explanation": explanation,
        "example_title": example_title,
        "example_content": example_content,
    }
    if difficulty is not None:
        out["difficulty"] = difficulty
    if bloom_level is not None:
        out["bloom_level"] = bloom_level
    if common_mistakes is not None:
        out["common_mistakes"] = common_mistakes
    if key_formula is not None:
        out["key_formula"] = key_formula
    return out


def _make_response(n: int, **overrides) -> str:
    """Build a JSON-array string with n valid concepts."""
    return json.dumps([_make_concept(title=f"Concept {i}", **overrides) for i in range(n)])


# ── Happy path ──────────────────────────────────────────────────────────────


def test_parses_minimal_3_concept_array():
    out = parse_concepts_response(_make_response(3))
    assert out is not None
    assert len(out) == 3


def test_parses_4_concept_array():
    out = parse_concepts_response(_make_response(4))
    assert out is not None
    assert len(out) == 4


def test_parses_with_markdown_fence_wrapping():
    raw = f"```json\n{_make_response(3)}\n```"
    out = parse_concepts_response(raw)
    assert out is not None
    assert len(out) == 3


def test_parses_with_surrounding_prose():
    raw = f"Here are your concepts:\n{_make_response(3)}\nEnjoy!"
    out = parse_concepts_response(raw)
    assert out is not None


def test_parses_full_concept_with_all_fields():
    raw = json.dumps(
        [
            _make_concept(
                title=f"C{i}",
                common_mistakes=["m1", "m2"],
                key_formula="F = ma",
            )
            for i in range(3)
        ]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert out[0].common_mistakes == ["m1", "m2"]
    assert out[0].key_formula == "F = ma"


# ── REG-76 pinned: <3 concepts rejected ─────────────────────────────────────


def test_rejects_array_with_less_than_3_concepts():
    """REG-76: must reject 0/1/2-concept arrays (chapter_concepts requires 3+)."""
    assert parse_concepts_response(_make_response(2)) is None
    assert parse_concepts_response(_make_response(1)) is None
    assert parse_concepts_response("[]") is None


def test_rejects_array_with_2_valid_concepts():
    """Two concepts that pass per-item validation still fail the 3-min rule."""
    out = parse_concepts_response(_make_response(2))
    assert out is None


# ── REG-76 pinned: cap at 6 concepts ────────────────────────────────────────


def test_caps_array_at_6_concepts():
    """REG-76: arrays larger than 6 are sliced to 6.

    Mirrors TS index.ts:539 ``concepts.slice(0, 6)``. Pinned so a future
    relaxation (e.g. up to 8 concepts) would force an explicit catalog
    update.
    """
    out = parse_concepts_response(_make_response(10))
    assert out is not None
    assert len(out) == 6


def test_caps_array_at_exactly_6_for_7():
    out = parse_concepts_response(_make_response(7))
    assert out is not None
    assert len(out) == 6


# ── REG-76 pinned: difficulty default ───────────────────────────────────────


def test_defaults_invalid_difficulty_to_2():
    """REG-76: difficulty outside {1, 2, 3} → default 2.

    Mirrors TS index.ts:510-512. Pinned so a future LLM that emits e.g.
    difficulty=10 still lands a safe row in chapter_concepts.
    """
    out = parse_concepts_response(_make_response(3, difficulty=99))
    assert out is not None
    assert all(c.difficulty == 2 for c in out)


def test_defaults_difficulty_when_missing():
    raw = json.dumps([_make_concept(title=f"C{i}", difficulty=None) for i in range(3)])
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.difficulty == 2 for c in out)


def test_defaults_float_difficulty():
    """Non-integer difficulty → default."""
    out = parse_concepts_response(_make_response(3, difficulty=2.5))
    assert out is not None
    assert all(c.difficulty == 2 for c in out)


def test_defaults_string_difficulty():
    """String-as-difficulty → default."""
    out = parse_concepts_response(_make_response(3, difficulty="hard"))
    assert out is not None
    assert all(c.difficulty == 2 for c in out)


def test_bool_difficulty_rejected_as_int():
    """``isinstance(True, int)`` is True in Python; must be explicitly excluded."""
    out = parse_concepts_response(_make_response(3, difficulty=True))
    assert out is not None
    assert all(c.difficulty == 2 for c in out)


def test_accepts_valid_difficulty_1_3():
    """All three canonical difficulties pass through."""
    for d in (1, 2, 3):
        out = parse_concepts_response(_make_response(3, difficulty=d))
        assert out is not None
        assert all(c.difficulty == d for c in out)


# ── REG-76 pinned: bloom_level default ──────────────────────────────────────


def test_defaults_invalid_bloom_to_understand():
    """REG-76: bloom_level outside the 4-value canonical set → default 'understand'.

    Mirrors TS index.ts:515-517.
    """
    out = parse_concepts_response(_make_response(3, bloom_level="evaluate"))
    assert out is not None
    assert all(c.bloom_level == "understand" for c in out)


def test_defaults_bloom_when_missing():
    raw = json.dumps([_make_concept(title=f"C{i}", bloom_level=None) for i in range(3)])
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.bloom_level == "understand" for c in out)


def test_accepts_all_canonical_bloom_levels():
    for b in ("remember", "understand", "apply", "analyze"):
        out = parse_concepts_response(_make_response(3, bloom_level=b))
        assert out is not None
        assert all(c.bloom_level == b for c in out)


def test_bloom_non_string_defaults():
    """Non-string bloom_level (e.g. dict, int) → default."""
    raw = json.dumps(
        [_make_concept(title=f"C{i}", bloom_level=42) for i in range(3)]  # type: ignore[arg-type]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.bloom_level == "understand" for c in out)


# ── REG-76 pinned: missing required field skip ──────────────────────────────


def test_skips_concept_missing_required_field():
    """REG-76: a concept missing learning_objective is skipped silently.

    The other 3 concepts in the array still produce a valid 3-record result.
    A 4-concept array with one bad concept → 3 returned.
    """
    concepts = [_make_concept(title=f"C{i}") for i in range(4)]
    # Mangle concept index 1 — remove learning_objective.
    del concepts[1]["learning_objective"]
    raw = json.dumps(concepts)
    out = parse_concepts_response(raw)
    assert out is not None
    assert len(out) == 3
    # The mangled C1 should not appear.
    titles = [c.title for c in out]
    assert "C1" not in titles


def test_skips_concept_with_empty_required_field():
    """Empty string treated as missing — matches TS truthy check."""
    concepts = [_make_concept(title=f"C{i}") for i in range(4)]
    concepts[1]["explanation"] = ""
    raw = json.dumps(concepts)
    out = parse_concepts_response(raw)
    assert out is not None
    assert len(out) == 3


def test_skips_concept_with_non_string_required_field():
    concepts = [_make_concept(title=f"C{i}") for i in range(4)]
    concepts[1]["title"] = 42  # type: ignore[assignment]
    raw = json.dumps(concepts)
    out = parse_concepts_response(raw)
    assert out is not None
    assert len(out) == 3


def test_skips_too_many_bad_concepts_falls_below_minimum():
    """Reject the whole batch if too many concepts fail validation."""
    concepts = [_make_concept(title=f"C{i}") for i in range(4)]
    # Mangle two — only 2 valid remain → below 3-minimum → None.
    del concepts[0]["learning_objective"]
    del concepts[1]["explanation"]
    raw = json.dumps(concepts)
    out = parse_concepts_response(raw)
    assert out is None


# ── common_mistakes ─────────────────────────────────────────────────────────


def test_common_mistakes_capped_at_3():
    raw = json.dumps(
        [
            _make_concept(
                title=f"C{i}",
                common_mistakes=["m1", "m2", "m3", "m4", "m5"],
            )
            for i in range(3)
        ]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(len(c.common_mistakes) == 3 for c in out)


def test_common_mistakes_filters_non_strings():
    raw = json.dumps(
        [
            _make_concept(
                title=f"C{i}",
                common_mistakes=["m1", 42, None, "m2"],  # type: ignore[list-item]
            )
            for i in range(3)
        ]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.common_mistakes == ["m1", "m2"] for c in out)


def test_common_mistakes_filters_empty_strings():
    raw = json.dumps(
        [_make_concept(title=f"C{i}", common_mistakes=["", "valid"]) for i in range(3)]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.common_mistakes == ["valid"] for c in out)


def test_common_mistakes_non_list_becomes_empty():
    raw = json.dumps(
        [
            _make_concept(title=f"C{i}", common_mistakes="not a list")  # type: ignore[arg-type]
            for i in range(3)
        ]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.common_mistakes == [] for c in out)


def test_common_mistakes_missing_becomes_empty():
    """Missing key → empty list."""
    raw = _make_response(3)  # no common_mistakes override → none in payload
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.common_mistakes == [] for c in out)


# ── key_formula ─────────────────────────────────────────────────────────────


def test_key_formula_when_string():
    raw = json.dumps([_make_concept(title=f"C{i}", key_formula="  E = mc^2  ") for i in range(3)])
    out = parse_concepts_response(raw)
    assert out is not None
    # Trimmed.
    assert all(c.key_formula == "E = mc^2" for c in out)


def test_key_formula_non_string_becomes_none():
    raw = json.dumps(
        [
            _make_concept(title=f"C{i}", key_formula=42)  # type: ignore[arg-type]
            for i in range(3)
        ]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.key_formula is None for c in out)


# ── Rejection branches ─────────────────────────────────────────────────────


def test_returns_none_for_empty_string():
    assert parse_concepts_response("") is None


def test_returns_none_for_prose_only():
    assert parse_concepts_response("Just text, no array.") is None


def test_returns_none_for_truncated_json():
    """Truncated JSON array (no closing bracket) → None."""
    raw = '[{"title": "C0"'
    assert parse_concepts_response(raw) is None


def test_returns_none_for_malformed_json():
    raw = "[{not valid}]"
    assert parse_concepts_response(raw) is None


def test_returns_none_for_non_array_payload():
    """Top-level JSON object (not array) — regex won't match."""
    raw = '{"concepts": []}'
    assert parse_concepts_response(raw) is None


def test_returns_none_for_non_string_input():
    """Defensive: non-string raw payload → None."""
    assert parse_concepts_response(None) is None  # type: ignore[arg-type]
    assert parse_concepts_response(42) is None  # type: ignore[arg-type]


def test_returns_none_for_array_of_non_dicts():
    raw = json.dumps(["a", "b", "c"])
    out = parse_concepts_response(raw)
    # All items skipped → 0 valid → None.
    assert out is None


# ── Stripping behaviour ─────────────────────────────────────────────────────


def test_required_field_whitespace_only_skipped():
    """Whitespace-only required field treated as empty."""
    concepts = [_make_concept(title=f"C{i}") for i in range(4)]
    concepts[1]["title"] = "    "
    raw = json.dumps(concepts)
    out = parse_concepts_response(raw)
    assert out is not None
    assert len(out) == 3


def test_required_fields_stripped_of_whitespace():
    raw = json.dumps(
        [_make_concept(title=f"  C{i}  ", learning_objective="  trim me  ") for i in range(3)]
    )
    out = parse_concepts_response(raw)
    assert out is not None
    assert all(c.title.startswith("C") for c in out)
    assert all(c.learning_objective == "trim me" for c in out)
