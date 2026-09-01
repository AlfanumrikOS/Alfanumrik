"""Router unit tests — BASE_MATRIX integrity + flag-driven reshape paths."""

from __future__ import annotations

from unittest.mock import patch

from services.ai.mol.router import (
    BASE_MATRIX,
    GPT_FULL,
    GPT_MINI,
    HAIKU,
    MAX_TOKENS,
    PASS2_SIMPLIFY_MAX,
    SONNET,
    RouterOptions,
    get_max_tokens,
    get_simplify_max_tokens,
    select_provider_chain,
)
from services.ai.mol.types import TaskType


def _opts(**overrides) -> RouterOptions:
    base = {
        "hybrid_enabled": False,
        "openai_default": False,
        "weights": {},
    }
    base.update(overrides)
    return RouterOptions(**base)


# ─── BASE_MATRIX integrity ──────────────────────────────────────────────────


def test_base_matrix_covers_every_task_type():
    """Every TaskType literal must have a BASE_MATRIX entry."""
    # Pull TaskType members directly from the typing.Literal to avoid drift.
    from typing import get_args

    task_types = get_args(TaskType)
    for t in task_types:
        assert t in BASE_MATRIX, f"BASE_MATRIX is missing {t!r}"


def test_max_tokens_covers_every_task_type():
    from typing import get_args

    for t in get_args(TaskType):
        assert t in MAX_TOKENS, f"MAX_TOKENS is missing {t!r}"


def test_explanation_chain_is_anthropic_first_by_default():
    chain = BASE_MATRIX["explanation"][0]["chain"]
    assert chain[0]["provider"] == "anthropic"
    assert chain[0]["model"] == HAIKU
    assert chain[1]["provider"] == "openai"
    assert chain[1]["model"] == GPT_MINI


def test_reasoning_chain_starts_with_sonnet():
    """Reasoning is a high-quality path — sonnet primary, haiku then gpt-4o fallback."""
    chain = BASE_MATRIX["reasoning"][0]["chain"]
    assert chain[0] == {"provider": "anthropic", "model": SONNET}
    assert chain[1] == {"provider": "anthropic", "model": HAIKU}
    assert chain[2] == {"provider": "openai", "model": GPT_FULL}


def test_doubt_solving_has_two_passes():
    """Hybrid doubt_solving uses reason + simplify passes."""
    passes = BASE_MATRIX["doubt_solving"]
    assert len(passes) == 2
    assert passes[0]["role"] == "reason"
    assert passes[1]["role"] == "simplify"


def test_constants_exposed_for_external_use():
    assert get_simplify_max_tokens() == PASS2_SIMPLIFY_MAX == 1200
    assert get_max_tokens("doubt_solving") == 2500
    assert get_max_tokens("evaluation") == 400


# ─── Default / single-task routing ──────────────────────────────────────────


def test_select_default_single_task_returns_clone():
    """Default options return a clone — mutating the result must not affect BASE_MATRIX."""
    selected = select_provider_chain("explanation", _opts())
    assert selected.mode == "single"
    assert len(selected.passes) == 1
    selected.passes[0].chain.clear()
    # Re-select and confirm original is intact.
    fresh = select_provider_chain("explanation", _opts())
    assert len(fresh.passes[0].chain) == 2


def test_select_returns_correct_task_type_field():
    selected = select_provider_chain("reasoning", _opts())
    assert selected.task_type == "reasoning"


# ─── openai_default flag flip ───────────────────────────────────────────────


@patch("services.ai.mol.router.random.random", return_value=0.9)
def test_openai_default_promotes_openai_for_teaching_tasks(mock_rand):
    """When openai_default is ON, explanation/step_by_step/quiz_generation get
    gpt-4o-mini as primary — observed on the shadow (weighted-random) path with
    random(0.9) >= the default weight (0.8), so step 4 does not re-promote
    anthropic and clobber the step-3 flip. (On the deterministic default path,
    step 4 unconditionally promotes anthropic — see the A2 section below.)"""
    for task in ("explanation", "step_by_step", "quiz_generation"):
        selected = select_provider_chain(task, _opts(openai_default=True, shadow_priority=True))
        first = selected.passes[0].chain[0]
        assert first.provider == "openai"
        assert first.model == GPT_MINI


@patch("services.ai.mol.router.random.random", return_value=0.1)
def test_openai_default_does_not_affect_reasoning(mock_rand):
    """openai_default only flips teaching tasks; reasoning keeps Anthropic primary.

    Observed on the shadow (weighted-random) path with random(0.1) < weight(0.8),
    so anthropic is promoted — reasoning's BASE_MATRIX already starts with
    sonnet, and since reasoning isn't in the openai_default flip-eligible set,
    there's nothing for the flip to have changed."""
    selected = select_provider_chain("reasoning", _opts(openai_default=True, shadow_priority=True))
    first = selected.passes[0].chain[0]
    assert first.provider == "anthropic"


@patch("services.ai.mol.router.random.random", return_value=0.9)
def test_openai_default_no_duplicate_after_flip(mock_rand):
    """The flip removes existing gpt-4o-mini before prepending — no duplicates."""
    selected = select_provider_chain("explanation", _opts(openai_default=True, shadow_priority=True))
    chain = selected.passes[0].chain
    mini_count = sum(1 for t in chain if t.provider == "openai" and t.model == GPT_MINI)
    assert mini_count == 1


@patch("services.ai.mol.router.random.random", return_value=0.1)
def test_weight_above_random_promotes_anthropic_primary(mock_rand):
    """w=0.8 > random(0.1) ensures the anthropic rung is primary (shadow path)."""
    selected = select_provider_chain(
        "reasoning", _opts(shadow_priority=True, weights={"reasoning": 0.8})
    )
    first = selected.passes[0].chain[0]
    assert first.provider == "anthropic"


@patch("services.ai.mol.router.random.random", return_value=0.9)
def test_weight_below_random_promotes_openai_primary(mock_rand):
    """w=0.8 < random(0.9) leaves openai as primary (shadow path)."""
    selected = select_provider_chain(
        "reasoning", _opts(shadow_priority=True, weights={"reasoning": 0.8})
    )
    first = selected.passes[0].chain[0]
    assert first.provider == "openai"


def test_weight_with_no_anthropic_in_chain_is_a_noop():
    """If the chain has no Anthropic rung, weights cannot promote one."""
    # Construct a synthetic case by patching BASE_MATRIX temporarily.
    from services.ai.mol import router as router_mod

    original = router_mod.BASE_MATRIX["evaluation"]
    try:
        router_mod.BASE_MATRIX["evaluation"] = [
            {
                "role": "single",
                "chain": [
                    {"provider": "openai", "model": GPT_MINI},
                ],
            }
        ]
        selected = select_provider_chain("evaluation", _opts(weights={"evaluation": 0.99}))
        assert all(t.provider == "openai" for t in selected.passes[0].chain)
    finally:
        router_mod.BASE_MATRIX["evaluation"] = original


# ─── Hybrid mode for doubt_solving ──────────────────────────────────────────


def test_hybrid_off_collapses_doubt_solving_to_single_pass():
    selected = select_provider_chain("doubt_solving", _opts(hybrid_enabled=False))
    assert selected.mode == "single"
    assert len(selected.passes) == 1


def test_hybrid_off_chain_matches_ceo_directive_shape():
    """Hybrid OFF collapsed chain is exactly [SONNET, HAIKU, GPT_FULL, GPT_MINI]
    — anthropic primary + fallback, then openai fallback + last resort (CEO
    directive 2026-08-26), matching router.ts's hybrid-off branch. Asserted on
    the deterministic default path — sonnet (the first anthropic rung) is
    already head, so the promotion is a no-op and the shape is stable."""
    selected = select_provider_chain("doubt_solving", _opts(hybrid_enabled=False))
    chain = selected.passes[0].chain
    assert [(t.provider, t.model) for t in chain] == [
        ("anthropic", SONNET),
        ("anthropic", HAIKU),
        ("openai", GPT_FULL),
        ("openai", GPT_MINI),
    ]


def test_hybrid_on_preserves_two_passes():
    selected = select_provider_chain("doubt_solving", _opts(hybrid_enabled=True))
    assert selected.mode == "hybrid"
    assert len(selected.passes) == 2
    assert selected.passes[0].role == "reason"
    assert selected.passes[1].role == "simplify"


def test_ocr_extraction_mode_is_vision():
    selected = select_provider_chain("ocr_extraction", _opts())
    assert selected.mode == "vision"


# ─── Deterministic Anthropic-priority (CEO directive 2026-08-26) ────────────


def test_deterministic_priority_makes_anthropic_primary_without_random():
    """With shadow_priority OFF (default), the anthropic rung is always
    primary — no dependence on random.random()."""
    for task in (
        "explanation",
        "concept_explanation",
        "step_by_step",
        "quiz_generation",
        "evaluation",
        "grounding_check",
    ):
        selected = select_provider_chain(task, _opts())
        first = selected.passes[0].chain[0]
        assert first.provider == "anthropic", f"{task} should be anthropic-primary"


def test_deterministic_priority_reasoning_keeps_sonnet_primary():
    """reasoning already has sonnet primary in BASE_MATRIX; deterministic
    priority (anthropic-favored) keeps it there."""
    selected = select_provider_chain("reasoning", _opts())
    first = selected.passes[0].chain[0]
    assert first.provider == "anthropic"
    assert first.model == SONNET


def test_deterministic_priority_is_stable_across_calls():
    """Two identical calls must yield byte-identical chains (no randomness)."""
    a = select_provider_chain("explanation", _opts())
    b = select_provider_chain("explanation", _opts())
    assert [(t.provider, t.model) for t in a.passes[0].chain] == [
        (t.provider, t.model) for t in b.passes[0].chain
    ]


def test_shadow_priority_on_uses_weights_and_random():
    """shadow_priority=True restores the weighted-random path: w=0.8, and
    random(0.9) >= w, so anthropic is NOT promoted — openai (the only openai
    rung, gpt-4o) is left primary for reasoning."""
    from unittest.mock import patch

    with patch("services.ai.mol.router.random.random", return_value=0.9):
        selected = select_provider_chain(
            "reasoning",
            _opts(shadow_priority=True, weights={"reasoning": 0.8}),
        )
    assert selected.passes[0].chain[0].provider == "openai"


def test_deterministic_priority_noop_when_chain_has_no_openai():
    """A chain with only anthropic rungs stays anthropic-first (nothing to promote)."""
    from services.ai.mol import router as router_mod

    original = router_mod.BASE_MATRIX["evaluation"]
    try:
        router_mod.BASE_MATRIX["evaluation"] = [
            {"role": "single", "chain": [{"provider": "anthropic", "model": HAIKU}]}
        ]
        selected = select_provider_chain("evaluation", _opts())
        assert all(t.provider == "anthropic" for t in selected.passes[0].chain)
    finally:
        router_mod.BASE_MATRIX["evaluation"] = original
