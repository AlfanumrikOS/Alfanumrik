"""Pydantic models - mirror TS request/response shape."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ExtractRequest(BaseModel):
    """POST body. All fields optional - defaults match TS."""

    model_config = ConfigDict(extra="forbid")

    grade: str | None = Field(default=None)
    subject: str | None = Field(default=None)
    batch_size: int = Field(default=3, ge=1, le=10)
    dry_run: bool = Field(default=False)

    @field_validator("grade")
    @classmethod
    def _grade_string(cls, v: str | None) -> str | None:
        # P5: grades are strings only. Empty -> None.
        if v is None or v == "":
            return None
        return str(v)


class ExtractedChapter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade: str
    subject: str
    chapter_number: int
    chapter_title: str


class ExtractResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool = True
    total_found: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    elapsed_ms: int = 0
    chapters: list[ExtractedChapter] | None = None
    dry_run: bool = False
    phase_2_stub: bool = True


class ExtractStatusResponse(BaseModel):
    """GET handler - extraction coverage overview."""

    model_config = ConfigDict(extra="forbid")

    total_chapters: int = 0
    with_extractions: int = 0
    without_extractions: int = 0
    coverage_percent: int = Field(default=0, ge=0, le=100)
    breakdown: dict[str, dict[str, int]] = Field(default_factory=dict)
