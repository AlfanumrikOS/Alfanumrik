"""Pydantic models for POST /v1/parent-report-generator.

Wire-shape mirrors TS index.ts. The Next.js parent portal consumes
WeeklyReport.report.{period,highlights,concerns,suggestion,stats}.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Language = Literal["en", "hi"]


class ParentReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student_id: str = Field(..., min_length=1)
    language: Language = Field(default="en")


class WeeklyStats(BaseModel):
    """Computed aggregate over the past 7 days.

    Field names match TS WeeklyStats (lines 64-78) byte-for-byte.
    """

    model_config = ConfigDict(extra="forbid")

    quizzes_completed: int = 0
    avg_score: int = Field(default=0, ge=0, le=100)
    xp_earned: int = 0
    time_spent_minutes: int = 0
    topics_mastered: int = 0
    streak: int = 0
    foxy_sessions: int = 0
    subjects_studied: list[str] = Field(default_factory=list)
    chapters_covered: list[str] = Field(default_factory=list)


class WeeklyReport(BaseModel):
    """Top-level report carried in response body. TS shape lines 84-92."""

    model_config = ConfigDict(extra="forbid")

    period: str
    highlights: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    suggestion: str
    stats: WeeklyStats


class ParentReportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report: WeeklyReport
    generated_at: str
