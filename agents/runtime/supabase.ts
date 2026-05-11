/**
 * agents/runtime/supabase.ts — service_role client for the mesh runtime.
 *
 * The mesh substrate (cycles / tasks / cycle_evaluations / ...) is locked
 * to `service_role` (see migration 20260511120000_agent_mesh_foundation.sql
 * RLS section). The runtime workers all use THIS client; nothing else.
 *
 * We deliberately do not import from `src/lib/supabase-admin.ts` because:
 *   1. This module is invoked from tsx scripts, not Next.js. The `@/`
 *      path alias is not configured for plain tsx, and we want the mesh
 *      runtime to stay independent of the Next.js bundler.
 *   2. supabase-admin in src/lib reads request-scoped env. The runtime is
 *      long-lived and authenticates once at boot.
 *
 * Required env vars (validated at boot — script refuses to start without them):
 *   - SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getMeshSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'agents/runtime: Supabase env missing (need SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).\n' +
        'These live in Vercel — pull them once with:\n' +
        '  vercel env pull .env.local --environment=development\n' +
        'The agent runtime auto-loads .env.local from the repo root on every tick.',
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-mesh-runtime': 'v0' } },
  });
  return cached;
}

export async function assertMeshFlagEnabled(): Promise<void> {
  const sb = getMeshSupabase();
  const { data, error } = await sb
    .from('feature_flags')
    .select('flag_name, is_enabled, rollout_percentage')
    .eq('flag_name', 'ff_agent_mesh_v1')
    .maybeSingle();
  if (error) {
    throw new Error(`Could not read feature_flags.ff_agent_mesh_v1: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      'feature_flags.ff_agent_mesh_v1 row not found. The migration 20260511120000_agent_mesh_foundation.sql has not been applied. Run `supabase db push` first.',
    );
  }
  if (!data.is_enabled) {
    throw new Error(
      'feature_flags.ff_agent_mesh_v1 is OFF. The mesh runtime refuses to run. Flip it ON deliberately (and only after resolving the four open questions in agents/README.md).',
    );
  }
}
