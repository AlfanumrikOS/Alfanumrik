"""Pydantic request + response envelopes for ``POST /v1/monthly-synthesis-builder``.

Wire-shape MUST match the TS Edge Function byte-for-byte: the Next.js side
that consumes ``monthly_synthesis_runs.bundle`` reads the keys
(``monthLabel``, ``weeklyArtifactIds``, ``masteryDelta``, ``chapterMockSummary``)
directly. Any rename breaks the synthesis viewer.

P13: response carries no PII — only UUIDs + counters + chapter titles.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

_MONTH_REGEX = re.compile(r"^\d{4}-\d{2}$")


class BuildSynthesisRequest(BaseModel):
    """Request body for the builder. Idempotency at the DB layer."""

    model_config = ConfigDict(extra="forbid")

    student_id: str = Field(..., min_length=1, description="UUID of the student.")
    synthesis_month: str = Field(
        ..., description='Year-month label in "YYYY-MM" form (e.g. "2026-05").'
    )

    @field_validator("synthesis_month")
    @classmethod
    def _month_shape(cls, v: str) -> str:
        if not _MONTH_REGEX.match(v):
            raise ValueError("synthesis_month must match YYYY-MM")
        month = int(v.split("-")[1])
        if month < 1 or month > 12:
            raise ValueError("synthesis_month month component must be 01..12")
        return v


class MasteryDelta(BaseModel):
    """Aggregated mastery movement across the month."""

    model_config = ConfigDict(extra="forbid")

    chaptersTouched: list[str] = Field(default_factory=list)
    topicsMastered: int = Field(default=0, ge=0)
    topicsImproved: int = Field(default=0, ge=0)
    topicsRegressed: int = Field(default=0, ge=0)


class ChapterMockSummary(BaseModel):
    """Approximated chapter-mock summary derived from chaptersTouched."""

    model_config = ConfigDict(extra="forbid")

    chapters: list[str] = Field(default_factory=list)
    totalQuestions: int = Field(default=0, ge=0)
    targetDifficulty: float = Field(default=0.55, ge=0.0, le=1.0)


class SynthesisBundle(BaseModel):
    """The structured bundle stored in ``monthly_synthesis_runs.bundle``."""

    model_config = ConfigDict(extra="forbid")

    monthLabel: str
    weeklyArtifactIds: list[str] = Field(default_factory=list)
    masteryDelta: MasteryDelta
    chapterMockSummary: ChapterMockSummary | None = None


class BuildResponse(BaseModel):
    """Response envelope for both first-build and idempotent re-build paths."""

    model_config = ConfigDict(extra="forbid")

    id: str | None = Field(default=None)
    alreadyExists: bool = Field(default=False)
    bundle: SynthesisBundle


class ErrorResponse(BaseModel):
    """Standard error envelope returned via HTTPException.detail."""

    model_config = ConfigDict(extra="forbid")

    error: str = Field(..., description="Machine-readable error label.")
    request_id: str = Field(..., description="UUIDv4 for log correlation.")
