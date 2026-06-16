/**
 * Phase 3B Wave B — route unit tests (mocked, NO DB) for the three seat-enforced
 * provisioning routes:
 *   - POST/PATCH /api/school-admin/students  (single + bulk + deactivate)
 *   - POST       /api/schools/enroll         (bulk import → class_enrollments)
 *   - POST       /api/school-admin/invite-codes (seat-bounded issuance)
 *
 * Strategy (mirrors the Wave A command-center-routes.test.ts seam discipline):
 *   - The seat-enforcement HELPER module (`@/lib/school-admin/seat-enforcement`)
 *     is mocked so each test controls `isSeatEnforcementEnabled`,
 *     `enrollWithSeatCheck`, `previewSeatPolicy`, etc. and asserts the ROUTE's
 *     branching + response shape.
 *   - The auth seam (`authorizeSchoolAdmin` / `authorizeRequest`) is stubbed
 *     authorized.
 *   - The supabase-admin client is a controllable chainable stub.
 *   - posthog + audit + logger are no-op mocks.
 *
 * Two big themes:
 *   (1) FLAG ON — block→409, grace_warn soft-allow + warning + flagGraceWarn called,
 *       bulk capacity-split, deactivation→refreshSeatUsage, enroll capacity-trim
 *       BEFORE student creation (no orphans), atomic section commit, P3B01→409,
 *       invite max_uses_capped_to_seats + 409 when exhausted.
 *   (2) FLAG OFF — the enforcement helpers are NEVER called and the legacy
 *       response shape/status is returned unchanged (byte-identical). [in the
 *       sibling seat-enforcement-flag-off.test.ts file]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Seat-enforcement helper mock (the seam the routes branch on). ────────────
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
    ...actual, // keep seatCapViolationResponse REAL so the 409 body is genuine
    isSeatEnforcementEnabled: (...a: unknown[]) => seat.isSeatEnforcementEnabled(...a),
    enrollWithSeatCheck: (...a: unknown[]) => seat.enrollWithSeatCheck(...a),
    enrollSectionWithSeatCheck: (...a: unknown[]) => seat.enrollSectionWithSeatCheck(...a),
    previewSeatPolicy: (...a: unknown[]) => seat.previewSeatPolicy(...a),
    remainingCapacity: (...a: unknown[]) => seat.remainingCapacity(...a),
    refreshSeatUsage: (...a: unknown[]) => seat.refreshSeatUsage(...a),
    flagGraceWarn: (...a: unknown[]) => seat.flagGraceWarn(...a),
  };
});

// ── Auth seams. ──────────────────────────────────────────────────────────────
const SCHOOL = '11111111-1111-1111-1111-111111111111';
vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: vi.fn(async () => ({
    authorized: true,
    userId: 'admin-1',
    schoolId: SCHOOL,
    schoolAdminId: 'sa-1',
  })),
}));
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({ authorized: true, userId: 'admin-1' })),
  logAudit: vi.fn(),
}));

// ── Quiet no-op infra mocks. ──────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ logSchoolAudit: vi.fn() }));
vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn() }));
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: vi.fn(async () => undefined),
  pickLocaleFromAcceptLanguage: () => 'en',
  truncateInviteCode: (c: string) => c.slice(0, 4),
}));

// ── Controllable supabase-admin chainable stub. ──────────────────────────────
const dbState = vi.hoisted(() => ({
  // queued responses keyed by a label the test sets via `handlers`
  handlers: {} as Record<string, () => Promise<{ data: unknown; error: unknown }>>,
  authCreateUser: vi.fn(),
  inserted: { class_students: [] as unknown[], class_enrollments: [] as unknown[] },
}));

function makeDb() {
  // A generic chainable query builder. Terminal resolvers (`maybeSingle`,
  // `single`, `then`-less) resolve from `dbState.handlers[table:op]` if present,
  // else a benign default. We keep it intentionally permissive — the tests assert
  // on the ROUTE decisions (status, helper calls), not on every query.
  function builder(table: string) {
    const ctx: { table: string; op: string } = { table, op: 'select' };
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.select = vi.fn(ret);
    chain.eq = vi.fn(ret);
    chain.in = vi.fn(ret);
    chain.ilike = vi.fn(ret);
    chain.order = vi.fn(ret);
    chain.range = vi.fn(ret);
    chain.limit = vi.fn(ret);
    chain.update = vi.fn(() => { ctx.op = 'update'; return chain; });
    chain.insert = vi.fn((row: unknown) => {
      ctx.op = 'insert';
      if (table === 'class_students') dbState.inserted.class_students.push(row);
      if (table === 'class_enrollments') dbState.inserted.class_enrollments.push(row);
      return chain;
    });
    chain.upsert = vi.fn((row: unknown) => {
      if (table === 'class_enrollments') dbState.inserted.class_enrollments.push(row);
      return chain;
    });
    const resolve = (term: string) => {
      // Resolution precedence: table:terminal (e.g. students:single) >
      // table:op (e.g. students:update) > table. Lets a test return a different
      // row for a `.single()` lookup vs a `.maybeSingle()` existence check on the
      // same table (the enroll route does both against `students`).
      const h =
        dbState.handlers[`${table}:${term}`] ??
        dbState.handlers[`${table}:${ctx.op}`] ??
        dbState.handlers[table];
      if (h) return h();
      return Promise.resolve({ data: null, error: null, count: 0 });
    };
    chain.maybeSingle = vi.fn(() => resolve('maybeSingle'));
    chain.single = vi.fn(() => resolve('single'));
    // some calls await the chain directly (no terminal) — make it thenable.
    (chain as { then: unknown }).then = (onF: (v: unknown) => unknown) => resolve(ctx.op).then(onF);
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
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function verdict(over: Partial<import('@/lib/school-admin/seat-enforcement').SeatVerdict> = {}) {
  return {
    allowed: true,
    status: 'within_plan' as const,
    seats_purchased: 10,
    grace_ceiling: 11,
    current_active: 5,
    projected: 6,
    grace_started_at: null,
    grace_expires_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.handlers = {};
  dbState.authCreateUser.mockReset();
  dbState.inserted.class_students = [];
  dbState.inserted.class_enrollments = [];
  // default: enforcement ON for this file (flag-off lives in the sibling file)
  seat.isSeatEnforcementEnabled.mockResolvedValue(true);
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/school-admin/students — single create (ENFORCED)
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/school-admin/students — single (enforcement ON)', () => {
  function primeStudentCreate() {
    // createOneStudent: email-exists check (none) → createUser ok → students.update→id
    dbState.handlers['students:select'] = () => Promise.resolve({ data: null, error: null }); // no existing email
    dbState.authCreateUser.mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null });
    dbState.handlers['students:update'] = () => Promise.resolve({ data: { id: 'stu-new' }, error: null });
    dbState.handlers['classes'] = () => Promise.resolve({ data: { id: 'c1', school_id: SCHOOL }, error: null });
  }

  it('returns a SINGLE 409 seat_cap_violation when the atomic enroll is blocked', async () => {
    primeStudentCreate();
    seat.enrollWithSeatCheck.mockResolvedValue({
      kind: 'blocked',
      verdict: verdict({ allowed: false, status: 'over_ceiling', projected: 12, current_active: 11 }),
      status: 'over_ceiling',
    });

    const res = await STUDENTS_POST(
      jsonReq('/api/school-admin/students', {
        name: 'Asha', email: 'asha@x.test', grade: '8', class_id: 'c1',
      }) as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('seat_cap_violation');
    expect(body.status).toBe('over_ceiling');
  });

  it('grace_warn soft-allows (201), returns a warning field, and calls flagGraceWarn', async () => {
    primeStudentCreate();
    const v = verdict({ status: 'grace_warn', current_active: 11, grace_ceiling: 11, grace_expires_at: '2026-06-22T00:00:00.000Z' });
    seat.enrollWithSeatCheck.mockResolvedValue({ kind: 'allowed', enrolled: 1, requested: 1, verdict: v, usage: {} });

    const res = await STUDENTS_POST(
      jsonReq('/api/school-admin/students', {
        name: 'Asha', email: 'asha@x.test', grade: '8', class_id: 'c1',
      }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.warning?.status).toBe('grace_warn');
    expect(body.warning?.grace_expires_at).toBe('2026-06-22T00:00:00.000Z');
    expect(seat.flagGraceWarn).toHaveBeenCalledTimes(1);
  });

  it('within_plan create succeeds (201) and does NOT flag grace', async () => {
    primeStudentCreate();
    seat.enrollWithSeatCheck.mockResolvedValue({
      kind: 'allowed', enrolled: 1, requested: 1, verdict: verdict({ status: 'within_plan' }), usage: {},
    });
    const res = await STUDENTS_POST(
      jsonReq('/api/school-admin/students', {
        name: 'Asha', email: 'asha@x.test', grade: '8', class_id: 'c1',
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(seat.flagGraceWarn).not.toHaveBeenCalled();
  });

  it('maps an enroll RPC error (not a block) to 503 retryable', async () => {
    primeStudentCreate();
    seat.enrollWithSeatCheck.mockResolvedValue({ kind: 'error', message: 'rpc down' });
    const res = await STUDENTS_POST(
      jsonReq('/api/school-admin/students', {
        name: 'Asha', email: 'asha@x.test', grade: '8', class_id: 'c1',
      }) as never,
    );
    expect(res.status).toBe(503);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/school-admin/students — deactivation triggers refreshSeatUsage
// ═════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/school-admin/students — deactivation refresh (enforcement ON)', () => {
  it('calls refreshSeatUsage when a student is deactivated', async () => {
    dbState.handlers['students:select'] = () => Promise.resolve({ data: { id: 'stu-1', is_active: true }, error: null });
    dbState.handlers['students:update'] = () => Promise.resolve({ data: { id: 'stu-1', is_active: false }, error: null });

    const res = await STUDENTS_PATCH(
      jsonReq('/api/school-admin/students', { id: 'stu-1', is_active: false }, 'PATCH') as never,
    );
    expect(res.status).toBe(200);
    expect(seat.refreshSeatUsage).toHaveBeenCalledWith(SCHOOL);
  });

  it('does NOT call refreshSeatUsage on an activation (only deactivation frees a seat)', async () => {
    dbState.handlers['students:select'] = () => Promise.resolve({ data: { id: 'stu-1', is_active: false }, error: null });
    dbState.handlers['students:update'] = () => Promise.resolve({ data: { id: 'stu-1', is_active: true }, error: null });

    await STUDENTS_PATCH(
      jsonReq('/api/school-admin/students', { id: 'stu-1', is_active: true }, 'PATCH') as never,
    );
    expect(seat.refreshSeatUsage).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/school-admin/students?bulk=true — capacity split per-row report
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/school-admin/students (bulk, enforcement ON) — capacity split', () => {
  it('accepts up to remaining capacity, rejects overflow rows with seat_limit_reached', async () => {
    // 5 valid rows, remaining capacity = 3 ⇒ 3 accepted, 2 rejected seat_limit_reached.
    seat.previewSeatPolicy.mockResolvedValue({
      ok: true,
      verdict: verdict({ seats_purchased: 10, grace_ceiling: 11, current_active: 8 }), // remaining = 11-8 = 3
    });
    // every create succeeds: no existing email, createUser ok, update→id
    dbState.handlers['students:select'] = () => Promise.resolve({ data: null, error: null });
    dbState.authCreateUser.mockResolvedValue({ data: { user: { id: 'auth-x' } }, error: null });
    dbState.handlers['students:update'] = () => Promise.resolve({ data: { id: 'stu-x' }, error: null });

    const rows = [1, 2, 3, 4, 5].map((n) => ({ name: `Kid${n}`, email: `k${n}@x.test`, grade: '8' }));
    const res = await STUDENTS_POST(
      jsonReq('/api/school-admin/students?bulk=true', { rows }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.created).toBe(3);
    const seatRejections = (body.data.rejected as Array<{ message: string }>).filter(
      (e) => e.message === 'seat_limit_reached',
    );
    expect(seatRejections.length).toBe(2);
  });

  it('returns 503 when the capacity preview fails', async () => {
    seat.previewSeatPolicy.mockResolvedValue({ ok: false });
    const rows = [{ name: 'Kid', email: 'k@x.test', grade: '8' }];
    const res = await STUDENTS_POST(jsonReq('/api/school-admin/students?bulk=true', { rows }) as never);
    expect(res.status).toBe(503);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/schools/enroll — capacity trim BEFORE create, atomic commit, P3B01
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/schools/enroll (enforcement ON)', () => {
  function primeEnrollCreate() {
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: { school_id: SCHOOL }, error: null });
    dbState.handlers['students:select'] = () => Promise.resolve({ data: null, error: null }); // no existing
    dbState.handlers['students:insert'] = () => Promise.resolve({ data: null, error: null });
    dbState.handlers['students:single'] = () => Promise.resolve({ data: { id: 'stu-e' }, error: null });
    dbState.handlers['classes'] = () => Promise.resolve({ data: { id: 'cls-e' }, error: null });
  }

  it('trims overflow BEFORE creating students (no orphans) — overflow reported as seat_limit_reached', async () => {
    primeEnrollCreate();
    // remaining capacity = 2; submit 4 valid ⇒ 2 created, 2 trimmed (never inserted).
    seat.previewSeatPolicy.mockResolvedValue({
      ok: true,
      verdict: verdict({ seats_purchased: 10, grace_ceiling: 11, current_active: 9 }), // remaining = 2
    });
    seat.enrollSectionWithSeatCheck.mockResolvedValue({
      kind: 'allowed', enrolled: 0, requested: 0, verdict: verdict(), usage: {},
    });

    const students = [1, 2, 3, 4].map((n) => ({ name: `E${n}`, email: `e${n}@x.test`, grade: '8' }));
    const res = await ENROLL_POST(jsonReq('/api/schools/enroll', { school_id: SCHOOL, students }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success_count).toBe(2);
    const seatRejections = (body.data.rejected as Array<{ reason: string }>).filter(
      (e) => e.reason === 'seat_limit_reached',
    );
    expect(seatRejections.length).toBe(2);
    // Preview ran before the create loop; capacity-trim happened up front.
    expect(seat.previewSeatPolicy).toHaveBeenCalled();
  });

  it('maps a P3B01 block from the atomic section commit to 409 seat_cap_violation', async () => {
    primeEnrollCreate();
    seat.previewSeatPolicy.mockResolvedValue({
      ok: true,
      verdict: verdict({ current_active: 5, grace_ceiling: 11 }),
    });
    seat.enrollSectionWithSeatCheck.mockResolvedValue({
      kind: 'blocked',
      verdict: verdict({ allowed: false, status: 'over_ceiling', projected: 12 }),
      status: 'over_ceiling',
    });

    // a section-placed student so sectionPairs is non-empty
    const students = [{ name: 'E1', email: 'e1@x.test', grade: '8', section: 'A' }];
    const res = await ENROLL_POST(jsonReq('/api/schools/enroll', { school_id: SCHOOL, students }) as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('seat_cap_violation');
  });

  it('returns 503 when the upfront preview fails', async () => {
    primeEnrollCreate();
    seat.previewSeatPolicy.mockResolvedValue({ ok: false });
    const students = [{ name: 'E1', email: 'e1@x.test', grade: '8' }];
    const res = await ENROLL_POST(jsonReq('/api/schools/enroll', { school_id: SCHOOL, students }) as never);
    expect(res.status).toBe(503);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/school-admin/invite-codes — seat-bounded issuance
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/school-admin/invite-codes (enforcement ON)', () => {
  function primeInvite() {
    dbState.handlers['schools'] = () => Promise.resolve({ data: { slug: 'dps', name: 'DPS' }, error: null });
    dbState.handlers['school_invite_codes:insert'] = () =>
      Promise.resolve({ data: { id: 'inv-1', code: 'DPS-ABC123', role_type: 'student', max_uses: 3, used_count: 0, is_active: true }, error: null });
  }

  it('caps max_uses to remaining seats and returns max_uses_capped_to_seats + remaining_seats', async () => {
    primeInvite();
    seat.remainingCapacity.mockResolvedValue(3); // remaining = 3, requested 50 → capped to 3
    const res = await INVITE_POST(
      jsonReq('/api/school-admin/invite-codes', { role: 'student', max_uses: 50 }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.max_uses_capped_to_seats).toBe(3);
    expect(body.data.remaining_seats).toBe(3);
  });

  it('returns 409 seat_cap_violation when capacity is exhausted (remaining = 0)', async () => {
    primeInvite();
    seat.remainingCapacity.mockResolvedValue(0);
    const res = await INVITE_POST(
      jsonReq('/api/school-admin/invite-codes', { role: 'student', max_uses: 50 }) as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('seat_cap_violation');
    expect(body.status).toBe('over_ceiling');
  });

  it('returns 503 when the seat check is unavailable (remaining = null)', async () => {
    primeInvite();
    seat.remainingCapacity.mockResolvedValue(null);
    const res = await INVITE_POST(
      jsonReq('/api/school-admin/invite-codes', { role: 'student', max_uses: 50 }) as never,
    );
    expect(res.status).toBe(503);
  });

  it('does NOT seat-bound a TEACHER invite (teachers are not seats)', async () => {
    primeInvite();
    dbState.handlers['school_invite_codes:insert'] = () =>
      Promise.resolve({ data: { id: 'inv-2', code: 'DPS-XYZ', role_type: 'teacher', max_uses: 1, used_count: 0, is_active: true }, error: null });
    const res = await INVITE_POST(
      jsonReq('/api/school-admin/invite-codes', { role: 'teacher' }) as never,
    );
    expect(res.status).toBe(201);
    expect(seat.remainingCapacity).not.toHaveBeenCalled();
  });
});
