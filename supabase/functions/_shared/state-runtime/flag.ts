/**
 * supabase/functions/_shared/state-runtime/flag.ts
 *
 * Deno-side copy of `src/lib/state/runtime/flag.ts`. The cached module-level
 * state means a single Edge Function instance reuses the flag value for 30s,
 * matching Node-side semantics.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FLAG_NAME = 'ff_projector_runner_v1'
const TTL_MS = 30_000
let cachedAt: number | null = null
let cachedValue: boolean | null = null

export async function isProjectorRunnerEnabled(
  sb: SupabaseClient,
): Promise<boolean> {
  const now = Date.now()
  if (cachedValue !== null && cachedAt !== null && now - cachedAt < TTL_MS) {
    return cachedValue
  }
  const { data, error } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', FLAG_NAME)
    .maybeSingle()
  // tickAll() already wraps this call in a try/catch that fails closed and
  // reports `failedClosedReason` — but supabase-js resolves instead of
  // throwing, so that handler could never fire and an unreadable kill-switch
  // silently resolved to "OFF, cached for 30s" with no reason recorded.
  // Throwing restores the designed path. The cache is deliberately left
  // untouched so the next call retries the read.
  if (error) {
    throw new Error(`${FLAG_NAME} read failed (${error.code}): ${error.message}`)
  }
  cachedValue = data?.is_enabled === true
  cachedAt = now
  return cachedValue
}
