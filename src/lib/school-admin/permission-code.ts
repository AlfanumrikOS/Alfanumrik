/**
 * Phase 3B — Wave C: flag-conditional permission-code selector (backend-owned).
 *
 * ─── Why this exists (deploy-safety, not behavior) ───────────────────────────
 * Wave C re-points each school-admin route from its historical permission code
 * (e.g. `school.manage_billing`) onto a CEO-approved MATRIX code (e.g.
 * `institution.manage_billing` / `institution.view_billing`). The matrix codes
 * are granted to the single `institution_admin` RBAC role by migration
 * 20260614000002, so once that migration is applied EVERY school admin passes
 * `authorizeRequest()` for the new code regardless of the `ff_school_admin_rbac`
 * flag (the flag only toggles the per-role NARROWING inside
 * `authorizeSchoolAdmin`).
 *
 * The risk this helper closes is a DEPLOY ORDERING gap: if the application code
 * (carrying the new matrix code) reaches production BEFORE the grants migration
 * applies, a school admin's RBAC role would lack the not-yet-granted new code
 * and `authorizeRequest()` would 403 them — a regression on a live route.
 *
 * So the rule is: while `ff_school_admin_rbac` is OFF, every route authorizes on
 * its ORIGINAL code (today's exact behavior — no dependency on the new grant).
 * Only when the flag is ON do routes authorize on the new matrix code (by which
 * point the migration is necessarily applied and role-narrowing is wanted). This
 * makes the flag-OFF auth decision BYTE-IDENTICAL to pre-Wave-C and the code
 * deploy safe to ship ahead of the migration.
 *
 * Cost: a single already-cached flag read (`isFeatureEnabled` caches for 5min),
 * no extra DB round-trip, no measurable added latency.
 *
 * This is a PURE selector — it makes no auth decision and never touches the
 * SCHOOL_ADMIN_ROLE_CAPABILITIES narrowing in school-admin-auth.ts (architect
 * owns that). It only chooses WHICH permission string to hand to
 * `authorizeSchoolAdmin`.
 */

import { isFeatureEnabled } from '@/lib/feature-flags';

/**
 * Wave C master flag name. Kept as a local literal (rather than importing
 * SCHOOL_ADMIN_RBAC_FLAGS) so this selector only depends on the single
 * `isFeatureEnabled` export — route unit tests that partially mock
 * `@/lib/feature-flags` (just `isFeatureEnabled`) keep working unchanged.
 * MUST equal SCHOOL_ADMIN_RBAC_FLAGS.V1 in src/lib/feature-flags.ts.
 */
const FF_SCHOOL_ADMIN_RBAC = 'ff_school_admin_rbac';

interface CodePair {
  /** Permission code used while ff_school_admin_rbac is OFF (today's behavior). */
  off: string;
  /** CEO-approved matrix code used when ff_school_admin_rbac is ON (Wave C). */
  on: string;
}

/**
 * Resolve the permission code a school-admin route should authorize against,
 * conditional on the `ff_school_admin_rbac` flag.
 *
 *   flag OFF → returns `off` (the route's original, pre-Wave-C code)
 *   flag ON  → returns `on`  (the CEO-approved matrix code)
 *
 * The flag read is environment-scoped to mirror every other server-side gate in
 * the school-admin surface and reuses the shared 5-minute flag cache.
 */
export async function schoolAdminPermissionCode(pair: CodePair): Promise<string> {
  const rbacEnforced = await isFeatureEnabled(FF_SCHOOL_ADMIN_RBAC, {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
  return rbacEnforced ? pair.on : pair.off;
}
