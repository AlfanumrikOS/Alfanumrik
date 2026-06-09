"""Pydantic models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

QuestionType = Literal["short_answer", "long_answer", "fill_blank"]


class BulkGenRequest(BaseModel):
    """POST body. All fields optional - defaults match TS."""

    model_config = ConfigDict(extra="forbid")

    grade: str | None = Field(default=None)
    subject: str | None = Field(default=None)
    chapter_number: int | None = Field(default=None, ge=1)
    question_type: QuestionType = Field(default="short_answer")
    batch_size: int = Field(default=5, ge=1, le=20)
    dry_run: bool = Field(default=False)

    @field_validator("grade")
    @classmethod
    def _grade_string(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return str(v)


class BulkGenResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool = True
    question_type: QuestionType = "short_answer"
    total_found: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    elapsed_ms: int = 0
    dry_run: bool = False
    phase_2_stub: bool = True
