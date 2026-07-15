/**
 * ⚠️ CRITICAL AUTH / TENANT-ISOLATION PATH
 * Sets the tenant claim that the DB's get_jwt_school_id() reads for RLS.
 *
 * SERVER-ONLY: imports the service-role supabase client (getSupabaseAdmin,
 * which bypasses RLS and uses the admin GoTrue endpoints). NEVER import this
 * from client components. Intentionally NOT re-exported from the identity
 * barrel (packages/lib/src/identity/index.ts) for the same reason — import it
 * directly:
 *   import { setSchoolClaim } from '@alfanumrik/lib/identity/school-claim';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 * ─────────────────────────────────────────────────────────────────────────────
 * Writes `app_metadata.school_id = schoolId` onto a user's auth record via the
 * Supabase admin API. That claim is the ONLY thing the tenant-isolation helper
 * `public.get_jwt_school_id()` reads
 *   (migration 20260506000002_white_label_school_schema.sql:29-40 →
 *    current_setting('request.jwt.claims')::jsonb -> 'app_metadata' ->> 'school_id')
 * and it powers the school-staff RLS SELECT policies on students / teachers /
 * classes. Until this helper is wired in, that claim is never set, so those
 * policies never fire and school-staff reads rely entirely on the service-role
 * client (which bypasses RLS).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KNOWN BEHAVIOR — CLAIM PROPAGATION (document at every call site)
 * ─────────────────────────────────────────────────────────────────────────────
 * `app_metadata` changes take effect on the user's NEXT token refresh / login,
 * NOT immediately. An already-issued JWT keeps its old (missing) claim until it
 * refreshes. Therefore:
 *   • The service-role read paths remain the safety net until claims propagate —
 *     do NOT remove them when wiring this in.
 *   • A "re-login to activate your school view" UX nudge is a frontend follow-up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCALAR CLAIM — SINGLE-SCHOOL ONLY
 * ─────────────────────────────────────────────────────────────────────────────
 * `app_metadata.school_id` is a single scalar uuid. This path targets
 * single-school staff (principals/teachers) and single-school students. Do NOT
 * call this for MULTI-school institution_admins — a single claim would be
 * misleading and silently hide their other schools. Multi-school admins stay on
 * the explicit `school_admins`-scoped query path (authorizeSchoolAdmin). If we
 * ever need multi-school JWT scoping, the right shape is an
 * `app_metadata.school_ids` array + an array-membership variant of
 * get_jwt_school_id() (a broader change — deliberately NOT implemented here).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAIL-SOFT + P13
 * ─────────────────────────────────────────────────────────────────────────────
 * Never throws — returns a structured result so callers can wire this into
 * onboarding/staff flows without risking the funnel (P15-adjacent). Logs only
 * non-PID identifiers (authUserId + schoolId are opaque uuids — acceptable);
 * never logs email / token / name / phone (P13).
 */

import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export type SetSchoolClaimReason =
  | 'set' // write performed
  | 'noop_already_set' // idempotent guard hit — claim already equals schoolId
  | 'invalid_input' // missing authUserId or schoolId
  | 'user_not_found' // no auth user for authUserId
  | 'fetch_failed' // admin.getUserById errored
  | 'update_failed' // admin.updateUserById errored
  | 'threw'; // unexpected throw

export interface SetSchoolClaimResult {
  /** True when the claim now equals schoolId (whether just written or already set). */
  ok: boolean;
  /** True only when an actual write happened (false for the idempotent no-op). */
  changed: boolean;
  reason: SetSchoolClaimReason;
}

/**
 * Set `app_metadata.school_id = schoolId` on the given auth user.
 *
 * MERGE, NEVER CLOBBER: fetches the user's current `app_metadata` first and
 * spreads it, so existing claims (provider, providers, role, …) are preserved.
 *
 * IDEMPOTENT: if the claim already equals `schoolId`, the write is skipped
 * (returns { ok: true, changed: false, reason: 'noop_already_set' }).
 *
 * @param authUserId auth.users.id (uuid) — the user whose claim to set.
 * @param schoolId   schools.id (uuid) — the tenant to scope them to.
 */
export async function setSchoolClaim(
  authUserId: string,
  schoolId: string,
  logPrefix = '[setSchoolClaim]'
): Promise<SetSchoolClaimResult> {
  if (!authUserId || !schoolId) {
    // Metadata only (P13): no ids to leak here, and both are opaque uuids anyway.
    console.error(`${logPrefix} missing authUserId or schoolId — refusing to set claim`);
    return { ok: false, changed: false, reason: 'invalid_input' };
  }

  try {
    const admin = getSupabaseAdmin();

    // 1. Fetch current app_metadata so we MERGE rather than clobber it.
    const { data: fetched, error: fetchErr } =
      await admin.auth.admin.getUserById(authUserId);

    if (fetchErr) {
      console.error(
        `${logPrefix} getUserById failed for ${authUserId}:`,
        fetchErr.message
      );
      return { ok: false, changed: false, reason: 'fetch_failed' };
    }
    if (!fetched?.user) {
      console.error(`${logPrefix} no auth user found for ${authUserId}`);
      return { ok: false, changed: false, reason: 'user_not_found' };
    }

    const existing =
      (fetched.user.app_metadata as Record<string, unknown> | null | undefined) ?? {};

    // 2. Idempotent guard: re-setting the same school_id is a no-op (skip write).
    if (existing.school_id === schoolId) {
      return { ok: true, changed: false, reason: 'noop_already_set' };
    }

    // 3. Merge: spread existing app_metadata, add/replace only school_id.
    const { error: updateErr } = await admin.auth.admin.updateUserById(authUserId, {
      app_metadata: { ...existing, school_id: schoolId },
    });

    if (updateErr) {
      console.error(
        `${logPrefix} updateUserById failed for ${authUserId} (school ${schoolId}):`,
        updateErr.message
      );
      return { ok: false, changed: false, reason: 'update_failed' };
    }

    // NOTE: takes effect on the user's next token refresh/login — see file header.
    return { ok: true, changed: true, reason: 'set' };
  } catch (err) {
    console.error(
      `${logPrefix} threw for ${authUserId}:`,
      err instanceof Error ? err.message : err
    );
    return { ok: false, changed: false, reason: 'threw' };
  }
}
