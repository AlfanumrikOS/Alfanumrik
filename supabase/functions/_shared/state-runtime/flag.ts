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
  const { data } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', FLAG_NAME)
    .maybeSingle()
  cachedValue = data?.is_enabled === true
  cachedAt = now
  return cachedValue
}
