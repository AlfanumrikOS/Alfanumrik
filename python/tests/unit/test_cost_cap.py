"""Cost-cap enforcement tests — A4."""

from __future__ import annotations

from typing import get_args

import pytest

from services.ai.mol.cost_cap import (
    PER_TASK_INR_CEILING,
    enforce_cost_cap,
    estimate_inr,
)
from services.ai.mol.errors import MolError
from services.ai.mol.types import TaskType


def test_every_task_type_has_a_ceiling():
    for t in get_args(TaskType):
        assert t in PER_TASK_INR_CEILING, f"missing ceiling for {t!r}"


def test_estimate_inr_uses_primary_model_price():
    inr = estimate_inr("openai", "gpt-4o-mini", prompt_tokens=500, max_tokens=1024)
    assert inr > 0.0


def test_under_ceiling_does_not_raise():
    enforce_cost_cap(task_type="explanation", provider="openai", model="gpt-4o-mini", prompt_tokens=500, max_tokens=1024)


def test_over_ceiling_raises_cost_cap_exceeded():
    with pytest.raises(MolError) as exc:
        enforce_cost_cap(task_type="evaluation", provider="anthropic", model="claude-sonnet-4-6-20251022", prompt_tokens=2_000_000, max_tokens=2_000_000)
    assert exc.value.code == "COST_CAP_EXCEEDED"
    assert "estimated_inr" in exc.value.details
    assert "ceiling_inr" in exc.value.details


def test_unknown_model_estimate_is_zero_and_passes():
    enforce_cost_cap(task_type="explanation", provider="openai", model="some-unpriced-model", prompt_tokens=10_000_000, max_tokens=10_000_000)
