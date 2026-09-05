// supabase/functions/grounded-answer/_semantic-cache-flag.ts
//
// Lightweight feature-flag cache for ff_foxy_semantic_cache_v1 — the
// embedding-cosine-similarity answer cache tier (cache-semantic.ts, Phase 2E
// cost optimization). Structurally a copy of _everyday-flag.ts (same 60s TTL
// cache, same single-column read, same __reset*ForTests export) so the
// grounded-answer flag readers stay one recognisable pattern.
//
// Default: DISABLED. Fail-CLOSED — a missing row, a null/false row, OR a
// failed read all yield `false`, same reasoning as _everyday-flag.ts: a
// semantic-cache hit changes what a student sees (a previously-generated
// answer instead of a fresh one), so an unreadable flag must degrade to
// "behave exactly like today" (pipeline runs end-to-end), never to serving
// stale/wrong-context answers.

/** The flag row this module reads. Exported for tests + call-site clarity. */
export const SEMANTIC_CACHE_FLAG_NAME = 'ff_foxy_semantic_cache_v1';

interface FlagCache {
  value: boolean;
  expiresAt: number;
}
let semanticCacheFlagCache: FlagCache | null = null;
const SEMANTIC_CACHE_FLAG_CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
export async function isFoxySemanticCacheEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (semanticCacheFlagCache && semanticCacheFlagCache.expiresAt > now) {
    return semanticCacheFlagCache.value;
  }

  try {
    const { data, error } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', SEMANTIC_CACHE_FLAG_NAME)
      .single();
    if (error && error.code !== 'PGRST116') {
      console.warn(
        `${SEMANTIC_CACHE_FLAG_NAME} lookup failed — ${error.code}: ${error.message}`,
      );
      semanticCacheFlagCache = { value: false, expiresAt: now + SEMANTIC_CACHE_FLAG_CACHE_TTL_MS };
      return false;
    }
    const value = data?.is_enabled === true;
    semanticCacheFlagCache = { value, expiresAt: now + SEMANTIC_CACHE_FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`${SEMANTIC_CACHE_FLAG_NAME} lookup failed — ${String(err)}`);
    semanticCacheFlagCache = { value: false, expiresAt: now + SEMANTIC_CACHE_FLAG_CACHE_TTL_MS };
    return false;
  }
}

export function __resetSemanticCacheFlagCacheForTests(): void {
  semanticCacheFlagCache = null;
}
