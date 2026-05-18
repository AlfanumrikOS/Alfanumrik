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
  // C4 foundation (2026-05-19): the shadow-routing flag stores its full
  // gate envelope (kill switch, task allow-list, rollout %) in this jsonb
  // column. The base isFlagEnabled() path ignores metadata; callers that
  // need the envelope use getFlagEnvelope() below.
  metadata?: Record<string, unknown> | null
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
      `${url}/rest/v1/feature_flags?select=flag_name,is_enabled,target_environments,rollout_percentage,metadata`,
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

/**
 * C4 foundation (2026-05-19): read the JSON envelope stored in
 * feature_flags.metadata for a given flag, AND return is_enabled.
 *
 * Designed for flags whose gating policy is too rich for the simple
 * environment+rollout shape — specifically ff_grounded_answer_mol_shadow_v1
 * which carries `{ enabled, kill_switch, task_types[], rollout_pct }`.
 *
 * Returns `{ is_enabled: false, metadata: {} }` when the flag does not
 * exist, the row read failed, or `metadata` is null. Never throws.
 *
 * NB: this helper does NOT apply target_environments or rollout_percentage
 * filtering — the caller owns the policy. We deliberately split the read
 * from the policy so the shadow helper can implement its own
 * `hash(request_id + ':' + task_type) % 100 < rollout_pct` rule (which is
 * different from the student-bucketed rule isFlagEnabled() implements).
 */
export async function getFlagEnvelope(
  flag_name: string,
): Promise<{ is_enabled: boolean; metadata: Record<string, unknown> }> {
  const flags = await load()
  const f = flags.find((x) => x.flag_name === flag_name)
  if (!f) return { is_enabled: false, metadata: {} }
  const meta = f.metadata && typeof f.metadata === 'object' ? f.metadata : {}
  return { is_enabled: Boolean(f.is_enabled), metadata: meta }
}
