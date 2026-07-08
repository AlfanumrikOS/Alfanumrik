import type { SupabaseClient } from '@supabase/supabase-js';

const FLAG_NAME = 'ff_projector_runner_v1';
const TTL_MS = 30_000;
let cachedAt: number | null = null;
let cachedValue: boolean | null = null;

/**
 * Cached read of the projector-runner kill-switch flag. When the flag is
 * OFF, the runtime's tickAll() returns {skipped: true} without touching
 * any subscriber cursors. Cache TTL is 30s so flag flips propagate fast.
 */
export async function isProjectorRunnerEnabled(sb: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && cachedAt !== null && now - cachedAt < TTL_MS) {
    return cachedValue;
  }
  const { data } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', FLAG_NAME)
    .maybeSingle();
  cachedValue = data?.is_enabled === true;
  cachedAt = now;
  return cachedValue;
}

/** Test-only. */
export function __resetFlagCacheForTests(): void {
  cachedAt = null;
  cachedValue = null;
}
