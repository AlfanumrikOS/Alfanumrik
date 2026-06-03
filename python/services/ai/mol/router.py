"""Provider chain selection — Python twin of :file:`router.ts`.

The BASE_MATRIX is hand-mirrored from the TS source. Any change to the TS
matrix MUST land here in the same PR — assessment owns the routing rules and
the two files MUST agree byte-for-byte at the chain level so shadow rows
written by either runtime remain comparable.
"""

from __future__ import annotations

import random
from copy import deepcopy
from dataclasses import dataclass, field

from .types import Pass, ProviderTarget, SelectedChain, TaskType

# ── Canonical model identifiers — kept in lockstep with router.ts. ──
HAIKU = "claude-haiku-4-5-20251001"
SONNET = "claude-sonnet-4-6-20251022"
GPT_MINI = "gpt-4o-mini"
GPT_FULL = "gpt-4o"

# BASE_MATRIX: same chains, same order, same role tags as router.ts.
# Stored as plain dicts so callers can mutate copies without Pydantic
# re-validation costs in the hot path; converted to ``Pass`` objects on read.
BASE_MATRIX: dict[TaskType, list[dict]] = {
    "explanation": [
        {
            "role": "single",
            "chain": [
                {"provider": "openai", "model": GPT_MINI},
                {"provider": "anthropic", "model": HAIKU},
            ],
        }
    ],
    "concept_explanation": [
        {
            "role": "single",
            "chain": [
                {"provider": "openai", "model": GPT_MINI},
                {"provider": "anthropic", "model": HAIKU},
            ],
        }
    ],
    "step_by_step": [
        {
            "role": "single",
            "chain": [
                {"provider": "openai", "model": GPT_MINI},
                {"provider": "anthropic", "model": HAIKU},
            ],
        }
    ],
    "reasoning": [
        {
            "role": "single",
            "chain": [
                {"provider": "anthropic", "model": SONNET},
                {"provider": "openai", "model": GPT_FULL},
                {"provider": "anthropic", "model": HAIKU},
            ],
        }
    ],
    "quiz_generation": [
        {
            "role": "single",
            "chain": [
                {"provider": "openai", "model": GPT_MINI},
                {"provider": "anthropic", "model": HAIKU},
            ],
        }
    ],
    "evaluation": [
        {
            "role": "single",
            "chain": [
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_MINI},
            ],
        }
    ],
    "doubt_solving": [
        {
            "role": "reason",
            "chain": [
                {"provider": "anthropic", "model": SONNET},
                {"provider": "anthropic", "model": HAIKU},
            ],
        },
        {
            "role": "simplify",
            "chain": [
                {"provider": "openai", "model": GPT_MINI},
                {"provider": "anthropic", "model": HAIKU},
            ],
        },
    ],
    "ocr_extraction": [
        {
            "role": "vision",
            "chain": [
                {"provider": "anthropic", "model": SONNET},
                {"provider": "openai", "model": GPT_FULL},
            ],
        }
    ],
    # 'grounding_check' is a label only; the TS router falls back to the
    # default plan-table entry. We mirror that with an evaluation-style chain
    # so a future shadow-only caller doesn't crash.
    "grounding_check": [
        {
            "role": "single",
            "chain": [
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_MINI},
            ],
        }
    ],
}

# Token caps per task. Mirrors router.ts:MAX_TOKENS.
MAX_TOKENS: dict[TaskType, int] = {
    "explanation": 1024,
    "concept_explanation": 1024,
    "step_by_step": 1500,
    "reasoning": 3000,
    "quiz_generation": 2000,
    "evaluation": 400,
    "doubt_solving": 2500,  # pass-1; pass-2 uses PASS2_SIMPLIFY_MAX
    "ocr_extraction": 1500,
    "grounding_check": 400,  # evaluation-style, conservative
}

PASS2_SIMPLIFY_MAX = 1200


@dataclass
class RouterOptions:
    """Per-call routing knobs. Mirrors TS ``RouterOptions``."""

    hybrid_enabled: bool = False
    openai_default: bool = False
    # Per-task weight in [0,1]. weights[task] > 0.5 ⇒ openai becomes primary.
    weights: dict[str, float] = field(default_factory=dict)


def get_max_tokens(task: TaskType) -> int:
    """Return the default token cap for ``task``."""
    return MAX_TOKENS[task]


def get_simplify_max_tokens() -> int:
    """Token cap for the doubt_solving simplify pass."""
    return PASS2_SIMPLIFY_MAX


def select_provider_chain(task: TaskType, opts: RouterOptions) -> SelectedChain:
    """Select the provider chain for ``task`` given runtime ``opts``.

    Logic mirrors router.ts:selectProviderChain:
        1. Clone the BASE_MATRIX entry so we never mutate the original.
        2. If task='doubt_solving' AND hybrid OFF, collapse to a single-pass
           Anthropic-first chain with a cost-conscious gpt-4o-mini fallback.
        3. If openai_default AND task in {explanation, step_by_step,
           quiz_generation}, reorder so gpt-4o-mini is primary.
        4. If weights[task] > 0.5, ensure openai is the primary rung
           (per-task override beats global default).
        5. ``mode`` reflects the post-mutation shape: 'hybrid' for
           doubt_solving + hybrid, 'vision' for ocr_extraction, else 'single'.
    """
    # Step 1: deep-clone so mutations to the chain list never leak back.
    passes_raw = deepcopy(BASE_MATRIX[task])

    # Step 2: hybrid OFF collapse for doubt_solving.
    if task == "doubt_solving" and not opts.hybrid_enabled:
        passes_raw = [
            {
                "role": "single",
                "chain": [
                    {"provider": "anthropic", "model": SONNET},
                    {"provider": "anthropic", "model": HAIKU},
                    # gpt-4o-mini chosen (not GPT_FULL) for cost-effective
                    # fallback — keeps cutover cost-neutral vs the Anthropic
                    # baseline. Matches router.ts comment block.
                    {"provider": "openai", "model": GPT_MINI},
                ],
            }
        ]

    # Step 3: openai_default flip for teaching tasks.
    if opts.openai_default and task in ("step_by_step", "quiz_generation", "explanation"):
        for p in passes_raw:
            # Pull existing gpt-4o-mini out (wherever it is) and push to head.
            others = [
                t for t in p["chain"] if not (t["provider"] == "openai" and t["model"] == GPT_MINI)
            ]
            p["chain"] = [{"provider": "openai", "model": GPT_MINI}, *others]

    # Step 4: probabilistic routing (80% default to OpenAI).
    w = opts.weights.get(task)
    if not isinstance(w, (int, float)):
        w = 0.8

    if random.random() < w:
        for p in passes_raw:
            openai_target = next((t for t in p["chain"] if t["provider"] == "openai"), None)
            if openai_target is None:
                continue
            # Reorder: openai first, original-order remainder after.
            rest = [t for t in p["chain"] if t is not openai_target]
            p["chain"] = [openai_target, *rest]
    else:
        for p in passes_raw:
            anthropic_target = next((t for t in p["chain"] if t["provider"] == "anthropic"), None)
            if anthropic_target is None:
                continue
            # Reorder: anthropic first, original-order remainder after.
            rest = [t for t in p["chain"] if t is not anthropic_target]
            p["chain"] = [anthropic_target, *rest]

    # Step 5: compute mode.
    if task == "doubt_solving" and opts.hybrid_enabled:
        mode = "hybrid"
    elif task == "ocr_extraction":
        mode = "vision"
    else:
        mode = "single"

    passes = [
        Pass(
            role=p["role"],
            chain=[ProviderTarget(**t) for t in p["chain"]],
        )
        for p in passes_raw
    ]

    return SelectedChain(task_type=task, passes=passes, mode=mode)
