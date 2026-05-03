/**
 * Goal Profile Preview API tests (Phase 0 of Goal-Adaptive Learning Layers).
 *
 * Pins the contract for `src/app/api/super-admin/goal-profiles/route.ts`:
 *   - Auth gate: super_admin.access — denied → 401 / 403, no body work.
 *   - 200 happy path returns { success, data: { flagEnabled, profiles } }
 *     with all 6 profiles in deterministic display order.
 *   - flagEnabled mirrors the isFeatureEnabled('ff_goal_profiles') eval.
 *
 * Mocking style mirrors `src/__tests__/api/super-admin/oracle-health.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────

const mockAuthorizeRequest = vi.fn();
const mockIsFeatureEnabled = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

// ─── Auth helpers ─────────────────────────────────────────────────────

const AUTH_OK = {
  authorized: true as const,
  userId: '11111111-1111-1111-1111-111111111111',
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED_401 = () => ({
  authorized: false as const,
  userId: null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
});

const AUTH_DENIED_403 = () => ({
  authorized: false as const,
  userId: '22222222-2222-2222-2222-222222222222',
  studentId: null,
  roles: ['student'],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  }),
});

function buildRequest(): Request {
  return new Request('http://localhost/api/super-admin/goal-profiles', {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible default — flag off, matching the seeded staging/prod state.
  mockIsFeatureEnabled.mockResolvedValue(false);
});

// ─── Auth gate ────────────────────────────────────────────────────────

describe('GET /api/super-admin/goal-profiles: auth', () => {
  it('returns 401 when no session (auth denies with 401)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_401());
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated but not super-admin', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_403());
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(403);
  });

  it('checks the super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    await GET(buildRequest() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(
      expect.anything(),
      'super_admin.access',
    );
  });

  it('does NOT call isFeatureEnabled when auth fails (no extra DB work)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_401());
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    await GET(buildRequest() as never);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });
});

// ─── Response shape ───────────────────────────────────────────────────

describe('GET /api/super-admin/goal-profiles: response shape', () => {
  it('200 with success=true, flagEnabled, and 6 profiles', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeTruthy();
    expect(typeof body.data.flagEnabled).toBe('boolean');
    expect(Array.isArray(body.data.profiles)).toBe(true);
    expect(body.data.profiles).toHaveLength(6);
  });

  it('returns profiles in deterministic display order', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    const codes = body.data.profiles.map((p: { code: string }) => p.code);
    expect(codes).toEqual([
      'improve_basics',
      'pass_comfortably',
      'school_topper',
      'board_topper',
      'competitive_exam',
      'olympiad',
    ]);
  });

  it('each profile has the expected stable shape', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    for (const p of body.data.profiles) {
      expect(p).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          labelEn: expect.any(String),
          labelHi: expect.any(String),
          difficultyMix: expect.objectContaining({
            easy: expect.any(Number),
            medium: expect.any(Number),
            hard: expect.any(Number),
          }),
          bloomBand: expect.objectContaining({
            min: expect.any(Number),
            max: expect.any(Number),
          }),
          sourcePriority: expect.any(Array),
          masteryThreshold: expect.any(Number),
          dailyTargetMinutes: expect.any(Number),
          pacePolicy: expect.any(String),
          scorecardTone: expect.any(String),
          dashboardCalloutEn: expect.any(String),
          dashboardCalloutHi: expect.any(String),
        }),
      );
      // difficultyMix sums to ~1.0 (within ±1e-9)
      const sum = p.difficultyMix.easy + p.difficultyMix.medium + p.difficultyMix.hard;
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    }
  });

  it('flagEnabled mirrors isFeatureEnabled when flag is OFF', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.flagEnabled).toBe(false);
  });

  it('flagEnabled mirrors isFeatureEnabled when flag is ON', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.flagEnabled).toBe(true);
  });

  it('passes the correct flag name to isFeatureEnabled', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    await GET(buildRequest() as never);
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(
      'ff_goal_profiles',
      expect.objectContaining({ role: 'super_admin' }),
    );
  });

  it('sets a Cache-Control s-maxage header (table is in-code)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    const cc = res.headers.get('Cache-Control');
    expect(cc).toBeTruthy();
    expect(cc).toMatch(/s-maxage=/);
  });
});

// ─── Error handling ───────────────────────────────────────────────────

describe('GET /api/super-admin/goal-profiles: errors', () => {
  it('500 when isFeatureEnabled throws', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    mockIsFeatureEnabled.mockRejectedValueOnce(new Error('flag store down'));
    const { GET } = await import(
      '@/app/api/super-admin/goal-profiles/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/flag store down/);
  });
});
