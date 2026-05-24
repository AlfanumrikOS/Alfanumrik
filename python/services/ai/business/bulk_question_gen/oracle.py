"""Oracle admission gate — direct Anthropic call at temperature=0.

This is the deterministic LLM grader that decides whether a candidate
question's marked correct option is consistent with its explanation. It is
intentionally NOT routed through MoL because:

1. MoL providers default to ~0.7 temperature; the grader requires temp=0
   for reproducible verdicts (REG-54 admission gate).
2. The Python provider's ``call`` surface elevates ``temperature`` to a
   first-class parameter (see ``providers/base.py:50-77``) so we can pass 0
   directly to the AnthropicProvider — closing the gap that the TS path
   bypassed by reaching for a legacy direct-fetch (see TS index.ts lines
   525-589 for the equivalent rationale).

Caching:
    In-process FNV-1a hash keyed on (question_text, options, idx, explanation).
    Cap at 200 entries; oldest dropped first. Same shape as TS
    :file:`supabase/functions/_shared/quiz-oracle.ts:480-515`.

Fail-closed semantics:
    On network/timeout/parse error → returns ``OracleResult(ok=False,
    category='llm_grader_unavailable')`` and does NOT cache. The handler
    treats this as a rejection — P12 (AI safety) prefers dropping a
    question over admitting one we can't audit.
"""

from __future__ import annotations

import json
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Literal

import structlog

from ...mol.providers.anthropic import AnthropicProvider
from ...mol.types import ChatTurn
from .models import CandidateQuestion
from .prompts import (
    QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
    build_oracle_grader_user_prompt,
)

logger = structlog.get_logger(__name__)

# Single per-process instance — same posture as the orchestrator's
# _providers dict (one provider per worker).
_anthropic = AnthropicProvider()

# Oracle grader knobs. TS source uses 12s timeout and 256 tokens
# (index.ts:548, 563).
_ORACLE_TIMEOUT_S = 12
_ORACLE_MAX_TOKENS = 256
# Claude Haiku 4.5 — the same model the TS direct-fetch path uses
# (index.ts:562).
_ORACLE_MODEL = "claude-haiku-4-5-20251001"

# ── Result types ────────────────────────────────────────────────────────────

OracleVerdict = Literal["consistent", "mismatch", "ambiguous"]
OracleRejectionCategory = Literal[
    "llm_mismatch",
    "llm_ambiguous",
    "llm_grader_unavailable",
]


@dataclass(frozen=True)
class LlmGradeResult:
    """Parsed grader JSON. Mirrors TS LlmGradeResult."""

    verdict: OracleVerdict
    reasoning: str = ""
    suggested_correct_index: int | None = None


@dataclass(frozen=True)
class OracleResult:
    """Final admission verdict.

    Attributes:
        ok: True iff the candidate may be admitted to question_bank.
        category: rejection bucket (empty on accept).
        reason: short human-readable reason (empty on accept).
        suggested_correct_index: grader's preferred index on 'mismatch'.
        llm_calls: 1 if the grader was invoked, 0 if cached or short-circuited.
    """

    ok: bool
    category: str = ""
    reason: str = ""
    suggested_correct_index: int | None = None
    llm_calls: int = 1


# ── In-process LRU cache ────────────────────────────────────────────────────

_ORACLE_CACHE_CAP = 200
_oracle_cache: OrderedDict[str, OracleResult] = OrderedDict()


def make_candidate_cache_key(candidate: CandidateQuestion) -> str:
    """FNV-1a 32-bit hash. Mirrors TS ``makeCandidateCacheKey`` exactly.

    Source: ``supabase/functions/_shared/quiz-oracle.ts:483-498``.
    """
    s = (
        f"{candidate.question_text.strip()}\n"
        f"{chr(10).join(o.strip() for o in candidate.options)}\n"
        f"idx={candidate.correct_answer_index}\n"
        f"exp={candidate.explanation.strip()}"
    )
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) & 0xFFFFFFFF
    return f"{h:x}"


def get_cached_result(key: str) -> OracleResult | None:
    """Return cached OracleResult and refresh LRU position; None if absent."""
    val = _oracle_cache.get(key)
    if val is None:
        return None
    _oracle_cache.move_to_end(key)
    return val


def set_cached_result(key: str, result: OracleResult) -> None:
    """Insert into LRU cache. Drops the oldest entry when over cap."""
    if key in _oracle_cache:
        _oracle_cache.move_to_end(key)
        _oracle_cache[key] = result
        return
    if len(_oracle_cache) >= _ORACLE_CACHE_CAP:
        _oracle_cache.popitem(last=False)
    _oracle_cache[key] = result


def clear_oracle_cache() -> None:
    """Test-only cache reset."""
    _oracle_cache.clear()


# ── Response parser ─────────────────────────────────────────────────────────


def parse_llm_grader_response(raw: str) -> LlmGradeResult | None:
    """Parse the grader's JSON envelope. Mirrors TS ``parseLlmGraderResponse``.

    Returns None on any parse failure or invalid verdict.
    """
    if not isinstance(raw, str):
        return None
    stripped = raw
    stripped = re.sub(r"^\s*```json\s*", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"^\s*```\s*", "", stripped)
    stripped = re.sub(r"\s*```\s*$", "", stripped)
    stripped = stripped.strip()
    try:
        obj = json.loads(stripped)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    verdict = obj.get("verdict")
    if verdict not in ("consistent", "mismatch", "ambiguous"):
        return None
    reasoning = obj.get("reasoning")
    if not isinstance(reasoning, str):
        reasoning = ""
    suggested = obj.get("suggested_correct_index")
    suggested_clamped: int | None = None
    if (
        isinstance(suggested, int)
        and not isinstance(suggested, bool)
        and 0 <= suggested <= 3
    ):
        suggested_clamped = suggested
    return LlmGradeResult(
        verdict=verdict,
        reasoning=reasoning,
        suggested_correct_index=suggested_clamped,
    )


# ── Grader call ─────────────────────────────────────────────────────────────


async def grade_candidate(candidate: CandidateQuestion) -> OracleResult:
    """Admission gate — single grader call at temperature=0.

    Cached per-candidate. On network/timeout/parse failure, returns
    ``OracleResult(ok=False, category='llm_grader_unavailable')`` and does
    NOT cache (TS Q2 follow-up — a transient blip must not pin the same
    candidate to a sticky rejection across retries).
    """
    key = make_candidate_cache_key(candidate)
    cached = get_cached_result(key)
    if cached is not None:
        # Cached call ⇒ 0 new llm_calls. Return the cached envelope as-is.
        return cached

    user_prompt = build_oracle_grader_user_prompt(
        question_text=candidate.question_text,
        options=candidate.options,
        correct_answer_index=candidate.correct_answer_index,
        explanation=candidate.explanation,
    )

    if not _anthropic.is_configured():
        result = OracleResult(
            ok=False,
            category="llm_grader_unavailable",
            reason="Anthropic provider not configured (no API key)",
            llm_calls=0,
        )
        # Do NOT cache: config can change at runtime via env reload.
        return result

    try:
        response = await _anthropic.call(
            model=_ORACLE_MODEL,
            system_prompt=QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
            user_messages=[ChatTurn(role="user", content=user_prompt)],
            max_tokens=_ORACLE_MAX_TOKENS,
            temperature=0,  # Deterministic verdict — non-negotiable for P6 admission.
            timeout_seconds=_ORACLE_TIMEOUT_S,
        )
    except Exception as err:  # noqa: BLE001 — fail closed; orchestrator drops candidate
        logger.warning(
            "bulk_question_gen.oracle.call_failed",
            error=str(err),
            candidate_key=key,
        )
        # Fail closed; do NOT cache (Q2: transient errors mustn't stick).
        return OracleResult(
            ok=False,
            category="llm_grader_unavailable",
            reason=f"oracle call threw: {err}",
            llm_calls=1,
        )

    graded = parse_llm_grader_response(response.text)
    if graded is None:
        # Treat unparseable response as ambiguous — same as TS path.
        result = OracleResult(
            ok=False,
            category="llm_ambiguous",
            reason="grader returned unparseable JSON",
            llm_calls=1,
        )
        set_cached_result(key, result)
        return result

    if graded.verdict == "consistent":
        result = OracleResult(ok=True, llm_calls=1)
    elif graded.verdict == "mismatch":
        result = OracleResult(
            ok=False,
            category="llm_mismatch",
            reason=(graded.reasoning or "LLM grader returned mismatch")[:300],
            suggested_correct_index=graded.suggested_correct_index,
            llm_calls=1,
        )
    else:  # 'ambiguous'
        result = OracleResult(
            ok=False,
            category="llm_ambiguous",
            reason=(graded.reasoning or "LLM grader returned ambiguous")[:300],
            llm_calls=1,
        )

    set_cached_result(key, result)
    return result
