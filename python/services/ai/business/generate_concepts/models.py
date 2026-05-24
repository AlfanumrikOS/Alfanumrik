"""Pydantic request/response models for ``POST /v1/generate-concepts``.

Mirrors the TS Edge Function HTTP contract byte-for-byte at the field level.
The Edge proxy in TS forwards requests to this endpoint as-is, so any
divergence here breaks the TS Edge → Python proxy cutover.

Source of truth: :file:`supabase/functions/generate-concepts/index.ts`
lines 11-21 (POST body), 622-627 (PostParams interface), 853-869 (POST
response envelope), 600-616 (GET status envelope).

Product invariants enforced at the model layer:
- P5: ``grade`` is a string ``'6'..'12'`` when provided — never an integer.
- ``batch_size`` clamping (default 5, max 15) is enforced at the handler
  layer (mirrors TS ``index.ts:652-655``).
- P6: ``ConceptRow`` enforces required fields (title, learning_objective,
  explanation, example_title, example_content) and bounded difficulty +
  bloom_level enums. The handler additionally rejects responses with
  fewer than 3 concepts.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ── Allowed enums (mirror the TS Edge Function) ─────────────────────────────
# TS source: generate-concepts/index.ts lines 52-59 (VALID_BLOOM_LEVELS).
VALID_BLOOM_LEVELS = (
    "remember",
    "understand",
    "apply",
    "analyze",
)
BloomLevel = Literal["remember", "understand", "apply", "analyze"]

# Difficulty band: 1=easy, 2=medium, 3=hard. Mirrors TS line 510-512.
VALID_DIFFICULTIES = (1, 2, 3)

# Batch-size limits — mirror TS constants (index.ts:42-43).
MAX_BATCH_SIZE = 15
DEFAULT_BATCH_SIZE = 5

# Default difficulty when LLM returns an out-of-band value. Matches TS
# index.ts:511 fallback.
DEFAULT_DIFFICULTY = 2
DEFAULT_BLOOM_LEVEL: BloomLevel = "understand"


# ── Request envelope ────────────────────────────────────────────────────────


class GenerateConceptsRequest(BaseModel):
    """POST body. Field shape mirrors TS PostParams (index.ts lines 622-627).

    All fields are optional — TS path falls back to "no filter / default
    batch / not a dry run" when keys are absent. ``extra='forbid'`` matches
    REG-73 so the proxy cutover catches any drift between TS-side body
    shape and Python expectations.

    ``grade`` / ``subject`` are filters: when provided, only chapters
    matching those values are considered. ``batch_size`` is clamped to the
    TS-side ``[1, MAX_BATCH_SIZE]`` range; out-of-range values fall back
    to ``DEFAULT_BATCH_SIZE`` per the handler at index.ts:652-655.
    """

    model_config = ConfigDict(extra="forbid")

    grade: str | None = Field(
        default=None, description="P5: string grade '6'..'12' or None for any."
    )
    subject: str | None = Field(default=None, description="CBSE subject; None for any.")
    batch_size: int | None = Field(
        default=None,
        description="Chapters per run. Clamped to [1, 15]. TS default 5.",
    )
    dry_run: bool | None = Field(
        default=None,
        description="When true, list candidate chapters but skip generation.",
    )

    @field_validator("grade")
    @classmethod
    def _grade_must_be_string_or_none(cls, v: str | None) -> str | None:
        """P5: explicit guard against integer grades sneaking past Pydantic.

        Pydantic's coercion would happily turn ``10`` into ``"10"``; this
        validator rejects non-string inputs early so the contract is
        unambiguous at the wire level.
        """
        if v is None:
            return None
        if not isinstance(v, str):
            raise TypeError("grade must be a string (P5: never an integer)")
        return v


# ── Chapter shape (internal) ────────────────────────────────────────────────


class ChapterInfo(BaseModel):
    """One chapter candidate. Internal — never serialized over the wire.

    Mirrors TS ``ChapterInfo`` (index.ts lines 134-141). Carries both the
    raw RAG keys ("Grade 10" / "Mathematics") used for the
    ``get_chapter_rag_content`` RPC and the normalised keys ("10" / "math")
    used for the ``chapter_concepts`` insert.
    """

    model_config = ConfigDict(extra="forbid")
    rag_grade: str
    rag_subject: str
    grade: str
    subject: str
    chapter_number: int
    chapter_title: str


class ChapterPreview(BaseModel):
    """Slim chapter preview returned on dry_run=true.

    Mirrors TS dry-run payload at index.ts:692-697.
    """

    model_config = ConfigDict(extra="forbid")
    grade: str
    subject: str
    chapter_number: int
    chapter_title: str


# ── Generated concept shape ─────────────────────────────────────────────────


class GeneratedConcept(BaseModel):
    """One parsed concept from the LLM response.

    Mirrors TS ``GeneratedConcept`` (index.ts lines 143-153). Used as the
    intermediate shape between the validator and the row builder in
    :mod:`.handler`.
    """

    model_config = ConfigDict(extra="forbid")
    title: str
    learning_objective: str
    explanation: str
    key_formula: str | None = None
    example_title: str
    example_content: str
    common_mistakes: list[str] = Field(default_factory=list)
    difficulty: int = Field(default=DEFAULT_DIFFICULTY, ge=1, le=3)
    bloom_level: BloomLevel = DEFAULT_BLOOM_LEVEL


# ── Response envelopes ──────────────────────────────────────────────────────


class GenerateConceptsResponse(BaseModel):
    """POST response. Mirrors TS handler's jsonResponse envelope.

    The shape is the union of the two TS response branches:
      - dry_run=true (index.ts:686-704)
      - normal run (index.ts:853-869)

    ``chapters`` is populated only on dry_run; ``remaining`` is populated
    only on the normal run. Mirrors the TS JSON which selectively includes
    them.
    """

    model_config = ConfigDict(extra="forbid")

    success: bool
    total_found: int
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    elapsed_ms: int
    remaining: int | None = None
    dry_run: bool = False
    chapters: list[ChapterPreview] | None = None


class StatusBreakdownEntry(BaseModel):
    """One row of the GET status breakdown.

    Mirrors TS shape at index.ts:588-599.
    """

    model_config = ConfigDict(extra="forbid")
    total: int
    with_concepts: int
    without_concepts: int


class GenerateConceptsStatusResponse(BaseModel):
    """GET response. Mirrors TS jsonResponse at index.ts:601-616.

    Coverage view of how many rag_content_chunks chapters have entries in
    chapter_concepts.
    """

    model_config = ConfigDict(extra="forbid")
    total_chapters: int
    with_concepts: int
    without_concepts: int
    coverage_percent: int
    breakdown: dict[str, StatusBreakdownEntry] = Field(default_factory=dict)


# ── Insert row shape (chapter_concepts) ─────────────────────────────────────


class ConceptInsertRow(BaseModel):
    """One row scheduled for insertion into ``chapter_concepts``.

    Mirrors the TS row-mapping logic at index.ts:773-814 — one row per
    parsed concept, with diagram_refs filtered by title-keyword match and
    a practice_question optionally peeled from question_bank.

    The model is intentionally permissive on the practice-* fields so the
    handler can populate them lazily; the actual DB schema constraints
    enforce P6 quality at the row level.
    """

    model_config = ConfigDict(extra="forbid")
    grade: str  # P5: string grade
    subject: str
    chapter_number: int
    chapter_title: str
    concept_number: int
    title: str
    slug: str
    learning_objective: str
    explanation: str
    key_formula: str | None = None
    example_title: str
    example_content: str
    common_mistakes: list[str] = Field(default_factory=list)
    exam_tips: list[str] = Field(default_factory=list)
    diagram_refs: list[dict[str, Any]] = Field(default_factory=list)
    practice_question: str | None = None
    practice_options: list[str] | None = None
    practice_correct_index: int | None = None
    practice_explanation: str | None = None
    difficulty: int = Field(default=DEFAULT_DIFFICULTY, ge=1, le=3)
    bloom_level: BloomLevel = DEFAULT_BLOOM_LEVEL
    estimated_minutes: int = 5
    is_active: bool = True
    source: str = "ncert_2025"
