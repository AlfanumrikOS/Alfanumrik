// supabase/functions/grounded-answer/_continuation-flag.ts
//
// Lightweight feature-flag cache for ff_foxy_answer_continuation_v1 (Phase 0.2
// — bounded max_tokens continuation for truncated Foxy structured answers).
// Mirrors the isDigitalTwinEnabled pattern in _twin-flag.ts, kept separate so
// this flag's TTL + fail-CLOSED semantics are independent.
//
// Default: DISABLED. Fail-CLOSED — if the DB read fails for ANY reason, the
// continuation behavior stays OFF. This flag gates an EXTRA Claude call that
// runs only when the primary structured turn was cut off at max_tokens, so the
// safe default on an unreadable flag is "behave exactly like today" (the
// existing rescueFromTruncatedJson → wrapAsParagraph net still applies).

interface FlagCache {
  value: boolean;
  expiresAt: number;
}
let continuationFlagCache: FlagCache | null = null;
const CONTINUATION_FLAG_CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
export async function isAnswerContinuationEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (continuationFlagCache && continuationFlagCache.expiresAt > now) {
    return continuationFlagCache.value;
  }

  try {
    const { data } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_foxy_answer_continuation_v1')
      .single();
    // Default OFF: only a row with is_enabled === true enables the behavior.
    // A missing row (migration not applied / dev DB) → OFF (fail-closed).
    const value = data?.is_enabled === true;
    continuationFlagCache = { value, expiresAt: now + CONTINUATION_FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`ff_foxy_answer_continuation_v1 lookup failed — ${String(err)}`);
    // Fail-CLOSED: keep continuation OFF if we can't read the flag.
    continuationFlagCache = { value: false, expiresAt: now + CONTINUATION_FLAG_CACHE_TTL_MS };
    return false;
  }
}

export function __resetContinuationFlagCacheForTests(): void {
  continuationFlagCache = null;
}
