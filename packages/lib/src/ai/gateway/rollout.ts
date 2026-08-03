/**
 * Model Gateway — Percentage rollout for the OpenAI-primary swap (2026-08-03)
 *
 * The 2026-08-02 OpenAI-primary provider swap (REG-332, CEO-approved) shipped
 * as a flat, unconditional 100%-of-traffic switch: LEGACY_FALLBACK_ORDER (and
 * its Deno mirror, MODEL_FALLBACK_ORDER) now put OpenAI first for every
 * preference, with no gradual ramp. This module adds a deterministic,
 * percentage-controlled lever ON TOP of that swap so ops can ramp/roll back
 * exposure gradually instead of a second flat code change.
 *
 * ── Flag: ff_foxy_openai_primary_rollout_v1 (MODEL_ROLLOUT_FLAGS.V1) ────────
 * Plain `is_enabled` + `rollout_percentage` columns — read via the existing,
 * already-tested `isFeatureEnabled` + `hashForRollout` engine in
 * feature-flags.ts, NOT a new metadata/kill_switch envelope. This was a
 * deliberate choice, not an oversight:
 *   - The admin-rollback-flag.ts kill_switch precedence pattern was
 *     considered (per the design brief) but does not fit here: this flag's
 *     bucketing decision MUST be byte-identical to the Deno grounded-answer
 *     mirror (supabase/functions/grounded-answer/_model-rollout-flag.ts) for
 *     the same caller (P12). The only PRE-EXISTING, PROVEN cross-runtime rollout
 *     primitive in this codebase is `hashForRollout` (this file, mirrored
 *     verbatim in supabase/functions/identity/index.ts, with an existing
 *     parity test at apps/host/src/__tests__/lib/feature-flags-rollout-hash-parity.test.ts).
 *     Reusing that proven pair — rather than inventing a third bucketing
 *     formula to go with a metadata envelope — is the point.
 *   - `is_enabled=false` IS this flag's kill switch. No separate emergency
 *     bit is needed: most flags in this codebase (ff_model_gateway_v1,
 *     ff_foxy_math_pipeline_v1, etc.) don't carry one either — only the
 *     ff_python_* family does, for reasons specific to that migration.
 *
 * ── Mapping (READ CAREFULLY — inverted from "rollout_pct% get the new thing") ─
 * LEGACY_FALLBACK_ORDER (OpenAI-primary) is ALREADY live for 100% of traffic,
 * unconditionally, before this flag exists. So "the new thing this flag
 * controls" is exposure to the ROLLBACK order, not exposure to OpenAI:
 *   - is_enabled=false, OR rollout_percentage<=0, OR no caller id available
 *     → stays on LEGACY_FALLBACK_ORDER (OpenAI-primary) — today's shipped,
 *     100%-live default. This is what makes a fresh deploy of this
 *     mechanism, and its seed state, a pure no-op.
 *   - is_enabled=true AND rollout_percentage=P (1-100) AND a caller id is
 *     present → that caller's deterministic bucket decides: in-bucket → rolled
 *     BACK to CLAUDE_PRIMARY_FALLBACK_ORDER; out-of-bucket → stays on
 *     OpenAI-primary.
 *
 * ── Fail-safe direction (explicit, documented decision — ai-engineer,
 * 2026-08-03) ── ALWAYS fail toward OpenAI-primary: on a flag-read error
 * (isFeatureEnabled already fails closed to `false` on any error — see
 * feature-flags.ts), on a missing/empty caller id, and at the seeded/default
 * posture. OpenAI-primary is the currently-live, reviewed default;
 * Claude-primary is the deliberate ROLLBACK target, never the silent
 * fallback.
 *
 * IMPORTANT — `isFeatureEnabled`'s documented "no userId + partial rollout ⇒
 * treated as enabled (backward compat)" behavior is WRONG for this flag (it
 * would silently roll an unidentified caller BACK to Claude-primary, the
 * opposite of the required fail-safe direction). This module therefore
 * short-circuits to `false` (stay on OpenAI-primary) BEFORE calling
 * isFeatureEnabled whenever no caller id is supplied — see
 * resolveDefaultChain below. Do not "simplify" this away.
 *
 * Owner: ai-engineer. Assessment reviews any change that could move a live
 * path off the reviewed default; user approval required to change a live
 * model/provider (unchanged from the Gateway's existing constitution note).
 */

import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { MODEL_ROLLOUT_FLAGS } from '@alfanumrik/lib/flags/registries/foxy';
import type { ModelDescriptor, RoutingConstraints } from './types';
import { legacyChain, claudePrimaryChain } from './registry';
import { passesConstraints } from './router';

/** The flag controlling the OpenAI-primary/Claude-primary rollback split (registry constant — single source). */
export const MODEL_ROLLOUT_FLAG = MODEL_ROLLOUT_FLAGS.V1;

/**
 * Resolve the `default` policy's chain, rollout-flag-aware.
 *
 * Behavior when `flagContext` carries no `userId` (the overwhelming majority
 * of today's callModel('default') call sites — e.g. the intent classifier in
 * ai/workflows/foxy-router.ts, which passes no flagContext at all): the flag
 * system is NEVER consulted and this resolves byte-identically to
 * `selectModelChain('default', constraints)` (i.e. `legacyChain('auto')`,
 * filtered) — exactly today's behavior, unchanged.
 */
export async function resolveDefaultChain(
  flagContext: Parameters<typeof isFeatureEnabled>[1] | undefined,
  constraints: RoutingConstraints = {},
): Promise<ModelDescriptor[]> {
  const callerId = flagContext?.userId;
  // No identity to bucket on → fail toward OpenAI-primary, and skip the flag
  // read entirely (mirrors the Deno mirror's callerId-first short-circuit).
  const useClaudePrimary = !!callerId && (await isFeatureEnabled(MODEL_ROLLOUT_FLAG, flagContext ?? {}));

  const chain = useClaudePrimary ? claudePrimaryChain('auto') : legacyChain('auto');
  return chain.filter((m) => passesConstraints(m, constraints));
}
