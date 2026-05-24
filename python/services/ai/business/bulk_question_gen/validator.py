"""P6 + P11 candidate validation — port of TS ``isValidQuestion``.

Source of truth (port from):
    :file:`supabase/functions/bulk-question-gen/index.ts` lines 253-333.

Product invariants enforced here:
- **P6 (Question Quality)** — every accepted question MUST satisfy:
  - non-empty ``question_text``, no ``{{`` / ``[BLANK]`` placeholders
  - exactly 4 options, each non-empty, all distinct (case-insensitive)
  - ``correct_answer_index`` ∈ {0, 1, 2, 3}
  - non-empty ``explanation``
  - non-empty ``hint``
  - ``difficulty`` integer in 1..5
  - ``bloom_level`` in the canonical set
- **P11 (arithmetic-consistency)** — the explanation's final numeric token
  must not unambiguously contradict the marked answer.

The P11 check is the high-precision variant from the TS source (lines 289-330):
we only reject when ALL of these are true:
  1. The explanation's final ASCII number is one of the four options.
  2. That option is at a DIFFERENT index than ``correct_answer_index``.
  3. The text of the option at ``correct_answer_index`` does NOT appear
     anywhere in the explanation (case-insensitive substring).

Without rule 3, the legacy rule produced ~62% false positives in prod audits
(see TS comment block lines 290-312).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import VALID_BLOOM_LEVELS, CandidateQuestion

# ── Constants ───────────────────────────────────────────────────────────────

_PLACEHOLDER_TOKENS = ("{{", "[BLANK]")
_VALID_DIFFICULTY_MIN = 1
_VALID_DIFFICULTY_MAX = 5

# Matches the LAST signed-or-unsigned integer/decimal in a string.
# Mirrors TS regex /(-?\d+(?:\.\d+)?)(?!.*\d)/ (index.ts line 313).
_FINAL_NUMBER_RE = re.compile(r"(-?\d+(?:\.\d+)?)(?!.*\d)")


# ── Result type ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of validating a single candidate.

    Attributes:
        ok: True iff the candidate passed every check.
        reason: Short human-readable reason on rejection; empty on accept.
        category: Machine-readable rejection bucket for telemetry.
    """

    ok: bool
    reason: str = ""
    category: str = ""


# ── Public API ──────────────────────────────────────────────────────────────


def validate_candidate(q: CandidateQuestion) -> ValidationResult:
    """Run P6 + P11 checks on one candidate. Pure function — no I/O.

    Returns ``ValidationResult(ok=True)`` if accepted, else a structured
    rejection with category + reason for the rejection-count telemetry.
    """
    # 1. Question text — non-empty, no template placeholders.
    text = (q.question_text or "").strip()
    if not text:
        return ValidationResult(False, "question_text is empty", "p6_text_empty")
    for tok in _PLACEHOLDER_TOKENS:
        if tok in text:
            return ValidationResult(
                False,
                f"question_text contains placeholder {tok!r}",
                "p6_text_placeholder",
            )

    # 2. Options — exactly 4 entries, each non-empty + case-insensitive distinct.
    opts = q.options
    if not isinstance(opts, list) or len(opts) != 4:
        return ValidationResult(
            False,
            f"expected exactly 4 options, got {len(opts) if isinstance(opts, list) else 'non-list'}",
            "p6_options_count",
        )
    cleaned: list[str] = []
    for i, raw in enumerate(opts):
        if not isinstance(raw, str) or not raw.strip():
            return ValidationResult(
                False, f"option at index {i} is empty or not a string", "p6_option_empty"
            )
        cleaned.append(raw.strip())
    lowered = [o.lower() for o in cleaned]
    if len(set(lowered)) != 4:
        return ValidationResult(
            False, "options are not all distinct (case-insensitive)", "p6_options_not_distinct"
        )

    # 3. correct_answer_index — integer 0..3.
    idx = q.correct_answer_index
    # Pydantic already coerces ints, but bool is a subclass of int — exclude it.
    if isinstance(idx, bool) or not isinstance(idx, int) or idx < 0 or idx > 3:
        return ValidationResult(
            False, f"correct_answer_index must be integer 0..3, got {idx!r}", "p6_correct_index"
        )

    # 4. Explanation — non-empty.
    exp = (q.explanation or "").strip()
    if not exp:
        return ValidationResult(False, "explanation is empty", "p6_explanation_empty")

    # 5. Hint — non-empty (TS requires this on the bulk-gen path; the
    # grounded path leaves it empty, which is handled in the repository
    # by stripping the requirement).
    hint = (q.hint or "").strip()
    if not hint:
        return ValidationResult(False, "hint is empty", "p6_hint_empty")

    # 6. Difficulty — integer 1..5.
    diff = q.difficulty
    if (
        isinstance(diff, bool)
        or not isinstance(diff, int)
        or diff < _VALID_DIFFICULTY_MIN
        or diff > _VALID_DIFFICULTY_MAX
    ):
        return ValidationResult(
            False,
            f"difficulty must be integer 1..5, got {diff!r}",
            "p6_difficulty",
        )

    # 7. Bloom level — valid lower-cased token.
    bloom = (q.bloom_level or "").lower().strip()
    if bloom not in VALID_BLOOM_LEVELS:
        return ValidationResult(
            False,
            f"bloom_level must be one of {sorted(VALID_BLOOM_LEVELS)}, got {q.bloom_level!r}",
            "p6_bloom_level",
        )

    # 8. P11 arithmetic consistency — high-precision variant.
    # See module docstring + TS source lines 289-330 for the rationale.
    arithmetic_fail = _check_arithmetic_consistency(cleaned, idx, exp)
    if arithmetic_fail:
        return ValidationResult(False, arithmetic_fail, "p11_arithmetic_inconsistency")

    return ValidationResult(True)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _check_arithmetic_consistency(
    options_clean: list[str],
    correct_idx: int,
    explanation: str,
) -> str | None:
    """Port of TS lines 313-330. Returns rejection reason or None.

    Rules (all three must be true to reject):
      1. The explanation's last ASCII number equals one of the four options.
      2. That matching option is at a different index than correct_idx.
      3. The text of options[correct_idx] does NOT appear anywhere in the
         explanation (case-insensitive substring match).
    """
    m = _FINAL_NUMBER_RE.search(explanation)
    if not m:
        return None
    final_number = m.group(1)
    matching_idx = -1
    for i, opt in enumerate(options_clean):
        if opt == final_number:
            matching_idx = i
            break
    if matching_idx < 0 or matching_idx == correct_idx:
        return None
    # Rule 3: trust the answer if it's referenced in the explanation.
    stored_option = options_clean[correct_idx]
    if stored_option and stored_option.lower() in explanation.lower():
        return None
    return (
        f"explanation's final number ({final_number}) matches option index "
        f"{matching_idx}, but correct_answer_index is {correct_idx} and the "
        f"stored option ({stored_option!r}) is not mentioned in the explanation"
    )


# ── JSON-array extractor (mirrors TS extractJsonArray, lines 466-485) ───────


def extract_json_array(text: str) -> list | None:
    """Pull the first JSON array out of an LLM response.

    Strips ```json / ``` fences and any prose around the array. Returns None
    if no parseable array is found.
    """
    import json

    if not isinstance(text, str):
        return None
    stripped = text
    stripped = re.sub(r"^\s*```json\s*", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"^\s*```\s*", "", stripped)
    stripped = re.sub(r"\s*```\s*$", "", stripped)
    stripped = stripped.strip()

    start = stripped.find("[")
    end = stripped.rfind("]")
    if start < 0 or end <= start:
        return None
    candidate = stripped[start : end + 1]
    try:
        parsed = json.loads(candidate)
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, list):
        return None
    return parsed
