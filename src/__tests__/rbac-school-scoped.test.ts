import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RBAC School-Scoped Permission Tests
 *
 * Tests the school-aware cache and resolution logic added in Phase 2A:
 * 1. Platform-wide lookup (no schoolId) — calls RPC without p_school_id
 * 2. School-scoped lookup — calls RPC with p_school_id, returns school permissions
 * 3. Different cache keys for platform vs school (two calls to same user = 2 RPC calls)
 * 4. Throws on RPC error (doesn't return empty perms)
 */

// ── Mock Supabase admin ──
const mockRpc = vi.fn();
const mockFrom = vi.fn().mockReturnValue({
  insert: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
  }),
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
});

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(),
}));

// Import after mocks are set up
import { getUserPermissions, invalidatePermissionCache } from '@/lib/rbac';
import type { RoleName, UserPermissions, AuthorizationResult, RoleInfo } from '@/lib/rbac-types';

describe('RBAC School-Scoped Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level _localCache by invalidating known test users
    // We use invalidatePermissionCache which clears local cache entries
  });

  // ─── Test 1: Platform-wide lookup (no schoolId) ─────────────

  describe('Platform-wide lookup', () => {
    it('calls RPC without p_school_id when no schoolId provided', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
          permissions: ['quiz.attempt', 'study_plan.view'],
        },
        error: null,
      });

      const result = await getUserPermissions('user-platform-1');

      expect(mockRpc).toHaveBeenCalledWith('get_user_permissions', {
        p_auth_user_id: 'user-platform-1',
      });
      // Should NOT include p_school_id in the RPC params
      expect(mockRpc).not.toHaveBeenCalledWith(
        'get_user_permissions',
        expect.objectContaining({ p_school_id: expect.anything() }),
      );
      expect(result.permissions).toContain('quiz.attempt');
      expect(result.schoolId).toBeNull();
    });

    it('returns permissions with schoolId = null for platform lookup', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
          permissions: ['admin.manage_users'],
        },
        error: null,
      });

      const result = await getUserPermissions('user-platform-2');
      expect(result.schoolId).toBeNull();
    });
  });

  // ─── Test 2: School-scoped lookup ───────────────────────────

  describe('School-scoped lookup', () => {
    it('calls RPC with p_school_id when schoolId provided', async () => {
      const schoolId = 'school-abc-123';
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'institution_admin', display_name: 'Institution Admin', hierarchy_level: 80 }],
          permissions: ['institution.manage', 'institution.view_analytics'],
        },
        error: null,
      });

      const result = await getUserPermissions('user-school-1', schoolId);

      expect(mockRpc).toHaveBeenCalledWith('get_user_permissions', {
        p_auth_user_id: 'user-school-1',
        p_school_id: schoolId,
      });
      expect(result.permissions).toContain('institution.manage');
      expect(result.schoolId).toBe(schoolId);
    });

    it('returns school-specific permissions', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50, school_id: 'school-xyz' }],
          permissions: ['class.manage', 'class.view_analytics'],
        },
        error: null,
      });

      const result = await getUserPermissions('user-school-2', 'school-xyz');
      expect(result.roles[0].name).toBe('teacher');
      expect(result.schoolId).toBe('school-xyz');
    });
  });

  // ─── Test 3: Different cache keys for platform vs school ────

  describe('Cache key isolation', () => {
    it('uses separate cache keys for platform and school lookups', async () => {
      // First call: platform-wide
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
          permissions: ['admin.manage_users'],
        },
        error: null,
      });

      await getUserPermissions('user-cache-1');
      expect(mockRpc).toHaveBeenCalledTimes(1);

      // Second call: same user, school-scoped — should NOT use cached platform result
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'institution_admin', display_name: 'Institution Admin', hierarchy_level: 80 }],
          permissions: ['institution.manage'],
        },
        error: null,
      });

      await getUserPermissions('user-cache-1', 'school-123');
      expect(mockRpc).toHaveBeenCalledTimes(2); // Both calls hit RPC (separate cache keys)
    });

    it('caches platform and school lookups independently', async () => {
      // Platform lookup
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
          permissions: ['admin.manage_users'],
        },
        error: null,
      });
      const platformResult = await getUserPermissions('user-cache-2');

      // School lookup
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
          permissions: ['class.manage'],
        },
        error: null,
      });
      const schoolResult = await getUserPermissions('user-cache-2', 'school-456');

      expect(mockRpc).toHaveBeenCalledTimes(2);

      // Repeat both — should use cache (no additional RPC calls)
      const platformCached = await getUserPermissions('user-cache-2');
      const schoolCached = await getUserPermissions('user-cache-2', 'school-456');

      expect(mockRpc).toHaveBeenCalledTimes(2); // Still 2, both used cache
      expect(platformCached.permissions).toContain('admin.manage_users');
      expect(schoolCached.permissions).toContain('class.manage');
    });

    it('does not reuse cached platform result for a different school', async () => {
      // School A lookup
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
          permissions: ['class.manage'],
        },
        error: null,
      });
      await getUserPermissions('user-cache-3', 'school-A');

      // School B lookup — should be a separate cache miss
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'institution_admin', display_name: 'Institution Admin', hierarchy_level: 80 }],
          permissions: ['institution.manage'],
        },
        error: null,
      });
      await getUserPermissions('user-cache-3', 'school-B');

      expect(mockRpc).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Test 4: Throws on RPC error ────────────────────────────

  describe('Error handling', () => {
    it('throws on RPC error instead of returning empty permissions', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection refused' },
      });

      await expect(getUserPermissions('user-error-1')).rejects.toThrow(
        'Permission lookup failed: Database connection refused',
      );
    });

    it('throws when RPC returns no data', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await expect(getUserPermissions('user-error-2')).rejects.toThrow(
        'Permission lookup failed: no data returned',
      );
    });

    it('throws for school-scoped RPC errors too', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'School not found' },
      });

      await expect(getUserPermissions('user-error-3', 'nonexistent-school')).rejects.toThrow(
        'Permission lookup failed: School not found',
      );
    });
  });

  // ─── Test 5: Type exports from rbac-types.ts ────────────────

  describe('Type exports', () => {
    it('RoleName type includes new institution roles', () => {
      // This is a compile-time check — if these assignments fail, TypeScript catches it.
      const roles: RoleName[] = [
        'student', 'parent', 'teacher', 'tutor', 'admin', 'super_admin',
        'institution_admin', 'content_manager', 'reviewer', 'support', 'finance',
      ];
      expect(roles).toHaveLength(11);
    });

    it('UserPermissions includes schoolId field', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
          permissions: ['quiz.attempt'],
        },
        error: null,
      });

      const result: UserPermissions = await getUserPermissions('user-type-1', 'school-type');
      // schoolId should be set from the argument
      expect(result.schoolId).toBe('school-type');
    });

    it('AuthorizationResult includes schoolId field', () => {
      const result: AuthorizationResult = {
        authorized: true,
        userId: 'u1',
        studentId: 's1',
        roles: ['student'],
        permissions: ['quiz.attempt'],
        schoolId: 'school-test',
      };
      expect(result.schoolId).toBe('school-test');
    });
  });

  // ─── Test 6: invalidatePermissionCache clears all variants ──

  describe('Cache invalidation', () => {
    it('invalidatePermissionCache clears both platform and school entries', async () => {
      // Seed platform cache
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
          permissions: ['admin.manage_users'],
        },
        error: null,
      });
      await getUserPermissions('user-invalidate-1');

      // Seed school cache
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
          permissions: ['class.manage'],
        },
        error: null,
      });
      await getUserPermissions('user-invalidate-1', 'school-inv');

      expect(mockRpc).toHaveBeenCalledTimes(2);

      // Invalidate all caches for this user
      await invalidatePermissionCache('user-invalidate-1');

      // Next calls should hit RPC again (cache was cleared)
      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
          permissions: ['admin.manage_users'],
        },
        error: null,
      });
      await getUserPermissions('user-invalidate-1');

      mockRpc.mockResolvedValueOnce({
        data: {
          roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
          permissions: ['class.manage'],
        },
        error: null,
      });
      await getUserPermissions('user-invalidate-1', 'school-inv');

      expect(mockRpc).toHaveBeenCalledTimes(4); // All 4 calls hit RPC
    });
  });
});
