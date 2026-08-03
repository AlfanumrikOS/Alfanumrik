// supabase/functions/grounded-answer/_model-rollout-flag.ts
//
// Percentage-based rollout mechanism for the 2026-08-02 OpenAI-primary
// provider swap (see ./config.ts's MODEL_FALLBACK_ORDER /
// CLAUDE_PRIMARY_FALLBACK_ORDER). That swap shipped as a flat, unconditional
// 100%-of-traffic switch — this module adds a deterministic, percentage-
// controlled lever ON TOP of it so ops can ramp/roll back exposure gradually
// instead of an all-or-nothing code change.
//
// ── Flag: ff_foxy_openai_primary_rollout_v1 ──────────────────────────────────
// Plain `is_enabled` + `rollout_percentage` columns on `feature_flags` — NOT
// the metadata/kill_switch envelope used by the ff_python_* family
// (_shared/mol/feature-flag.ts's getFlagEnvelope / admin-rollback-flag.ts's
// kill_switch precedence). That envelope pattern was considered (per the
// design brief) and deliberately NOT used here: this flag's bucketing MUST
// produce byte-identical decisions to the TS Model Gateway's
// packages/lib/src/ai/gateway/rollout.ts for the same caller (P12), and the
// TS side's only pre-existing, ALREADY-PROVEN cross-runtime-parity rollout
// primitive is `hashForRollout` (packages/lib/src/feature-flags.ts, mirrored
// in supabase/functions/identity/index.ts, with an existing parity test at
// apps/host/src/__tests__/lib/feature-flags-rollout-hash-parity.test.ts) —
// which reads plain is_enabled/rollout_percentage, not a metadata envelope.
// Reusing that proven pair (rather than inventing a third bucketing formula)
// is the whole point; see the "Bucketing" section below for the mechanics.
// `is_enabled=false` IS this flag's kill switch — no separate emergency bit
// is needed (mirrors ff_model_gateway_v1 / ff_foxy_math_pipeline_v1 and most
// other non-ff_python_* flags in this codebase, none of which carry a
// separate kill_switch either).
//
// ── Mapping (READ CAREFULLY — inverted from "rollout_pct% get the new thing") ─
// MODEL_FALLBACK_ORDER (OpenAI-primary) is ALREADY live for 100% of traffic,
// unconditionally, before this flag exists. So "the new thing this flag
// controls" is exposure to the ROLLBACK order, not exposure to OpenAI:
//   - is_enabled=false, OR rollout_percentage<=0, OR no caller id available,
//     OR the flag read fails for any reason
//     → OPENAI-PRIMARY (MODEL_FALLBACK_ORDER) — today's shipped, reviewed,
//     100%-live default. This is what makes a fresh deploy of this
//     mechanism, and its seed state, a pure no-op.
//   - is_enabled=true AND rollout_percentage=P (1-100) AND a caller id is
//     present → the caller's deterministic bucket (0-99) decides:
//     bucket < P  → rolled BACK to CLAUDE-PRIMARY (CLAUDE_PRIMARY_FALLBACK_ORDER)
//     bucket >= P → stays on OPENAI-PRIMARY
//   So `rollout_percentage` names "how much traffic is peeled off to the
//   rollback/Claude-primary order," not "how much traffic newly gets
//   OpenAI" — OpenAI already has 100% before anyone touches this flag.
//   Ops gets ONE lever either direction: dial rollout_percentage up to test
//   a partial (or, at 100, full) rollback to Claude-primary; dial back to 0
//   (or disable) to return fully to today's shipped behavior.
//
// ── Fail-safe direction (explicit, documented decision — ai-engineer,
// 2026-08-03) ── ALWAYS fail toward OPENAI-PRIMARY: on a flag-read error, on
// a missing/empty/null caller id, on a malformed rollout_percentage, and at
// the seeded/default posture. OpenAI-primary is the currently-live, reviewed
// default; Claude-primary is the deliberate ROLLBACK target, never the
// silent fallback — bucketing a caller into it should only ever happen as an
// explicit, successful, identified decision.
//
// ── Bucketing (parity — P12) ──────────────────────────────────────────────
// hash(`${callerId}:${flagName}`) % 100 — the EXACT algorithm as
// packages/lib/src/feature-flags.ts's hashForRollout (salted with the flag
// name), NOT the unsalted inRolloutBucket/hashBucket used by
// python-ai-proxy.ts / mol-shadow.ts / _shared/mol/feature-flag.ts (those
// solve a different, per-flag-independent bucketing need and are
// deliberately left untouched — changing their shared hash would be a
// cross-cutting change outside this task's scope and would regress three
// unrelated existing consumers). A dedicated cross-runtime parity test
// enforces the two copies never drift:
// apps/host/src/__tests__/lib/ai/gateway/model-rollout-hash-parity.test.ts
// (mirrors the existing feature-flags-rollout-hash-parity.test.ts template).
//
// Self-contained fetch + 5-minute in-process cache (mirrors
// _shared/mol/feature-flag.ts's TTL and fail-closed-on-any-error shape).
// Deliberately its OWN small reader rather than routed through
// _shared/mol/feature-flag.ts, for the hash-formula reason above.

export const MODEL_ROLLOUT_FLAG_NAME = 'ff_foxy_openai_primary_rollout_v1';

interface RolloutFlagRow {
  is_enabled: boolean;
  rollout_percentage: number | null;
}

interface FlagCacheEntry {
  /** null = row not found, read failed, or env not configured. */
  row: RolloutFlagRow | null;
  expiresAt: number;
}

let cache: FlagCacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60_000;

async function readRow(): Promise<RolloutFlagRow | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.row;

  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) {
    // Not configured (dev / test env) — cache the miss so we don't retry
    // every call, and resolve via the fail-safe (caller sees row=null).
    cache = { row: null, expiresAt: now + CACHE_TTL_MS };
    return null;
  }

  try {
    const res = await fetch(
      `${url}/rest/v1/feature_flags?select=is_enabled,rollout_percentage&flag_name=eq.${MODEL_ROLLOUT_FLAG_NAME}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) {
      cache = { row: null, expiresAt: now + CACHE_TTL_MS };
      return null;
    }
    const rows = (await res.json()) as RolloutFlagRow[];
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    cache = { row, expiresAt: now + CACHE_TTL_MS };
    return row;
  } catch (err) {
    console.warn(`${MODEL_ROLLOUT_FLAG_NAME} lookup failed — ${String(err)}`);
    // Fail-safe: treat a read error identically to "flag not found" — the
    // caller resolves to OpenAI-primary (see shouldUseClaudePrimary below).
    cache = { row: null, expiresAt: now + CACHE_TTL_MS };
    return null;
  }
}

/**
 * Deterministic 0-99 bucket. MUST stay byte-identical to
 * packages/lib/src/feature-flags.ts's hashForRollout — enforced by
 * apps/host/src/__tests__/lib/ai/gateway/model-rollout-hash-parity.test.ts.
 * The three load-bearing expressions (do not refactor away without updating
 * the parity test's source-pin assertions):
 *   - seed: `${id}:${flagName}`
 *   - accumulator: ((hash << 5) - hash + str.charCodeAt(i)) | 0
 *   - bucket: Math.abs(hash) % 100
 */
export function hashForRollout(id: string, flagName: string): number {
  let hash = 0;
  const str = `${id}:${flagName}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * True when THIS caller should be rolled BACK to Claude-primary for this
 * request. False (the fail-safe / seed default) keeps OpenAI-primary. Never
 * throws — every error path resolves to false.
 */
export async function shouldUseClaudePrimary(
  callerId: string | null | undefined,
): Promise<boolean> {
  // No identity to bucket on → fail toward OpenAI-primary. Deliberately
  // checked BEFORE the flag read so an anonymous/personalization-free call
  // (GroundedRequest.student_id can be null) never touches the flag system.
  if (!callerId) return false;

  const row = await readRow();
  if (!row || row.is_enabled !== true) return false; // absent row / read error / OFF

  const pct =
    typeof row.rollout_percentage === 'number' && Number.isFinite(row.rollout_percentage)
      ? Math.max(0, Math.min(100, row.rollout_percentage))
      : 0;
  if (pct <= 0) return false;

  return hashForRollout(callerId, MODEL_ROLLOUT_FLAG_NAME) < pct;
}

/** Force-clear the in-process cache (tests only). */
export function __resetModelRolloutCacheForTests(): void {
  cache = null;
}
