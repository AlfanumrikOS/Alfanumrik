"""Pydantic models. Wire-shape matches TS."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Tier = Literal["weak", "developing", "proficient", "strong"]


class GradeConclusionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observation_id: str = Field(..., min_length=1)


class CriterionScore(BaseModel):
    """One rubric criterion score (R1..R4), 0..3."""

    model_config = ConfigDict(extra="forbid")
    score: int = Field(..., ge=0, le=3)
    rationale: str = ""


class GradingResult(BaseModel):
    """The full rubric verdict, persisted into experiment_observations.grading_result."""

    model_config = ConfigDict(extra="forbid")

    r1_question: CriterionScore
    r2_method: CriterionScore
    r3_evidence: CriterionScore
    r4_conclusion: CriterionScore
    total: int = Field(..., ge=0, le=12)
    tier: Tier
    feedback_en: str = ""
    feedback_hi: str = ""


class GradeConclusionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observation_id: str
    grading_result: GradingResult
    coins_awarded: int = Field(..., ge=0)
    cached: bool = False
