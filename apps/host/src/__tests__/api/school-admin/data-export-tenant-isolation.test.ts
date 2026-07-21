/**
 * POST /api/school-admin/data-export — tenant (cross-school) isolation (Task 3.4,
 * RCA promotion — .claude/regression/07-teacher-school.md).
 *
 * WHY THIS EXISTS
 *   `data-export` exports PER-STUDENT rows (names + grades + xp + scores — see
 *   the P13 posture header comment on the route itself, added under Task 3.3).
 *   The route never reads a school id from the request body — it ONLY uses
 *   `auth.schoolId` returned by `authorizeSchoolAdmin`, which resolves the
 *   caller's OWN school membership server-side. This test proves that boundary
 *   holds end-to-end at the route layer: seeding students from TWO schools and
 *   asserting a school-A admin's export contains ONLY school-A students, and
 *   that a client-supplied `school_id`/`schoolId` field in the request body
 *   (an injection attempt) is silently ignored rather than honored.
 *
 *   The underlying tenant-scoping primitive (`authorizeSchoolAdmin` rejecting a
 *   foreign/unrequested school membership) already has direct unit coverage in
 *   `school-admin-auth.test.ts` ("selects only a requested active membership and
 *   rejects a foreign school"). This test is the route-level extension the RCA
 *   flagged as missing: proving `data-export/route.ts` itself never leaks another
 *   school's rows even if the resolved `schoolId` were somehow attacker-influenced.
 *
 * Seams mocked: @alfanumrik/lib/school-admin-auth (authorizeSchoolAdmin — returns
 * a fixed schoolId, simulating the already-tested resolution), @alfanumrik/lib/supabase-admin
 * (a chainable stub whose `.eq()` ACTUALLY filters by column, unlike the no-op
 * passthrough used by the row-cap suite — the filtering has to be real here
 * because tenant isolation IS what's under test), @alfanumrik/lib/audit (no-op).
 *
 * REGRESSION CATALOG: REG-292 in .claude/regression/07-teacher-school.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHOOL_A = '11111111-1111-4111-a111-111111111111';
const SCHOOL_B = '22222222-2222-4222-a222-222222222222';

const holders = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => holders.authorizeSchoolAdmin(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/audit', () => ({
  logSchoolAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alfanumrik/lib/school-admin/permission-code', () => ({
  schoolAdminPermissionCode: vi.fn().mockResolvedValue('school.export_data'),
}));

// A chainable stub whose `.eq()` ACTUALLY filters the seeded rows by column value —
// this is what makes the tenant-isolation assertion meaningful (a no-op `.eq()`
// would make the test pass even if the route forgot to scope the query at all).
vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function chainFor(table: string, rowsIn?: Array<Record<string, unknown>>) {
    const rows = rowsIn ?? (holders.tables[table] ?? []);
    const chain: Record<string, unknown> = {
      select() { return chainFor(table, rows); },
      eq(col: string, val: unknown) {
        return chainFor(table, rows.filter((r) => r[col] === val));
      },
      in(col: string, vals: unknown[]) {
        return chainFor(table, rows.filter((r) => vals.includes(r[col])));
      },
      order() { return chainFor(table, rows); },
      limit() { return chainFor(table, rows); },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(onF, onR);
      },
    };
    return chain;
  }
  const client = { from: (t: string) => chainFor(t) };
  return { getSupabaseAdmin: () => client, supabaseAdmin: client };
});

function authAs(schoolId: string) {
  holders.authorizeSchoolAdmin.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    schoolId,
    schoolAdminId: 'sa-1',
    schoolAdminRole: 'principal',
  });
}

function postReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/school-admin/data-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake.jwt' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {
    students: [
      { id: 'stu-a1', name: 'Aarav (School A)', school_id: SCHOOL_A, grade: '8', is_active: true, xp_total: 100, last_active: null, created_at: '2026-01-01' },
      { id: 'stu-a2', name: 'Diya (School A)', school_id: SCHOOL_A, grade: '9', is_active: true, xp_total: 50, last_active: null, created_at: '2026-01-02' },
      { id: 'stu-b1', name: 'Rohan (School B — MUST NOT LEAK)', school_id: SCHOOL_B, grade: '8', is_active: true, xp_total: 200, last_active: null, created_at: '2026-01-03' },
    ],
    quiz_sessions: [],
  };
});

describe('POST /api/school-admin/data-export — tenant isolation (P8/P13)', () => {
  it('a School-A admin export includes only School-A students, never School-B rows', async () => {
    authAs(SCHOOL_A);
    const { POST } = await import('@/app/api/school-admin/data-export/route');
    const res = await POST(postReq({ type: 'students' }) as never);
    expect(res.status).toBe(200);
    const csv = await res.text();

    expect(csv).toContain('Aarav (School A)');
    expect(csv).toContain('Diya (School A)');
    expect(csv).not.toContain('Rohan');
    expect(csv).not.toContain('School B');
    expect(csv).not.toContain(SCHOOL_B);
  });

  it('a School-B admin export includes only School-B students', async () => {
    authAs(SCHOOL_B);
    const { POST } = await import('@/app/api/school-admin/data-export/route');
    const res = await POST(postReq({ type: 'students' }) as never);
    const csv = await res.text();

    expect(csv).toContain('Rohan');
    expect(csv).not.toContain('Aarav');
    expect(csv).not.toContain('Diya');
  });

  it('ignores a client-supplied school_id/schoolId in the body (no tenant-scope injection vector)', async () => {
    authAs(SCHOOL_A);
    const { POST } = await import('@/app/api/school-admin/data-export/route');
    // Attempt to smuggle School B's id via the body — the route must not read it.
    const res = await POST(
      postReq({ type: 'students', school_id: SCHOOL_B, schoolId: SCHOOL_B }) as never,
    );
    const csv = await res.text();

    // Still scoped to the AUTHENTICATED admin's own school (A), proving the body
    // field is never consulted for tenant scoping.
    expect(csv).toContain('Aarav (School A)');
    expect(csv).not.toContain('Rohan');
  });

  it('the same isolation holds for the "full" export type (multi-section CSV)', async () => {
    authAs(SCHOOL_A);
    const { POST } = await import('@/app/api/school-admin/data-export/route');
    const res = await POST(postReq({ type: 'full' }) as never);
    const csv = await res.text();

    expect(csv).toContain('Aarav (School A)');
    expect(csv).not.toContain('Rohan');
    expect(csv).not.toContain('School B');
  });
});
