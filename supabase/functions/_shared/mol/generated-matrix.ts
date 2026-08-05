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
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
  concept_explanation: [
    { role: "single", chain: [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
  step_by_step: [
    { role: "single", chain: [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
  reasoning: [
    { role: "single", chain: [
      { provider: "openai", model: "gpt-4o" },
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
  quiz_generation: [
    { role: "single", chain: [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
  evaluation: [
    { role: "single", chain: [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
  doubt_solving: [
    { role: "reason", chain: [
      { provider: "openai", model: "gpt-4o" },
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
    { role: "simplify", chain: [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
  ocr_extraction: [
    { role: "vision", chain: [
      { provider: "openai", model: "gpt-4o" },
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    ] },
  ],
  grounding_check: [
    { role: "single", chain: [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    ] },
  ],
};
