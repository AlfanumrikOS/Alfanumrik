/**
 * Phase 3C Wave A / A2 — guarded-route integration: the module route guard is
 * applied to the school-admin exams route AFTER auth, and a disabled module
 * 404s while a flag-OFF / all-enabled tenant proceeds to the handler.
 *
 * We mock the three seams the route + guard depend on:
 *   - `@/lib/school-admin-auth`  → control whether auth passes (and the schoolId).
 *   - `@/lib/modules/route-guard`→ spy on `assertModuleEnabledForSchool` so we can
 *     assert (a) the route invokes it with the CORRECT module key, (b) it runs
 *     AFTER auth (never called when auth fails), and drive its allow/block result.
 *   - `@/lib/supabase-admin`     → a thin chainable stub so the happy path reaches
 *     the DB read without a real connection.
 *
 * The route's REAL branching runs: auth → gate → handler. We assert the ORDER
 * (auth first, gate second) and the disabled→404 / allowed→proceed outcomes.
 *
 * Exams maps to the `testing_engine` module (registry routePrefix `/quiz`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

// ── Auth seam. ───────────────────────────────────────────────────────────────
const auth = vi.hoisted(() => ({ authorizeSchoolAdmin: vi.fn() }));
vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => auth.authorizeSchoolAdmin(...a),
}));

// ── Guard seam — spied so we can assert call order + module key, drive result. ─
const guard = vi.hoisted(() => ({ assertModuleEnabledForSchool: vi.fn() }));
vi.mock('@/lib/modules/route-guard', () => ({
  assertModuleEnabledForSchool: (...a: unknown[]) => guard.assertModuleEnabledForSchool(...a),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/audit', () => ({ logSchoolAudit: vi.fn() }));

// ── Supabase-admin stub: a chainable builder whose terminal resolves to a
//    controllable result. The exams GET handler ends in `await query` (range),
//    so the chain must be thenable. ──
const db = vi.hoisted(() => ({ result: { data: [] as unknown[], error: null, count: 0 } }));
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  const ret = () => c;
  c.select = vi.fn(ret);
  c.eq = vi.fn(ret);
  c.in = vi.fn(ret);
  c.gt = vi.fn(ret);
  c.order = vi.fn(ret);
  c.range = vi.fn(ret);
  (c as { then: unknown }).then = (onF: (v: unknown) => unknown) => Promise.resolve(db.result).then(onF);
  return c;
}
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: () => chain() }),
}));

import { GET as RAW_GET } from '@/app/api/school-admin/exams/route';

// The route handler's inferred return type widens to `NextResponse | undefined`
// because the real `authorizeSchoolAdmin` result types `errorResponse` as
// optional. Every code path in the handler DOES return a NextResponse, so we pin
// the call to the non-undefined shape for the assertions below.
const GET = (req: NextRequest): Promise<NextResponse> =>
  RAW_GET(req) as Promise<NextResponse>;

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/exams', { method: 'GET' });
}

function authPass() {
  auth.authorizeSchoolAdmin.mockResolvedValue({
    authorized: true,
    schoolId: SCHOOL_ID,
    userId: 'admin-1',
  });
}

function authFail(status = 403) {
  auth.authorizeSchoolAdmin.mockResolvedValue({
    authorized: false,
    errorResponse: NextResponse.json({ success: false, error: 'forbidden' }, { status }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.result = { data: [], error: null, count: 0 };
  // Default: allowed gate. Each test overrides as needed.
  guard.assertModuleEnabledForSchool.mockResolvedValue({ allowed: true });
});

describe('GET /api/school-admin/exams — module gate runs AFTER auth', () => {
  it('auth failure short-circuits BEFORE the module gate (gate never invoked)', async () => {
    authFail(403);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect(guard.assertModuleEnabledForSchool).not.toHaveBeenCalled();
  });

  it('auth 401 also short-circuits before the gate', async () => {
    authFail(401);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(guard.assertModuleEnabledForSchool).not.toHaveBeenCalled();
  });

  it('on auth success, the gate is invoked with the resolved schoolId + the testing_engine module key', async () => {
    authPass();
    await GET(getReq());
    expect(guard.assertModuleEnabledForSchool).toHaveBeenCalledTimes(1);
    expect(guard.assertModuleEnabledForSchool).toHaveBeenCalledWith(SCHOOL_ID, 'testing_engine');
  });
});

describe('GET /api/school-admin/exams — disabled module → 404; allowed → handler proceeds', () => {
  it('a DISABLED module returns the gate 404 response and never reads the DB', async () => {
    authPass();
    guard.assertModuleEnabledForSchool.mockResolvedValueOnce({
      allowed: false,
      response: NextResponse.json(
        { success: false, error: 'This module is not enabled for your organization.', code: 'MODULE_DISABLED', module: 'testing_engine' },
        { status: 404 },
      ),
    });

    const res = await GET(getReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('MODULE_DISABLED');
    expect(body.module).toBe('testing_engine');
  });

  it('an ALLOWED gate (flag OFF / all-enabled / fail-open) → 200 and the handler returns the exam list', async () => {
    authPass();
    db.result = {
      data: [{ id: 'exam-1', title: 'Unit Test 1', status: 'draft' }],
      error: null,
      count: 1,
    };
    guard.assertModuleEnabledForSchool.mockResolvedValueOnce({ allowed: true });

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.exams).toHaveLength(1);
    expect(body.data.exams[0].id).toBe('exam-1');
  });
});
