"""USD + INR cost computation for MoL responses.

Mirrors :file:`supabase/functions/_shared/mol/telemetry.ts` PRICING table
plus ``calcCost`` and ``toInr``. The PRICING dict here MUST stay synchronized
with the TS source AND with the seeded ``model_pricing`` table; the TS source
explicitly calls out that mismatch is a data-integrity bug.
"""

from __future__ import annotations

import re

import structlog

from ..config import get_settings

logger = structlog.get_logger(__name__)

# USD per 1M tokens. KEEP IN SYNC with:
#   - supabase/functions/_shared/mol/telemetry.ts:PRICING
#   - public.model_pricing seed
# Adding a model in one place but not the others returns 0.0 here and silently
# undercounts cost in dashboards.
PRICING: dict[str, dict[str, float]] = {
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "openai/gpt-4o": {"input": 2.50, "output": 10.00},
    "anthropic/claude-haiku-4-5-20251001": {"input": 1.00, "output": 5.00},
    "anthropic/claude-sonnet-4-6-20251022": {"input": 3.00, "output": 15.00},
}

# Matches a trailing -YYYY-MM-DD on dated model strings (gpt-4o-2024-08-06,
# claude-haiku-2024-10-22, etc.). When the exact key misses, we strip the
# date and retry — same defensive behavior as TS telemetry.ts:calcCost.
_DATE_SUFFIX_RE = re.compile(r"-\d{4}-\d{2}-\d{2}$")


def compute_cost(
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> tuple[float, float]:
    """Return ``(usd, inr)`` for a single provider call.

    Both prices are computed from the same PRICING entry. INR uses the
    runtime ``USD_TO_INR`` setting (default 83 — matches TS default).

    Behavior on missing PRICING entry: returns ``(0.0, 0.0)`` and emits a
    single ``WARN`` structured log line with the provider/model. Matches TS
    defensive default — telemetry must never break the user request.
    """
    exact_key = f"{provider}/{model}"
    pricing = PRICING.get(exact_key)
    if pricing is None:
        base_model = _DATE_SUFFIX_RE.sub("", model)
        pricing = PRICING.get(f"{provider}/{base_model}")
    if pricing is None:
        logger.warning(
            "mol.cost.missing_pricing",
            provider=provider,
            model=model,
            hint="Add entry to PRICING in cost.py AND telemetry.ts AND model_pricing seed.",
        )
        return (0.0, 0.0)

    usd = (prompt_tokens / 1_000_000.0) * pricing["input"] + (
        completion_tokens / 1_000_000.0
    ) * pricing["output"]
    inr = to_inr(usd)
    return (usd, inr)


def to_inr(usd: float) -> float:
    """Convert USD → INR using the configured rate.

    Rounding matches TS telemetry.ts:toInr — ``round(usd * rate * 10000) / 10000``
    (4 decimal places). Keeps numeric(12,4) inserts deterministic.
    """
    rate = get_settings().usd_to_inr
    return round(usd * rate * 10000.0) / 10000.0
