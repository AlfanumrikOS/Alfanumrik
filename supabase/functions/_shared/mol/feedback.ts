// supabase/functions/_shared/mol/feedback.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface WeightRow {
  task_type: string
  openai_weight: number  // 0..1
}

let cache: Record<string, number> | null = null
let cache_expiry = 0
const TTL_MS = 5 * 60_000

let _client: ReturnType<typeof createClient> | null = null
function client() {
  if (_client) return _client
  _client = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  return _client
}

/** Returns { task_type: openai_weight } map. */
export async function getRoutingWeights(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cache && now < cache_expiry) return cache

  try {
    const { data } = await client().from('mol_routing_weights')
      .select('task_type, openai_weight') as unknown as { data: WeightRow[] | null }
    cache = {}
    for (const r of data ?? []) cache[r.task_type] = r.openai_weight
    cache_expiry = now + TTL_MS
    return cache
  } catch {
    return cache || {}
  }
}

export function _resetWeightsCache(): void {
  cache = null
  cache_expiry = 0
}
