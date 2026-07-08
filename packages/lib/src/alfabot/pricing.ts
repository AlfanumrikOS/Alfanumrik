/**
 * AlfaBot — model-pricing constants for cost estimation.
 *
 * Single source of truth for $ per token across every AlfaBot surface that
 * computes a USD cost:
 *   - Edge Function `supabase/functions/alfabot-answer/` (per-turn ledger)
 *   - Next route `src/app/api/alfabot/route.ts` (budget tally fallback)
 *   - Super-admin page `src/app/super-admin/alfabot/page.tsx`
 *   - Super-admin route `src/app/api/super-admin/alfabot/stats/route.ts`
 *
 * Model: OpenAI gpt-4o-mini (CEO directive 2026-05-19). Schema is
 * model-agnostic; we keep gpt-4o here as the fallback for grounding-failure
 * retries (matches `ALFABOT_OPENAI_CONFIG.fallback_model`).
 *
 * OpenAI pricing (USD per 1M tokens, as of 2026-05-19, source:
 * https://openai.com/pricing):
 *   gpt-4o-mini: input $0.15, output $0.60
 *   gpt-4o:      input $2.50, output $10.00
 *
 * IMPORTANT: When OpenAI changes pricing, update this file AND verify the
 * `$` cap behavior in /super-admin/alfabot still triggers correctly (the
 * page yellows at 50%, reds at 80% of `ALFABOT_DAILY_USD_CAP`). The
 * `estimateCostUsd()` helper is the only place callers should compute cost;
 * never hardcode the per-1M numbers elsewhere.
 *
 * Owner: ops (cost & cap policy)
 * Reviewers: backend (route consumers), ai-engineer (Edge Function consumer)
 */

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

/**
 * Per-model pricing table. The keys MUST match the strings persisted in
 * `alfabot_messages.model` and emitted on `AlfabotResponse.model`.
 */
export const ALFABOT_MODEL_PRICING: Record<string, ModelPricing> = {
  // Primary (CEO directive 2026-05-19).
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  // Fallback model for grounding-failure retries. Same family, higher quality.
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
};

/** Default per-day USD cap when the env override is missing. */
export const DEFAULT_ALFABOT_DAILY_USD_CAP = 20;

/**
 * Resolve the daily USD cap from env, falling back to the constant above.
 * Centralised so the super-admin dashboard and the rate-limit budget tally
 * read from the SAME value.
 */
export function getAlfabotDailyUsdCap(): number {
  const raw = process.env.ALFABOT_DAILY_USD_CAP;
  if (!raw) return DEFAULT_ALFABOT_DAILY_USD_CAP;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ALFABOT_DAILY_USD_CAP;
  return parsed;
}

/**
 * Estimate USD cost for a single completion.
 *
 * Unknown models fall back to gpt-4o-mini pricing so we never crash the
 * dashboard if a future model id slips through. The fallback is logged at
 * call sites that have a logger handy (Edge Function); this pure helper
 * stays side-effect free.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = ALFABOT_MODEL_PRICING[model] ?? ALFABOT_MODEL_PRICING['gpt-4o-mini'];
  const inUsd = (Math.max(0, inputTokens) * p.inputPerMillion) / 1_000_000;
  const outUsd = (Math.max(0, outputTokens) * p.outputPerMillion) / 1_000_000;
  return inUsd + outUsd;
}

/**
 * Convenience: estimate from a single `tokens_used` count when input/output
 * are not separately reported. Charges everything at the output rate (the
 * pessimistic side) so the cap triggers earlier rather than later.
 *
 * Use this only as a fallback — prefer the 3-arg form when the Edge
 * Function returns split token counts.
 */
export function estimateCostUsdFromTotal(model: string, totalTokens: number): number {
  const p = ALFABOT_MODEL_PRICING[model] ?? ALFABOT_MODEL_PRICING['gpt-4o-mini'];
  return (Math.max(0, totalTokens) * p.outputPerMillion) / 1_000_000;
}
