/**
 * /api/super-admin/adaptive-loops — dashboard backing reader (Master Action
 * Plan Phase 8, item 8.1).
 *
 * Pins:
 *   - Auth gate: super_admin.access — denied (401/403) short-circuits BEFORE
 *     any RPC call; the route returns the authorizer's errorResponse verbatim.
 *   - 200 happy path returns { success, data } passing the aggregate-only RPC
 *     snapshot through verbatim.
 *   - The response payload is AGGREGATE-ONLY (P13): no student id / PII-shaped
 *     keys, because the SECURITY DEFINER RPC returns counts/ratios only and the
 *     route adds nothing per-student.
 *   - RPC error → 500 { success: false }.
 *
 * Mocking style mirrors src/__tests__/api/super-admin/goal-profiles.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────

const mockAuthorizeRequest = vi.fn();
const rpcMock = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpcMock(...a) },
  getSupabaseAdmin: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

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

const HEALTH_FIXTURE = {
  window_hours: 24,
  storm_days: 30,
  daily_new_by_signal: {
    mastery_cliff: 5,
    inactivity: 2,
    at_risk_concentration: 1,
    blocked_prerequisite: 0,
  },
  daily_new_total: 8,
  ceiling_violation_count: 0,
  ceiling_violation_students: 0,
  terminal_total: 40,
  escalation_total: 8,
  escalation_share: 0.2,
  last_success_at: '2026-07-22T02:31:00.000Z',
  hours_since_last_success: 2,
  generated_at: '2026-07-22T04:35:00.000Z',
};

function buildRequest(): Request {
  return new Request('http://localhost/api/super-admin/adaptive-loops', { method: 'GET' });
}

async function loadRoute() {
  return import('@/app/api/super-admin/adaptive-loops/route');
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: HEALTH_FIXTURE, error: null });
});

// ════════════════════════════════════════════════════════════════════════════
// Auth gate
// ════════════════════════════════════════════════════════════════════════════

describe('super-admin/adaptive-loops — auth gate', () => {
  it('denied 401 → returns 401 and never touches the RPC', async () => {
    mockAuthorizeRequest.mockResolvedValue(AUTH_DENIED_401());
    const { GET } = await loadRoute();
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('denied 403 → returns 403 and never touches the RPC', async () => {
    mockAuthorizeRequest.mockResolvedValue(AUTH_DENIED_403());
    const { GET } = await loadRoute();
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('authorizes against the super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValue(AUTH_OK);
    const { GET } = await loadRoute();
    await GET(buildRequest() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Happy path + aggregate-only output
// ════════════════════════════════════════════════════════════════════════════

describe('super-admin/adaptive-loops — output', () => {
  beforeEach(() => mockAuthorizeRequest.mockResolvedValue(AUTH_OK));

  it('200 → { success, data } with the aggregate snapshot passed through', async () => {
    const { GET } = await loadRoute();
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(HEALTH_FIXTURE);
    expect(rpcMock).toHaveBeenCalledWith('get_adaptive_loops_health', {
      p_window_hours: 24,
      p_storm_days: 30,
    });
  });

  it('payload is aggregate-only (P13): no student id / PII-shaped keys', async () => {
    const { GET } = await loadRoute();
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/student_id|auth_user_id|email|phone|"name"/i);
    // Only aggregate fields are present on data.
    expect(Object.keys(body.data).sort()).toEqual(
      [
        'ceiling_violation_count',
        'ceiling_violation_students',
        'daily_new_by_signal',
        'daily_new_total',
        'escalation_share',
        'escalation_total',
        'generated_at',
        'hours_since_last_success',
        'last_success_at',
        'storm_days',
        'terminal_total',
        'window_hours',
      ].sort(),
    );
  });

  it('RPC error → 500 { success: false }', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { GET } = await loadRoute();
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
