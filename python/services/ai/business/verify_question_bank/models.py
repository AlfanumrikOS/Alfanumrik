"""Pydantic models. Empty request body (cron-triggered)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class VerifierCronRequest(BaseModel):
    """Empty body - cron-triggered, no caller params."""

    model_config = ConfigDict(extra="forbid")


class VerifierCronResponse(BaseModel):
    """Per-tick verifier summary."""

    model_config = ConfigDict(extra="forbid")

    claimed: int = Field(default=0, ge=0)
    verified: int = Field(default=0, ge=0)
    released: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    batch_size: int = Field(default=0, ge=0)
    is_peak: bool = False
    throttled: bool = False
    elapsed_ms: int = Field(default=0, ge=0)
    phase_2_stub: bool = True
