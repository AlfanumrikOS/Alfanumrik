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

import { createClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────

export type RoleName = 'student' | 'parent' | 'teacher' | 'tutor' | 'admin' | 'super_admin';

export type OwnershipType = 'own' | 'linked' | 'assigned' | 'any';

export interface UserPermissions {
  roles: Array<{ name: RoleName; display_name: string; hierarchy_level: number }>;
  permissions: string[];
}

export interface AuthorizationResult {
  authorized: boolean;
  userId: string | null;
  studentId: string | null;
  roles: RoleName[];
  permissions: string[];
  errorResponse?: Response;
  reason?: string;
}

export interface ResourceAccessCheck {
  resourceType: string;
  resourceId?: string;
  ownerId?: string;
  ownershipType: OwnershipType;
}

// ─── Server-side Supabase client ─────────────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, serviceKey);
}

// ─── Permission Cache ────────────────────────────────────────
// In-memory cache with 5-minute TTL to avoid DB hits on every request.
// In production, replace with Redis.

const permissionCache = new Map<string, { data: UserPermissions; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedPermissions(userId: string): UserPermissions | null {
  const cached = permissionCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.data;
  if (cached) permissionCache.delete(userId);
  return null;
}

function setCachedPermissions(userId: string, data: UserPermissions): void {
  permissionCache.set(userId, { data, expires: Date.now() + CACHE_TTL_MS });
  // Periodic cleanup — evict expired entries every 100 sets
  if (permissionCache.size > 200) {
    const now = Date.now();
    Array.from(permissionCache.entries()).forEach(([key, val]) => {
      if (val.expires < now) permissionCache.delete(key);
    });
  }
}

export function invalidatePermissionCache(userId: string): void {
  permissionCache.delete(userId);
}

// ─── Core Permission Functions ───────────────────────────────

/**
 * Get all permissions for a user (server-side, with caching).
 */
export async function getUserPermissions(authUserId: string): Promise<UserPermissions> {
  const cached = getCachedPermissions(authUserId);
  if (cached) return cached;

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc('get_user_permissions', { p_auth_user_id: authUserId });

  if (error || !data) {
    console.error('[RBAC] Failed to get permissions:', error?.message);
    return { roles: [], permissions: [] };
  }

  const result: UserPermissions = {
    roles: data.roles || [],
    permissions: data.permissions || [],
  };

  setCachedPermissions(authUserId, result);
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

  // Student: can only access own data
  const { data: ownStudent } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('id', studentId)
    .single();
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
      .eq('status', 'approved')
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
  const { data: image } = await supabase.from('image_uploads').select('student_id').eq('id', imageId).single();
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
    console.error('[RBAC] Audit log failed:', e);
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
  }
): Promise<AuthorizationResult> {
  // 1. Extract auth token
  const authHeader = request.headers.get('Authorization');
  const cookieHeader = request.headers.get('Cookie');

  let authUserId: string | null = null;

  // Try JWT from Authorization header
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const supabase = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser(token);
    authUserId = user?.id || null;
  }

  // Fallback: try Supabase session cookie
  if (!authUserId && cookieHeader) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const { createServerClient } = await import('@supabase/ssr');
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return (cookieHeader || '').split(';').map(c => {
            const [name, ...rest] = c.trim().split('=');
            return { name, value: rest.join('=') };
          });
        },
        setAll() {},
      },
    });
    const { data: { user } } = await supabase.auth.getUser();
    authUserId = user?.id || null;
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

  // 2. Get user permissions
  const perms = await getUserPermissions(authUserId);

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
      .single();
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
  };
}

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
