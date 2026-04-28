// supabase/functions/grounded-answer/_mmr-flag.ts
//
// Lightweight feature-flag cache for ff_rag_mmr_diversity (Phase 2.B Win 2).
// Mirrors the isServiceEnabled pattern in pipeline.ts but kept separate so
// pipeline.ts retains a single FF lookup pattern and this flag's TTL +
// fail-OPEN semantics can be tuned independently.
//
// Default: ENABLED. Fail-OPEN — if the DB read fails for any reason, MMR
// stays on. MMR is purely a re-ordering of a fixed set; the worst case if
// it misbehaves is "Foxy gets the original Voyage rerank ordering" which
// is already production-quality. Compare to ff_grounded_ai_enabled which
// fail-CLOSEs because that flag gates real AI calls.

interface FlagCache {
  value: boolean;
  expiresAt: number;
}
let mmrFlagCache: FlagCache | null = null;
const MMR_FLAG_CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
export async function isMMRDiversityEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (mmrFlagCache && mmrFlagCache.expiresAt > now) return mmrFlagCache.value;

  try {
    const { data } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_rag_mmr_diversity')
      .single();
    // Treat missing row as "enabled" — the migration is the source of
    // truth for the default and a missing row indicates the migration
    // hasn't run yet (dev/test environments). We default to ON to match
    // the migration's seed.
    const value = data?.is_enabled !== false;
    mmrFlagCache = { value, expiresAt: now + MMR_FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`ff_rag_mmr_diversity lookup failed — ${String(err)}`);
    // Fail-OPEN: keep MMR enabled if we can't read the flag.
    mmrFlagCache = { value: true, expiresAt: now + MMR_FLAG_CACHE_TTL_MS };
    return true;
  }
}

export function __resetMMRFlagCacheForTests(): void {
  mmrFlagCache = null;
}
