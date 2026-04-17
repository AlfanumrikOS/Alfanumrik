/**
 * School Admin (institution_admin) Authorization Helper
 *
 * Wraps the existing RBAC authorizeRequest() with school-scoped resolution.
 * Every school-admin API route must:
 *   1. Verify the user has the required permission
 *   2. Resolve which school they administer
 *   3. Scope ALL queries to that school_id
 *
 * Usage:
 *   const auth = await authorizeSchoolAdmin(request, 'class.manage');
 *   if (!auth.authorized) return auth.errorResponse!;
 *   // auth.schoolId is the school UUID — scope ALL queries
 */

import { NextResponse } from 'next/server';
import { authorizeRequest, type AuthorizationResult } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────

export interface SchoolAdminAuth {
  authorized: true;
  userId: string;
  schoolId: string;
  roles: string[];
  permissions: string[];
}

export interface SchoolAdminAuthFailure {
  authorized: false;
  errorResponse: NextResponse;
}

export type SchoolAdminAuthResult = SchoolAdminAuth | SchoolAdminAuthFailure;

// ─── Cache for school_id resolution (per-request dedup) ──────

const _schoolIdCache = new Map<string, { schoolId: string; expires: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

async function resolveSchoolId(authUserId: string): Promise<string | null> {
  // Check local cache
  const cached = _schoolIdCache.get(authUserId);
  if (cached && cached.expires > Date.now()) {
    return cached.schoolId;
  }

  const supabase = getSupabaseAdmin();

  // Strategy 1: Check school_admins table (B2B institution_admin role)
  const { data: adminRecord } = await supabase
    .from('school_admins')
    .select('school_id')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (adminRecord?.school_id) {
    _schoolIdCache.set(authUserId, {
      schoolId: adminRecord.school_id,
      expires: Date.now() + CACHE_TTL_MS,
    });
    return adminRecord.school_id;
  }

  // Strategy 2: Check teachers table (teachers with institution_admin role)
  const { data: teacherRecord } = await supabase
    .from('teachers')
    .select('school_id')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .not('school_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (teacherRecord?.school_id) {
    _schoolIdCache.set(authUserId, {
      schoolId: teacherRecord.school_id,
      expires: Date.now() + CACHE_TTL_MS,
    });
    return teacherRecord.school_id;
  }

  return null;
}

// ─── Main authorizer ─────────────────────────────────────────

/**
 * Authorize a school admin request.
 *
 * 1. Verifies user authentication and permission via RBAC
 * 2. Resolves the school_id from school_admins or teachers table
 * 3. Returns a typed result with schoolId for query scoping
 *
 * @param request - Incoming request (NextRequest or Request)
 * @param permissionCode - Required RBAC permission (e.g., 'class.manage')
 */
export async function authorizeSchoolAdmin(
  request: Request,
  permissionCode: string
): Promise<SchoolAdminAuthResult> {
  // Step 1: RBAC permission check
  const auth: AuthorizationResult = await authorizeRequest(request, permissionCode);

  if (!auth.authorized) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: auth.errorResponse?.status || 401 }
      ),
    };
  }

  if (!auth.userId) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        { success: false, error: 'User ID not found', code: 'NO_USER_ID' },
        { status: 401 }
      ),
    };
  }

  // Step 2: Resolve school_id
  try {
    const schoolId = await resolveSchoolId(auth.userId);

    if (!schoolId) {
      logger.warn('school_admin_no_school', {
        userId: auth.userId,
        route: 'school-admin-auth',
      });
      return {
        authorized: false,
        errorResponse: NextResponse.json(
          { success: false, error: 'No school associated with this account', code: 'NO_SCHOOL' },
          { status: 403 }
        ),
      };
    }

    return {
      authorized: true,
      userId: auth.userId,
      schoolId,
      roles: auth.roles,
      permissions: auth.permissions,
    };
  } catch (err) {
    logger.error('school_admin_auth_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'school-admin-auth',
    });
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        { success: false, error: 'Authorization failed', code: 'AUTH_ERROR' },
        { status: 500 }
      ),
    };
  }
}
