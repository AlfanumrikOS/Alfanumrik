"""Concept-response validation — port of TS ``parseConceptsResponse``.

Source of truth (port from):
    :file:`supabase/functions/generate-concepts/index.ts` lines 481-543.

P6 quality gate (runs AFTER the LLM call, BEFORE the DB insert):
- Extract a JSON array from the response body (regex ``\\[[\\s\\S]*\\]``).
- Per concept: verify required string fields are non-empty.
- ``difficulty`` must be 1/2/3 — else default 2.
- ``bloom_level`` must be in {remember, understand, apply, analyze} — else
  default 'understand'.
- ``common_mistakes`` clipped to the first 3 string items.
- Require 3-6 concepts. <3 → reject. >6 → slice to 6.

If the parser rejects the response, the handler flips that chapter to
failed=1 and the batch continues with the next chapter — exactly the
TS-side per-chapter failure posture.
"""

from __future__ import annotations

import json
import re
from typing import Any

import structlog

from .models import (
    DEFAULT_BLOOM_LEVEL,
    DEFAULT_DIFFICULTY,
    VALID_BLOOM_LEVELS,
    VALID_DIFFICULTIES,
    GeneratedConcept,
)

logger = structlog.get_logger(__name__)

# Matches the first JSON array in a string. Mirrors TS regex
# /\[[\s\S]*\]/ (index.ts:484) — greedy [...] body so wrapping prose or
# markdown fences don't trip the parse.
_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]")

# 3-6 concepts per chapter — mirrors TS index.ts:538-539.
_MIN_CONCEPTS = 3
_MAX_CONCEPTS = 6


def parse_concepts_response(raw: str) -> list[GeneratedConcept] | None:
    """Parse the LLM response and produce 3-6 validated concept records.

    Args:
        raw: the LLM response text. May be wrapped in markdown fences or
            include prose before/after the JSON array body.

    Returns:
        List of 3-6 :class:`GeneratedConcept` records, or ``None`` when:
          - the regex cannot find a ``[...]`` body
          - the array is empty / not a list
          - fewer than 3 concepts survive validation
          - JSON parsing fails

    Behaviour mirrors TS ``parseConceptsResponse`` (index.ts:481-543)
    byte-for-byte at the contract level. Internal logging structured so
    quality drift across runtimes is observable in dashboards.
    """
    if not isinstance(raw, str) or not raw:
        return None

    match = _JSON_ARRAY_RE.search(raw)
    if not match:
        return None

    try:
        parsed = json.loads(match.group(0))
    except (ValueError, TypeError):
        return None

    if not isinstance(parsed, list) or not parsed:
        return None

    concepts: list[GeneratedConcept] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue

        # Required string fields. Mirrors TS index.ts:494-507.
        title = item.get("title")
        learning_objective = item.get("learning_objective")
        explanation = item.get("explanation")
        example_title = item.get("example_title")
        example_content = item.get("example_content")

        if not _is_nonempty_str(title):
            continue
        if not _is_nonempty_str(learning_objective):
            continue
        if not _is_nonempty_str(explanation):
            continue
        if not _is_nonempty_str(example_title):
            continue
        if not _is_nonempty_str(example_content):
            continue

        # Difficulty coercion. Mirrors TS index.ts:510-512.
        raw_difficulty = item.get("difficulty")
        difficulty = DEFAULT_DIFFICULTY
        if (
            isinstance(raw_difficulty, int)
            and not isinstance(raw_difficulty, bool)
            and raw_difficulty in VALID_DIFFICULTIES
        ):
            difficulty = raw_difficulty

        # Bloom level coercion. Mirrors TS index.ts:515-517.
        raw_bloom = item.get("bloom_level")
        bloom_level: str = DEFAULT_BLOOM_LEVEL
        if isinstance(raw_bloom, str) and raw_bloom in VALID_BLOOM_LEVELS:
            bloom_level = raw_bloom

        # common_mistakes: filter strings + cap at 3. Mirrors TS index.ts:520-522.
        raw_mistakes = item.get("common_mistakes")
        common_mistakes: list[str] = []
        if isinstance(raw_mistakes, list):
            for m in raw_mistakes:
                if isinstance(m, str) and m:
                    common_mistakes.append(m)
                if len(common_mistakes) >= 3:
                    break

        # key_formula: optional string, trimmed. Mirrors TS index.ts:528.
        raw_formula = item.get("key_formula")
        key_formula: str | None = None
        if isinstance(raw_formula, str):
            stripped = raw_formula.strip()
            # TS keeps empty strings as-is (".trim()"), so do the same here.
            key_formula = stripped

        # title is verified non-empty above; cast for type checker.
        assert isinstance(title, str)
        assert isinstance(learning_objective, str)
        assert isinstance(explanation, str)
        assert isinstance(example_title, str)
        assert isinstance(example_content, str)

        try:
            concept = GeneratedConcept(
                title=title.strip(),
                learning_objective=learning_objective.strip(),
                explanation=explanation.strip(),
                key_formula=key_formula,
                example_title=example_title.strip(),
                example_content=example_content.strip(),
                common_mistakes=common_mistakes,
                difficulty=difficulty,
                bloom_level=bloom_level,  # already validated above
            )
        except Exception as err:  # noqa: BLE001 — Pydantic ValidationError
            # Defensive: a future model-validator change shouldn't crash
            # the parser. Skip the malformed concept and continue.
            logger.warning(
                "generate_concepts.validator.pydantic_reject",
                error=str(err),
            )
            continue

        concepts.append(concept)
        if len(concepts) >= _MAX_CONCEPTS:
            break

    # Must have 3-6 concepts. <3 ⇒ reject the whole chapter. Mirrors TS
    # index.ts:538-539.
    if len(concepts) < _MIN_CONCEPTS:
        return None

    return concepts


def _is_nonempty_str(value: Any) -> bool:
    """Return True iff ``value`` is a non-empty string after type check.

    Mirrors the TS check pattern ``!item.title || typeof item.title !==
    'string'`` (index.ts:494-505). Empty strings + non-string values both
    fail.
    """
    return isinstance(value, str) and bool(value.strip())
