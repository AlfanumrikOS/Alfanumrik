"""Provider chain selection — Python twin of :file:`router.ts`.

The BASE_MATRIX is hand-mirrored from the TS source. Any change to the TS
matrix MUST land here in the same PR — assessment owns the routing rules and
the two files MUST agree byte-for-byte at the chain level so shadow rows
written by either runtime remain comparable.

R3 CONSOLIDATION DRIFT RISK (Foxy North-Star Phase 4, 2026-08-05):
   The Deno-side twin (supabase/functions/_shared/mol/router.ts) is now
   GENERATED from packages/lib/src/ai/gateway/registry.ts via
   scripts/gen-mol-matrix.mjs. This Python copy remains HAND-MIRRORED
   because Python cannot import a TS ESM module, and deleting it would
   silently regress any live Python-side consumer (perception classifier
   at /v1/classify, and the shadow-generation path used by
   grounded-answer/foxy-python-generation.ts when flag-gated live).

   Phase-5 follow-up TODO: replace this hand-authored copy with a
   generator that reads the SAME registry.ts and emits a Python module
   (a second target of scripts/gen-mol-matrix.mjs, or a companion
   scripts/gen-mol-matrix-py.mjs). Until then: if you rename a model id
   in registry.ts, remember to touch THIS FILE too. The Deno half moves
   automatically; the Python half will not.
"""

from __future__ import annotations

import random
from copy import deepcopy
from dataclasses import dataclass, field

from .types import Pass, ProviderTarget, SelectedChain, TaskType

# ── Canonical model identifiers — kept in lockstep with router.ts. ──
HAIKU = "claude-haiku-4-5-20251001"
# Aligned to the id already pinned by config-model-name-identity.test.ts,
# packages/lib/src/ai/gateway/registry.ts (ANTHROPIC_SONNET_ID), and
# packages/lib/src/foxy/quality-eval.ts (JUDGE_MODEL). 2026-08-31: repinned to
# claude-sonnet-4-5-20250929 after the previous id was RETIRED (HTTP 404
# not_found_error); the replacement was confirmed live against the API.
SONNET = "claude-sonnet-4-5-20250929"
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
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_MINI},
            ],
        }
    ],
    "concept_explanation": [
        {
            "role": "single",
            "chain": [
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_MINI},
            ],
        }
    ],
    "step_by_step": [
        {
            "role": "single",
            "chain": [
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_MINI},
            ],
        }
    ],
    "reasoning": [
        {
            "role": "single",
            "chain": [
                {"provider": "anthropic", "model": SONNET},
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_FULL},
            ],
        }
    ],
    "quiz_generation": [
        {
            "role": "single",
            "chain": [
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_MINI},
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
                {"provider": "openai", "model": GPT_FULL},
            ],
        },
        {
            "role": "simplify",
            "chain": [
                {"provider": "anthropic", "model": HAIKU},
                {"provider": "openai", "model": GPT_MINI},
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
    # Per-task weight in [0,1] — probability (on the shadow_priority=True path)
    # that anthropic is promoted to primary. Higher weight ⇒ anthropic more
    # likely primary. Defaults to 0.8 when unset (see select_provider_chain).
    weights: dict[str, float] = field(default_factory=dict)
    # Anthropic is primary/default, OpenAI is fallback (CEO directive,
    # 2026-08-26 — reversed the earlier 2026-08-02 OpenAI-primary swap).
    # When False (default, live path), priority is DETERMINISTIC — Anthropic
    # is always the primary rung. When True (gated by ff_mol_deterministic_priority
    # being OFF → shadow/experiment), use the weighted-random reorder (still
    # anthropic-favored by default). The flag name is inverted on purpose: the
    # flag turns the *deterministic* path ON; shadow_priority is the negation.
    shadow_priority: bool = False


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
           chain: anthropic-sonnet, anthropic-haiku, openai-gpt-4o,
           openai-gpt-4o-mini.
        3. If openai_default AND task in {explanation, step_by_step,
           quiz_generation}, reorder so gpt-4o-mini is primary.
        4. Per-task weighted-random reorder — anthropic primary by default
           (CEO directive 2026-08-26); see select_provider_chain step 4.
        5. ``mode`` reflects the post-mutation shape: 'hybrid' for
           doubt_solving + hybrid, 'vision' for ocr_extraction, else 'single'.
    """
    # Step 1: deep-clone so mutations to the chain list never leak back.
    passes_raw = deepcopy(BASE_MATRIX[task])

    # Step 2: hybrid OFF collapse for doubt_solving — Anthropic primary
    # (CEO directive 2026-08-26), matches router.ts's hybrid-off branch.
    if task == "doubt_solving" and not opts.hybrid_enabled:
        passes_raw = [
            {
                "role": "single",
                "chain": [
                    {"provider": "anthropic", "model": SONNET},
                    {"provider": "anthropic", "model": HAIKU},
                    {"provider": "openai", "model": GPT_FULL},
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

    # Step 4: priority selection — Anthropic primary (CEO directive 2026-08-26).
    if opts.shadow_priority:
        # Shadow/experiment path: weighted-random reorder, anthropic-favored
        # by default (80%). Mirrors router.ts's unconditional weighted-random
        # reorder (it has no separate deterministic branch anymore).
        w = opts.weights.get(task)
        if not isinstance(w, int | float):
            w = 0.8
        head_provider = "anthropic" if random.random() < w else "openai"
    else:
        # Deterministic path: Anthropic is ALWAYS primary. No randomness.
        head_provider = "anthropic"

    for p in passes_raw:
        target = next((t for t in p["chain"] if t["provider"] == head_provider), None)
        if target is None:
            continue
        rest = [t for t in p["chain"] if t is not target]
        p["chain"] = [target, *rest]

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
