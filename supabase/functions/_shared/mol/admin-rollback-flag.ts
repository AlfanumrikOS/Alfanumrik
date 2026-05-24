// supabase/functions/_shared/mol/admin-rollback-flag.ts
//
// Phase 1A rollback flag reader — used by the six admin/async Edge Functions
// that route through MoL with `preferred_provider: 'openai'`:
//
//   1. bulk-question-gen
//   2. bulk-non-mcq-gen
//   3. generate-concepts
//   4. generate-answers
//   5. extract-ncert-questions
//   6. parent-report-generator
//
// Contract: when the flag returns FALSE, the function MUST revert to its
// legacy direct-Anthropic-fetch path (the byte-for-byte pre-migration code).
// Goal: ops can disable OpenAI routing in under 5 minutes (flag cache TTL)
// without a redeploy if anything goes wrong.
//
// Kill-switch precedence (highest first):
//   1. metadata.kill_switch === true   → legacy path
//   2. typeof metadata.enabled === 'boolean' → that value
//   3. else → is_enabled column
//
// This intentionally splits "kill switch" (emergency) from "enabled"
// (operational toggle) so an oncall engineer can hit kill_switch without
// touching the regular metadata.enabled state.

import { getFlagEnvelope } from './feature-flag.ts'

export const MOL_ADMIN_FUNCTIONS_FLAG = 'ff_mol_admin_functions_v1'

/**
 * Returns true if the flag is in its "route through MoL" state.
 *
 * Defensive: on any flag-read failure we return FALSE (legacy path). The
 * tradeoff: if Supabase is down we lose the cost savings briefly, but we
 * NEVER accidentally hit OpenAI when ops thinks the kill switch is on.
 * Cost > correctness for the duration of a flag-read outage.
 */
export async function isMolAdminRoutingEnabled(): Promise<boolean> {
  try {
    const { is_enabled, metadata } = await getFlagEnvelope(MOL_ADMIN_FUNCTIONS_FLAG)
    const md = (metadata ?? {}) as { enabled?: boolean; kill_switch?: boolean }
    if (md.kill_switch === true) return false
    if (typeof md.enabled === 'boolean') return md.enabled
    return is_enabled === true
  } catch {
    return false
  }
}
