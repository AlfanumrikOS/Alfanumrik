import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Track A.5 — GET /api/billing/coverage.
 *
 * Under test: src/app/api/billing/coverage/route.ts
 *
 * Contract pinned:
 *   1. AUTH (P9): authorizeRequest(request, 'payments.subscribe'); denial is
 *      returned verbatim and no resolution happens.
 *   2. TENANT/PII safety (P8/P13): the student is resolved STRICTLY from the
 *      caller's own auth userId (resolveEffectiveEntitlementForUser(auth.userId)).
 *      No studentId/schoolId from the request body or query is ever consulted.
 *   3. The response carries ONLY tiers/codes/booleans + the caller's own
 *      school_id — never names, emails, phones, or other-student data (P13).
 *   4. Covered vs not-covered payloads are shaped correctly.
 *   5. A non-student caller gets a safe free / no-coverage payload.
 */

const mockAuthorizeRequest = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
}));

const mockResolveForUser = vi.fn();
vi.mock('@alfanumrik/lib/entitlements/effective-plan', () => ({
  resolveEffectiveEntitlementForUser: (...a: unknown[]) => mockResolveForUser(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET } from '@/app/api/billing/coverage/route';

const USER = 'auth-user-1';

function allowed() {
  return { authorized: true, userId: USER, errorResponse: undefined };
}
function denied(status: number) {
  return {
    authorized: false,
    userId: null,
    errorResponse: new Response(JSON.stringify({ error: 'Access denied' }), { status }),
  };
}

// A request that tries to smuggle a foreign student/school in — the route must ignore it.
function req(): never {
  return {
    nextUrl: { searchParams: new URLSearchParams('studentId=victim&schoolId=other-school') },
    url: 'http://localhost/api/billing/coverage?studentId=victim&schoolId=other-school',
    headers: { get: () => null },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/billing/coverage — auth gate', () => {
  it('returns the authorize errorResponse (401) and never resolves coverage when denied', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(401));
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockResolveForUser).not.toHaveBeenCalled();
  });

  it('authorizes against the EXACT permission "payments.subscribe"', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    mockResolveForUser.mockResolvedValue(null);
    await GET(req());
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'payments.subscribe');
  });
});

describe('GET /api/billing/coverage — resolves CALLER\'s own student only', () => {
  it('resolves strictly from the caller auth userId, ignoring request studentId/schoolId', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    mockResolveForUser.mockResolvedValue({
      studentId: 'caller-student',
      entitlement: {
        effectivePlan: 'pro',
        source: 'school',
        schoolCoverage: { plan: 'pro', schoolId: 'caller-school' },
        canUpgrade: true,
      },
    });
    await GET(req());
    // The resolver was called with the CALLER's auth id — not "victim"/"other-school".
    expect(mockResolveForUser).toHaveBeenCalledTimes(1);
    expect(mockResolveForUser).toHaveBeenCalledWith(USER);
    const arg = String(mockResolveForUser.mock.calls[0][0]);
    expect(arg).not.toContain('victim');
    expect(arg).not.toContain('other-school');
  });
});

describe('GET /api/billing/coverage — covered payload', () => {
  it('reports covered_by_school + school_plan + can_upgrade when school-covered', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    mockResolveForUser.mockResolvedValue({
      studentId: 'caller-student',
      entitlement: {
        effectivePlan: 'pro',
        source: 'school',
        schoolCoverage: { plan: 'pro', schoolId: 'caller-school' },
        personalPlan: undefined,
        canUpgrade: true,
      },
    });
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      covered_by_school: true,
      school_plan: 'pro',
      effective_plan: 'pro',
      source: 'school',
      personal_plan: null,
      can_upgrade: true,
    });
  });

  it('reports NOT covered for a B2C-only student (no schoolCoverage)', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    mockResolveForUser.mockResolvedValue({
      studentId: 'caller-student',
      entitlement: {
        effectivePlan: 'starter',
        source: 'personal',
        personalPlan: 'starter',
        canUpgrade: true,
      },
    });
    const res = await GET(req());
    const body = await res.json();
    expect(body.data.covered_by_school).toBe(false);
    expect(body.data.school_plan).toBeNull();
    expect(body.data.source).toBe('personal');
    expect(body.data.personal_plan).toBe('starter');
  });

  it('non-student caller (resolver null) → safe free / no-coverage payload', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    mockResolveForUser.mockResolvedValue(null);
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      covered_by_school: false,
      school_plan: null,
      effective_plan: 'free',
      source: 'free',
      personal_plan: null,
      can_upgrade: true,
    });
  });
});

describe('GET /api/billing/coverage — P13 PII-free', () => {
  it('serializes ONLY tiers/codes/booleans + own school_id — no PII keys', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    // The resolver result intentionally carries no PII; assert the SERIALIZED
    // response surface contains none of the redacted keys and no free-text PII.
    mockResolveForUser.mockResolvedValue({
      studentId: 'caller-student',
      entitlement: {
        effectivePlan: 'unlimited',
        source: 'school',
        schoolCoverage: { plan: 'unlimited', schoolId: 'caller-school' },
        personalPlan: 'pro',
        canUpgrade: false,
      },
    });
    const res = await GET(req());
    const raw = JSON.stringify(await res.json());
    for (const piiKey of ['email', 'phone', 'name', 'password', 'token', 'student_id', 'auth_user']) {
      expect(raw.toLowerCase()).not.toContain(piiKey);
    }
    // No @-shaped email and no caller-student id leaked.
    expect(raw).not.toMatch(/@/);
    expect(raw).not.toContain('caller-student');
  });
});
