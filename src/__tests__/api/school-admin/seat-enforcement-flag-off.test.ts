/**
 * Phase 3B Wave B — FLAG-OFF byte-identical guarantee for the seat-enforced
 * provisioning routes. The contract: with `ff_school_provisioning` OFF, the
 * enforcement helpers (enrollWithSeatCheck / enrollSectionWithSeatCheck /
 * previewSeatPolicy / remainingCapacity / refreshSeatUsage / flagGraceWarn) are
 * NEVER called, and each route returns its LEGACY response shape/status
 * unchanged.
 *
 * `isSeatEnforcementEnabled` is the single gate every route branches on. Pinning
 * "OFF ⇒ none of the enforcement helpers run + legacy status" is the cheapest,
 * most robust proof of byte-identity (mirrors the Wave A flag-gate test which
 * pins the one boolean every consumer branches on).
 *
 * The legacy seat-cap pre-checks (which read students/school_subscriptions
 * directly) still run on the OFF path; we drive them to their legacy
 * status codes (409 for the over-cap pre-check on the students/bulk path, 403 on
 * /api/schools/enroll) and assert the NEW enforcement RPC helpers were not used.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const seat = vi.hoisted(() => ({
  isSeatEnforcementEnabled: vi.fn(),
  enrollWithSeatCheck: vi.fn(),
  enrollSectionWithSeatCheck: vi.fn(),
  previewSeatPolicy: vi.fn(),
  remainingCapacity: vi.fn(),
  refreshSeatUsage: vi.fn(),
  flagGraceWarn: vi.fn(),
}));

vi.mock('@/lib/school-admin/seat-enforcement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/school-admin/seat-enforcement')>();
  return {
    ...actual,
    isSeatEnforcementEnabled: (...a: unknown[]) => seat.isSeatEnforcementEnabled(...a),
    enrollWithSeatCheck: (...a: unknown[]) => seat.enrollWithSeatCheck(...a),
    enrollSectionWithSeatCheck: (...a: unknown[]) => seat.enrollSectionWithSeatCheck(...a),
    previewSeatPolicy: (...a: unknown[]) => seat.previewSeatPolicy(...a),
    remainingCapacity: (...a: unknown[]) => seat.remainingCapacity(...a),
    refreshSeatUsage: (...a: unknown[]) => seat.refreshSeatUsage(...a),
    flagGraceWarn: (...a: unknown[]) => seat.flagGraceWarn(...a),
  };
});

const SCHOOL = '11111111-1111-1111-1111-111111111111';
vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: vi.fn(async () => ({
    authorized: true, userId: 'admin-1', schoolId: SCHOOL, schoolAdminId: 'sa-1',
  })),
}));
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({ authorized: true, userId: 'admin-1' })),
  logAudit: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ logSchoolAudit: vi.fn() }));
vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn() }));
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: vi.fn(async () => undefined),
  pickLocaleFromAcceptLanguage: () => 'en',
  truncateInviteCode: (c: string) => c.slice(0, 4),
}));

const dbState = vi.hoisted(() => ({
  handlers: {} as Record<string, () => Promise<{ data: unknown; error: unknown; count?: number }>>,
  authCreateUser: vi.fn(),
}));

function makeDb() {
  function builder(table: string) {
    const ctx = { op: 'select' };
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.select = vi.fn((_c?: unknown, opts?: { head?: boolean }) => { void opts; return chain; });
    chain.eq = vi.fn(ret);
    chain.in = vi.fn(ret);
    chain.ilike = vi.fn(ret);
    chain.order = vi.fn(ret);
    chain.range = vi.fn(ret);
    chain.limit = vi.fn(ret);
    chain.update = vi.fn(() => { ctx.op = 'update'; return chain; });
    chain.insert = vi.fn(() => { ctx.op = 'insert'; return chain; });
    chain.upsert = vi.fn(ret);
    const resolve = () => {
      const h = dbState.handlers[`${table}:${ctx.op}`] ?? dbState.handlers[table];
      return h ? h() : Promise.resolve({ data: null, error: null, count: 0 });
    };
    chain.maybeSingle = vi.fn(resolve);
    chain.single = vi.fn(resolve);
    (chain as { then: unknown }).then = (onF: (v: unknown) => unknown) => resolve().then(onF);
    return chain;
  }
  return {
    from: vi.fn((t: string) => builder(t)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: { admin: { createUser: dbState.authCreateUser } },
  };
}

vi.mock('@/lib/supabase-admin', () => {
  const db = makeDb();
  return { getSupabaseAdmin: () => db, supabaseAdmin: db };
});

import { POST as STUDENTS_POST, PATCH as STUDENTS_PATCH } from '@/app/api/school-admin/students/route';
import { POST as ENROLL_POST } from '@/app/api/schools/enroll/route';
import { POST as INVITE_POST } from '@/app/api/school-admin/invite-codes/route';

function jsonReq(url: string, body: unknown, method = 'POST'): Request {
  return new Request(`http://localhost${url}`, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

/** Assert NONE of the enforcement helpers ran. */
function expectNoEnforcement() {
  expect(seat.enrollWithSeatCheck).not.toHaveBeenCalled();
  expect(seat.enrollSectionWithSeatCheck).not.toHaveBeenCalled();
  expect(seat.previewSeatPolicy).not.toHaveBeenCalled();
  expect(seat.remainingCapacity).not.toHaveBeenCalled();
  expect(seat.refreshSeatUsage).not.toHaveBeenCalled();
  expect(seat.flagGraceWarn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.handlers = {};
  dbState.authCreateUser.mockReset();
  // ── FLAG OFF for every test in this file. ──
  seat.isSeatEnforcementEnabled.mockResolvedValue(false);
});

// ═════════════════════════════════════════════════════════════════════════════
describe('FLAG OFF — POST /api/school-admin/students single (legacy path)', () => {
  it('creates via the legacy pre-check (201) and never calls the enforcement helpers', async () => {
    // legacy readSeatStatus: active count + no subscription ⇒ uncapped ⇒ create.
    dbState.handlers['students:select'] = () => Promise.resolve({ data: null, error: null, count: 0 });
    dbState.handlers['school_subscriptions'] = () => Promise.resolve({ data: null, error: null });
    dbState.authCreateUser.mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null });
    dbState.handlers['students:update'] = () => Promise.resolve({ data: { id: 'stu-1' }, error: null });

    const res = await STUDENTS_POST(
      jsonReq('/api/school-admin/students', { name: 'Asha', email: 'asha@x.test', grade: '8' }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.student_id).toBe('stu-1');
    expectNoEnforcement();
  });

  it('legacy over-cap pre-check returns the unchanged 409 seat_cap_violation shape', async () => {
    // legacy: active count = 50, seats_purchased = 50 ⇒ +1 > 50 ⇒ 409 with code field.
    dbState.handlers['students:select'] = () => Promise.resolve({ data: null, error: null, count: 50 });
    dbState.handlers['school_subscriptions'] = () => Promise.resolve({ data: { seats_purchased: 50 }, error: null });

    const res = await STUDENTS_POST(
      jsonReq('/api/school-admin/students', { name: 'Asha', email: 'asha@x.test', grade: '8' }) as never,
    );
    expect(res.status).toBe(409); // legacy single-create status
    const body = await res.json();
    expect(body.code).toBe('seat_cap_violation'); // legacy used `code`, not `error`
    expect(body.seats_used).toBe(50);
    expect(body.seats_purchased).toBe(50);
    expectNoEnforcement();
  });
});

describe('FLAG OFF — PATCH /api/school-admin/students deactivate', () => {
  it('deactivates (200) WITHOUT calling refreshSeatUsage', async () => {
    dbState.handlers['students:select'] = () => Promise.resolve({ data: { id: 'stu-1', is_active: true }, error: null });
    dbState.handlers['students:update'] = () => Promise.resolve({ data: { id: 'stu-1', is_active: false }, error: null });

    const res = await STUDENTS_PATCH(
      jsonReq('/api/school-admin/students', { id: 'stu-1', is_active: false }, 'PATCH') as never,
    );
    expect(res.status).toBe(200);
    expectNoEnforcement();
  });
});

describe('FLAG OFF — POST /api/schools/enroll (legacy path)', () => {
  it('legacy over-cap returns 403 (legacy status) and never calls enforcement helpers', async () => {
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: { school_id: SCHOOL }, error: null });
    // legacy: subscription active seats=10, currentStudents=10 ⇒ seatsRemaining=0 < 1 ⇒ 403
    dbState.handlers['school_subscriptions'] = () => Promise.resolve({ data: { seats_purchased: 10 }, error: null });
    dbState.handlers['students:select'] = () => Promise.resolve({ data: null, error: null, count: 10 });

    const students = [{ name: 'E1', email: 'e1@x.test', grade: '8' }];
    const res = await ENROLL_POST(jsonReq('/api/schools/enroll', { school_id: SCHOOL, students }) as never);
    expect(res.status).toBe(403); // legacy seat-limit status (NOT the new 409)
    expectNoEnforcement();
  });
});

describe('FLAG OFF — POST /api/school-admin/invite-codes (legacy path)', () => {
  it('issues a STUDENT code with the requested max_uses (no seat cap) — legacy 201 shape', async () => {
    dbState.handlers['schools'] = () => Promise.resolve({ data: { slug: 'dps', name: 'DPS' }, error: null });
    dbState.handlers['school_invite_codes:insert'] = () =>
      Promise.resolve({ data: { id: 'inv-1', code: 'DPS-ABC', role_type: 'student', max_uses: 50, used_count: 0, is_active: true }, error: null });

    const res = await INVITE_POST(
      jsonReq('/api/school-admin/invite-codes', { role: 'student', max_uses: 50 }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    // Legacy shape: the raw invite row, NO max_uses_capped_to_seats / remaining_seats.
    expect(body.data.max_uses).toBe(50);
    expect(body.data).not.toHaveProperty('max_uses_capped_to_seats');
    expect(body.data).not.toHaveProperty('remaining_seats');
    expectNoEnforcement();
  });
});
