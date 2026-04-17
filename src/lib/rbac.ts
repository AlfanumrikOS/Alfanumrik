/**
 * ALFANUMRIK RBAC — Production Authorization Library
 *
 * Three layers of access control:
 * 1. Permission checks (does role have permission?)
 * 2. Resource ownership (does user own/link to resource?)
 * 3. Audit logging (who did what when?)
 *
 * Usage in API routes:
 *   const auth = await authorizeRequest(request, 'quiz.attempt');
 *   if (!auth.authorized) return auth.errorResponse;
 *   // proceed with auth.userId, auth.studentId, etc.
 *
 * Usage in client components:
 *   const { hasPermission, can } = usePermissions();
 *   if (can('quiz.attempt')) { ... }
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { Redis } from '@upstash/redis';

// ─── Types (canonical definitions in rbac-types.ts) ─────────
// Re-exported here for backward compatibility: any module importing
// types from '@/lib/rbac' continues to work unchanged.

export type {
  RoleName,
  OwnershipType,
  RoleInfo,
  UserPermissions,
  ResolutionContext,
  ResolutionTrace,
  AuthorizationResult,
  ResourceAccessCheck,
} from '@/lib/rbac-types';

import type { RoleName, UserPermissions, AuthorizationResult } from '@/lib/rbac-types';

// ─── Server-side Supabase client ─────────────────────────────

function getServiceClient() {
  return getSupabaseAdmin();
}

// ─── Permission Cache (Upstash Redis) ────────────────────────
// Redis-backed cache with 5-minute TTL, shared across all serverless instances.
// Falls back to in-memory if Redis env vars are absent (local dev).

const CACHE_TTL_SECS = 5 * 60; // 5 minutes
const CACHE_KEY = (uid: string, schoolId?: string | null) =>
  schoolId ? `rbac:perms:${uid}:school:${schoolId}` : `rbac:perms:${uid}:platform`;

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // dev / missing config — use in-memory fallback
  _redis = new Redis({ url, token });
  return _redis;
}

// In-memory fallback for dev/test environments without Redis
const _localCache = new Map<string, { data: UserPermissions; expires: number }>();

async function getCachedPermissions(userId: string, schoolId?: string | null): Promise<UserPermissions | null> {
  const cacheKey = CACHE_KEY(userId, schoolId);
  const redis = getRedis();
  // Check taint marker first (instant invalidation for security events)
  if (redis) {
    try {
      const tainted = await redis.get(`rbac:tainted:${userId}`);
      if (tainted) {
        _localCache.delete(cacheKey);
        return null; // Force fresh DB lookup
      }
    } catch { /* Redis unavailable — proceed with local cache */ }
  }
  // Try Redis cache
  if (redis) {
    try {
      const raw = await redis.get<UserPermissions>(cacheKey);
      return raw ?? null;
    } catch { /* fall through */ }
  }
  // Fallback: in-memory cache
  const local = _localCache.get(cacheKey);
  if (local && local.expires > Date.now()) return local.data;
  if (local) _localCache.delete(cacheKey);
  return null;
}

async function setCachedPermissions(userId: string, data: UserPermissions, schoolId?: string | null): Promise<void> {
  const key = CACHE_KEY(userId, schoolId);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, data, { ex: CACHE_TTL_SECS });
      return;
    } catch {
      // Redis write failed — fall through to local cache
    }
  }
  _localCache.set(key, { data, expires: Date.now() + CACHE_TTL_SECS * 1000 });
  if (_localCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _localCache.entries()) {
      if (v.expires < now) _localCache.delete(k);
    }
  }
}

export async function invalidatePermissionCache(userId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try { await redis.del(CACHE_KEY(userId)); } catch { /* ignore */ }
  }
  // Clear all local cache entries for this user (platform + school variants)
  for (const key of Array.from(_localCache.keys())) {
    if (key.startsWith(`rbac:perms:${userId}:`)) {
      _localCache.delete(key);
    }
  }
}

/**
 * Invalidate permission caches for multiple users due to a security event.
 * Sets a short-lived taint marker in Redis so that even cached entries
 * are bypassed until the marker expires (5 seconds).
 * Fires a cache_invalidation audit event (best-effort).
 */
export async function invalidateForSecurityEvent(
  userIds: string[],
  reason: string = 'security_event',
): Promise<void> {
  const redis = getRedis();
  for (const userId of userIds) {
    if (redis) {
      try {
        await redis.del(CACHE_KEY(userId));
        await redis.set(`rbac:tainted:${userId}`, '1', { ex: 5 });
      } catch { /* Redis unavailable */ }
    }
    // Clear all local cache entries for this user (platform + school variants)
    for (const key of Array.from(_localCache.keys())) {
      if (key.startsWith(`rbac:perms:${userId}:`)) {
        _localCache.delete(key);
      }
    }
  }
  // Fire-and-forget audit event
  try {
    const { writeAuditEvent } = await import('@/lib/audit-pipeline');
    await writeAuditEvent({
      eventType: 'cache_invalidation',
      actorUserId: null,
      action: 'revoke',
      result: 'granted',
      resourceType: 'permission_cache',
      metadata: { userIds, reason },
    });
  } catch { /* Audit write failed — not critical */ }
}

// ─── Core Permission Functions ───────────────────────────────

/**
 * Get all permissions for a user (server-side, with caching).
 */
export async function getUserPermissions(
  authUserId: string,
  schoolId?: string | null,
): Promise<UserPermissions> {
  const cached = await getCachedPermissions(authUserId, schoolId);
  if (cached) return cached;

  const supabase = getServiceClient();
  const rpcParams: Record<string, string> = { p_auth_user_id: authUserId };
  if (schoolId) rpcParams.p_school_id = schoolId;

  const { data, error } = await supabase.rpc('get_user_permissions', rpcParams);

  if (error || !data) {
    logger.error('rbac_permissions_failed', {
      error: error ? new Error(error.message) : new Error('unknown'),
      route: 'rbac',
    });
    throw new Error(`Permission lookup failed: ${error?.message ?? 'no data returned'}`);
  }

  const result: UserPermissions = {
    roles: data.roles || [],
    permissions: data.permissions || [],
    schoolId: schoolId ?? null,
  };

  await setCachedPermissions(authUserId, result, schoolId);
  return result;
}

/**
 * Check if user has a specific permission.
 */
export async function hasPermission(authUserId: string, permissionCode: string): Promise<boolean> {
  const perms = await getUserPermissions(authUserId);
  // Super admins have all permissions
  if (perms.roles.some(r => r.name === 'super_admin')) return true;
  return perms.permissions.includes(permissionCode);
}

/**
 * Check if user has ANY of the listed permissions.
 */
export async function hasAnyPermission(authUserId: string, codes: string[]): Promise<boolean> {
  const perms = await getUserPermissions(authUserId);
  if (perms.roles.some(r => r.name === 'super_admin')) return true;
  return codes.some(code => perms.permissions.includes(code));
}

/**
 * Check if user has ALL of the listed permissions.
 */
export async function hasAllPermissions(authUserId: string, codes: string[]): Promise<boolean> {
  const perms = await getUserPermissions(authUserId);
  if (perms.roles.some(r => r.name === 'super_admin')) return true;
  return codes.every(code => perms.permissions.includes(code));
}

/**
 * Check if user has a specific role.
 */
export async function hasRole(authUserId: string, roleName: RoleName): Promise<boolean> {
  const perms = await getUserPermissions(authUserId);
  return perms.roles.some(r => r.name === roleName);
}

// ─── Resource Ownership Checks ───────────────────────────────

/**
 * Check if a student belongs to this user (own, linked child, or assigned class).
 */
export async function canAccessStudent(authUserId: string, studentId: string): Promise<boolean> {
  const supabase = getServiceClient();
  const perms = await getUserPermissions(authUserId);

  // Admin/super_admin can access any student
  if (perms.roles.some(r => r.name === 'admin' || r.name === 'super_admin')) return true;

  // Institution admin: can access students in their school
  if (perms.roles.some(r => r.name === 'institution_admin')) {
    const { data: studentSchool } = await supabase
      .from('students')
      .select('school_id')
      .eq('id', studentId)
      .maybeSingle();

    if (studentSchool?.school_id) {
      const { data: membership } = await supabase
        .from('school_memberships')
        .select('id')
        .eq('auth_user_id', authUserId)
        .eq('school_id', studentSchool.school_id)
        .eq('is_active', true)
        .maybeSingle();

      if (membership) return true;
    }
  }

  // Student: can only access own data
  const { data: ownStudent } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('id', studentId)
    .maybeSingle();
  if (ownStudent) return true;

  // Parent: can access linked children
  const { data: guardians } = await supabase
    .from('guardians')
    .select('id')
    .eq('auth_user_id', authUserId);
  const guardianIds = guardians?.map(g => g.id) || [];

  if (guardianIds.length > 0) {
    const { data: linkedChild } = await supabase
      .from('guardian_student_links')
      .select('id')
      .eq('student_id', studentId)
      .in('status', ['active', 'approved'])
      .in('guardian_id', guardianIds)
      .limit(1);
    if (linkedChild && linkedChild.length > 0) return true;
  }

  // Teacher: can access students in assigned classes
  try {
    const { data: assignedStudent } = await supabase.rpc('is_teacher_of_student', {
      p_auth_user_id: authUserId,
      p_student_id: studentId,
    });
    if (assignedStudent) return true;
  } catch {
    // RPC may not exist yet — silently continue
  }

  return false;
}

/**
 * Check if user can access an image upload.
 */
export async function canAccessImage(authUserId: string, imageId: string): Promise<boolean> {
  const supabase = getServiceClient();
  const { data: image } = await supabase.from('image_uploads').select('student_id').eq('id', imageId).maybeSingle();
  if (!image) return false;
  return canAccessStudent(authUserId, image.student_id);
}

/**
 * Check if user can access a report.
 */
export async function canAccessReport(authUserId: string, studentId: string): Promise<boolean> {
  return canAccessStudent(authUserId, studentId);
}

// ─── Audit Logging ───────────────────────────────────────────

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  status?: 'success' | 'failure' | 'denied';
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit entry (fire-and-forget for performance).
 */
export async function logAudit(authUserId: string | null, entry: AuditEntry): Promise<void> {
  try {
    const supabase = getServiceClient();
    await supabase.from('audit_logs').insert({
      auth_user_id: authUserId,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId || null,
      details: entry.details || {},
      ip_address: entry.ipAddress || null,
      user_agent: entry.userAgent || null,
      status: entry.status || 'success',
    });
  } catch (e) {
    logger.error('rbac_audit_log_failed', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac' });
  }
}

// ─── API Route Authorization ─────────────────────────────────

/**
 * Authorize an API request. Returns authorization result with user info.
 *
 * Usage:
 *   export async function GET(request: Request) {
 *     const auth = await authorizeRequest(request, 'study_plan.view');
 *     if (!auth.authorized) return auth.errorResponse!;
 *     // ... use auth.userId, auth.studentId
 *   }
 */
export async function authorizeRequest(
  request: Request,
  requiredPermission?: string,
  options?: {
    requireStudentId?: boolean;
    resourceCheck?: { type: string; id: string };
    context?: { schoolId?: string };
  }
): Promise<AuthorizationResult> {
  // 1. Extract auth token
  const authHeader = request.headers.get('Authorization');

  let authUserId: string | null = null;

  // Try JWT from Authorization header
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const supabase = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser(token);
    authUserId = user?.id || null;
  }

  // Fallback: try Supabase session cookie via next/headers
  // NOTE: Must use cookies() from next/headers — NOT manual Cookie header parsing.
  // Supabase splits large JWTs across multiple chunked cookies (sb-*-auth-token.0,
  // sb-*-auth-token.1, …). cookieStore.getAll() returns all chunks; @supabase/ssr
  // reassembles them. The manual split(';') approach misses this and returns null.
  if (!authUserId) {
    try {
      const { cookies } = await import('next/headers');
      const { createServerClient } = await import('@supabase/ssr');
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const cookieStore = await cookies();
      const supabase = createServerClient(url, anonKey, {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      });
      const { data: { user } } = await supabase.auth.getUser();
      authUserId = user?.id || null;
    } catch {
      // Not in a Next.js request context (e.g., unit tests) — skip cookie auth
    }
  }

  if (!authUserId) {
    return {
      authorized: false,
      userId: null,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      reason: 'No valid authentication token',
    };
  }

  // 2. Get user permissions (school-scoped if context provided)
  let perms: UserPermissions;
  try {
    perms = await getUserPermissions(authUserId, options?.context?.schoolId);
  } catch (permError) {
    logger.error('rbac_authorize_perm_lookup_failed', {
      error: permError instanceof Error ? permError : new Error(String(permError)),
      route: 'rbac',
    });
    return {
      authorized: false,
      userId: authUserId,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Permission lookup failed', code: 'PERM_LOOKUP_ERROR' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
      reason: 'Permission lookup failed',
    };
  }

  if (perms.roles.length === 0) {
    return {
      authorized: false,
      userId: authUserId,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'No roles assigned', code: 'NO_ROLES' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      reason: 'User has no active roles',
    };
  }

  // 3. Check permission
  if (requiredPermission) {
    const isSuperAdmin = perms.roles.some(r => r.name === 'super_admin');
    if (!isSuperAdmin && !perms.permissions.includes(requiredPermission)) {
      // Log denied access
      const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
      logAudit(authUserId, {
        action: 'permission_denied',
        resourceType: requiredPermission.split('.')[0],
        details: { required_permission: requiredPermission },
        status: 'denied',
        ipAddress: ip,
        userAgent: request.headers.get('user-agent') || '',
      });

      return {
        authorized: false,
        userId: authUserId,
        studentId: null,
        roles: perms.roles.map(r => r.name as RoleName),
        permissions: perms.permissions,
        errorResponse: new Response(JSON.stringify({
          error: 'Forbidden',
          code: 'PERMISSION_DENIED',
          required: requiredPermission,
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
        reason: `Missing permission: ${requiredPermission}`,
      };
    }
  }

  // 4. Get student ID if needed
  let studentId: string | null = null;
  if (options?.requireStudentId || perms.roles.some(r => r.name === 'student')) {
    const supabase = getServiceClient();
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    studentId = student?.id || null;
  }

  // 5. Resource access check
  if (options?.resourceCheck) {
    const canAccess = await canAccessStudent(authUserId, options.resourceCheck.id);
    if (!canAccess) {
      logAudit(authUserId, {
        action: 'resource_access_denied',
        resourceType: options.resourceCheck.type,
        resourceId: options.resourceCheck.id,
        status: 'denied',
      });
      return {
        authorized: false,
        userId: authUserId,
        studentId,
        roles: perms.roles.map(r => r.name as RoleName),
        permissions: perms.permissions,
        errorResponse: new Response(JSON.stringify({ error: 'Access denied to resource', code: 'RESOURCE_ACCESS_DENIED' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
        reason: 'Cannot access requested resource',
      };
    }
  }

  return {
    authorized: true,
    userId: authUserId,
    studentId,
    roles: perms.roles.map(r => r.name as RoleName),
    permissions: perms.permissions,
    schoolId: options?.context?.schoolId ?? null,
  };
}

// ─── Permission Code Registry ────────────────────────────────
//
// Canonical list of all permission codes used in authorizeRequest() calls and
// usePermissions().can() checks.  The authoritative source of truth is the
// `permissions` table in Postgres (seeded in supabase/migrations/); this
// object is the TypeScript companion — it prevents typos and provides
// IDE auto-complete.  Every code here MUST have a matching row in the DB.
//
// Role assignment summary:
//   student    — own-data permissions + quiz/foxy/diagnostic/review/simulation
//   parent     — child-scoped read permissions
//   teacher    — class management + student feedback permissions
//   admin      — all permissions (wildcard insert in migration)
//   super_admin — all permissions (wildcard insert in migration) + bypass in hasPermission()

export const PERMISSIONS = {
  // ── Study plan ──────────────────────────────────────────────
  STUDY_PLAN_VIEW: 'study_plan.view',
  STUDY_PLAN_CREATE: 'study_plan.create',

  // ── Quiz ────────────────────────────────────────────────────
  QUIZ_ATTEMPT: 'quiz.attempt',
  QUIZ_VIEW_RESULTS: 'quiz.view_results',

  // ── Exam ────────────────────────────────────────────────────
  EXAM_VIEW: 'exam.view',
  EXAM_CREATE: 'exam.create',

  // ── Image upload ────────────────────────────────────────────
  IMAGE_UPLOAD: 'image.upload',
  IMAGE_VIEW_OWN: 'image.view_own',

  // ── Reports ─────────────────────────────────────────────────
  REPORT_VIEW_OWN: 'report.view_own',
  REPORT_DOWNLOAD_OWN: 'report.download_own',

  // ── Spaced-repetition review ─────────────────────────────────
  REVIEW_VIEW: 'review.view',
  REVIEW_PRACTICE: 'review.practice',

  // ── Foxy AI tutor ────────────────────────────────────────────
  FOXY_CHAT: 'foxy.chat',

  // ── Simulations ─────────────────────────────────────────────
  SIMULATION_VIEW: 'simulation.view',
  SIMULATION_INTERACT: 'simulation.interact',

  // ── Leaderboard ─────────────────────────────────────────────
  LEADERBOARD_VIEW: 'leaderboard.view',

  // ── Profile ─────────────────────────────────────────────────
  PROFILE_VIEW_OWN: 'profile.view_own',
  PROFILE_UPDATE_OWN: 'profile.update_own',

  // ── Notifications ────────────────────────────────────────────
  NOTIFICATION_VIEW: 'notification.view',
  NOTIFICATION_DISMISS: 'notification.dismiss',

  // ── Progress ─────────────────────────────────────────────────
  PROGRESS_VIEW_OWN: 'progress.view_own',

  // ── Diagnostic assessment (student role) ────────────────────
  // diagnostic.attempt  — student can start a new diagnostic session
  //                        (POST /api/diagnostic/start)
  // diagnostic.complete — student can submit responses for a diagnostic session
  //                        (POST /api/diagnostic/complete)
  DIAGNOSTIC_ATTEMPT: 'diagnostic.attempt',
  DIAGNOSTIC_COMPLETE: 'diagnostic.complete',

  // ── Parent (child-scoped) ────────────────────────────────────
  CHILD_VIEW_PERFORMANCE: 'child.view_performance',
  CHILD_VIEW_PROGRESS: 'child.view_progress',
  CHILD_DOWNLOAD_REPORT: 'child.download_report',
  CHILD_VIEW_EXAMS: 'child.view_exams',
  CHILD_RECEIVE_ALERTS: 'child.receive_alerts',

  // ── Teacher ──────────────────────────────────────────────────
  CLASS_MANAGE: 'class.manage',
  CLASS_VIEW_ANALYTICS: 'class.view_analytics',
  EXAM_ASSIGN: 'exam.assign',
  EXAM_CREATE_FOR_CLASS: 'exam.create_for_class',
  TEST_CREATE: 'test.create',
  TEST_EDIT: 'test.edit',
  STUDENT_VIEW_UPLOADS: 'student.view_uploads',
  STUDENT_PROVIDE_FEEDBACK: 'student.provide_feedback',
  WORKSHEET_CREATE: 'worksheet.create',
  WORKSHEET_ASSIGN: 'worksheet.assign',
  REPORT_VIEW_CLASS: 'report.view_class',

  // ── Admin ────────────────────────────────────────────────────
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  PERMISSION_MANAGE: 'permission.manage',
  SYSTEM_AUDIT: 'system.audit',
  SYSTEM_CONFIG: 'system.config',
  CONTENT_MANAGE: 'content.manage',
  ANALYTICS_GLOBAL: 'analytics.global',
  ADMIN_MANAGE_USERS: 'admin.manage_users',
  SYSTEM_MANAGE_ROLES: 'system.manage_roles',

  // ── Student (write-scoped) ────────────────────────────────
  STUDENT_PROFILE_WRITE: 'student.profile.write',
  STUDENT_SCAN: 'student.scan',

  // ── Study plan (write) ────────────────────────────────────
  STUDY_PLAN_WRITE: 'study_plan.write',

  // ── Exam (write) ──────────────────────────────────────────
  EXAM_WRITE: 'exam.write',

  // ── Foxy AI tutor (interaction) ───────────────────────────
  FOXY_INTERACT: 'foxy.interact',

  // ── STEM observations ─────────────────────────────────────
  STEM_OBSERVE: 'stem.observe',

  // ── Institution (multi-school admin) ─────────────────────
  INSTITUTION_MANAGE: 'institution.manage',
  INSTITUTION_VIEW_ANALYTICS: 'institution.view_analytics',
  INSTITUTION_MANAGE_TEACHERS: 'institution.manage_teachers',

  // ── Tutor ──────────────────────────────────────────────
  TUTOR_VIEW_STUDENT: 'tutor.view_student',
  TUTOR_PROVIDE_FEEDBACK: 'tutor.provide_feedback',
  TUTOR_VIEW_ANALYTICS: 'tutor.view_analytics',
  TUTOR_CREATE_WORKSHEET: 'tutor.create_worksheet',
  TUTOR_ASSIGN_WORKSHEET: 'tutor.assign_worksheet',

  // ── Super-admin subject governance (Phase E) ─────────────
  // Granted to: super_admin (and admin, defensively).  Gates the 7 routes
  // under /api/super-admin/subjects/** and /api/super-admin/students/[id]/subjects.
  // NOTE: seed migration `20260415000011_subject_governance_rbac_permission.sql`
  // is staged but NOT yet applied — awaits user approval per CLAUDE.md RBAC
  // policy.  Routes currently still authenticate via authorizeAdmin(); they
  // will switch to authorizeRequest(request, 'super_admin.subjects.manage')
  // once the migration runs.
  SUPER_ADMIN_SUBJECTS_MANAGE: 'super_admin.subjects.manage',
} as const;

export type PermissionCode = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// ─── Client-side Permission Hook ─────────────────────────────

// This is a lightweight client-side check. The real enforcement happens server-side.
// Client uses this for UI rendering decisions (show/hide buttons).
// See /src/lib/usePermissions.ts for the React hook implementation.

export interface ClientPermissions {
  roles: RoleName[];
  permissions: string[];
  loading: boolean;
  hasPermission: (code: string) => boolean;
  hasRole: (role: RoleName) => boolean;
  can: (code: string) => boolean; // alias for hasPermission
  isAdmin: boolean;
}
