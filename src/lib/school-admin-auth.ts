/**
 * School Admin Authentication Helper
 *
 * Wraps the standard RBAC authorizeRequest() with school_admins lookup.
 * Every school-admin API route calls authorizeSchoolAdmin() first to:
 *   1. Verify JWT + RBAC permission via authorizeRequest()
 *   2. Look up the school_admins record to get school_id
 *   3. Verify the school is active
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
import { authorizeRequest } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────

export interface SchoolAdminAuthResult {
  authorized: boolean;
  userId: string | null;
  schoolId: string | null;
  schoolAdminId: string | null;
  errorResponse?: Response;
}

// ─── Main Auth Function ──────────────────────────────────────

/**
 * Authorize a request as a school admin with a specific permission.
 *
 * Steps:
 *  1. Calls authorizeRequest() to validate JWT and check RBAC permission.
 *  2. Queries school_admins to find the admin record for this auth user.
 *  3. Verifies the linked school is active.
 *
 * Returns schoolId for tenant-scoped queries.
 */
export async function authorizeSchoolAdmin(
  request: Request,
  permissionCode: string
): Promise<SchoolAdminAuthResult> {
  // Step 1: Standard RBAC check (JWT + permission)
  const rbacAuth = await authorizeRequest(request, permissionCode);

  if (!rbacAuth.authorized) {
    return {
      authorized: false,
      userId: rbacAuth.userId,
      schoolId: null,
      schoolAdminId: null,
      errorResponse: rbacAuth.errorResponse,
    };
  }

  const userId = rbacAuth.userId!;
  const supabase = getSupabaseAdmin();

  try {
    // Step 2: Look up school_admins record
    const { data: adminRecord, error: adminError } = await supabase
      .from('school_admins')
      .select('id, school_id, is_active')
      .eq('auth_user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

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
        errorResponse: NextResponse.json(
          { success: false, error: 'Failed to verify school admin status' },
          { status: 500 }
        ),
      };
    }

    if (!adminRecord) {
      return {
        authorized: false,
        userId,
        schoolId: null,
        schoolAdminId: null,
        errorResponse: NextResponse.json(
          { success: false, error: 'Not a school administrator' },
          { status: 403 }
        ),
      };
    }

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
        errorResponse: NextResponse.json(
          { success: false, error: 'School is not active' },
          { status: 403 }
        ),
      };
    }

    return {
      authorized: true,
      userId,
      schoolId: adminRecord.school_id,
      schoolAdminId: adminRecord.id,
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
      errorResponse: NextResponse.json(
        { success: false, error: 'Authorization failed' },
        { status: 500 }
      ),
    };
  }
}
