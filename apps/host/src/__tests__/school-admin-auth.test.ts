import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * School Admin Auth Unit Tests
 *
 * Tests authorizeSchoolAdmin() from @alfanumrik/lib/school-admin-auth.
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
vi.mock('@alfanumrik/lib/rbac', () => ({
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
  chain.then = (resolve: (value: typeof resolvedValue) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(resolve, reject);
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

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

// Mock logger to prevent console noise
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock feature-flags so the Wave C ff_school_admin_rbac gate is deterministic and
// never performs a real fetch. Default OFF: role-narrowing is skipped, so these
// existing tests exercise the byte-identical flag-OFF path. Flip via
// mockSchoolAdminRbacFlag(true) inside a test to exercise the matrix.
const mockIsFeatureEnabled = vi.fn().mockResolvedValue(false);
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  SCHOOL_ADMIN_RBAC_FLAGS: { V1: 'ff_school_admin_rbac' },
}));

// Import after mocks are set up
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import type { SchoolAdminAuthResult } from '@alfanumrik/lib/school-admin-auth';

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
    // Re-establish the flag-OFF default after clearAllMocks (which resets impls).
    mockIsFeatureEnabled.mockResolvedValue(false);
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
      const permissionDenied = new Response('Forbidden', { status: 403 });
      mockAuthorized('user-without-permission');
      mockAuthorizeRequest.mockResolvedValueOnce({
        authorized: true,
        userId: 'user-without-permission',
        roles: ['institution_admin'],
        permissions: [],
      }).mockResolvedValueOnce({
        authorized: false,
        userId: 'user-without-permission',
        roles: ['institution_admin'],
        permissions: [],
        errorResponse: permissionDenied,
      });
      schoolAdminsChain = createChainableMock({
        data: { id: 'admin-1', school_id: 'school-abc', role: 'institution_admin', is_active: true },
        error: null,
      });

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
      schoolAdminsChain.then = (_resolve: unknown, reject: (reason: unknown) => unknown) =>
        Promise.reject(new Error('Unexpected crash')).catch(reject);

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
    it('evaluates the permission only after selecting the school context', async () => {
      mockAuthorized('scoped-admin');
      schoolAdminsChain = createChainableMock({
        data: { id: 'admin-1', school_id: 'school-scoped', role: 'institution_admin', is_active: true },
        error: null,
      });
      schoolsChain = createChainableMock({ data: { id: 'school-scoped', is_active: true }, error: null });
      const req = makeRequest();
      await authorizeSchoolAdmin(req, 'institution.view_reports');
      expect(mockAuthorizeRequest).toHaveBeenNthCalledWith(1, req);
      expect(mockAuthorizeRequest).toHaveBeenNthCalledWith(2, req, 'institution.view_reports', {
        context: { schoolId: 'school-scoped' },
      });
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
      // Wave C: `role` is now fetched in the same query (no extra round-trip) to
      // drive the SCHOOL_ADMIN_ROLE_CAPABILITIES narrowing + returned schoolAdminRole.
      expect(schoolAdminsChain.select).toHaveBeenCalledWith('id, school_id, role, is_active');
      expect(schoolAdminsChain.eq).toHaveBeenCalledWith('auth_user_id', 'user-verify-query');
      expect(schoolAdminsChain.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('requires an explicit scope for multiple active school memberships', async () => {
      mockAuthorized('multi-school-admin');
      schoolAdminsChain = createChainableMock({
        data: [
          { id: 'admin-1', school_id: 'school-a', role: 'institution_admin', is_active: true },
          { id: 'admin-2', school_id: 'school-b', role: 'institution_admin', is_active: true },
        ],
        error: null,
      });

      const result = await authorizeSchoolAdmin(makeRequest(), 'class.manage');
      expect(result.authorized).toBe(false);
      expect(result.errorResponse!.status).toBe(400);
      expect((await result.errorResponse!.json()).school_ids).toEqual(['school-a', 'school-b']);
    });

    it('selects only a requested active membership and rejects a foreign school', async () => {
      mockAuthorized('multi-school-admin');
      schoolAdminsChain = createChainableMock({
        data: [
          { id: 'admin-1', school_id: 'school-a', role: 'institution_admin', is_active: true },
          { id: 'admin-2', school_id: 'school-b', role: 'principal', is_active: true },
        ],
        error: null,
      });
      schoolsChain = createChainableMock({ data: { id: 'school-b', is_active: true }, error: null });

      const selected = await authorizeSchoolAdmin(makeRequest('https://test.alfanumrik.com/api/school-admin/classes?schoolId=school-b'), 'class.manage');
      expect(selected).toMatchObject({ authorized: true, schoolId: 'school-b', schoolAdminId: 'admin-2', schoolAdminRole: 'principal' });

      const denied = await authorizeSchoolAdmin(makeRequest('https://test.alfanumrik.com/api/school-admin/classes?school_id=foreign'), 'class.manage');
      expect(denied.authorized).toBe(false);
      expect(denied.errorResponse!.status).toBe(403);
    });

    it('applies the selected membership role matrix for multi-school users even when the flag is off', async () => {
      mockAuthorized('multi-school-role-admin');
      mockIsFeatureEnabled.mockResolvedValue(false);
      schoolAdminsChain = createChainableMock({
        data: [
          { id: 'admin-a', school_id: 'school-a', role: 'principal', is_active: true },
          { id: 'admin-b', school_id: 'school-b', role: 'academic_coordinator', is_active: true },
        ],
        error: null,
      });
      schoolsChain = createChainableMock({ data: { id: 'school-b', is_active: true }, error: null });

      // The scoped RBAC seam is deliberately authorized here, simulating the
      // baseline one-argument global permission fallback. The selected School
      // B role must still deny a billing permission it does not hold.
      const result = await authorizeSchoolAdmin(
        makeRequest('https://test.alfanumrik.com/api/school-admin/billing?schoolId=school-b'),
        'institution.manage_billing',
      );

      expect(result.authorized).toBe(false);
      expect(result.schoolId).toBe('school-b');
      expect((await result.errorResponse!.json()).code).toBe('SCHOOL_ADMIN_ROLE_DENIED');
    });

    it('denies a multi-school selection when selected-school permission resolution denies', async () => {
      const scopedDenial = new Response('Forbidden', { status: 403 });
      mockAuthorizeRequest
        .mockResolvedValueOnce({ authorized: true, userId: 'multi-school-permission-admin', roles: ['institution_admin'], permissions: [] })
        .mockResolvedValueOnce({ authorized: false, userId: 'multi-school-permission-admin', roles: ['institution_admin'], permissions: [], errorResponse: scopedDenial });
      schoolAdminsChain = createChainableMock({
        data: [
          { id: 'admin-a', school_id: 'school-a', role: 'institution_admin', is_active: true },
          { id: 'admin-b', school_id: 'school-b', role: 'institution_admin', is_active: true },
        ],
        error: null,
      });
      schoolsChain = createChainableMock({ data: { id: 'school-b', is_active: true }, error: null });

      const result = await authorizeSchoolAdmin(
        makeRequest('https://test.alfanumrik.com/api/school-admin/students?schoolId=school-b'),
        'institution.manage_students',
      );

      expect(result.authorized).toBe(false);
      expect(result.schoolId).toBe('school-b');
      expect(result.errorResponse).toBe(scopedDenial);
    });

    it('denies non-matrix permissions for multi-school users on the baseline global fallback', async () => {
      mockAuthorizeRequest
        .mockResolvedValueOnce({ authorized: true, userId: 'multi-school-baseline-admin', roles: ['institution_admin'], permissions: [] })
        .mockResolvedValueOnce({
          authorized: true,
          userId: 'multi-school-baseline-admin',
          roles: ['institution_admin'],
          permissions: ['school.manage_content'],
          permissionScope: 'baseline-global',
        });
      schoolAdminsChain = createChainableMock({
        data: [
          { id: 'admin-a', school_id: 'school-a', role: 'institution_admin', is_active: true },
          { id: 'admin-b', school_id: 'school-b', role: 'institution_admin', is_active: true },
        ],
        error: null,
      });
      schoolsChain = createChainableMock({ data: { id: 'school-b', is_active: true }, error: null });

      const result = await authorizeSchoolAdmin(
        makeRequest('https://test.alfanumrik.com/api/school-admin/content?schoolId=school-b'),
        'school.manage_content',
      );

      expect(result.authorized).toBe(false);
      expect(result.schoolId).toBe('school-b');
      expect((await result.errorResponse!.json()).code).toBe('SCHOOL_SCOPED_RBAC_REQUIRED');
    });

    it('rejects conflicting camelCase and API school scope values', async () => {
      mockAuthorized('multi-school-admin');
      schoolAdminsChain = createChainableMock({
        data: [
          { id: 'admin-1', school_id: 'school-a', role: 'institution_admin', is_active: true },
          { id: 'admin-2', school_id: 'school-b', role: 'institution_admin', is_active: true },
        ],
        error: null,
      });
      const result = await authorizeSchoolAdmin(
        makeRequest('https://test.alfanumrik.com/api/school-admin/classes?schoolId=school-a&school_id=school-b'),
        'class.manage',
      );
      expect(result.authorized).toBe(false);
      expect(result.errorResponse!.status).toBe(400);
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
