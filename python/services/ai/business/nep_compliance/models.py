"""Pydantic models for POST /v1/nep-compliance.

Wire-shape mirrors TS byte-for-byte so the Edge proxy + frontend consumers
stay contract-stable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Action = Literal["generate_hpc", "get_hpc"]


class NepComplianceRequest(BaseModel):
    """Request body. Two-action endpoint."""

    model_config = ConfigDict(extra="forbid")

    action: Action
    student_id: str = Field(..., min_length=1)


class StudentInfo(BaseModel):
    """Student name/grade/board sub-block of HPCReport."""

    model_config = ConfigDict(extra="forbid")

    name: str
    grade: str  # P5: grade as string
    board: str


class SubjectPerformance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avg_mastery_pct: int = Field(ge=0, le=100)
    concepts_attempted: int = Field(ge=0)
    concepts_total: int = Field(ge=0)
    chapters_covered: int = Field(ge=0)
    chapters_total: int = Field(ge=0)


class BloomDistribution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remember: int = 0
    understand: int = 0
    apply: int = 0
    analyze: int = 0
    evaluate: int = 0
    create: int = 0
    total: int = 0


class CompetencyEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall_level: str


class LearningBehaviors(BaseModel):
    model_config = ConfigDict(extra="forbid")

    consistency: int | None = None
    curiosity: int | None = None
    self_regulation: int | None = None
    collaboration: int | None = None


class HolisticIndicators(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_sessions: int = 0
    active_days: int = 0
    streak_best: int = 0
    notes_created: int = 0
    xp_total: int = 0
    study_regularity_pct: int = Field(default=0, ge=0, le=100)


class CBSESectionReadiness(BaseModel):
    model_config = ConfigDict(extra="forbid")

    section: str
    marks: str
    readiness_pct: int | None = None


class PortfolioHighlight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    description: str
    date: str


class HPCReport(BaseModel):
    """Top-level HPC document stored in nep_compliance_reports.report_data."""

    model_config = ConfigDict(extra="forbid")

    student: StudentInfo
    academic_year: str
    term: str
    class_percentile: int = Field(default=0, ge=0, le=100)
    bloom_distribution: BloomDistribution
    competency_levels: dict[str, CompetencyEntry] = Field(default_factory=dict)
    subject_performance: dict[str, SubjectPerformance] = Field(default_factory=dict)
    learning_behaviors: LearningBehaviors
    holistic_indicators: HolisticIndicators
    cbse_readiness: dict[str, dict[str, CBSESectionReadiness]] = Field(default_factory=dict)
    portfolio_highlights: list[PortfolioHighlight] = Field(default_factory=list)
    generated_at: str


class NepComplianceResponse(BaseModel):
    """Response envelope mirroring TS shape."""

    model_config = ConfigDict(extra="forbid")

    success: bool = True
    report: HPCReport | None = None
    error: str | None = None
