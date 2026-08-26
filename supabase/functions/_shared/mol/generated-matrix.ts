// GENERATED — DO NOT EDIT
// DO NOT MANUALLY MERGE
// Regenerate: `npm run gen:mol-matrix`
//
// Source of truth: packages/lib/src/ai/gateway/registry.ts (model-id constants)
// + scripts/gen-mol-matrix.mjs (task-type -> chain mapping).
//
// This file is R3's authoritative Deno-side BASE_MATRIX for the MOL router.
// The parity test in supabase/functions/_shared/mol/__tests__/router.test.ts
// asserts every TaskType's chain matches the gateway intent for that policy.

import type { TaskType } from './types.ts';
import type { Pass } from './router.ts';

// Model ids (mirror of registry.ts — kept as string literals here so this file
// is Deno-consumable without pulling the TS gateway across the runtime boundary).
export const MODEL_IDS = {
  ANTHROPIC_HAIKU_ID: "claude-haiku-4-5-20251001",
  ANTHROPIC_SONNET_ID: "claude-sonnet-4-20250514",
  OPENAI_MINI_ID: "gpt-4o-mini",
  OPENAI_FULL_ID: "gpt-4o",
} as const;


export const GENERATED_BASE_MATRIX: Record<TaskType, Pass[]> = {
  explanation: [
    { role: "single", chain: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o-mini" },
    ] },
  ],
  concept_explanation: [
    { role: "single", chain: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o-mini" },
    ] },
  ],
  step_by_step: [
    { role: "single", chain: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o-mini" },
    ] },
  ],
  reasoning: [
    { role: "single", chain: [
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o" },
    ] },
  ],
  quiz_generation: [
    { role: "single", chain: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o-mini" },
    ] },
  ],
  evaluation: [
    { role: "single", chain: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o-mini" },
    ] },
  ],
  doubt_solving: [
    { role: "reason", chain: [
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o" },
    ] },
    { role: "simplify", chain: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o-mini" },
    ] },
  ],
  ocr_extraction: [
    { role: "vision", chain: [
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      { provider: "openai", model: "gpt-4o" },
    ] },
  ],
  grounding_check: [
    { role: "single", chain: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai", model: "gpt-4o-mini" },
    ] },
  ],
};
