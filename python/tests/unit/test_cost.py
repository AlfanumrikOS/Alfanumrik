"""Cost computation unit tests."""

from __future__ import annotations

import pytest

from services.ai.mol.cost import PRICING, compute_cost, to_inr


def test_pricing_has_all_known_models():
    """PRICING must cover the 4 models referenced in router constants."""
    expected_keys = {
        "openai/gpt-4o-mini",
        "openai/gpt-4o",
        "anthropic/claude-haiku-4-5-20251001",
        "anthropic/claude-sonnet-4-6-20251022",
    }
    assert expected_keys.issubset(PRICING.keys())


def test_compute_cost_for_haiku():
    """1M prompt + 1M completion tokens at $1 / $5 = $6 + INR(6) = ₹498.0."""
    usd, inr = compute_cost(
        "anthropic", "claude-haiku-4-5-20251001", 1_000_000, 1_000_000
    )
    assert usd == pytest.approx(6.0)
    assert inr == pytest.approx(6.0 * 83.0, rel=1e-9)


def test_compute_cost_for_gpt_4o_mini():
    """1k prompt + 1k completion @ $0.15 / $0.60 per 1M = $0.00075."""
    usd, inr = compute_cost("openai", "gpt-4o-mini", 1_000, 1_000)
    # 1000/1e6 * 0.15 + 1000/1e6 * 0.60 = 0.00015 + 0.00060 = 0.00075
    assert usd == pytest.approx(0.00075, rel=1e-9)
    # to_inr rounds to 4 decimals.
    assert inr == round(0.00075 * 83.0 * 10000) / 10000


def test_compute_cost_strips_date_suffix():
    """Dated model strings (gpt-4o-2024-08-06) fall back to the base alias."""
    usd, inr = compute_cost("openai", "gpt-4o-2024-08-06", 1_000_000, 0)
    # Falls back to openai/gpt-4o = $2.50 / 1M input.
    assert usd == pytest.approx(2.50, rel=1e-9)
    assert inr == round(2.50 * 83.0 * 10000) / 10000


def test_compute_cost_for_missing_model_returns_zero():
    """Unknown model returns (0.0, 0.0) without raising."""
    usd, inr = compute_cost("openai", "unknown-model-name", 1_000_000, 1_000_000)
    assert usd == 0.0
    assert inr == 0.0


def test_compute_cost_with_zero_tokens():
    usd, inr = compute_cost("anthropic", "claude-haiku-4-5-20251001", 0, 0)
    assert usd == 0.0
    assert inr == 0.0


def test_to_inr_rounds_to_four_decimals():
    """to_inr matches the TS `Math.round(usd*rate*10000)/10000` rounding."""
    result = to_inr(0.123456789)
    # 0.123456789 * 83 = 10.246913... * 10000 = 102469.13 → round = 102469 → /10000 = 10.2469
    assert result == 10.2469


def test_to_inr_zero():
    assert to_inr(0) == 0.0


def test_compute_cost_for_sonnet():
    """Sonnet pricing: $3 input / $15 output per 1M."""
    usd, _ = compute_cost(
        "anthropic", "claude-sonnet-4-6-20251022", 2_000_000, 500_000
    )
    # 2M * 3 + 0.5M * 15 = 6 + 7.5 = $13.50
    assert usd == pytest.approx(13.50, rel=1e-9)
