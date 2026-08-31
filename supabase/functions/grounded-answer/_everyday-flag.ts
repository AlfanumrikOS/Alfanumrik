// supabase/functions/grounded-answer/_everyday-flag.ts
//
// Lightweight feature-flag cache for ff_foxy_everyday_examples_v1 — the
// everyday-Indian-life example requirement appended to Foxy's structured-output
// system prompt (see structured-prompt.ts's EVERYDAY_EXAMPLE_DIRECTIVE).
//
// Structurally a copy of _mmr-flag.ts (same 60s TTL cache, same single-column
// read, same __reset*ForTests export) so the four grounded-answer flag readers
// stay recognisably one pattern.
//
// Default: DISABLED. Fail-CLOSED — a missing row, a null/false row, OR a failed
// read all yield `false`.
//
// WHY THE OPPOSITE OF _mmr-flag.ts: that flag fails OPEN because MMR is a pure
// re-ordering of an already-retrieved chunk set — its worst case is "Foxy gets
// the original Voyage rerank ordering", which is itself production-quality, so
// there is no unsafe direction. This flag is different in kind: it CHANGES
// STUDENT-FACING GENERATION by adding a hard requirement to the system prompt.
// The safe state for an unreadable flag is therefore "behave exactly like
// today", i.e. OFF — the same reasoning _continuation-flag.ts and pipeline.ts's
// ff_grounded_ai_enabled use. A transient DB blip must never silently ramp a
// generation change to 100% of students.
//
// Fail-CLOSED also protects the cache-correctness contract: the resolved value
// is folded into gen_ctx (gen-ctx.ts's `everyday_examples`). Defaulting to
// `false` on an unreadable flag means a blip produces today's prompt AND today's
// cache identity together — never a mismatched pair.

/** The flag row this module reads. Exported for tests + call-site clarity. */
export const EVERYDAY_EXAMPLES_FLAG_NAME = 'ff_foxy_everyday_examples_v1';

interface FlagCache {
  value: boolean;
  expiresAt: number;
}
let everydayFlagCache: FlagCache | null = null;
const EVERYDAY_FLAG_CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
export async function isEverydayExamplesEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (everydayFlagCache && everydayFlagCache.expiresAt > now) {
    return everydayFlagCache.value;
  }

  try {
    const { data, error } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', EVERYDAY_EXAMPLES_FLAG_NAME)
      .single();
    // supabase-js resolves instead of throwing, so the fail-CLOSED catch below
    // never ran for a query error — the flag resolved OFF and was cached as a
    // SUCCESS with no log. Same outcome (OFF, which the header explains is the
    // deliberate direction for a generation-changing flag), now recorded.
    // PGRST116 ("no rows") is the documented missing-row case and stays silent.
    if (error && error.code !== 'PGRST116') {
      console.warn(
        `${EVERYDAY_EXAMPLES_FLAG_NAME} lookup failed — ${error.code}: ${error.message}`,
      );
      everydayFlagCache = { value: false, expiresAt: now + EVERYDAY_FLAG_CACHE_TTL_MS };
      return false;
    }
    // Default OFF: ONLY an explicit `is_enabled === true` enables the directive.
    // A missing row (migration not applied — dev/test/fresh DB) → false.
    const value = data?.is_enabled === true;
    everydayFlagCache = { value, expiresAt: now + EVERYDAY_FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`${EVERYDAY_EXAMPLES_FLAG_NAME} lookup failed — ${String(err)}`);
    // Fail-CLOSED: keep the everyday-example directive OFF if we can't read the
    // flag. Cached for the same TTL as the success path so a sustained outage
    // does not turn into a per-request DB hammer.
    everydayFlagCache = { value: false, expiresAt: now + EVERYDAY_FLAG_CACHE_TTL_MS };
    return false;
  }
}

export function __resetEverydayFlagCacheForTests(): void {
  everydayFlagCache = null;
}
