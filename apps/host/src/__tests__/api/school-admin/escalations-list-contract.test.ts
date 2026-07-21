/**
 * T13 (Teacher Dashboard RCA follow-up) — GET /api/school-admin/escalations
 * contract tests.
 *
 * Pins:
 *   - AUTHZ: authorizeSchoolAdmin denies -> errorResponse verbatim, no DB read.
 *   - SCHOOL SCOPE (P8): only escalations addressed to an ACTIVE school_admin
 *     at the CALLER'S school are returned — never another school's rows, and
 *     never rows addressed to an inactive admin at the same school whose id
 *     was removed from the active set (defense-in-depth on top of the
 *     `notif_own` RLS boundary, since this route reads via service role).
 *   - EMPTY: no active admins at the school -> { success:true, data: [] }.
 *   - Happy path: returns escalation rows ordered newest-first with the
 *     expected shape (id, title, message, is_read, created_at, student_id,
 *     class_id).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHOOL_A = '11111111-1111-4111-a111-111111111111';
const SCHOOL_B = '22222222-2222-4222-a222-222222222222';

const ADMIN_A1 = 'aaaa1111-1111-4111-a111-111111111111';
const ADMIN_A2 = 'aaaa2222-1111-4111-a111-111111111111';
const ADMIN_A3_INACTIVE = 'aaaa3333-1111-4111-a111-111111111111';
const ADMIN_B1 = 'bbbb1111-1111-4111-a111-111111111111';

const holders = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
  schoolAdmins: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => holders.authorizeSchoolAdmin(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  type Row = Record<string, unknown>;
  function chainFor(table: string) {
    const rows = (): Row[] =>
      table === 'school_admins' ? holders.schoolAdmins : table === 'notifications' ? holders.notifications : [];
    const filters: Array<(r: Row) => boolean> = [];
    let limitN: number | null = null;
    const apply = () => {
      let out = rows().filter((r) => filters.every((p) => p(r)));
      out = [...out].sort((a, b) => (String(b.created_at) > String(a.created_at) ? 1 : -1));
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    };
    const chain: Record<string, unknown> = {
      select() { return chain; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return chain; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return chain; },
      order() { return chain; },
      limit(n: number) { limitN = n; return chain; },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve({ data: apply(), error: null }).then(onF, onR);
      },
    };
    return chain;
  }
  const client = { from: (t: string) => chainFor(t) };
  return { getSupabaseAdmin: () => client, supabaseAdmin: client };
});

function getReq(): import('next/server').NextRequest {
  return new Request('http://localhost/api/school-admin/escalations', {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt' },
  }) as unknown as import('next/server').NextRequest;
}

function authOk(schoolId: string) {
  holders.authorizeSchoolAdmin.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    schoolId,
    schoolAdminId: 'sa-1',
    schoolAdminRole: 'principal',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.schoolAdmins = [
    { id: ADMIN_A1, school_id: SCHOOL_A, is_active: true },
    { id: ADMIN_A2, school_id: SCHOOL_A, is_active: true },
    { id: ADMIN_A3_INACTIVE, school_id: SCHOOL_A, is_active: false },
    { id: ADMIN_B1, school_id: SCHOOL_B, is_active: true },
  ];
  holders.notifications = [
    {
      id: 'n1', recipient_id: ADMIN_A1, recipient_type: 'school_admin', type: 'teacher_escalation',
      title: 'Teacher escalation', message: 'Aarav: concern 1', is_read: false,
      created_at: '2026-07-01T00:00:00.000Z', data: { student_id: 's1', class_id: 'c1' },
    },
    {
      id: 'n2', recipient_id: ADMIN_A2, recipient_type: 'school_admin', type: 'teacher_escalation',
      title: 'Teacher escalation', message: 'Riya: concern 2', is_read: true,
      created_at: '2026-07-02T00:00:00.000Z', data: { student_id: 's2', class_id: 'c2' },
    },
    {
      id: 'n3', recipient_id: ADMIN_A3_INACTIVE, recipient_type: 'school_admin', type: 'teacher_escalation',
      title: 'Teacher escalation', message: 'Should not show (inactive admin)', is_read: false,
      created_at: '2026-07-03T00:00:00.000Z', data: { student_id: 's3', class_id: 'c3' },
    },
    {
      id: 'n4', recipient_id: ADMIN_B1, recipient_type: 'school_admin', type: 'teacher_escalation',
      title: 'Teacher escalation', message: 'Other school — must not leak', is_read: false,
      created_at: '2026-07-04T00:00:00.000Z', data: { student_id: 's4', class_id: 'c4' },
    },
  ];
});

describe('GET /api/school-admin/escalations — authz gate', () => {
  it('returns the auth errorResponse verbatim when denied', async () => {
    const { GET } = await import('@/app/api/school-admin/escalations/route');
    const { NextResponse } = await import('next/server');
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: false,
      errorResponse: NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 }),
    });
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/school-admin/escalations — school scope (P8)', () => {
  it('never returns another school\'s escalation rows', async () => {
    authOk(SCHOOL_A);
    const { GET } = await import('@/app/api/school-admin/escalations/route');
    const res = await GET(getReq());
    const json = await res.json();
    expect(json.success).toBe(true);
    const ids = json.data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain('n4');
  });

  it('never returns a row addressed to an INACTIVE admin at the same school', async () => {
    authOk(SCHOOL_A);
    const { GET } = await import('@/app/api/school-admin/escalations/route');
    const res = await GET(getReq());
    const json = await res.json();
    const ids = json.data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain('n3');
  });

  it('returns { success:true, data: [] } when the school has no active admins', async () => {
    authOk(SCHOOL_B);
    holders.schoolAdmins = holders.schoolAdmins.filter((a) => a.school_id !== SCHOOL_B);
    const { GET } = await import('@/app/api/school-admin/escalations/route');
    const res = await GET(getReq());
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });
});

describe('GET /api/school-admin/escalations — happy path', () => {
  it('returns escalation rows with the expected shape, newest first', async () => {
    authOk(SCHOOL_A);
    const { GET } = await import('@/app/api/school-admin/escalations/route');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.map((r: { id: string }) => r.id)).toEqual(['n2', 'n1']);
    expect(json.data[0]).toMatchObject({
      id: 'n2',
      title: 'Teacher escalation',
      message: 'Riya: concern 2',
      is_read: true,
      student_id: 's2',
      class_id: 'c2',
    });
  });
});
