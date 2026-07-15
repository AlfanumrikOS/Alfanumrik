/**
 * ⚠️ SERVER-ONLY — tenant-claim wiring for STAFF link points (Phase 4).
 *
 * Thin, fail-soft, fire-and-forget adapters around setSchoolClaim() (in
 * ./school-claim.ts) that the school-admin onboarding / staff-create / provisioning
 * / claim flows call to stamp `app_metadata.school_id` onto a STAFF member's auth
 * user, so the DB's get_jwt_school_id() RLS can fire for them.
 *
 * Like school-claim.ts this imports the service-role admin client transitively and
 * is INTENTIONALLY NOT re-exported from the identity barrel
 * (packages/lib/src/identity/index.ts) — import it directly:
 *   import { dispatchSingleSchoolAdminClaim } from '@alfanumrik/lib/identity/school-claim-wiring';
 * (keeps the admin client out of client bundles — P8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A WRAPPER (single-school guard + fire-and-forget)
 * ─────────────────────────────────────────────────────────────────────────────
 * `app_metadata.school_id` is a SCALAR uuid (see school-claim.ts). A caller must
 * NEVER set it for a MULTI-school institution_admin — a single claim would silently
 * hide their other schools. Every staff link point can already have (or can cheaply
 * resolve) the caller's `school_admins` memberships, so this module resolves the
 * count itself and only sets the claim when the auth user administers EXACTLY ONE
 * active school AND that school is the one being established. Multi-school admins
 * stay on the explicit `school_admins`-scoped query path (authorizeSchoolAdmin).
 *
 * STUDENTS ARE INTENTIONALLY NOT WIRED HERE. The `students` staff RLS policy is
 * role-agnostic, so a student carrying `school_id` could read same-school peers'
 * PII. Students are excluded until that policy gets a staff guard (architect
 * follow-up). These helpers therefore key strictly on `school_admins`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAIL-SOFT + "RE-LOGIN TO ACTIVATE"
 * ─────────────────────────────────────────────────────────────────────────────
 * A failed or slow claim write must NEVER block or fail the underlying
 * link/create operation. `dispatchSingleSchoolAdminClaim` is fire-and-forget: it
 * never throws, never rejects (belt-and-suspenders .catch), and returns void. The
 * service-role read paths remain the safety net until the claim propagates, which
 * happens on the user's NEXT token refresh / login (app_metadata is baked into the
 * JWT at issue time). Callers that return a response to the client surface a small
 * non-PII `school_claim: 'pending_refresh'` hint so the frontend can later nudge
 * the user to re-login to see their school view. P13: nothing here logs PII — the
 * only identifiers touched are opaque uuids, and this module itself does not log.
 */

import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { setSchoolClaim, type SetSchoolClaimReason } from '@alfanumrik/lib/identity/school-claim';

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

export type SingleSchoolAdminClaimReason =
  | SetSchoolClaimReason // pass-through from setSchoolClaim when it was actually called
  | 'skipped_invalid_input' // missing authUserId / expectedSchoolId
  | 'skipped_multi_school' // the auth user administers >1 school (or a different one)
  | 'skipped_lookup_failed' // membership lookup errored — safety net remains
  | 'skipped_threw'; // unexpected throw building/awaiting the membership query

export interface SingleSchoolAdminClaimResult {
  ok: boolean;
  reason: SingleSchoolAdminClaimReason;
}

/**
 * Set `app_metadata.school_id = expectedSchoolId` on `authUserId` IFF that auth
 * user administers EXACTLY ONE active school and it is `expectedSchoolId`. Never
 * throws — returns a structured reason for observability. The membership count is
 * resolved from `school_admins` (active rows) using the passed admin client.
 *
 * This is the single-school guard for the scalar claim; multi-school admins are
 * skipped (`skipped_multi_school`) and keep using the school_admins-scoped path.
 */
export async function setSchoolClaimForSingleSchoolAdmin(
  admin: AdminClient,
  authUserId: string,
  expectedSchoolId: string,
  logPrefix = '[schoolClaimWiring]'
): Promise<SingleSchoolAdminClaimResult> {
  if (!authUserId || !expectedSchoolId) {
    return { ok: false, reason: 'skipped_invalid_input' };
  }
  try {
    // Resolve how many DISTINCT active schools this auth user administers. The
    // claim is scalar, so only a genuine single-school admin may carry it.
    const { data, error } = await admin
      .from('school_admins')
      .select('school_id')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true);

    if (error) {
      // Non-fatal: the service-role read paths remain the safety net.
      return { ok: false, reason: 'skipped_lookup_failed' };
    }

    const schoolIds = new Set(
      (Array.isArray(data) ? data : [])
        .map((row) => (row as { school_id?: string } | null)?.school_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );

    if (schoolIds.size !== 1 || !schoolIds.has(expectedSchoolId)) {
      // Multi-school (or a mismatch) — never stamp a misleading scalar claim.
      return { ok: false, reason: 'skipped_multi_school' };
    }

    const res = await setSchoolClaim(authUserId, expectedSchoolId, logPrefix);
    return { ok: res.ok, reason: res.reason };
  } catch {
    // Absolute backstop — this must never throw into a link/create flow.
    return { ok: false, reason: 'skipped_threw' };
  }
}

/**
 * Fire-and-forget dispatcher for a single-school-admin tenant claim. Never
 * awaited by the caller, never throws, never rejects. Use at STAFF link points
 * where blocking on the GoTrue admin write is unacceptable (onboarding /
 * staff-create / provisioning / claim). The claim takes effect on the user's next
 * token refresh — the service-role read paths remain the safety net until then.
 */
export function dispatchSingleSchoolAdminClaim(
  admin: AdminClient,
  authUserId: string,
  expectedSchoolId: string,
  logPrefix = '[schoolClaimWiring]'
): void {
  // `void` + defensive `.catch` so a rejected promise can never surface as an
  // unhandled rejection (the inner helper already never throws).
  void setSchoolClaimForSingleSchoolAdmin(admin, authUserId, expectedSchoolId, logPrefix).catch(
    () => {}
  );
}
