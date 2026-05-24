"""Answer validation — port of TS ``parseAnswerResponse``.

Source of truth (port from):
    :file:`supabase/functions/generate-answers/index.ts` lines 299-336.

Post-LLM checks (P12):
- Extract JSON object from response (handles markdown-fence wrapping).
- Verify ``answer_text`` is a non-empty string.
- Validate ``answer_methodology`` is in ``VALID_METHODOLOGIES``; default
  to ``'definition'`` when invalid (matches TS line 314).
- Clamp ``marks_expected`` to [1, 10]; default to 2 (or 1 for MCQ) when
  invalid (matches TS lines 319-326).
- MCQ override: always 1 mark regardless of LLM's suggestion (TS line 324).

The handler runs an additional length floor check (≥ 10 chars) AFTER this
function returns — see ``handler.py`` for the post-parse safety gate that
mirrors TS index.ts:585-591.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .models import VALID_METHODOLOGIES, GeneratedAnswer

# Matches the first JSON object in a string. Mirrors TS regex
# /\{[\s\S]*\}/ (generate-answers/index.ts:302) — greedy {...} body.
_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")


@dataclass(frozen=True)
class ParseResult:
    """Outcome of parsing one LLM answer response.

    ``answer`` is None when parsing failed; ``reason`` is a short bucket label
    for telemetry. Mirrors the TS pattern of returning ``null`` and letting
    the caller log the rejection bucket.
    """

    answer: GeneratedAnswer | None
    reason: str = ""


def parse_answer_response(raw: str, is_mcq: bool) -> ParseResult:
    """Parse one ``answer_text``/``answer_methodology``/``marks_expected`` JSON.

    Args:
        raw: the LLM response text. May be wrapped in markdown fences or
            include prose before/after the JSON body.
        is_mcq: when True, force ``marks_expected=1`` per CBSE single-mark
            MCQ convention. Mirrors TS line 324.

    Returns:
        :class:`ParseResult` with ``answer`` populated on success, or with a
        ``reason`` label on failure. Reason buckets:
          - ``no_json_object``: regex couldn't find a ``{...}`` body
          - ``invalid_json``: JSON parse error
          - ``not_dict``: top-level JSON is not an object
          - ``empty_answer``: ``answer_text`` missing / empty / not a string
    """
    if not isinstance(raw, str) or not raw:
        return ParseResult(None, "no_json_object")

    match = _JSON_OBJECT_RE.search(raw)
    if not match:
        return ParseResult(None, "no_json_object")

    try:
        parsed = json.loads(match.group(0))
    except (ValueError, TypeError):
        return ParseResult(None, "invalid_json")

    if not isinstance(parsed, dict):
        return ParseResult(None, "not_dict")

    # answer_text — required, non-empty string.
    answer_text = parsed.get("answer_text")
    if not isinstance(answer_text, str) or not answer_text.strip():
        return ParseResult(None, "empty_answer")

    # answer_methodology — coerce to known value, default 'definition'.
    methodology = "definition"
    proposed = parsed.get("answer_methodology")
    if isinstance(proposed, str) and proposed in VALID_METHODOLOGIES:
        methodology = proposed

    # marks_expected — integer in [1, 10]; default 1 for MCQ else 2.
    marks = 1 if is_mcq else 2
    proposed_marks = parsed.get("marks_expected")
    if (
        isinstance(proposed_marks, int | float)
        and not isinstance(proposed_marks, bool)
        and 1 <= proposed_marks <= 10
    ):
        marks = round(float(proposed_marks))
    # MCQ override — always 1 (TS line 324).
    if is_mcq:
        marks = 1

    answer = GeneratedAnswer(
        answer_text=answer_text.strip(),
        answer_methodology=methodology,
        marks_expected=marks,
    )
    return ParseResult(answer)
