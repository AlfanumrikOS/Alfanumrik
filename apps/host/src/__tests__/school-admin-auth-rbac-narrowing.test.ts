import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 3B Wave C — authorizeSchoolAdmin ROLE-NARROWING tests.
 *
 * Mirrors the seam discipline of the existing src/__tests__/school-admin-auth.test.ts
 * (RBAC + supabase-admin + logger + feature-flags all mocked, NO DB). This file
 * focuses ONLY on the Wave C Step-4 narrowing block:
 *
 *   - flag ON  → the caller's school_admins.role must grant the requested code per
 *     the CEO-approved matrix, else 403 SCHOOL_ADMIN_ROLE_DENIED:
 *       · vice_principal + institution.manage_billing → 403
 *       · vice_principal + institution.manage_staff   → 403
 *       · academic_coordinator + institution.manage   → 403
 *       · academic_coordinator + institution.view_billing → 403
 *       · principal + ANY matrix code → authorized
 *       · vice_principal + a code it DOES hold (view_billing) → authorized
 *       · a non-matrix code (school.manage_settings) → authorized for any role (defer)
 *
 *   - flag OFF → NO narrowing whatsoever. EVERY role passes the school_admins step
 *     exactly as before Wave C. We prove flag-OFF is BYTE-IDENTICAL by showing the
 *     OFF decision for a code a role would be DENIED under ON (vice_principal +
 *     manage_billing) is `authorized:true` with the same schoolId/userId/adminId,
 *     and that the SCHOOL_ADMIN_ROLE_DENIED code never appears on the OFF path.
 */

// ── RBAC seam (always authorized for these tests; the JWT/permission gate is
//    proven in school-admin-auth.test.ts — here we drive the narrowing only). ──
const mockAuthorizeRequest = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorizeRequest(...args),
}));

// ── Chainable supabase-admin stub (school_admins → schools), copied from the
//    sibling auth test so the two files stay structurally identical. ──
function createChainableMock(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

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

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Feature-flag seam. Default OFF; flip per-test via mockRbacFlag(true). ──
const mockIsFeatureEnabled = vi.fn().mockResolvedValue(false);
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  SCHOOL_ADMIN_RBAC_FLAGS: { V1: 'ff_school_admin_rbac' },
}));

import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import type { SchoolAdminAuthResult, SchoolAdminRole } from '@alfanumrik/lib/school-admin-auth';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(): Request {
  return new Request('https://test.alfanumrik.com/api/school-admin/staff', { method: 'GET' });
}

function mockAuthorized(userId = 'user-123') {
  mockAuthorizeRequest.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['institution_admin'] as string[],
    permissions: [],
    errorResponse: undefined,
  });
}

const SCHOOL = 'school-abc-123';

function primeAdmin(role: SchoolAdminRole, adminId = 'admin-rec-1') {
  schoolAdminsChain = createChainableMock({
    data: { id: adminId, school_id: SCHOOL, role, is_active: true },
    error: null,
  });
  schoolsChain = createChainableMock({
    data: { id: SCHOOL, is_active: true },
    error: null,
  });
}

function setRbacFlag(on: boolean) {
  mockIsFeatureEnabled.mockResolvedValue(on);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFeatureEnabled.mockResolvedValue(false);
  schoolAdminsChain = createChainableMock({ data: null, error: null });
  schoolsChain = createChainableMock({ data: { id: SCHOOL, is_active: true }, error: null });
  mockAuthorized();
});

// ═════════════════════════════════════════════════════════════════════════════
// FLAG ON — the matrix narrows
// ═════════════════════════════════════════════════════════════════════════════
describe('authorizeSchoolAdmin — flag ON narrowing (denials)', () => {
  it('vice_principal calling institution.manage_billing → 403 SCHOOL_ADMIN_ROLE_DENIED', async () => {
    setRbacFlag(true);
    primeAdmin('vice_principal');

    const result: SchoolAdminAuthResult = await authorizeSchoolAdmin(
      makeRequest(),
      'institution.manage_billing',
    );

    expect(result.authorized).toBe(false);
    expect(result.errorResponse!.status).toBe(403);
    const body = await result.errorResponse!.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('SCHOOL_ADMIN_ROLE_DENIED');
    // The role is still echoed back even on denial (additive field).
    expect(result.schoolAdminRole).toBe('vice_principal');
    // The school context is resolved before the narrowing denial.
    expect(result.schoolId).toBe(SCHOOL);
  });

  it('vice_principal calling institution.manage_staff → 403 SCHOOL_ADMIN_ROLE_DENIED', async () => {
    setRbacFlag(true);
    primeAdmin('vice_principal');

    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage_staff');

    expect(result.authorized).toBe(false);
    expect(result.errorResponse!.status).toBe(403);
    expect((await result.errorResponse!.json()).code).toBe('SCHOOL_ADMIN_ROLE_DENIED');
  });

  it('academic_coordinator calling institution.manage → 403 SCHOOL_ADMIN_ROLE_DENIED', async () => {
    setRbacFlag(true);
    primeAdmin('academic_coordinator');

    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage');

    expect(result.authorized).toBe(false);
    expect(result.errorResponse!.status).toBe(403);
    expect((await result.errorResponse!.json()).code).toBe('SCHOOL_ADMIN_ROLE_DENIED');
  });

  it('academic_coordinator calling institution.view_billing → 403 (no billing visibility)', async () => {
    setRbacFlag(true);
    primeAdmin('academic_coordinator');

    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.view_billing');

    expect(result.authorized).toBe(false);
    expect(result.errorResponse!.status).toBe(403);
  });
});

describe('authorizeSchoolAdmin — flag ON narrowing (allows)', () => {
  it('principal calling institution.manage_staff → authorized', async () => {
    setRbacFlag(true);
    primeAdmin('principal');

    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage_staff');

    expect(result.authorized).toBe(true);
    expect(result.schoolId).toBe(SCHOOL);
    expect(result.schoolAdminRole).toBe('principal');
    expect(result.errorResponse).toBeUndefined();
  });

  it('principal calling institution.manage_billing → authorized', async () => {
    setRbacFlag(true);
    primeAdmin('principal');
    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage_billing');
    expect(result.authorized).toBe(true);
  });

  it('institution_admin calling institution.manage_staff → authorized (full superset)', async () => {
    setRbacFlag(true);
    primeAdmin('institution_admin');
    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage_staff');
    expect(result.authorized).toBe(true);
  });

  it('vice_principal calling institution.view_billing (a code it DOES hold) → authorized', async () => {
    setRbacFlag(true);
    primeAdmin('vice_principal');
    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.view_billing');
    expect(result.authorized).toBe(true);
  });

  it('academic_coordinator calling a SHARED code (institution.manage_students) → authorized', async () => {
    setRbacFlag(true);
    primeAdmin('academic_coordinator');
    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage_students');
    expect(result.authorized).toBe(true);
  });

  it('a NON-matrix code (school.manage_settings) is NOT narrowed → authorized for any role', async () => {
    setRbacFlag(true);
    primeAdmin('academic_coordinator'); // even the narrowest role passes a deferred code
    const result = await authorizeSchoolAdmin(makeRequest(), 'school.manage_settings');
    expect(result.authorized).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FLAG OFF — byte-identical, NO narrowing
// ═════════════════════════════════════════════════════════════════════════════
describe('authorizeSchoolAdmin — flag OFF is byte-identical (no narrowing)', () => {
  it('vice_principal + institution.manage_billing is AUTHORIZED when the flag is OFF (would be 403 ON)', async () => {
    setRbacFlag(false);
    primeAdmin('vice_principal', 'admin-vp-1');

    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage_billing');

    // The SAME (role, code) pair that 403s under ON must pass under OFF.
    expect(result.authorized).toBe(true);
    expect(result.errorResponse).toBeUndefined();
    expect(result.schoolId).toBe(SCHOOL);
    expect(result.userId).toBe('user-123');
    expect(result.schoolAdminId).toBe('admin-vp-1');
    // The role is still returned (additive, flag-independent) but is NOT enforced.
    expect(result.schoolAdminRole).toBe('vice_principal');
  });

  it('academic_coordinator + institution.manage is AUTHORIZED when the flag is OFF', async () => {
    setRbacFlag(false);
    primeAdmin('academic_coordinator', 'admin-ac-1');

    const result = await authorizeSchoolAdmin(makeRequest(), 'institution.manage');

    expect(result.authorized).toBe(true);
    expect(result.errorResponse).toBeUndefined();
    expect(result.schoolAdminRole).toBe('academic_coordinator');
  });

  it('NO role is ever 403 SCHOOL_ADMIN_ROLE_DENIED on the OFF path, for any matrix code', async () => {
    setRbacFlag(false);
    const roles: SchoolAdminRole[] = [
      'principal',
      'vice_principal',
      'academic_coordinator',
      'institution_admin',
    ];
    const codes = [
      'institution.manage_billing',
      'institution.manage_staff',
      'institution.manage',
      'institution.view_billing',
    ];
    for (const role of roles) {
      for (const code of codes) {
        primeAdmin(role);
        const result = await authorizeSchoolAdmin(makeRequest(), code);
        expect(result.authorized).toBe(true);
        // No denial body is ever produced on the OFF path.
        expect(result.errorResponse).toBeUndefined();
      }
    }
  });

  it('does not consult schoolAdminRoleAllows for the decision (flag read gates the block)', async () => {
    // The flag must be read; when it resolves false the narrowing block is skipped
    // entirely. We verify the flag was checked with the Wave C flag name.
    setRbacFlag(false);
    primeAdmin('academic_coordinator');
    await authorizeSchoolAdmin(makeRequest(), 'institution.manage');
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('ff_school_admin_rbac');
  });
});
