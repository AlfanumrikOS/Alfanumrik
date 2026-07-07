import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Types for RBAC testing ──
interface Role {
  name: string;
  display_name: string;
  hierarchy_level: number;
}

interface UserPermissions {
  roles: Role[];
  permissions: string[];
}

interface AuditLogEntry {
  user_id: string;
  action: string;
  resource: string;
  allowed: boolean;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}

// ── Mock Supabase client ──
const mockInsert = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
});

const mockEq = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockReturnValue({
  eq: mockEq,
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
});

const mockFrom = vi.fn((table: string) => {
  if (table === 'audit_logs') {
    return { insert: mockInsert, select: mockSelect };
  }
  if (table === 'parent_student_links') {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
  }
  if (table === 'class_students') {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
  }
  return { select: mockSelect, insert: mockInsert };
});

const mockRpc = vi.fn().mockResolvedValue({
  data: {
    roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
    permissions: ['quiz.attempt', 'study_plan.view', 'profile.edit_own'],
  } as UserPermissions,
  error: null,
});

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'test-user-id' } },
  error: null,
});

const mockSupabase = {
  from: mockFrom,
  rpc: mockRpc,
  auth: { getUser: mockGetUser },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// ── RBAC helper functions (mirrors expected production logic) ──

// Permission cache with TTL
const permissionCache = new Map<string, { data: UserPermissions; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getUserPermissions(userId: string): Promise<UserPermissions> {
  const cached = permissionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const { data, error } = await mockSupabase.rpc('get_user_permissions', { p_user_id: userId });
  if (error || !data) {
    return { roles: [], permissions: [] };
  }

  permissionCache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL });
  return data;
}

function invalidatePermissionCache(userId: string): void {
  permissionCache.delete(userId);
}

function hasPermission(userPerms: UserPermissions, permission: string): boolean {
  // Super admins have access to everything
  if (userPerms.roles.some(r => r.name === 'super_admin')) {
    return true;
  }
  return userPerms.permissions.includes(permission);
}

function hasAnyPermission(userPerms: UserPermissions, permissions: string[]): boolean {
  if (userPerms.roles.some(r => r.name === 'super_admin')) return true;
  return permissions.some(p => userPerms.permissions.includes(p));
}

function hasAllPermissions(userPerms: UserPermissions, permissions: string[]): boolean {
  if (userPerms.roles.some(r => r.name === 'super_admin')) return true;
  return permissions.every(p => userPerms.permissions.includes(p));
}

function getHighestRole(userPerms: UserPermissions): Role | null {
  if (userPerms.roles.length === 0) return null;
  return userPerms.roles.reduce((highest, role) =>
    role.hierarchy_level > highest.hierarchy_level ? role : highest
  );
}

async function checkResourceOwnership(
  userId: string,
  resourceOwnerId: string,
  userPerms: UserPermissions,
): Promise<boolean> {
  // User owns the resource
  if (userId === resourceOwnerId) return true;

  // Admins and super_admins can access any resource
  if (userPerms.roles.some(r => r.name === 'admin' || r.name === 'super_admin')) {
    return true;
  }

  // Parents can access linked children's data
  if (userPerms.roles.some(r => r.name === 'parent')) {
    const { data } = await mockSupabase.from('parent_student_links')
      .select('id')
      .eq('parent_id', userId)
      .eq('student_id', resourceOwnerId)
      .single();
    return !!data;
  }

  // Teachers can access assigned class students
  if (userPerms.roles.some(r => r.name === 'teacher')) {
    const { data } = await mockSupabase.from('class_students')
      .select('id')
      .eq('teacher_id', userId)
      .eq('student_id', resourceOwnerId)
      .single();
    return !!data;
  }

  return false;
}

async function logAuditEntry(entry: AuditLogEntry): Promise<void> {
  const client = mockSupabase as unknown as { from: (table: string) => { insert: (data: AuditLogEntry) => Promise<unknown> } };
  await client.from('audit_logs').insert(entry);
}

// API authorization check
async function authorizeApiRequest(
  authHeader: string | null,
  requiredPermission: string,
  ip?: string,
  userAgent?: string,
): Promise<{ authorized: boolean; status: number; error?: string }> {
  // Check authentication
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, status: 401, error: 'Authentication required' };
  }

  const token = authHeader.replace('Bearer ', '');
  if (!token || token === 'invalid') {
    return { authorized: false, status: 401, error: 'Invalid token' };
  }

  // Get user from token
  const { data: userData, error: authError } = await mockSupabase.auth.getUser();
  if (authError || !userData?.user) {
    return { authorized: false, status: 401, error: 'Invalid token' };
  }

  // Check permissions
  const userPerms = await getUserPermissions(userData.user.id);
  if (!hasPermission(userPerms, requiredPermission)) {
    // Log denied access
    await logAuditEntry({
      user_id: userData.user.id,
      action: 'access_denied',
      resource: requiredPermission,
      allowed: false,
      ip_address: ip,
      user_agent: userAgent,
    });
    // Do NOT expose which permission was missing
    return { authorized: false, status: 403, error: 'Insufficient permissions' };
  }

  // Log successful access
  await logAuditEntry({
    user_id: userData.user.id,
    action: 'access_granted',
    resource: requiredPermission,
    allowed: true,
    ip_address: ip,
    user_agent: userAgent,
  });

  return { authorized: true, status: 200 };
}

// ══════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════

describe('RBAC System', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    permissionCache.clear();

    // Clear call counts so tests can assert exact counts
    mockRpc.mockClear();
    mockGetUser.mockClear();
    mockFrom.mockClear();
    mockInsert.mockClear();

    // Reset default mock behavior
    mockRpc.mockResolvedValue({
      data: {
        roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
        permissions: ['quiz.attempt', 'study_plan.view', 'profile.edit_own'],
      },
      error: null,
    });

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });

    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
    });
  });

  afterEach(() => {
    permissionCache.clear();
  });

  // ── Permission Checks ──

  describe('Permission Checks', () => {
    it('should allow access when user has required permission', async () => {
      const perms = await getUserPermissions('test-user-id');
      expect(hasPermission(perms, 'quiz.attempt')).toBe(true);
      expect(hasPermission(perms, 'study_plan.view')).toBe(true);
    });

    it('should deny access when user lacks permission', async () => {
      const perms = await getUserPermissions('test-user-id');
      expect(hasPermission(perms, 'admin.manage_users')).toBe(false);
      expect(hasPermission(perms, 'quiz.delete')).toBe(false);
    });

    it('should allow super_admin access to everything', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'super_admin', display_name: 'Super Admin', hierarchy_level: 100 }],
          permissions: ['*'],
        },
        error: null,
      });

      const perms = await getUserPermissions('admin-user-id');
      expect(hasPermission(perms, 'quiz.attempt')).toBe(true);
      expect(hasPermission(perms, 'admin.manage_users')).toBe(true);
      expect(hasPermission(perms, 'any.arbitrary.permission')).toBe(true);
    });

    it('should check multiple permissions with hasAnyPermission', async () => {
      const perms = await getUserPermissions('test-user-id');

      // Has quiz.attempt, so this should pass
      expect(hasAnyPermission(perms, ['quiz.attempt', 'admin.manage_users'])).toBe(true);

      // Has neither of these
      expect(hasAnyPermission(perms, ['admin.manage_users', 'quiz.delete'])).toBe(false);
    });

    it('should check all permissions with hasAllPermissions', async () => {
      const perms = await getUserPermissions('test-user-id');

      // Has both of these
      expect(hasAllPermissions(perms, ['quiz.attempt', 'study_plan.view'])).toBe(true);

      // Missing admin.manage_users
      expect(hasAllPermissions(perms, ['quiz.attempt', 'admin.manage_users'])).toBe(false);
    });

    it('should return empty permissions on RPC error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'RPC failed' },
      });

      const perms = await getUserPermissions('error-user');
      expect(perms.roles).toEqual([]);
      expect(perms.permissions).toEqual([]);
    });
  });

  // ── Role Hierarchy ──

  describe('Role Hierarchy', () => {
    it('should correctly identify role hierarchy levels', async () => {
      const studentPerms: UserPermissions = {
        roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
        permissions: ['quiz.attempt'],
      };

      const teacherPerms: UserPermissions = {
        roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
        permissions: ['quiz.create', 'quiz.grade'],
      };

      const adminPerms: UserPermissions = {
        roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
        permissions: ['admin.manage_users'],
      };

      const studentRole = getHighestRole(studentPerms);
      const teacherRole = getHighestRole(teacherPerms);
      const adminRole = getHighestRole(adminPerms);

      expect(studentRole!.hierarchy_level).toBeLessThan(teacherRole!.hierarchy_level);
      expect(teacherRole!.hierarchy_level).toBeLessThan(adminRole!.hierarchy_level);
    });

    it('should support multi-role users', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [
            { name: 'student', display_name: 'Student', hierarchy_level: 10 },
            { name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 },
          ],
          permissions: ['quiz.attempt', 'study_plan.view', 'quiz.create', 'quiz.grade'],
        },
        error: null,
      });

      const perms = await getUserPermissions('multi-role-user');
      expect(perms.roles).toHaveLength(2);
      expect(perms.roles.map(r => r.name)).toContain('student');
      expect(perms.roles.map(r => r.name)).toContain('teacher');

      // Should have permissions from both roles
      expect(hasPermission(perms, 'quiz.attempt')).toBe(true);
      expect(hasPermission(perms, 'quiz.create')).toBe(true);

      // Highest role should be teacher
      const highest = getHighestRole(perms);
      expect(highest!.name).toBe('teacher');
    });

    it('should handle expired roles', async () => {
      // Expired roles should not be returned by the RPC
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [], // No active roles after expiry
          permissions: [],
        },
        error: null,
      });

      const perms = await getUserPermissions('expired-role-user');
      expect(perms.roles).toHaveLength(0);
      expect(perms.permissions).toHaveLength(0);
      expect(hasPermission(perms, 'quiz.attempt')).toBe(false);
    });

    it('should return null for user with no roles', () => {
      const noRolePerms: UserPermissions = { roles: [], permissions: [] };
      expect(getHighestRole(noRolePerms)).toBeNull();
    });
  });

  // ── Resource Ownership ──

  describe('Resource Ownership', () => {
    it('should allow student to access own data', async () => {
      const perms: UserPermissions = {
        roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
        permissions: ['profile.edit_own'],
      };

      const allowed = await checkResourceOwnership('user-123', 'user-123', perms);
      expect(allowed).toBe(true);
    });

    it('should deny student access to other students data', async () => {
      const perms: UserPermissions = {
        roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
        permissions: ['profile.edit_own'],
      };

      const allowed = await checkResourceOwnership('user-123', 'user-456', perms);
      expect(allowed).toBe(false);
    });

    it('should allow parent access to linked child', async () => {
      // Mock a valid parent-student link
      mockFrom.mockImplementationOnce((table: string) => {
        if (table === 'parent_student_links') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'link-1' }, error: null }),
                }),
              }),
            }),
          };
        }
        return { select: mockSelect, insert: mockInsert };
      });

      const perms: UserPermissions = {
        roles: [{ name: 'parent', display_name: 'Parent', hierarchy_level: 20 }],
        permissions: ['student.view_linked'],
      };

      const allowed = await checkResourceOwnership('parent-1', 'child-1', perms);
      expect(allowed).toBe(true);
    });

    it('should deny parent access to unlinked child', async () => {
      // Default mock returns null (no link found)
      const perms: UserPermissions = {
        roles: [{ name: 'parent', display_name: 'Parent', hierarchy_level: 20 }],
        permissions: ['student.view_linked'],
      };

      const allowed = await checkResourceOwnership('parent-1', 'unlinked-child', perms);
      expect(allowed).toBe(false);
    });

    it('should allow teacher access to assigned class students', async () => {
      mockFrom.mockImplementationOnce((table: string) => {
        if (table === 'class_students') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'enrollment-1' }, error: null }),
                }),
              }),
            }),
          };
        }
        return { select: mockSelect, insert: mockInsert };
      });

      const perms: UserPermissions = {
        roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
        permissions: ['student.view_class'],
      };

      const allowed = await checkResourceOwnership('teacher-1', 'student-in-class', perms);
      expect(allowed).toBe(true);
    });

    it('should allow admin access to any student', async () => {
      const perms: UserPermissions = {
        roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
        permissions: ['admin.manage_users'],
      };

      const allowed = await checkResourceOwnership('admin-1', 'any-student', perms);
      expect(allowed).toBe(true);
    });
  });

  // ── Permission Cache ──

  describe('Permission Cache', () => {
    it('should cache permissions for 5 minutes', async () => {
      await getUserPermissions('cache-user');
      expect(mockRpc).toHaveBeenCalledTimes(1);

      // Second call should use cache, not RPC
      await getUserPermissions('cache-user');
      expect(mockRpc).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should invalidate cache when requested', async () => {
      await getUserPermissions('cache-user');
      expect(mockRpc).toHaveBeenCalledTimes(1);

      invalidatePermissionCache('cache-user');

      await getUserPermissions('cache-user');
      expect(mockRpc).toHaveBeenCalledTimes(2); // Called again after invalidation
    });

    it('should refresh cache after expiry', async () => {
      // Manually set an expired cache entry
      permissionCache.set('expired-cache-user', {
        data: { roles: [], permissions: [] },
        expiresAt: Date.now() - 1000, // Already expired
      });

      const perms = await getUserPermissions('expired-cache-user');

      // Should have called RPC since cache was expired
      expect(mockRpc).toHaveBeenCalled();
      // Should have fresh data from RPC
      expect(perms.permissions).toContain('quiz.attempt');
    });

    it('should not return stale data from expired cache', async () => {
      permissionCache.set('stale-user', {
        data: { roles: [], permissions: ['old.permission'] },
        expiresAt: Date.now() - 1, // Expired
      });

      const perms = await getUserPermissions('stale-user');
      // Should NOT contain the old cached permission
      expect(perms.permissions).not.toContain('old.permission');
      // Should contain fresh data
      expect(perms.permissions).toContain('quiz.attempt');
    });
  });

  // ── API Authorization ──

  describe('API Authorization', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const result = await authorizeApiRequest(null, 'quiz.attempt');
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBe('Authentication required');
    });

    it('should return 401 for missing Bearer prefix', async () => {
      const result = await authorizeApiRequest('token-without-bearer', 'quiz.attempt');
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(401);
    });

    it('should return 403 for unauthorized permissions', async () => {
      const result = await authorizeApiRequest(
        'Bearer valid-token',
        'admin.manage_users', // Student doesn't have this
      );
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toBe('Insufficient permissions');
    });

    it('should return authorized for valid requests', async () => {
      const result = await authorizeApiRequest(
        'Bearer valid-token',
        'quiz.attempt', // Student has this
      );
      expect(result.authorized).toBe(true);
      expect(result.status).toBe(200);
    });

    it('should log denied access attempts', async () => {
      await authorizeApiRequest(
        'Bearer valid-token',
        'admin.manage_users',
        '192.168.1.1',
        'Mozilla/5.0',
      );

      expect(mockFrom).toHaveBeenCalledWith('audit_logs');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'access_denied',
          allowed: false,
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
        }),
      );
    });
  });

  // ── Audit Logging ──

  describe('Audit Logging', () => {
    it('should log successful actions', async () => {
      await logAuditEntry({
        user_id: 'user-1',
        action: 'quiz.submit',
        resource: 'quiz-123',
        allowed: true,
      });

      expect(mockFrom).toHaveBeenCalledWith('audit_logs');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          action: 'quiz.submit',
          resource: 'quiz-123',
          allowed: true,
        }),
      );
    });

    it('should log denied access attempts', async () => {
      await logAuditEntry({
        user_id: 'user-1',
        action: 'access_denied',
        resource: 'admin.panel',
        allowed: false,
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'access_denied',
          allowed: false,
        }),
      );
    });

    it('should include IP and user agent', async () => {
      await logAuditEntry({
        user_id: 'user-1',
        action: 'login',
        resource: 'auth',
        allowed: true,
        ip_address: '10.0.0.1',
        user_agent: 'TestAgent/1.0',
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          ip_address: '10.0.0.1',
          user_agent: 'TestAgent/1.0',
        }),
      );
    });

    it('should log with metadata when provided', async () => {
      await logAuditEntry({
        user_id: 'user-1',
        action: 'quiz.submit',
        resource: 'quiz-456',
        allowed: true,
        metadata: { score: 85, time_taken: 120 },
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { score: 85, time_taken: 120 },
        }),
      );
    });
  });

  // ── Security ──

  describe('Security', () => {
    it('should not expose permissions in error messages', async () => {
      const result = await authorizeApiRequest(
        'Bearer valid-token',
        'admin.delete_everything',
      );

      // Error should be generic, not revealing the specific permission
      expect(result.error).toBe('Insufficient permissions');
      expect(result.error).not.toContain('admin.delete_everything');
    });

    it('should prevent privilege escalation', async () => {
      // A student trying to use admin permissions
      const studentPerms: UserPermissions = {
        roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
        permissions: ['quiz.attempt', 'study_plan.view'],
      };

      // Cannot access admin functions
      expect(hasPermission(studentPerms, 'admin.manage_users')).toBe(false);
      expect(hasPermission(studentPerms, 'admin.delete_user')).toBe(false);
      expect(hasPermission(studentPerms, 'quiz.create')).toBe(false);

      // Cannot escalate via hasAnyPermission
      expect(hasAnyPermission(studentPerms, ['admin.manage_users', 'admin.delete_user'])).toBe(false);

      // Cannot claim resource ownership of others
      const canAccessOther = await checkResourceOwnership('student-1', 'student-2', studentPerms);
      expect(canAccessOther).toBe(false);
    });

    it('should handle invalid tokens gracefully', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const result = await authorizeApiRequest('Bearer invalid', 'quiz.attempt');
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBe('Invalid token');
    });

    it('should handle RPC failures without exposing internals', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Internal database error: connection refused' },
      });

      const perms = await getUserPermissions('rpc-fail-user');
      // Should return empty permissions, not throw or expose error
      expect(perms.roles).toEqual([]);
      expect(perms.permissions).toEqual([]);
      // With no permissions, everything should be denied
      expect(hasPermission(perms, 'quiz.attempt')).toBe(false);
    });

    it('should not allow empty role name to bypass checks', () => {
      const perms: UserPermissions = {
        roles: [{ name: '', display_name: '', hierarchy_level: 0 }],
        permissions: [],
      };

      expect(hasPermission(perms, 'admin.manage_users')).toBe(false);
      expect(hasPermission(perms, 'quiz.attempt')).toBe(false);
    });

    it('should treat permissions as case-sensitive', () => {
      const perms: UserPermissions = {
        roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
        permissions: ['quiz.attempt'],
      };

      expect(hasPermission(perms, 'quiz.attempt')).toBe(true);
      expect(hasPermission(perms, 'Quiz.Attempt')).toBe(false);
      expect(hasPermission(perms, 'QUIZ.ATTEMPT')).toBe(false);
    });
  });
});
