// supabase/functions/grounded-answer/_grounding-gate-flag.ts
//
// Feature flag for the strict-mode grounding-check CONFIDENCE GATE.
// Mirrors the _l2-cache-flags.ts / _mmr-flag.ts / _twin-flag.ts pattern: a 60s
// in-process memoized read against `feature_flags`, in its own file so this
// flag's TTL and fail-semantics stay independently tunable.
//
// ── What it gates, and why it is OFF by default ──────────────────────────────
//
// Strict mode currently sends EVERY answer to a second Anthropic call that
// fact-checks it against the retrieved chunks. Measured 2026-09-01 in
// mol_request_logs, that check averaged 6,213 input tokens for 56 output tokens
// and was 63% of the day's total AI spend across every surface — the single
// largest line item, larger than answer generation itself.
//
// When this flag is ON, the check is SKIPPED for answers whose retrieval
// similarity is already above GROUNDING_GATE_MIN_COSINE — the cases where the
// chunks demonstrably cover the question and the check nearly always returns
// "pass". Below the threshold, the check runs exactly as today.
//
// THIS RELAXES A P12 AI-SAFETY RAIL, so it ships OFF and stays OFF until
// ai-engineer + assessment + testing sign off on a threshold backed by
// measured pass rates (P14 review chain for AI tutor behavior). Turning it on
// without that evidence trades a groundedness guarantee for money, which is
// not a trade this file is entitled to make on its own. Ramp it like any
// serving-path flag and watch grounded_ai_traces.grounding_pass_ratio.
//
// Fail-CLOSED in the strict sense: any read error, missing row, or missing
// similarity signal leaves the gate CLOSED, i.e. the grounding check RUNS.
// The expensive, safe behavior is the fallback — never the cheap one.

export const FF_GROUNDING_CHECK_CONFIDENCE_GATE_V1 =
  'ff_grounding_check_confidence_gate_v1';

interface FlagCache {
  value: boolean;
  expiresAt: number;
}

const FLAG_CACHE_TTL_MS = 60_000;

let gateFlagCache: FlagCache | null = null;

/**
 * Minimum top cosine similarity required to SKIP the grounding check.
 *
 * Default 0.75 is deliberately conservative — high enough that the retrieved
 * chunks clearly address the question. Tunable without a deploy via
 * GROUNDING_GATE_MIN_COSINE. A malformed or out-of-range value falls back to
 * the default rather than silently widening the skip.
 */
export function groundingGateMinCosine(): number {
  const raw = Deno.env.get('GROUNDING_GATE_MIN_COSINE');
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return 0.75;
  return parsed;
}

// deno-lint-ignore no-explicit-any
async function readFlag(sb: any, flagName: string): Promise<boolean> {
  const { data, error } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', flagName)
    .maybeSingle();
  if (error) return false;
  return data?.is_enabled === true;
}

/** Is the confidence gate enabled? Fail-closed (false ⇒ always run the check). */
// deno-lint-ignore no-explicit-any
export async function isGroundingConfidenceGateEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (gateFlagCache && gateFlagCache.expiresAt > now) return gateFlagCache.value;
  try {
    const value = await readFlag(sb, FF_GROUNDING_CHECK_CONFIDENCE_GATE_V1);
    gateFlagCache = { value, expiresAt: now + FLAG_CACHE_TTL_MS };
    return value;
  } catch {
    // Do NOT cache a failure — a transient DB blip should not pin the gate
    // for 60s in either direction.
    return false;
  }
}

/**
 * Pure decision helper, exported for tests.
 *
 * Returns true ONLY when the gate is enabled AND we have a real numeric
 * similarity AND it clears the threshold. A null/undefined/NaN similarity —
 * which is what a retrieval path that never stamped the signal produces —
 * returns false, so "we don't know" runs the check.
 */
export function shouldSkipGroundingCheck(
  gateEnabled: boolean,
  topCosineSimilarity: number | null | undefined,
  minCosine: number,
): boolean {
  if (!gateEnabled) return false;
  if (typeof topCosineSimilarity !== 'number' || !Number.isFinite(topCosineSimilarity)) {
    return false;
  }
  return topCosineSimilarity >= minCosine;
}

/** Test-only: clear the memoized flag so a suite can re-stub the DB read. */
export function __resetGroundingGateCacheForTests(): void {
  gateFlagCache = null;
}
