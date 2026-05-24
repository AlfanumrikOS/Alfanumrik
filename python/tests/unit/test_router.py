"""Router unit tests — BASE_MATRIX integrity + flag-driven reshape paths."""

from __future__ import annotations

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


def test_explanation_chain_is_openai_first_by_default():
    chain = BASE_MATRIX["explanation"][0]["chain"]
    assert chain[0]["provider"] == "openai"
    assert chain[0]["model"] == GPT_MINI
    assert chain[1]["provider"] == "anthropic"
    assert chain[1]["model"] == HAIKU


def test_reasoning_chain_starts_with_sonnet():
    """Reasoning is a high-quality path — sonnet primary, gpt-4o fallback."""
    chain = BASE_MATRIX["reasoning"][0]["chain"]
    assert chain[0] == {"provider": "anthropic", "model": SONNET}
    assert chain[1] == {"provider": "openai", "model": GPT_FULL}
    assert chain[2] == {"provider": "anthropic", "model": HAIKU}


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


def test_openai_default_promotes_openai_for_teaching_tasks():
    """When openai_default is ON, explanation/step_by_step/quiz_generation get
    gpt-4o-mini as primary."""
    for task in ("explanation", "step_by_step", "quiz_generation"):
        selected = select_provider_chain(task, _opts(openai_default=True))
        first = selected.passes[0].chain[0]
        assert first.provider == "openai"
        assert first.model == GPT_MINI


def test_openai_default_does_not_affect_reasoning():
    """openai_default only flips teaching tasks; reasoning keeps Anthropic primary."""
    selected = select_provider_chain("reasoning", _opts(openai_default=True))
    first = selected.passes[0].chain[0]
    assert first.provider == "anthropic"


def test_openai_default_no_duplicate_after_flip():
    """The flip removes existing gpt-4o-mini before prepending — no duplicates."""
    selected = select_provider_chain("explanation", _opts(openai_default=True))
    chain = selected.passes[0].chain
    mini_count = sum(1 for t in chain if t.provider == "openai" and t.model == GPT_MINI)
    assert mini_count == 1


# ─── Per-task weight override ───────────────────────────────────────────────


def test_weight_above_half_promotes_openai_primary():
    """weights[task] > 0.5 ensures the openai rung is primary."""
    selected = select_provider_chain("reasoning", _opts(weights={"reasoning": 0.75}))
    first = selected.passes[0].chain[0]
    assert first.provider == "openai"


def test_weight_at_or_below_half_is_a_noop():
    """weights[task] <= 0.5 leaves the chain order untouched."""
    selected = select_provider_chain("reasoning", _opts(weights={"reasoning": 0.5}))
    first = selected.passes[0].chain[0]
    assert first.provider == "anthropic"


def test_weight_with_no_openai_in_chain_is_a_noop():
    """If the chain has no OpenAI rung, weights cannot promote one."""
    # Construct a synthetic case by patching BASE_MATRIX temporarily.
    from services.ai.mol import router as router_mod

    original = router_mod.BASE_MATRIX["evaluation"]
    try:
        router_mod.BASE_MATRIX["evaluation"] = [
            {
                "role": "single",
                "chain": [
                    {"provider": "anthropic", "model": HAIKU},
                ],
            }
        ]
        selected = select_provider_chain("evaluation", _opts(weights={"evaluation": 0.99}))
        assert all(t.provider == "anthropic" for t in selected.passes[0].chain)
    finally:
        router_mod.BASE_MATRIX["evaluation"] = original


# ─── Hybrid mode for doubt_solving ──────────────────────────────────────────


def test_hybrid_off_collapses_doubt_solving_to_single_pass():
    selected = select_provider_chain("doubt_solving", _opts(hybrid_enabled=False))
    assert selected.mode == "single"
    assert len(selected.passes) == 1


def test_hybrid_off_chain_has_cost_friendly_openai_fallback():
    """Hybrid OFF collapsed chain includes gpt-4o-mini (not gpt-4o) per cost note."""
    selected = select_provider_chain("doubt_solving", _opts(hybrid_enabled=False))
    chain = selected.passes[0].chain
    assert chain[0].model == SONNET
    assert chain[-1].provider == "openai"
    assert chain[-1].model == GPT_MINI


def test_hybrid_on_preserves_two_passes():
    selected = select_provider_chain("doubt_solving", _opts(hybrid_enabled=True))
    assert selected.mode == "hybrid"
    assert len(selected.passes) == 2
    assert selected.passes[0].role == "reason"
    assert selected.passes[1].role == "simplify"


def test_ocr_extraction_mode_is_vision():
    selected = select_provider_chain("ocr_extraction", _opts())
    assert selected.mode == "vision"
