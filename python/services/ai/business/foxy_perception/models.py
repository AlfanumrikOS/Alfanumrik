"""Pydantic request/response models for ``POST /v1/classify``.

Foxy Perception (Phase 1C, 2026-07-15). The endpoint runs a CHEAP MOL task
(gpt-4o-mini, ``task_type='evaluation'``) that reads one Foxy tutoring turn and
emits a compact, structured classification of it. The classification is pure
OBSERVABILITY — it never moves mastery (enforced downstream by the
``learner.turn_classified`` bus contract).

Product invariants enforced at the model layer:
- P5: ``grade`` is a string ('6'..'12') — never coerced to int.
- P12 (AI safety): the classifier stays within CBSE grade/subject scope (the
  system prompt pins this); the response is codes/labels only, never
  student-facing prose.
- P13 (privacy): the RESPONSE carries codes / enums / short labels only — never
  the student's message text, name, email, or phone. The request DOES carry the
  turn text (the classifier's evidence), same internal trust boundary as the
  tutor LLM call, but it is never logged or echoed onto any event.

The Node client (``packages/lib/src/foxy/perception.ts``) POSTs
``ClassifyTurnRequest`` and re-validates every field of the response itself, so
this contract is intentionally loose on the response side (best-effort coercion
happens in ``classifier.py`` before the model is constructed).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Canonical LOWERCASE Bloom taxonomy — IDENTICAL to the TS BloomLevel union
# (packages/lib/src/cognitive-engine.ts) and the learner.turn_classified enum.
BloomLevel = Literal[
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
]

# Struggle signals — mirror learner.struggle_observed's signalType plus 'none'.
StruggleSignal = Literal[
    "none",
    "repeated_hint",
    "repeated_wrong",
    "explicit_confusion",
    "long_idle",
    "give_up",
]

# Ontology regex — mirrors MISCONCEPTION_CODE_REGEX in
# packages/lib/src/super-admin/misconception-validation.ts. Kept in lock-step so
# a code that would be rejected by the curator is rejected here too.
MISCONCEPTION_CODE_PATTERN = r"^[a-z][a-z0-9_-]{2,63}$"

# Bound the turn text the classifier ingests (defence against oversized bodies).
_MAX_TURN_CHARS = 8000


class ClassifyTurnRequest(BaseModel):
    """Request body for ``POST /v1/classify``.

    Field names are wire-stable — ``packages/lib/src/foxy/perception.ts`` POSTs
    these exact keys. Any rename breaks the Node client.
    """

    model_config = ConfigDict(extra="forbid")

    student_id: str = Field(..., description="students.id UUID. Never PII (P13).")
    grade: str = Field(..., description="P5: string '6'..'12'.")
    subject: str = Field(..., min_length=1, max_length=64)
    chapter_number: int | None = Field(default=None, ge=0)
    student_message: str = Field(..., min_length=1, max_length=_MAX_TURN_CHARS)
    foxy_answer: str = Field(..., min_length=1, max_length=_MAX_TURN_CHARS)

    @field_validator("grade")
    @classmethod
    def _grade_is_string(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("grade must be a non-empty string (P5: never an integer)")
        return v.strip()

    @field_validator("student_id")
    @classmethod
    def _student_id_nonempty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("student_id is required")
        return v.strip()


class TurnClassificationResponse(BaseModel):
    """Structured classification of one Foxy turn.

    The Node client re-validates every field, so this model is deliberately
    permissive; ``classifier.py`` coerces the raw model output into a clean dict
    (Bloom lowercased, misconception ontology-checked, struggle/intent bounded)
    BEFORE constructing this — an unparseable model output never reaches here
    (the handler raises instead, so the Node side fail-safes to null).
    """

    model_config = ConfigDict(extra="forbid")

    topic_label: str | None = Field(
        default=None,
        max_length=200,
        description="Short CBSE topic name for the turn, or null.",
    )
    bloom_level: BloomLevel | None = Field(
        default=None,
        description="Canonical lowercase Bloom verb, or null for a non-graded moment.",
    )
    misconception_code: str | None = Field(
        default=None,
        max_length=64,
        description="Short ontology-valid misconception code, or null.",
    )
    struggle_signal: StruggleSignal = Field(
        default="none",
        description="Observed struggle signal; 'none' for a clean turn.",
    )
    intent: str = Field(
        default="unknown",
        min_length=1,
        max_length=64,
        description="Short intent label (a code, never message text).",
    )
