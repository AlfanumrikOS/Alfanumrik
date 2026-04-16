import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * School Admin Auth Unit Tests
 *
 * Tests authorizeSchoolAdmin() from @/lib/school-admin-auth.
 * This function wraps RBAC authorizeRequest() with school-scoped resolution:
 *   1. Verify user has the required permission
 *   2. Resolve which school they administer (school_admins or teachers table)
 *   3. Return schoolId for query scoping
 *
 * All Supabase calls are mocked -- never hits real DB.
 */

// ── Mock setup ────────────────────────────────────────────────────────────────

// Mock authorizeRequest from RBAC module
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorizeRequest(...args),
}));

// Build a chainable mock that tracks the call sequence and returns at maybeSingle
function createChainableMock(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

let schoolAdminsChain: ReturnType<typeof createChainableMock>;
let teachersChain: ReturnType<typeof createChainableMock>;

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'school_admins') return schoolAdminsChain;
  if (table === 'teachers') return teachersChain;
  return createChainableMock({ data: null, error: null });
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

// Mock logger to prevent console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import type { SchoolAdminAuth, SchoolAdminAuthFailure } from '@/lib/school-admin-auth';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(url = 'https://test.alfanumrik.com/api/school-admin/classes'): Request {
  return new Request(url, { method: 'GET' });
}

function mockAuthorized(userId = 'user-123') {
  mockAuthorizeRequest.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['institution_admin'] as string[],
    permissions: ['class.manage', 'institution.view_reports'],
    errorResponse: undefined,
  });
}

function mockUnauthorized(status = 401) {
  mockAuthorizeRequest.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response('Unauthorized', { status }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('authorizeSchoolAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no records found in either table
    schoolAdminsChain = createChainableMock({ data: null, error: null });
    teachersChain = createChainableMock({ data: null, error: null });
  });

  // ── Unauthorized: no JWT / failed RBAC ────────────────────────────────────

  describe('returns unauthorized', () => {
    it('when RBAC authorizeRequest fails (no JWT)', async () => {
      mockUnauthorized(401);

      const result = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      const failure = result as SchoolAdminAuthFailure;
      expect(failure.errorResponse).toBeDefined();
      const body = await failure.errorResponse.json();
      expect(body.code).toBe('AUTH_REQUIRED');
      expect(failure.errorResponse.status).toBe(401);
    });

    it('when user lacks the required permission', async () => {
      mockUnauthorized(403);

      const result = await authorizeSchoolAdmin(makeRequest(), 'institution.view_reports');

      expect(result.authorized).toBe(false);
      const failure = result as SchoolAdminAuthFailure;
      expect(failure.errorResponse.status).toBe(403);
    });

    it('when authorizeRequest returns authorized but no userId', async () => {
      mockAuthorizeRequest.mockResolvedValue({
        authorized: true,
        userId: null, // edge case: authorized but missing userId
        studentId: null,
        roles: ['institution_admin'],
        permissions: ['class.manage'],
      });

      const result = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      const failure = result as SchoolAdminAuthFailure;
      const body = await failure.errorResponse.json();
      expect(body.code).toBe('NO_USER_ID');
      expect(failure.errorResponse.status).toBe(401);
    });

    it('when user is not in school_admins or teachers table', async () => {
      mockAuthorized('user-no-school');
      // Both chains return null data (default from beforeEach)

      const result = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      const failure = result as SchoolAdminAuthFailure;
      const body = await failure.errorResponse.json();
      expect(body.code).toBe('NO_SCHOOL');
      expect(failure.errorResponse.status).toBe(403);
    });
  });

  // ── Authorized ────────────────────────────────────────────────────────────

  describe('returns authorized with correct schoolId', () => {
    it('when school_admins table has a record for the user', async () => {
      const schoolId = 'school-abc-123';
      mockAuthorized('user-admin-1');
      schoolAdminsChain = createChainableMock({
        data: { school_id: schoolId },
        error: null,
      });

      const result = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(true);
      const success = result as SchoolAdminAuth;
      expect(success.schoolId).toBe(schoolId);
      expect(success.userId).toBe('user-admin-1');
      expect(success.roles).toEqual(['institution_admin']);
      expect(success.permissions).toContain('class.manage');
    });

    it('falls back to teachers table when school_admins has no match', async () => {
      const schoolId = 'school-via-teacher';
      mockAuthorized('user-teacher-1');
      // school_admins returns null
      schoolAdminsChain = createChainableMock({ data: null, error: null });
      // teachers returns the school
      teachersChain = createChainableMock({
        data: { school_id: schoolId },
        error: null,
      });

      const result = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(true);
      const success = result as SchoolAdminAuth;
      expect(success.schoolId).toBe(schoolId);
      expect(success.userId).toBe('user-teacher-1');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns 500 when resolveSchoolId throws an unexpected error', async () => {
      mockAuthorized('user-error');
      schoolAdminsChain = createChainableMock({ data: null, error: null });
      (schoolAdminsChain.maybeSingle as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB connection failed')
      );

      const result = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      const failure = result as SchoolAdminAuthFailure;
      expect(failure.errorResponse.status).toBe(500);
      const body = await failure.errorResponse.json();
      expect(body.code).toBe('AUTH_ERROR');
    });
  });

  // ── Permission code forwarding ────────────────────────────────────────────

  describe('permission code forwarding', () => {
    it('passes the permission code to authorizeRequest', async () => {
      mockUnauthorized();
      const req = makeRequest();
      await authorizeSchoolAdmin(req, 'institution.view_reports');
      expect(mockAuthorizeRequest).toHaveBeenCalledWith(req, 'institution.view_reports');
    });
  });

  // ── Table query verification ──────────────────────────────────────────────

  describe('query scoping', () => {
    it('queries school_admins with auth_user_id and is_active=true', async () => {
      mockAuthorized('user-verify-query');
      schoolAdminsChain = createChainableMock({
        data: { school_id: 'school-x' },
        error: null,
      });

      await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(mockFrom).toHaveBeenCalledWith('school_admins');
      expect(schoolAdminsChain.select).toHaveBeenCalledWith('school_id');
      expect(schoolAdminsChain.eq).toHaveBeenCalledWith('auth_user_id', 'user-verify-query');
      expect(schoolAdminsChain.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('queries teachers table only after school_admins returns no match', async () => {
      mockAuthorized('user-fallback');
      // school_admins: no match
      schoolAdminsChain = createChainableMock({ data: null, error: null });
      // teachers: match
      teachersChain = createChainableMock({
        data: { school_id: 'school-teacher-fallback' },
        error: null,
      });

      await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      // Both tables should be queried
      expect(mockFrom).toHaveBeenCalledWith('school_admins');
      expect(mockFrom).toHaveBeenCalledWith('teachers');
    });
  });
});
