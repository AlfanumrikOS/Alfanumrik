"""Pydantic models for the Foxy tutor endpoint.

The Foxy tutor is a thin wrapper around the generic MoL generate pipeline.
It accepts a simple question string and returns a CBSE‑formatted answer.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class FoxyRequest(BaseModel):
    """Request body for ``POST /v1/foxy-tutor``.

    Only the question is required; additional fields can be added later if the
    frontend needs more context.
    """

    model_config = ConfigDict(extra="forbid")
    question: str = Field(..., description="The student question to answer.")


class FoxyResponse(BaseModel):
    """Response body for the Foxy tutor.

    ``answer`` contains the CBSE‑style formatted text.
    """

    model_config = ConfigDict(extra="forbid")
    answer: str = Field(..., description="CBSE‑formatted answer string.")
