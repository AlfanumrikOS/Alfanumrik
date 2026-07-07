import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gap 3 regression — ROUTE-LEVEL school-admin RBAC narrowing (billing + staff).
 *
 * The helper-level proof lives in src/__tests__/school-admin-auth-rbac-narrowing.test.ts
 * (it exercises authorizeSchoolAdmin's Step-4 matrix directly). THIS file pins the
 * end-to-end ROUTE → HELPER wiring so a future edit to the code-pair (route picks
 * the matrix permission code via schoolAdminPermissionCode, helper narrows by role)
 * can't silently re-open the hole.
 *
 * It therefore uses the REAL authorizeSchoolAdmin AND the REAL
 * schoolAdminPermissionCode, mocking ONLY the deepest seams:
 *   - @alfanumrik/lib/rbac authorizeRequest → always authorized (the institution_admin RBAC
 *     superset grants every matrix code; the JWT/permission gate is proven in
 *     rbac.test.ts). This makes the per-school-admin-ROLE narrowing the sole
 *     decision under test.
 *   - @alfanumrik/lib/supabase-admin → returns the caller's school_admins row (carrying the
 *     role we are asserting) + an active school.
 *   - @alfanumrik/lib/feature-flags isFeatureEnabled → ff_school_admin_rbac ON (the test sets
 *     it ON purely for the assertion; it stays OFF in prod). Other flags also ON so
 *     a PASS reaches the route body rather than a flag gate.
 *
 * Contract pinned (flag ON):
 *   - billing WRITE (POST /api/school-admin/subscription → institution.manage_billing):
 *       vice_principal → 403 SCHOOL_ADMIN_ROLE_DENIED; principal → PASSES the gate.
 *   - staff (GET /api/school-admin/staff → institution.manage_staff):
 *       vice_principal → 403 SCHOOL_ADMIN_ROLE_DENIED; principal → PASSES the gate.
 */

import type { SchoolAdminRole } from '@alfanumrik/lib/school-admin-auth';

// ── RBAC seam: always authorized (superset granted). The role narrowing inside
//    authorizeSchoolAdmin is what we are testing, not the JWT/permission check. ──
const mockAuthorizeRequest = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
}));

// ── Feature-flag seam. schoolAdminPermissionCode + authorizeSchoolAdmin + the
//    route gates all read isFeatureEnabled. ON for ff_school_admin_rbac (the bit
//    under test) and ON for the per-route self-service / staff feature gates so a
//    role-PASS lands in the route body instead of an unrelated flag gate. ──
const mockIsFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => mockIsFeatureEnabled(...a),
  SCHOOL_ADMIN_RBAC_FLAGS: { V1: 'ff_school_admin_rbac' },
}));

// ── supabase-admin: school_admins row (the asserted role) + active school. ──
const dbState = vi.hoisted(() => ({ role: 'principal' as SchoolAdminRole }));

function createChainableMock(resolvedValue: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = vi.fn(ret);
  chain.eq = vi.fn(ret);
  chain.order = vi.fn(ret);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  (chain as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(onF);
  return chain;
}

const SCHOOL = 'school-abc-123';

function mockFrom(table: string) {
  if (table === 'school_admins') {
    return createChainableMock({
      data: { id: 'admin-rec-1', school_id: SCHOOL, role: dbState.role, is_active: true },
      error: null,
    });
  }
  if (table === 'schools') {
    return createChainableMock({ data: { id: SCHOOL, is_active: true }, error: null });
  }
  // subscription_plans / students / school_subscriptions etc. — never reached on a
  // role-DENY; on a PASS we stop the billing route earlier (invalid plan → 400).
  return createChainableMock({ data: null, error: null, count: 0 });
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
  supabaseAdmin: { from: mockFrom },
}));

// ── Quiet infra / unused-on-deny dependencies. ───────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@alfanumrik/lib/audit', () => ({ logSchoolAudit: vi.fn() }));
vi.mock('@alfanumrik/lib/posthog/server', () => ({ capture: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alfanumrik/lib/razorpay', () => ({
  createRazorpaySubscription: vi.fn(),
  cancelRazorpaySubscription: vi.fn(),
  updateRazorpaySubscriptionQuantity: vi.fn(),
}));

import { POST as subscriptionPOST } from '@/app/api/school-admin/subscription/route';
import { GET as staffGET } from '@/app/api/school-admin/staff/route';

function makeReq(url: string, method = 'GET', body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // RBAC superset: every school admin maps to institution_admin and passes the
  // RBAC permission check; the role-matrix narrowing is the sole gate under test.
  mockAuthorizeRequest.mockResolvedValue({
    authorized: true,
    userId: 'user-123',
    studentId: null,
    roles: ['institution_admin'],
    permissions: [],
    errorResponse: undefined,
  });
  // All flags ON: ff_school_admin_rbac (narrowing) + ff_school_self_service_billing_v1.
  mockIsFeatureEnabled.mockResolvedValue(true);
  dbState.role = 'principal';
});

function setCallerRole(role: SchoolAdminRole) {
  dbState.role = role;
}

// ═════════════════════════════════════════════════════════════════════════════
// BILLING WRITE — POST /api/school-admin/subscription → institution.manage_billing
// ═════════════════════════════════════════════════════════════════════════════
describe('billing route RBAC narrowing (institution.manage_billing)', () => {
  it('vice_principal → 403 SCHOOL_ADMIN_ROLE_DENIED (no manage_billing)', async () => {
    setCallerRole('vice_principal');
    const res = await subscriptionPOST(
      makeReq('/api/school-admin/subscription', 'POST', {
        plan: 'starter',
        billing_cycle: 'monthly',
        seats: 50,
      }) as never,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('SCHOOL_ADMIN_ROLE_DENIED');
  });

  it('principal → PASSES the role gate (does NOT return SCHOOL_ADMIN_ROLE_DENIED)', async () => {
    setCallerRole('principal');
    // Send an invalid plan so the route returns 400 AFTER clearing the RBAC gate.
    // A role-denied principal would instead 403 with SCHOOL_ADMIN_ROLE_DENIED — so a
    // 400 here proves the principal got PAST the matrix narrowing.
    const res = await subscriptionPOST(
      makeReq('/api/school-admin/subscription', 'POST', {
        plan: 'not-a-real-plan',
        billing_cycle: 'monthly',
        seats: 50,
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).not.toBe('SCHOOL_ADMIN_ROLE_DENIED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STAFF — GET /api/school-admin/staff → institution.manage_staff
// ═════════════════════════════════════════════════════════════════════════════
describe('staff route RBAC narrowing (institution.manage_staff)', () => {
  it('vice_principal → 403 SCHOOL_ADMIN_ROLE_DENIED (no manage_staff)', async () => {
    setCallerRole('vice_principal');
    const res = await staffGET(makeReq('/api/school-admin/staff', 'GET') as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('SCHOOL_ADMIN_ROLE_DENIED');
  });

  it('principal → PASSES the role gate (200, lists staff)', async () => {
    setCallerRole('principal');
    const res = await staffGET(makeReq('/api/school-admin/staff', 'GET') as never);
    // Principal holds manage_staff → reaches the handler body; the mocked
    // school_admins list resolves to an empty array → 200, not a 403 role denial.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
