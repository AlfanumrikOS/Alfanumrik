/**
 * P2-5 regression (2026-08-12 E2E run) — /api/school-admin/leadership must
 * authorize BEFORE the ff_school_pulse_v1 flag gate.
 *
 * Defect: the flag gate ran as step 0, before resolveCommandCenterContext, so
 * with the flag OFF (its seeded state) EVERY caller — no session, student
 * token, anyone — got `200 { success:true, data:null, gated:true }`. It was
 * the only route out of 240 in the unauthenticated sweep to answer 200 with a
 * role-gated shape: no data leaked (data:null), but the denial was invisible
 * to monitoring and the route's 401/403 path was dead code.
 *
 * Fixed order (matches siblings overview / classes-at-risk /
 * teacher-engagement):
 *   1. resolveCommandCenterContext — failure returns its 401/403 UNCHANGED.
 *   2. Flag gate — only an AUTHORIZED school admin gets the fail-soft
 *      `200 { gated:true }` contract (ops toggles the flag mid-flight;
 *      authorized callers must fail-soft render).
 *
 * Mock pattern mirrors command-center-routes.test.ts: only the resolution
 * seam + the flag reader are stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockResolve, mockIsFeatureEnabled, rpcSpy } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  rpcSpy: vi.fn(),
}));

vi.mock('@alfanumrik/lib/school-admin/command-center-context', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@alfanumrik/lib/school-admin/command-center-context')
  >();
  return {
    ...actual,
    resolveCommandCenterContext: (...args: unknown[]) => mockResolve(...args),
  };
});

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { NextResponse } from 'next/server';
import { GET } from '@/app/api/school-admin/leadership/route';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

/** Stub supabase for the authorized happy path: 3 RPCs + 2 view reads. */
function stubSupabase() {
  return {
    rpc: (...args: unknown[]) => {
      rpcSpy(...args);
      return Promise.resolve({ data: {}, error: null });
    },
    from: () => ({
      select: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  };
}

function resolvedOk() {
  mockResolve.mockResolvedValue({
    ok: true,
    ctx: { schoolId: SCHOOL_ID, userId: 'admin-1', supabase: stubSupabase() },
  });
}

function resolvedFail(status: number, body: Record<string, unknown> = { success: false }) {
  mockResolve.mockResolvedValue({
    ok: false,
    response: NextResponse.json(body, { status }),
  });
}

function req(): Request {
  return new Request('http://localhost/api/school-admin/leadership', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Seeded production state: flag OFF — the exact posture of the defect.
  mockIsFeatureEnabled.mockResolvedValue(false);
});

describe('GET /api/school-admin/leadership — auth before flag gate (P2-5)', () => {
  it('unauthenticated caller gets 401 — NOT 200 {gated:true} — even with the flag OFF', async () => {
    resolvedFail(401, { success: false, error: 'Authentication required' });

    const res = await GET(req() as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty('gated');
    // The flag gate must not even run for a denied caller.
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('unauthorized caller (e.g. student token) gets the resolver 403 unchanged with the flag OFF', async () => {
    resolvedFail(403, { success: false, error: 'Not an active school administrator' });

    const res = await GET(req() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty('gated');
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('authorized school admin + flag OFF keeps the fail-soft 200 {gated:true} contract with the private cache header', async () => {
    resolvedOk();
    mockIsFeatureEnabled.mockResolvedValue(false);

    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: null, gated: true });
    // Authorized-only now, so a private short-TTL cache stays appropriate.
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=30');
    // Gated → no read-model work is done.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('authorized school admin + flag ON proceeds to the read model (resolution ran first)', async () => {
    resolvedOk();
    mockIsFeatureEnabled.mockResolvedValue(true);

    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schoolId).toBe(SCHOOL_ID);
    expect(rpcSpy).toHaveBeenCalledWith('get_school_overview', { p_school_id: SCHOOL_ID });
    expect(rpcSpy).toHaveBeenCalledWith('get_school_safeguarding_counts', { p_school_id: SCHOOL_ID });
    expect(rpcSpy).toHaveBeenCalledWith('get_school_competency_summary', { p_school_id: SCHOOL_ID });
  });

  it('a flag-reader failure for an authorized caller fails soft to 200 {gated:true} (never 500s the dashboard)', async () => {
    resolvedOk();
    mockIsFeatureEnabled.mockRejectedValue(new Error('flag store down'));

    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: null, gated: true });
  });

  it('propagates the 400 multi-school {school_ids} hint unchanged before the flag gate', async () => {
    resolvedFail(400, {
      success: false,
      error: 'Multiple schools — specify ?school_id',
      school_ids: ['a', 'b'],
    });

    const res = await GET(req() as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.school_ids).toEqual(['a', 'b']);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });
});
