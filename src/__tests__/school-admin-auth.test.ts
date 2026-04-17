import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * School Admin Auth Unit Tests
 *
 * Tests authorizeSchoolAdmin() from @/lib/school-admin-auth.
 * This function wraps RBAC authorizeRequest() with school-scoped resolution:
 *   1. Verify JWT + RBAC permission via authorizeRequest()
 *   2. Look up school_admins record to get school_id
 *   3. Verify the linked school is active
 *   4. Return schoolId for tenant-scoped queries
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
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// The actual code queries: school_admins then schools (to verify active)
let schoolAdminsChain: ReturnType<typeof createChainableMock>;
let schoolsChain: ReturnType<typeof createChainableMock>;

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'school_admins') return schoolAdminsChain;
  if (table === 'schools') return schoolsChain;
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
import type { SchoolAdminAuthResult } from '@/lib/school-admin-auth';

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
    // Default: no records found
    schoolAdminsChain = createChainableMock({ data: null, error: null });
    schoolsChain = createChainableMock({ data: { id: 'school-abc', is_active: true }, error: null });
  });

  // ── Unauthorized: no JWT / failed RBAC ────────────────────────────────────

  describe('returns unauthorized', () => {
    it('when RBAC authorizeRequest fails (no JWT)', async () => {
      mockUnauthorized(401);

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      expect(result.errorResponse).toBeDefined();
      // The RBAC errorResponse is passed through directly (plain text Response)
      expect(result.errorResponse!.status).toBe(401);
    });

    it('when user lacks the required permission', async () => {
      mockUnauthorized(403);

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'institution.view_reports');

      expect(result.authorized).toBe(false);
      expect(result.errorResponse!.status).toBe(403);
    });

    it('when user is not in school_admins table', async () => {
      mockAuthorized('user-no-school');
      // school_admins returns null (default from beforeEach)

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      const body = await result.errorResponse!.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Not a school administrator');
      expect(result.errorResponse!.status).toBe(403);
    });

    it('when school is not active', async () => {
      mockAuthorized('user-inactive-school');
      schoolAdminsChain = createChainableMock({
        data: { id: 'admin-1', school_id: 'school-inactive', is_active: true },
        error: null,
      });
      schoolsChain = createChainableMock({
        data: { id: 'school-inactive', is_active: false },
        error: null,
      });

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      const body = await result.errorResponse!.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('School is not active');
      expect(result.errorResponse!.status).toBe(403);
    });
  });

  // ── Authorized ────────────────────────────────────────────────────────────

  describe('returns authorized with correct schoolId', () => {
    it('when school_admins table has a record for the user', async () => {
      const schoolId = 'school-abc-123';
      mockAuthorized('user-admin-1');
      schoolAdminsChain = createChainableMock({
        data: { id: 'admin-rec-1', school_id: schoolId, is_active: true },
        error: null,
      });
      schoolsChain = createChainableMock({
        data: { id: schoolId, is_active: true },
        error: null,
      });

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(true);
      expect(result.schoolId).toBe(schoolId);
      expect(result.userId).toBe('user-admin-1');
      expect(result.schoolAdminId).toBe('admin-rec-1');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns 500 when school_admins query fails', async () => {
      mockAuthorized('user-error');
      schoolAdminsChain = createChainableMock({
        data: null,
        error: { message: 'DB connection failed' },
      });

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      expect(result.errorResponse!.status).toBe(500);
      const body = await result.errorResponse!.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to verify school admin status');
    });

    it('returns 500 when schools query fails', async () => {
      mockAuthorized('user-school-err');
      schoolAdminsChain = createChainableMock({
        data: { id: 'admin-1', school_id: 'school-err', is_active: true },
        error: null,
      });
      schoolsChain = createChainableMock({
        data: null,
        error: { message: 'School lookup failed' },
      });

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      expect(result.errorResponse!.status).toBe(500);
      const body = await result.errorResponse!.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to verify school status');
    });

    it('returns 500 when maybeSingle throws an unexpected error', async () => {
      mockAuthorized('user-throw');
      (schoolAdminsChain.maybeSingle as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Unexpected crash')
      );

      const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(result.authorized).toBe(false);
      expect(result.errorResponse!.status).toBe(500);
      const body = await result.errorResponse!.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Authorization failed');
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
        data: { id: 'admin-1', school_id: 'school-x', is_active: true },
        error: null,
      });

      await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(mockFrom).toHaveBeenCalledWith('school_admins');
      expect(schoolAdminsChain.select).toHaveBeenCalledWith('id, school_id, is_active');
      expect(schoolAdminsChain.eq).toHaveBeenCalledWith('auth_user_id', 'user-verify-query');
      expect(schoolAdminsChain.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('queries schools table to verify school is active', async () => {
      mockAuthorized('user-verify-school');
      schoolAdminsChain = createChainableMock({
        data: { id: 'admin-1', school_id: 'school-verify', is_active: true },
        error: null,
      });

      await authorizeSchoolAdmin(makeRequest(), 'class.manage');

      expect(mockFrom).toHaveBeenCalledWith('schools');
      expect(schoolsChain.select).toHaveBeenCalledWith('id, is_active');
      expect(schoolsChain.eq).toHaveBeenCalledWith('id', 'school-verify');
    });
  });
});