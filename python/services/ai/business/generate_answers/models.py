"""Pydantic request/response models for ``POST /v1/generate-answers``.

Mirrors the TS Edge Function HTTP contract byte-for-byte at the field level.
The Edge proxy in TS will forward requests to this endpoint as-is, so any
divergence here breaks the TS Edge → Python proxy cutover.

Source of truth: :file:`supabase/functions/generate-answers/index.ts`
lines 11-21 (body docstring), 410-415 (PostParams interface), 614-628
(response envelope).

Product invariants enforced at the model layer:
- P5: ``grade`` is a string ``'6'..'12'`` when provided — never an integer.
  (Optional here because GET-status path takes no grade and the POST path
  uses grade as a filter, defaulting to "all grades".)
- ``batch_size`` clamped to 1..50 (TS default 20, max 50) at the field
  layer matches index.ts:429-432.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# ── Allowed enums (mirror the TS Edge Function) ─────────────────────────────
# TS source: generate-answers/index.ts lines 49-58 (VALID_METHODOLOGIES).
VALID_METHODOLOGIES = (
    "definition",
    "stepwise",
    "diagram",
    "derivation",
    "essay",
    "numerical",
    "comparison",
    "analysis",
)

# Batch-size limits — mirror TS constants (index.ts:42-43).
MAX_BATCH_SIZE = 50
DEFAULT_BATCH_SIZE = 20


# ── Request envelope ────────────────────────────────────────────────────────


class GenerateAnswersRequest(BaseModel):
    """POST body. Field shape mirrors TS PostParams (index.ts lines 410-415).

    All fields are optional — TS path falls back to "no filter / default batch
    / not a dry run" when keys are absent. ``extra='forbid'`` matches REG-73
    so the proxy cutover catches any drift between TS-side body shape and
    Python expectations.

    ``grade`` / ``subject`` are filters: when provided, only ``question_bank``
    rows matching those values are considered. ``batch_size`` is clamped to
    the TS-side ``[1, MAX_BATCH_SIZE]`` range; out-of-range values fall back
    to ``DEFAULT_BATCH_SIZE`` per the TS handler at index.ts:429-432.
    """

    model_config = ConfigDict(extra="forbid")

    grade: str | None = Field(default=None, description="P5: string grade '6'..'12' or None for any.")
    subject: str | None = Field(default=None, description="CBSE subject code; None for any.")
    batch_size: int | None = Field(
        default=None,
        description="Questions per run. Clamped to [1, 50]. TS default 20.",
    )
    dry_run: bool | None = Field(
        default=None,
        description="When true, fetch matching questions but skip answer generation.",
    )


# ── Generated answer shape ──────────────────────────────────────────────────


class GeneratedAnswer(BaseModel):
    """One parsed answer from the LLM response.

    Mirrors TS ``GeneratedAnswer`` (generate-answers/index.ts lines 109-113).
    """

    model_config = ConfigDict(extra="forbid")
    answer_text: str
    answer_methodology: str = Field(..., description="One of VALID_METHODOLOGIES.")
    marks_expected: int = Field(..., ge=1, le=10)


# ── Response envelopes ──────────────────────────────────────────────────────


class DryRunQuestionPreview(BaseModel):
    """Slim question preview returned on dry_run=true.

    Mirrors TS preview shape (index.ts:489-495).
    """

    model_config = ConfigDict(extra="forbid")
    id: str
    grade: str
    subject: str
    question_type_v2: str | None = None
    question_text: str


class GenerateAnswersResponse(BaseModel):
    """POST response. Mirrors TS handler's jsonResponse envelope.

    The shape is the union of the two TS response branches:
      - dry_run=true (index.ts:485-501)
      - normal run (index.ts:611-625)

    Both fields ``questions`` and ``remaining`` are optional so a single
    response model can carry either branch — same as the TS JSON which
    selectively includes them.
    """

    model_config = ConfigDict(extra="forbid")

    success: bool
    total_found: int
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    errors: list[str] = Field(default_factory=list)
    elapsed_ms: int
    remaining: int | None = None
    dry_run: bool = False
    questions: list[DryRunQuestionPreview] | None = None


class StatusBreakdownEntry(BaseModel):
    """One row of the GET status breakdown.

    Mirrors TS shape at index.ts:386-391.
    """

    model_config = ConfigDict(extra="forbid")
    total: int
    with_answer: int
    without_answer: int


class GenerateAnswersStatusResponse(BaseModel):
    """GET response. Mirrors TS jsonResponse at index.ts:399-410.

    Coverage view of how many ``question_bank`` rows have answers.
    """

    model_config = ConfigDict(extra="forbid")
    total_active: int
    with_answer: int
    without_answer: int
    coverage_percent: int
    breakdown: dict[str, StatusBreakdownEntry] | None = None
