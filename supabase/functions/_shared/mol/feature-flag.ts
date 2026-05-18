// supabase/functions/_shared/mol/feature-flag.ts

/**
 * Minimal Deno-side feature_flags reader for Edge Functions.
 * Mirrors src/lib/feature-flags.ts but uses Deno.env and avoids npm deps.
 * Cached per-worker for 5 minutes.
 */

interface FlagRow {
  flag_name: string
  is_enabled: boolean
  target_environments: string[] | null
  rollout_percentage: number | null
}

let cache: FlagRow[] | null = null
let cache_expiry = 0
const TTL_MS = 5 * 60_000

async function load(): Promise<FlagRow[]> {
  const now = Date.now()
  if (cache && now < cache_expiry) return cache

  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return cache || []

  try {
    const res = await fetch(
      `${url}/rest/v1/feature_flags?select=flag_name,is_enabled,target_environments,rollout_percentage`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    )
    if (!res.ok) return cache || []
    cache = await res.json() as FlagRow[]
    cache_expiry = now + TTL_MS
    return cache
  } catch {
    return cache || []
  }
}

/**
 * Deterministic bucket: returns true for `student_id` if rollout_percentage covers it.
 * Uses simple string hash mod 100.
 */
function inRolloutBucket(student_id: string, percent: number): boolean {
  let h = 0
  for (let i = 0; i < student_id.length; i++) h = ((h << 5) - h + student_id.charCodeAt(i)) | 0
  return Math.abs(h) % 100 < percent
}

export async function isFlagEnabled(
  flag_name: string,
  ctx: { student_id?: string; environment?: string } = {},
): Promise<boolean> {
  const flags = await load()
  const f = flags.find((x) => x.flag_name === flag_name)
  if (!f || !f.is_enabled) return false

  if (f.target_environments && f.target_environments.length > 0) {
    const env = ctx.environment || Deno.env.get('ENVIRONMENT') || 'production'
    if (!f.target_environments.includes(env)) return false
  }

  if (typeof f.rollout_percentage === 'number' && f.rollout_percentage < 100) {
    if (!ctx.student_id) return false
    return inRolloutBucket(ctx.student_id, f.rollout_percentage)
  }

  return true
}

/** Force-clear cache (for tests / admin tools). */
export function _resetFlagCache(): void {
  cache = null
  cache_expiry = 0
}
