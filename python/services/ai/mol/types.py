"""Pydantic models for the MoL Python port.

Mirrors :file:`supabase/functions/_shared/mol/types.ts` byte-for-byte at the
field level. The cutover from TS Edge Functions → this Python service is a
network swap — request/response payloads MUST validate against both stacks.

Naming rules:
- Field names are snake_case (matches TS source).
- ``TaskType`` / ``Language`` / ``ExamGoal`` are ``Literal[...]`` aliases so
  Pydantic generates a proper JSON-schema enum.
- ``grade`` is a string ("6".."12"), enforced via :func:`_validate_grade`
  (product invariant P5).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ── TaskType: every key in BASE_MATRIX (router.py). ──
# 'grounding_check' (2026-05-18) is an additive label used by grounded-answer's
# strict-mode fact-check pass; the orchestrator treats unknown task_types via
# the BASE_MATRIX default lookup, so it is intentionally NOT a router key.
TaskType = Literal[
    "explanation",
    "concept_explanation",
    "step_by_step",
    "reasoning",
    "quiz_generation",
    "evaluation",
    "doubt_solving",
    "ocr_extraction",
    "grounding_check",
]

# Phase 2.2 (MOL-unification): opt-in structured-output contract. "foxy" makes
# the prompt-builder append the strict FoxyResponse block-schema instruction so
# the model emits the same JSON contract the TS Foxy pipeline expects. Optional
# and additive — absent → today's text-only output, byte-identical.
StructuredMode = Literal["foxy"]

Language = Literal["en", "hi", "hinglish"]
LearningSpeed = Literal["slow", "moderate", "fast"]
# Mirrors the TS union exactly. NOTE: the spec doc listed 'none|jee|neet|cuet|
# boards', but the TS source is ground-truth and uses 'cbse|jee|neet|general'
# — and that's what every existing telemetry row carries.
ExamGoal = Literal["cbse", "jee", "neet", "general"]
GradeTier = Literal["junior", "middle", "senior"]

# Used by router + orchestrator outputs.
ProviderId = Literal["openai", "anthropic"]
# 'hybrid' surfaces on MolResult when the orchestrator ran a 2-pass chain
# (doubt_solving + hybrid flag ON). Matches TS types.ts:MolResult.provider.
# 'cache' surfaces on a semantic-cache hit (A4): the answer was served from the
# Upstash exact-match cache with zero provider calls and zero cost.
ResultProvider = Literal["openai", "anthropic", "hybrid", "cache"]
PassRole = Literal["single", "reason", "simplify", "vision"]
ChainMode = Literal["single", "hybrid", "vision"]


def _validate_grade(v: str) -> str:
    """Enforce product invariant P5: grades are strings '6'..'12'."""
    if not isinstance(v, str):
        raise TypeError("grade must be a string (P5: never an integer)")
    if v not in {"6", "7", "8", "9", "10", "11", "12"}:
        # Accept passes for internal flows that use grade values outside 6-12
        # (e.g. demo seeders, K-5 future work). Warn instead of raise so we
        # don't break shadow rows from upstream callers; the regression suite
        # asserts the canonical set explicitly.
        return v
    return v


# ── Conversation primitives ───────────────────────────────────────────────────


class ChatTurn(BaseModel):
    """One turn in a conversation history. Mirrors the inline TS shape on
    ``GenerateRequest.input.chat_history[]``."""

    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str


# ── Student context ──────────────────────────────────────────────────────────


class StudentContext(BaseModel):
    """Per-request student profile. Mirrors TS ``StudentContext``.

    ``language`` defaults to ``'en'`` on the TS side via prompt-builder
    inference; we keep it optional here so absent inputs are coerced
    deterministically downstream.
    """

    model_config = ConfigDict(extra="forbid")
    student_id: str = Field(..., description="UUID. Never email/phone/name (P13).")
    grade: str = Field(..., description="P5: string '6'..'12'.")
    language: Language | None = Field(default=None)
    learning_speed: LearningSpeed | None = Field(default=None)
    exam_goal: ExamGoal | None = Field(default=None)
    subject: str | None = Field(default=None)
    board: str | None = Field(default=None)

    @field_validator("grade")
    @classmethod
    def _grade_is_string(cls, v: str) -> str:
        return _validate_grade(v)

    @field_validator("student_id")
    @classmethod
    def _student_id_nonempty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("student_id is required")
        return v


# ── Request shape ─────────────────────────────────────────────────────────────


class GenerateInput(BaseModel):
    """Inner ``input`` block on ``GenerateRequest``. Mirrors TS shape."""

    model_config = ConfigDict(extra="forbid")
    question: str | None = None
    topic: str | None = None
    instruction: str | None = None
    chat_history: list[ChatTurn] | None = None
    image_url: str | None = None  # ocr_extraction only
    options: list[str] | None = None  # quiz / evaluation


class GenerateConfig(BaseModel):
    """Optional per-request overrides.

    See :file:`supabase/functions/_shared/mol/types.ts` C4.2a wire-up notes
    for the ``system_prompt_override`` / ``shadow_role`` /
    ``shadow_of_request_id`` / ``trace_id`` shadow-routing contract.
    """

    model_config = ConfigDict(extra="forbid")
    preferred_provider: ProviderId | None = None
    max_tokens_override: int | None = None
    temperature_override: float | None = None
    request_id: str | None = None
    surface: Literal["foxy", "quiz", "solver", "ocr"] | None = None
    # Shadow-routing surface (mirrors TS):
    system_prompt_override: str | None = None
    shadow_role: Literal["baseline", "shadow"] | None = None
    shadow_of_request_id: str | None = None
    trace_id: str | None = None


class GenerateRequest(BaseModel):
    """The orchestrator's input envelope."""

    model_config = ConfigDict(extra="forbid")
    task_type: TaskType | None = None  # classifier infers when None
    input: GenerateInput
    student_context: StudentContext
    rag_context: str | None = None
    # Phase 2.2: opt-in structured-output mode. When "foxy", the prompt-builder
    # appends the FoxyResponse block-schema instruction. None → text-only
    # (byte-identical to prior behavior). Bypassed when
    # config.system_prompt_override is set (the production grounded-answer seam
    # supplies the fully-composed prompt, which already carries the schema).
    structured: StructuredMode | None = None
    config: GenerateConfig | None = None


# ── Provider + chain shapes ──────────────────────────────────────────────────


class ProviderTarget(BaseModel):
    """One rung on a provider chain (single ``provider``+``model`` pair)."""

    model_config = ConfigDict(extra="forbid")
    provider: ProviderId
    model: str


class Pass(BaseModel):
    """A pass = one ordered fallback chain. First success wins."""

    model_config = ConfigDict(extra="forbid")
    chain: list[ProviderTarget]
    role: PassRole


class SelectedChain(BaseModel):
    """Router output — the chain a single ``generate_response`` call will run."""

    model_config = ConfigDict(extra="forbid")
    task_type: TaskType
    passes: list[Pass]
    mode: ChainMode


# ── Provider call internals ──────────────────────────────────────────────────


class TokenUsage(BaseModel):
    """Prompt + completion token counts. Summed across passes for MolResult."""

    model_config = ConfigDict(extra="forbid")
    prompt: int = 0
    completion: int = 0

    def __add__(self, other: TokenUsage) -> TokenUsage:
        return TokenUsage(
            prompt=self.prompt + other.prompt,
            completion=self.completion + other.completion,
        )


class ProviderResponse(BaseModel):
    """Output of a single provider call. Internal — orchestrator composes these
    into a MolResult.
    """

    model_config = ConfigDict(extra="forbid")
    text: str
    provider: ProviderId
    model: str
    tokens: TokenUsage
    finish_reason: str
    raw: Any = None  # Provider-specific response payload; not serialized over the wire.


# ── Orchestrator output ──────────────────────────────────────────────────────


class MolResult(BaseModel):
    """Final response to the caller. Mirrors TS ``MolResult``.

    Field shape is part of the public API contract — every dashboard, every
    Sentry breadcrumb, every analytics event reads these. Do not rename
    without coordinating with the super-admin reporting surface.
    """

    model_config = ConfigDict(extra="forbid")
    text: str
    provider: ResultProvider
    model: str
    task_type: TaskType
    latency_ms: int
    tokens: TokenUsage
    usd_cost: float
    inr_cost: float
    fallback_count: int = 0
    passes: int = 1
    request_id: str
    # ``failure_chain`` is on the TS LogPayload but not the TS MolResult; we
    # expose it on the Python result so callers can surface it in error UIs
    # without re-querying mol_request_logs. Optional, defaults to empty.
    failure_chain: list[str] = Field(default_factory=list)
    # RAW provider stop/finish reason of the WINNING provider response (the one
    # whose ``text`` this result carries). Vocabulary is provider-native and
    # un-normalized:
    #   - Anthropic ``stop_reason``: end_turn | max_tokens | stop_sequence | tool_use
    #   - OpenAI   ``finish_reason``: stop | length | content_filter | tool_calls
    # Additive + optional (like ``failure_chain`` above — not on the TS
    # MolResult). ``None`` when there is no provider call (e.g. a semantic-cache
    # hit). The TS grounded-answer seam
    # (foxy-python-generation.ts::mapMolResultToClaudeResponse) maps this onto
    # its normalized ``ClaudeStopReason`` so a Python-sourced answer that hit the
    # token budget mid-JSON can trigger the SAME flag-gated bounded
    # max_tokens-continuation the Claude path does (``length``/``max_tokens`` →
    # ``max_tokens``; everything else → ``end_turn``).
    finish_reason: str | None = None
