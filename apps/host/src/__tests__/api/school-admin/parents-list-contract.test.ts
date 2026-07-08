/**
 * /api/school-admin/parents (GET) — list-links envelope contract (E2E fix pass).
 *
 * WHY THIS EXISTS
 *   The portal RBAC SaaS remediation standardised the parents-list GET on
 *   `{ success: true, data: { links: [...], total, page, limit } }`, where each
 *   link row now carries `id`, `status`, and `linked_at` IN ADDITION to the
 *   existing display fields. The parents page reads `json.data.links` and uses
 *   `id` as the React key + `status`/`linked_at` for the row chips; a handler that
 *   returned a bare array (or omitted those keys) would render an empty/keyless
 *   list with no error — a silent failure. These tests pin the envelope + the
 *   three load-bearing per-row keys so a refactor cannot regress them.
 *
 * Pins:
 *   - AUTHZ: authorizeSchoolAdmin denies → errorResponse verbatim, no DB.
 *   - EMPTY-SCHOOL: no students → { success:true, data:{ links:[], total:0 } }.
 *   - HAPPY PATH: data.links[*] carries { id, status, linked_at } plus the
 *     display fields; id is the composite `guardian_id:student_id`; linked_at
 *     falls back to created_at when the dedicated column is null.
 *   - PAGINATION: page/limit echoed in the envelope.
 *
 * Seams mocked: @alfanumrik/lib/school-admin-auth (authorizeSchoolAdmin),
 * @alfanumrik/lib/supabase-admin (getSupabaseAdmin — per-table chainable stub),
 * @alfanumrik/lib/audit (no-op).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHOOL = '11111111-1111-4111-a111-111111111111';
const STUDENT_ID = '33333333-3333-4333-a333-333333333333';
const GUARDIAN_ID = '44444444-4444-4444-a444-444444444444';

const holders = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  counts: {} as Record<string, number>,
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => holders.authorizeSchoolAdmin(...a),
}));
vi.mock('@alfanumrik/lib/audit', () => ({ logSchoolAudit: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function chainFor(table: string) {
    const rows = () => holders.tables[table] ?? [];
    const result = () => ({
      data: rows(),
      error: null,
      count: holders.counts[table] ?? rows().length,
    });
    const chain: Record<string, unknown> = {
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      ilike() { return chain; },
      range() { return chain; },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(onF, onR);
      },
    };
    return chain;
  }
  const client = { from: (t: string) => chainFor(t) };
  return { getSupabaseAdmin: () => client, supabaseAdmin: client };
});

function getReq(query = ''): import('next/server').NextRequest {
  return new Request(`http://localhost/api/school-admin/parents${query}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt' },
  }) as unknown as import('next/server').NextRequest;
}

function authOk() {
  holders.authorizeSchoolAdmin.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    schoolId: SCHOOL,
    schoolAdminId: 'sa-1',
    schoolAdminRole: 'principal',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {};
  holders.counts = {};
});

describe('GET /api/school-admin/parents — authz gate', () => {
  it('returns the auth errorResponse verbatim when denied', async () => {
    const { GET } = await import('@/app/api/school-admin/parents/route');
    const { NextResponse } = await import('next/server');
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: false,
      errorResponse: NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 }),
    });
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/school-admin/parents — {success,data:{links}} envelope', () => {
  it('empty school → { success:true, data:{ links:[], total:0 } }', async () => {
    authOk();
    holders.tables.students = [];
    const { GET } = await import('@/app/api/school-admin/parents/route');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeTruthy();
    expect(json.data.links).toEqual([]);
    expect(json.data.total).toBe(0);
  });

  it('happy path → data.links[*] carries id + status + linked_at + display fields', async () => {
    authOk();
    holders.tables.students = [{ id: STUDENT_ID, name: 'Aarav Sharma', grade: '7' }];
    holders.tables.guardian_student_links = [
      {
        guardian_id: GUARDIAN_ID,
        student_id: STUDENT_ID,
        status: 'approved',
        linked_at: '2026-02-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    holders.counts.guardian_student_links = 1;
    holders.tables.guardians = [
      {
        id: GUARDIAN_ID,
        auth_user_id: 'auth-g',
        name: 'Priya Sharma',
        email: 'priya@example.com',
        phone: '+910000000000',
        preferred_language: 'en',
      },
    ];

    const { GET } = await import('@/app/api/school-admin/parents/route');
    const res = await GET(getReq());
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.links)).toBe(true);
    expect(json.data.total).toBe(1);

    const row = json.data.links[0];
    // The three load-bearing keys the remediation added.
    expect(row).toHaveProperty('id', `${GUARDIAN_ID}:${STUDENT_ID}`);
    expect(row).toHaveProperty('status', 'approved');
    expect(row).toHaveProperty('linked_at', '2026-02-01T00:00:00.000Z');
    // Existing display fields preserved.
    expect(row.parent_name).toBe('Priya Sharma');
    expect(row.student_name).toBe('Aarav Sharma');
    expect(row.student_grade).toBe('7'); // P5: string
  });

  it('linked_at falls back to created_at when the dedicated column is null', async () => {
    authOk();
    holders.tables.students = [{ id: STUDENT_ID, name: 'Aarav', grade: '7' }];
    holders.tables.guardian_student_links = [
      {
        guardian_id: GUARDIAN_ID,
        student_id: STUDENT_ID,
        status: 'pending',
        linked_at: null,
        created_at: '2026-03-15T00:00:00.000Z',
      },
    ];
    holders.counts.guardian_student_links = 1;
    holders.tables.guardians = [
      { id: GUARDIAN_ID, auth_user_id: 'auth-g', name: 'P', email: null, phone: null, preferred_language: 'hi' },
    ];

    const { GET } = await import('@/app/api/school-admin/parents/route');
    const res = await GET(getReq());
    const json = await res.json();
    expect(json.data.links[0].linked_at).toBe('2026-03-15T00:00:00.000Z');
    expect(json.data.links[0].status).toBe('pending');
  });

  it('echoes page/limit in the envelope', async () => {
    authOk();
    holders.tables.students = [];
    const { GET } = await import('@/app/api/school-admin/parents/route');
    const res = await GET(getReq('?page=3&limit=10'));
    const json = await res.json();
    expect(json.data.page).toBe(3);
    expect(json.data.limit).toBe(10);
  });
});
