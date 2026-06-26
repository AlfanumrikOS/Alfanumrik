// supabase/functions/grounded-answer/_twin-flag.ts
//
// Lightweight feature-flag cache for ff_digital_twin_v1 (Digital Twin +
// Knowledge Graph, Slice 1). Mirrors the isServiceEnabled pattern in
// pipeline.ts and _mmr-flag.ts, kept separate so this flag's TTL + fail-CLOSED
// semantics are independent.
//
// Default: DISABLED. Fail-CLOSED — if the DB read fails for ANY reason, the
// twin behaviors (cross-subject transfer-edge retrieval widening) stay OFF.
// This flag gates a retrieval-widening behavior, so the safe default on an
// unreadable flag is "behave exactly like today" (no widening). Compare to
// ff_rag_mmr_diversity which fail-OPENs because MMR is a pure re-ordering of a
// fixed set.

interface FlagCache {
  value: boolean;
  expiresAt: number;
}
let twinFlagCache: FlagCache | null = null;
const TWIN_FLAG_CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
export async function isDigitalTwinEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (twinFlagCache && twinFlagCache.expiresAt > now) return twinFlagCache.value;

  try {
    const { data } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_digital_twin_v1')
      .single();
    // Default OFF: only a row with is_enabled === true enables the behavior.
    // A missing row (migration not applied / dev DB) → OFF (fail-closed).
    const value = data?.is_enabled === true;
    twinFlagCache = { value, expiresAt: now + TWIN_FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`ff_digital_twin_v1 lookup failed — ${String(err)}`);
    // Fail-CLOSED: keep twin behaviors OFF if we can't read the flag.
    twinFlagCache = { value: false, expiresAt: now + TWIN_FLAG_CACHE_TTL_MS };
    return false;
  }
}

export function __resetTwinFlagCacheForTests(): void {
  twinFlagCache = null;
}
