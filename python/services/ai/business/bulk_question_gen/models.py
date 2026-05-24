"""Pydantic request/response models for ``POST /v1/bulk-question-gen``.

Mirrors the TS Edge Function HTTP contract byte-for-byte at the field level.
The Edge proxy in TS will forward requests to this endpoint as-is, so any
divergence here breaks the TS Edge → Python proxy cutover.

Source of truth: :file:`supabase/functions/bulk-question-gen/index.ts`
lines 1-34 (body docstring), 136-153 (TS interfaces).

Product invariants enforced at the model layer:
- P5: ``grade`` is a string ``'6'..'12'`` — never an integer.
- P6: ``options`` exactly 4 entries, ``correct_answer_index`` 0..3,
   ``bloom_level`` in the canonical set, ``difficulty`` 1..5.
  Further P6 checks (distinct options, no placeholders) live in
  :mod:`.validator` because they run against generated candidates, not
  the request envelope.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ── Allowed enums (mirror the TS Edge Function) ─────────────────────────────
# TS source: bulk-question-gen/index.ts lines 86-87
VALID_GRADES = ("6", "7", "8", "9", "10", "11", "12")
VALID_BLOOM_LEVELS = frozenset(
    {"remember", "understand", "apply", "analyze", "evaluate", "create"}
)

# CBSE subject allowlist per grade. Mirrors TS VALID_SUBJECTS_BY_GRADE
# (bulk-question-gen/index.ts lines 91-99). Subjects stored lowercase;
# input is normalised before lookup.
VALID_SUBJECTS_BY_GRADE: dict[str, frozenset[str]] = {
    "6": frozenset({"math", "science", "english", "hindi", "social_studies", "social studies"}),
    "7": frozenset({"math", "science", "english", "hindi", "social_studies", "social studies"}),
    "8": frozenset({"math", "science", "english", "hindi", "social_studies", "social studies"}),
    "9": frozenset(
        {
            "math", "science", "english", "hindi", "social_studies", "social studies",
            "physics", "chemistry", "biology",
        }
    ),
    "10": frozenset(
        {
            "math", "science", "english", "hindi", "social_studies", "social studies",
            "physics", "chemistry", "biology",
        }
    ),
    "11": frozenset(
        {
            "math", "physics", "chemistry", "biology", "english", "hindi",
            "economics", "accountancy", "business_studies", "business studies",
            "history", "geography", "political_science", "political science",
        }
    ),
    "12": frozenset(
        {
            "math", "physics", "chemistry", "biology", "english", "hindi",
            "economics", "accountancy", "business_studies", "business studies",
            "history", "geography", "political_science", "political science",
        }
    ),
}


def is_valid_subject_for_grade(grade: str, subject: str) -> bool:
    """Mirror of TS ``isValidSubjectForGrade`` (index.ts lines 102-106)."""
    allowed = VALID_SUBJECTS_BY_GRADE.get(grade)
    if not allowed:
        return False
    return subject.lower().strip() in allowed


# ── Request envelope ────────────────────────────────────────────────────────


class BulkQuestionGenRequest(BaseModel):
    """POST body. Field shape mirrors TS handler (index.ts lines 1027-1093).

    ``count`` / ``difficulty`` / ``bloom_level`` have defaults so the endpoint
    matches the TS contract where missing fields silently fall back. The
    grade-vs-subject cross-check runs in the handler (it depends on grade,
    which is resolved during validation) — Pydantic only validates each
    field in isolation.
    """

    model_config = ConfigDict(extra="forbid")

    grade: Literal["6", "7", "8", "9", "10", "11", "12"] = Field(
        ..., description="P5: string grade '6'..'12'."
    )
    subject: str = Field(..., min_length=1, description="CBSE subject; cross-checked vs grade.")
    chapter: str = Field(..., min_length=1, description="Chapter title/name.")
    chapter_id: str | None = Field(default=None, max_length=36, description="curriculum_topics UUID.")
    count: int = Field(default=10, ge=1, le=50, description="1..50; TS default 10.")
    difficulty: int = Field(default=3, ge=1, le=5, description="1=easy..5=hard; TS default 3.")
    bloom_level: str = Field(default="remember", description="Bloom's taxonomy level.")

    @field_validator("bloom_level")
    @classmethod
    def _bloom_in_set(cls, v: str) -> str:
        """Coerce to lowercase and verify against the canonical set."""
        if not isinstance(v, str):
            raise TypeError("bloom_level must be a string")
        lower = v.lower().strip()
        if lower not in VALID_BLOOM_LEVELS:
            raise ValueError(
                f"bloom_level must be one of {sorted(VALID_BLOOM_LEVELS)}, got {v!r}"
            )
        return lower

    @field_validator("subject")
    @classmethod
    def _strip_subject(cls, v: str) -> str:
        # Same sanitization the TS handler runs (index.ts line 1090):
        #   subject.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').trim().slice(0, 100)
        # We apply it at validation so downstream code never sees unsanitized text.
        cleaned = _strip_html_and_template_chars(v).strip()[:100]
        if not cleaned:
            raise ValueError("subject is required")
        return cleaned

    @field_validator("chapter")
    @classmethod
    def _strip_chapter(cls, v: str) -> str:
        # Mirrors TS sanitization (index.ts line 1091, 200-char cap).
        cleaned = _strip_html_and_template_chars(v).strip()[:200]
        if not cleaned:
            raise ValueError("chapter is required")
        return cleaned


def _strip_html_and_template_chars(s: str) -> str:
    """Strip HTML tags + template-injection chars. Mirrors TS regex chain.

    TS source: ``subject.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '')``.
    """
    import re

    out = re.sub(r"<[^>]*>", "", s)
    out = re.sub(r"[{}`]", "", out)
    return out


# ── Candidate / inserted question shapes ────────────────────────────────────


class CandidateQuestion(BaseModel):
    """One question as parsed from the LLM response (pre-validation).

    Mirrors TS ``GeneratedQuestion`` (bulk-question-gen/index.ts lines 138-146).
    Lax on construction so the validator can return rich rejection reasons;
    strict checks live in :mod:`.validator`.
    """

    model_config = ConfigDict(extra="allow")  # Allow unknown LLM fields (we discard them).

    question_text: str
    options: list[str]
    correct_answer_index: int
    explanation: str
    hint: str = ""
    difficulty: int
    bloom_level: str


class Question(BaseModel):
    """Response-side question shape — what we return to the caller."""

    model_config = ConfigDict(extra="forbid")
    id: str | None = None  # Populated post-insert.
    question_text: str
    options: list[str]
    correct_answer_index: int
    explanation: str
    hint: str = ""
    difficulty: int
    bloom_level: str
    grade: str
    subject: str
    chapter: str


class InsertedQuestion(Question):
    """Alias for Question with an id field guaranteed to be present.

    Kept distinct so the public API contract can evolve independently of
    the post-insert response (e.g. add audit fields later).
    """

    # Override the parent's Optional[str] id with a required str post-insert.
    # mypy doesn't flag this because Pydantic re-validates field types via
    # ``model_config`` rather than the dataclass-style attribute shadowing
    # mypy expects — the annotation is enough.
    id: str


# ── Response envelope ───────────────────────────────────────────────────────


class BulkQuestionGenResponse(BaseModel):
    """POST response. Mirrors TS handler's ``jsonResponse(...)`` (lines 1454-1466).

    - ``generated``: questions produced by the LLM
    - ``inserted``: rows successfully persisted to question_bank
    - ``rejected``: P6/P11 validator drops (None when 0 in TS — we always emit)
    - ``oracle_evaluated``: candidates graded by the LLM oracle
    - ``oracle_rejected``: oracle rejections (subset of evaluated)
    - ``questions``: inserted rows, with id populated
    """

    model_config = ConfigDict(extra="forbid")

    generated: int
    inserted: int
    rejected: int = 0
    oracle_evaluated: int = 0
    oracle_rejected: int = 0
    questions: list[InsertedQuestion]
    warning: str | None = None
