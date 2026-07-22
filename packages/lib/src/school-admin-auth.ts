/**
 * School Admin Authentication Helper
 *
 * Wraps the standard RBAC authorizeRequest() with school_admins lookup.
 * Every school-admin API route calls authorizeSchoolAdmin() first to:
 *   1. Verify JWT and resolve the caller identity
 *   2. Look up every active school_admins membership for the caller
 *   3. Validate an optional URL school scope against those memberships
 *   4. Verify the selected school is active
 *   5. Evaluate RBAC permission in that selected school's context
 *
 * All subsequent queries in the route MUST be scoped to the returned schoolId
 * to enforce tenant isolation.
 *
 * Usage:
 *   const auth = await authorizeSchoolAdmin(request, 'institution.view_analytics');
 *   if (!auth.authorized) return auth.errorResponse!;
 *   // use auth.schoolId, auth.userId, auth.schoolAdminId
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled, SCHOOL_ADMIN_RBAC_FLAGS } from '@alfanumrik/lib/feature-flags';

// ─── School-admin role types ─────────────────────────────────
//
// `school_admins.role` is constrained in the DB to exactly these four values
// (baseline_from_prod.sql `school_admins_role_check`). Until Phase 3B Wave C the
// enum was DECORATIVE — all four resolved to the single `institution_admin` RBAC
// role and therefore got identical access. Wave C makes the role govern
// capability via SCHOOL_ADMIN_ROLE_CAPABILITIES below, gated behind
// `ff_school_admin_rbac` (default OFF).

export type SchoolAdminRole =
  | 'principal'
  | 'vice_principal'
  | 'academic_coordinator'
  | 'institution_admin';

// ─── Types ───────────────────────────────────────────────────

export interface SchoolAdminAuthResult {
  authorized: boolean;
  userId: string | null;
  schoolId: string | null;
  schoolAdminId: string | null;
  /**
   * The caller's `school_admins.role` for the resolved school (or null when not
   * authorized / no admin record). Returned so route handlers and the staff UI
   * can branch on capability without a second DB round-trip. Purely additive:
   * present regardless of the `ff_school_admin_rbac` flag state.
   */
  schoolAdminRole: SchoolAdminRole | null;
  errorResponse?: Response;
}

// ─── CEO-approved role → permission capability matrix (Wave C) ───────────────
//
// Source of truth for the per-school-admin-role narrowing. CEO-approved
// 2026-06-08. The RBAC layer (migration 20260614000002) grants the SUPERSET of
// these codes to the single `institution_admin` RBAC role so authorizeRequest()
// passes; this map then narrows by `school_admins.role` when
// `ff_school_admin_rbac` is ON.
//
//   Permission code                | principal | vice_principal | academic_coordinator | institution_admin
//   institution.view_analytics     |    ✓      |       ✓        |          ✓           |        ✓
//   report.view_class              |    ✓      |       ✓        |          ✓           |        ✓
//   institution.export_reports     |    ✓      |       ✓        |          ✓           |        ✓
//   institution.manage_students    |    ✓      |       ✓        |          ✓           |        ✓
//   institution.manage_teachers    |    ✓      |       ✓        |          ✓           |        ✓
//   class.manage                   |    ✓      |       ✓        |          ✓           |        ✓
//   institution.manage             |    ✓      |       ✓        |          ✗           |        ✓
//   institution.manage_billing     |    ✓      |       ✗        |          ✗           |        ✓
//   institution.view_billing       |    ✓      |       ✓        |          ✗           |        ✓
//   institution.manage_staff       |    ✓      |       ✗        |          ✗           |        ✓
//   institution.use_principal_ai    |    ✓      |       ✗        |          ✗           |        ✗   (CEO-approved 2026-06-11; principal-only v1)
//
// Track 2 "Principal AI Assistant" v1: 'institution.use_principal_ai' is granted
// to the PRINCIPAL role ONLY (NOT vice_principal / academic_coordinator) per the
// CEO-approved Track 2 design. institution_admin intentionally does NOT receive
// it in v1 — the assistant is a single-school principal surface; multi-school
// institution_admin access is a deliberate follow-up decision, not a default.
//
// Scope note: principal / vice_principal / academic_coordinator are single-school
// (their one school_admins.school_id, resolved below). institution_admin is the
// multi-school role with the SAME capability as principal across every active
// school_admins membership — cross-school student access is already special-cased
// for institution_admin in rbac.ts canAccessStudent().
const SCHOOL_ADMIN_ROLE_CAPABILITIES: Readonly<Record<SchoolAdminRole, ReadonlySet<string>>> = {
  principal: new Set<string>([
    'institution.view_analytics',
    'report.view_class',
    'institution.export_reports',
    'institution.manage_students',
    'institution.manage_teachers',
    'class.manage',
    'institution.manage',
    'institution.manage_billing',
    'institution.view_billing',
    'institution.manage_staff',
    // Track 2 Principal AI Assistant v1 — principal-only (CEO-approved 2026-06-11).
    'institution.use_principal_ai',
  ]),
  vice_principal: new Set<string>([
    'institution.view_analytics',
    'report.view_class',
    'institution.export_reports',
    'institution.manage_students',
    'institution.manage_teachers',
    'class.manage',
    'institution.manage',
    // manage_billing ✗
    'institution.view_billing',
    // manage_staff ✗
  ]),
  academic_coordinator: new Set<string>([
    'institution.view_analytics',
    'report.view_class',
    'institution.export_reports',
    'institution.manage_students',
    'institution.manage_teachers',
    'class.manage',
    // institution.manage ✗
    // manage_billing ✗
    // view_billing ✗
    // manage_staff ✗
  ]),
  institution_admin: new Set<string>([
    'institution.view_analytics',
    'report.view_class',
    'institution.export_reports',
    'institution.manage_students',
    'institution.manage_teachers',
    'class.manage',
    'institution.manage',
    'institution.manage_billing',
    'institution.view_billing',
    'institution.manage_staff',
  ]),
};

/**
 * Whether a given school_admins.role is permitted the requested permission code
 * under the CEO-approved Wave C matrix. O(1) Set lookup; no DB round-trip.
 *
 * Conservative default: a role not present in the matrix (should be impossible
 * given the DB CHECK constraint) is denied any code. A permission code that is
 * not part of the matrix at all is treated as NOT role-gated by Wave C — the
 * earlier authorizeRequest() RBAC check is the authority for those codes and the
 * matrix neither grants nor revokes them. This keeps the gate strictly additive:
 * Wave C can only ever DENY a school admin a code that the matrix explicitly
 * carves out for a narrower role; it never grants beyond the RBAC superset.
 */
export function schoolAdminRoleAllows(role: SchoolAdminRole, permissionCode: string): boolean {
  const allowed = SCHOOL_ADMIN_ROLE_CAPABILITIES[role];
  if (!allowed) return false;
  // Codes the matrix governs are the union across all four roles. If a code is
  // outside that union, Wave C does not narrow it (defer to the RBAC check).
  const isMatrixGoverned = schoolAdminRolePermissionIsGoverned(permissionCode);
  if (!isMatrixGoverned) return true;
  return allowed.has(permissionCode);
}

export function schoolAdminRolePermissionIsGoverned(permissionCode: string): boolean {
  return Object.values(SCHOOL_ADMIN_ROLE_CAPABILITIES).some((permissions) => permissions.has(permissionCode));
}

// ─── Main Auth Function ──────────────────────────────────────

/**
 * Authorize a request as a school admin with a specific permission.
 *
 * Steps:
 *  1. Calls authorizeRequest() to validate the JWT and resolve identity.
 *  2. Resolves one active school_admins membership from validated URL scope.
 *  3. Verifies the selected school is active.
 *  4. Calls authorizeRequest() again with context.schoolId for scoped RBAC.
 *
 * Returns schoolId for tenant-scoped queries.
 */
export async function authorizeSchoolAdmin(
  request: Request,
  permissionCode: string
): Promise<SchoolAdminAuthResult> {
  // Step 1: Authenticate and resolve the caller identity without making an
  // unscoped permission decision. Permission evaluation happens only after
  // the requested active membership has been selected below.
  const identityAuth = await authorizeRequest(request);

  if (!identityAuth.authorized) {
    return {
      authorized: false,
      userId: identityAuth.userId,
      schoolId: null,
      schoolAdminId: null,
      schoolAdminRole: null,
      errorResponse: identityAuth.errorResponse,
    };
  }

  const userId = identityAuth.userId!;
  const supabase = getSupabaseAdmin();

  try {
    // Step 2: Look up active school_admins memberships. This intentionally
    // does not use maybeSingle(): institution admins may govern more than one
    // school and their requested URL scope is an authorization boundary.
    // `role` is fetched in the SAME query (no extra round-trip) so the Wave C
    // matrix narrowing and the returned schoolAdminRole reuse it.
    const { data: adminRows, error: adminError } = await supabase
      .from('school_admins')
      .select('id, school_id, role, is_active')
      .eq('auth_user_id', userId)
      .eq('is_active', true);

    if (adminError) {
      logger.error('school_admin_auth_lookup_failed', {
        error: new Error(adminError.message),
        route: 'school-admin-auth',
      });
      return {
        authorized: false,
        userId,
        schoolId: null,
        schoolAdminId: null,
        schoolAdminRole: null,
        errorResponse: NextResponse.json(
          { success: false, error: 'Failed to verify school admin status' },
          { status: 500 }
        ),
      };
    }

    type AdminRow = { id: string; school_id: string; role: SchoolAdminRole | null; is_active: boolean };
    const memberships = (Array.isArray(adminRows) ? adminRows : adminRows ? [adminRows] : []) as AdminRow[];
    if (memberships.length === 0) {
      return {
        authorized: false,
        userId,
        schoolId: null,
        schoolAdminId: null,
        schoolAdminRole: null,
        errorResponse: NextResponse.json(
          { success: false, error: 'Not a school administrator' },
          { status: 403 }
        ),
      };
    }

    const requestUrl = new URL(request.url);
    const camelScope = requestUrl.searchParams.get('schoolId')?.trim() || null;
    const snakeScope = requestUrl.searchParams.get('school_id')?.trim() || null;
    if (camelScope && snakeScope && camelScope !== snakeScope) {
      return {
        authorized: false,
        userId,
        schoolId: null,
        schoolAdminId: null,
        schoolAdminRole: null,
        errorResponse: NextResponse.json(
          { success: false, error: 'Conflicting school scope' },
          { status: 400 },
        ),
      };
    }
    const requestedSchoolId = camelScope ?? snakeScope;
    let adminRecord: AdminRow | undefined;
    if (requestedSchoolId) {
      adminRecord = memberships.find((membership) => membership.school_id === requestedSchoolId);
      if (!adminRecord) {
        return {
          authorized: false,
          userId,
          schoolId: null,
          schoolAdminId: null,
          schoolAdminRole: null,
          errorResponse: NextResponse.json(
            { success: false, error: 'School scope is not one of your active memberships' },
            { status: 403 },
          ),
        };
      }
    } else if (memberships.length === 1) {
      adminRecord = memberships[0];
    } else {
      return {
        authorized: false,
        userId,
        schoolId: null,
        schoolAdminId: null,
        schoolAdminRole: null,
        errorResponse: NextResponse.json(
          {
            success: false,
            error: 'Multiple schools — specify schoolId',
            school_ids: memberships.map((membership) => membership.school_id),
          },
          { status: 400 },
        ),
      };
    }

    const schoolAdminRole = adminRecord.role ?? null;

    // Step 3: Verify the school is active
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('id, is_active')
      .eq('id', adminRecord.school_id)
      .maybeSingle();

    if (schoolError) {
      logger.error('school_admin_auth_school_lookup_failed', {
        error: new Error(schoolError.message),
        route: 'school-admin-auth',
      });
      return {
        authorized: false,
        userId,
        schoolId: null,
        schoolAdminId: null,
        schoolAdminRole: null,
        errorResponse: NextResponse.json(
          { success: false, error: 'Failed to verify school status' },
          { status: 500 }
        ),
      };
    }

    if (!school || !school.is_active) {
      return {
        authorized: false,
        userId,
        schoolId: null,
        schoolAdminId: null,
        schoolAdminRole: null,
        errorResponse: NextResponse.json(
          { success: false, error: 'School is not active' },
          { status: 403 }
        ),
      };
    }

    // Step 4: Evaluate the requested permission in the selected school's RBAC
    // context. Calling authorizeRequest without this context returns the union
    // of a multi-school user's grants and can authorize School B using a grant
    // held only at School A.
    const scopedRbac = await authorizeRequest(request, permissionCode, {
      context: { schoolId: adminRecord.school_id },
    });
    if (!scopedRbac.authorized) {
      return {
        authorized: false,
        userId,
        schoolId: adminRecord.school_id,
        schoolAdminId: adminRecord.id,
        schoolAdminRole,
        errorResponse: scopedRbac.errorResponse,
      };
    }

    if (
      memberships.length > 1
      && scopedRbac.permissionScope === 'baseline-global'
      && !schoolAdminRolePermissionIsGoverned(permissionCode)
    ) {
      return {
        authorized: false,
        userId,
        schoolId: adminRecord.school_id,
        schoolAdminId: adminRecord.id,
        schoolAdminRole,
        errorResponse: NextResponse.json(
          {
            success: false,
            error: 'Selected-school permission resolution is unavailable',
            code: 'SCHOOL_SCOPED_RBAC_REQUIRED',
          },
          { status: 403 },
        ),
      };
    }

    // Step 5 (Wave C): role-aware capability narrowing.
    // GATED behind ff_school_admin_rbac (default OFF). When the flag is OFF this
    // entire block is SKIPPED, so the auth decision is byte-identical to before
    // Wave C (RBAC check + active-school lookup only). When ON, the caller's
    // school_admins.role must grant the requested permissionCode per the
    // CEO-approved matrix, else 403. The role field was already fetched above —
    // no extra DB round-trip.
    // Multi-school requests always apply the selected membership's role
    // matrix, even while the rollout flag is off. This safely narrows the
    // baseline one-argument permission fallback, which cannot encode school-
    // scoped user_roles. Single-school behavior remains flag-controlled.
    const rbacEnforced = memberships.length > 1
      || await isFeatureEnabled(SCHOOL_ADMIN_RBAC_FLAGS.V1);
    if (rbacEnforced) {
      if (!schoolAdminRole || !schoolAdminRoleAllows(schoolAdminRole, permissionCode)) {
        // Best-effort denial audit (fire-and-forget; never blocks the response).
        logger.warn('school_admin_role_capability_denied', {
          route: 'school-admin-auth',
        });
        return {
          authorized: false,
          userId,
          schoolId: adminRecord.school_id,
          schoolAdminId: adminRecord.id,
          schoolAdminRole,
          errorResponse: NextResponse.json(
            {
              success: false,
              error: 'Your school-admin role does not permit this action',
              code: 'SCHOOL_ADMIN_ROLE_DENIED',
            },
            { status: 403 }
          ),
        };
      }
    }

    return {
      authorized: true,
      userId,
      schoolId: adminRecord.school_id,
      schoolAdminId: adminRecord.id,
      schoolAdminRole,
    };
  } catch (err) {
    logger.error('school_admin_auth_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'school-admin-auth',
    });
    return {
      authorized: false,
      userId,
      schoolId: null,
      schoolAdminId: null,
      schoolAdminRole: null,
      errorResponse: NextResponse.json(
        { success: false, error: 'Authorization failed' },
        { status: 500 }
      ),
    };
  }
}
