/**
 * Model Gateway — Registry (Phase 1)
 *
 * The SINGLE source of truth for every LLM the platform knows about. Previously
 * the same model ids were hardcoded in four places (config.ts, clients/claude.ts,
 * clients/openai.ts, grounded-answer/claude.ts) with two DIFFERENT fallback
 * orderings. This catalog consolidates them; config.ts now derives its
 * HAIKU/SONNET names from the id constants below.
 *
 * ⚠️ COST / LATENCY / QUALITY NUMBERS ARE ROUTING ESTIMATES ONLY.
 * They are approximate, publicly-known pricing and observed latency, used to
 * RANK candidates for the cost/latency/quality/balanced policies. They are
 * never used for billing and do not need to be exact — an order-of-magnitude
 * relationship between models is all the router needs. Update freely; no
 * behavior other than non-default routing depends on the exact figures.
 *
 * Owner: ai-engineer. Assessment reviews model/scope changes; user approval is
 * required to change the model or provider of any LIVE path (P12 / constitution).
 */

import type { ModelDescriptor, ProviderId, RoutingPolicy } from './types';

// ─── Model id constants (the ONE place these strings live) ──────────────────

export const ANTHROPIC_HAIKU_ID = 'claude-haiku-4-5-20251001';
export const ANTHROPIC_SONNET_ID = 'claude-sonnet-4-20250514';
export const OPENAI_MINI_ID = 'gpt-4o-mini';
export const OPENAI_FULL_ID = 'gpt-4o';
export const GEMINI_FLASH_ID = 'gemini-1.5-flash';
export const GEMINI_PRO_ID = 'gemini-1.5-pro';

/** Convenience bundle for callers that want the id set without importing each. */
export const MODEL_IDS = {
  ANTHROPIC_HAIKU_ID,
  ANTHROPIC_SONNET_ID,
  OPENAI_MINI_ID,
  OPENAI_FULL_ID,
  GEMINI_FLASH_ID,
  GEMINI_PRO_ID,
} as const;

// ─── Catalog ────────────────────────────────────────────────────────────────

const HAIKU: ModelDescriptor = {
  id: ANTHROPIC_HAIKU_ID,
  provider: 'anthropic',
  family: 'claude-haiku',
  tier: 'small',
  contextWindow: 200_000,
  maxOutput: 8_192,
  inputCostPer1M: 1.0, // estimate
  outputCostPer1M: 5.0, // estimate
  p50LatencyMs: 800,
  capabilities: { json: true, vision: true, streaming: true, tools: true },
  qualityTier: 6,
  configured: true,
};

const SONNET: ModelDescriptor = {
  id: ANTHROPIC_SONNET_ID,
  provider: 'anthropic',
  family: 'claude-sonnet',
  tier: 'large',
  contextWindow: 200_000,
  maxOutput: 8_192,
  inputCostPer1M: 3.0, // estimate
  outputCostPer1M: 15.0, // estimate
  p50LatencyMs: 1_500,
  capabilities: { json: true, vision: true, streaming: true, tools: true },
  qualityTier: 9,
  configured: true,
};

const GPT_4O_MINI: ModelDescriptor = {
  id: OPENAI_MINI_ID,
  provider: 'openai',
  family: 'gpt-4o',
  tier: 'small',
  contextWindow: 128_000,
  maxOutput: 16_384,
  inputCostPer1M: 0.15, // estimate
  outputCostPer1M: 0.6, // estimate
  p50LatencyMs: 700,
  capabilities: { json: true, vision: true, streaming: true, tools: true },
  qualityTier: 5,
  configured: true,
};

const GPT_4O: ModelDescriptor = {
  id: OPENAI_FULL_ID,
  provider: 'openai',
  family: 'gpt-4o',
  tier: 'large',
  contextWindow: 128_000,
  maxOutput: 16_384,
  inputCostPer1M: 2.5, // estimate
  outputCostPer1M: 10.0, // estimate
  p50LatencyMs: 1_200,
  capabilities: { json: true, vision: true, streaming: true, tools: true },
  qualityTier: 8,
  configured: true,
};

// Gemini entries are DORMANT in Phase 1: configured=false so the router can
// never select them. They exist only to prove the seam (a third provider drops
// in by flipping `configured` once GEMINI_API_KEY + adapter wiring land).
const GEMINI_FLASH: ModelDescriptor = {
  id: GEMINI_FLASH_ID,
  provider: 'gemini',
  family: 'gemini-1.5',
  tier: 'small',
  contextWindow: 1_000_000,
  maxOutput: 8_192,
  inputCostPer1M: 0.075, // estimate
  outputCostPer1M: 0.3, // estimate
  p50LatencyMs: 600,
  capabilities: { json: true, vision: true, streaming: true, tools: true },
  qualityTier: 5,
  configured: false, // dormant seam — no key wired
};

const GEMINI_PRO: ModelDescriptor = {
  id: GEMINI_PRO_ID,
  provider: 'gemini',
  family: 'gemini-1.5',
  tier: 'large',
  contextWindow: 2_000_000,
  maxOutput: 8_192,
  inputCostPer1M: 1.25, // estimate
  outputCostPer1M: 5.0, // estimate
  p50LatencyMs: 1_400,
  capabilities: { json: true, vision: true, streaming: true, tools: true },
  qualityTier: 8,
  configured: false, // dormant seam — no key wired
};

/** Full catalog, insertion order = declaration order. */
const CATALOG: readonly ModelDescriptor[] = [
  HAIKU,
  SONNET,
  GPT_4O_MINI,
  GPT_4O,
  GEMINI_FLASH,
  GEMINI_PRO,
] as const;

const BY_ID = new Map<string, ModelDescriptor>(CATALOG.map((m) => [m.id, m]));

// ─── Accessors ──────────────────────────────────────────────────────────────

/** Look up a descriptor by concrete model id. Returns undefined if unknown. */
export function getModel(id: string): ModelDescriptor | undefined {
  return BY_ID.get(id);
}

/**
 * List catalog descriptors. By default returns only `configured` models (the
 * ones the router may actually select). Pass `{ configuredOnly: false }` to see
 * dormant seams (Gemini) too.
 */
export function listModels(opts: { configuredOnly?: boolean } = {}): ModelDescriptor[] {
  const configuredOnly = opts.configuredOnly ?? true;
  return CATALOG.filter((m) => (configuredOnly ? m.configured : true));
}

// ─── Legacy fallback ordering (the ONE canonical chain) ─────────────────────
//
// Reproduces supabase/functions/grounded-answer/claude.ts `resolveModelOrder`
// EXACTLY. Anthropic runs FIRST for every preference — the Foxy system prompt,
// JSON output contract, and CBSE pedagogy tree are calibrated for Claude; the
// OpenAI tiers are availability fallbacks only (RCA-FIX CRITICAL-1, 2026-06-26).
//
// The `default` routing policy resolves to LEGACY_FALLBACK_ORDER.auto. The edge
// mirror lives in supabase/functions/grounded-answer/config.ts
// (MODEL_FALLBACK_ORDER); a parity test (owned by testing) asserts equality.

export interface FallbackTarget {
  provider: ProviderId;
  model: string;
}

export const LEGACY_FALLBACK_ORDER: Readonly<Record<'haiku' | 'sonnet' | 'auto', readonly FallbackTarget[]>> = {
  haiku: [
    { provider: 'anthropic', model: ANTHROPIC_HAIKU_ID },
    { provider: 'openai', model: OPENAI_MINI_ID },
  ],
  sonnet: [
    { provider: 'anthropic', model: ANTHROPIC_SONNET_ID },
    { provider: 'openai', model: OPENAI_FULL_ID },
  ],
  auto: [
    { provider: 'anthropic', model: ANTHROPIC_HAIKU_ID },
    { provider: 'anthropic', model: ANTHROPIC_SONNET_ID },
    { provider: 'openai', model: OPENAI_MINI_ID },
    { provider: 'openai', model: OPENAI_FULL_ID },
  ],
} as const;

/** Resolve a legacy preference key into ordered descriptors (configured only). */
export function legacyChain(pref: 'haiku' | 'sonnet' | 'auto'): ModelDescriptor[] {
  const out: ModelDescriptor[] = [];
  for (const target of LEGACY_FALLBACK_ORDER[pref]) {
    const m = BY_ID.get(target.model);
    if (m && m.configured) out.push(m);
  }
  return out;
}

// ─── Cost model ─────────────────────────────────────────────────────────────

/**
 * Routing-estimate cost of a call in USD. Estimate only — see the file header.
 * Safe on unknown token counts (treats them as 0).
 */
export function estimateCostUsd(
  descriptor: ModelDescriptor,
  inputTokens: number,
  outputTokens: number,
): number {
  const inTok = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const outTok = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  return (inTok / 1_000_000) * descriptor.inputCostPer1M + (outTok / 1_000_000) * descriptor.outputCostPer1M;
}

/** Blended cost signal (input + output per 1M) used by the cost/balanced policies. */
export function blendedCostPer1M(descriptor: ModelDescriptor): number {
  return descriptor.inputCostPer1M + descriptor.outputCostPer1M;
}

/** All routing policies the registry/router understands. */
export const ROUTING_POLICIES: readonly RoutingPolicy[] = [
  'default',
  'cost',
  'latency',
  'quality',
  'balanced',
] as const;
