/**
 * /api/parent/calendar — aggregated upcoming events for a linked child.
 *
 * Phase 2 portal remediation. Pins:
 *   1. RBAC gate uses child.view_progress; canAccessStudent is the single data
 *      boundary. A guardian NOT linked to the requested child → 403 with NO
 *      event payload (P13) and the source queries are never run.
 *   2. 400 on a non-UUID student_id (no boundary call, no payload).
 *   3. Happy path aggregation shape: events from assignments + school_exams +
 *      quiz_sessions are merged into a single `events[]`, each tagged with its
 *      `type`, and the array is sorted ascending by date. grade is a STRING (P5).
 *   4. No student-identifying data is logged.
 *
 * Mocks: @alfanumrik/lib/rbac (authorizeRequest/canAccessStudent), @alfanumrik/lib/domains/identity
 * (getStudentById), and a table-aware in-memory @alfanumrik/lib/supabase-admin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCanAccess: vi.fn(),
  mockGetStudent: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  // table → rows the in-memory client returns for that table's terminal await.
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  // True once any source table query was issued (proves deny short-circuits).
  anySourceQueried: false,
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  canAccessStudent: (...a: unknown[]) => holders.mockCanAccess(...a),
}));
vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getStudentById: (...a: unknown[]) => holders.mockGetStudent(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (...a: unknown[]) => holders.loggerInfo(...a),
    warn: (...a: unknown[]) => holders.loggerWarn(...a),
    error: (...a: unknown[]) => holders.loggerError(...a),
    debug: vi.fn(),
  },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  // Lazy chain: any terminal await resolves to the table's seeded rows.
  function chainFor(table: string) {
    if (table !== 'students') holders.anySourceQueried = true;
    const exec = () => Promise.resolve({ data: holders.tables[table] ?? [], error: null });
    const chain: Record<string, unknown> = {
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      is() { return chain; },
      not() { return chain; },
      gte() { return chain; },
      lte() { return chain; },
      order() { return chain; },
      limit() { return exec(); }, // terminal — all source queries end in .limit()
      maybeSingle() { return Promise.resolve({ data: (holders.tables[table] ?? [])[0] ?? null, error: null }); },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { return exec().then(onF, onR); },
    };
    return chain;
  }
  return { supabaseAdmin: { from: (t: string) => chainFor(t) } };
});

const GUARDIAN_AUTH = '11111111-1111-4111-a111-111111111111';
const CHILD_OWN = '33333333-3333-4333-a333-333333333333';
const CHILD_OTHER = '44444444-4444-4444-a444-444444444444';
const SCHOOL_ID = '55555555-5555-4555-a555-555555555555';

function req(studentId: string, query = ''): Request {
  return new Request(
    `http://localhost/api/parent/calendar?student_id=${studentId}${query}`,
    { method: 'GET', headers: { Authorization: 'Bearer fake.jwt' } },
  );
}

function authAsParent(userId = GUARDIAN_AUTH) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true, userId, studentId: null, roles: ['parent'], permissions: ['child.view_progress'],
  });
}
function authFail(status: number) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: false, userId: null, studentId: null, roles: [], permissions: [],
    errorResponse: new Response(JSON.stringify({ success: false, error: 'no' }), { status }),
  });
}
function withStudent() {
  holders.mockGetStudent.mockResolvedValue({
    ok: true, data: { id: CHILD_OWN, name: 'Aanya', grade: '8', schoolId: SCHOOL_ID, authUserId: 'x' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {};
  holders.anySourceQueried = false;
});

describe('GET /api/parent/calendar — boundary (P13)', () => {
  it('asks authorizeRequest for child.view_progress', async () => {
    const { GET } = await import('@/app/api/parent/calendar/route');
    authAsParent();
    holders.mockCanAccess.mockResolvedValue(true);
    withStudent();
    await GET(req(CHILD_OWN));
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('child.view_progress');
  });

  it('401 when unauthenticated — no boundary call, no payload', async () => {
    const { GET } = await import('@/app/api/parent/calendar/route');
    authFail(401);
    const res = await GET(req(CHILD_OWN));
    expect(res.status).toBe(401);
    expect(holders.mockCanAccess).not.toHaveBeenCalled();
    expect(holders.anySourceQueried).toBe(false);
  });

  it('400 on a non-UUID student_id — no boundary call, no payload', async () => {
    const { GET } = await import('@/app/api/parent/calendar/route');
    authAsParent();
    const res = await GET(req('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(holders.mockCanAccess).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty('data');
  });

  it('NOT LINKED → 403, source queries never run, NO event payload (P13)', async () => {
    const { GET } = await import('@/app/api/parent/calendar/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(false);
    const res = await GET(req(CHILD_OTHER));
    expect(res.status).toBe(403);
    expect(holders.mockCanAccess).toHaveBeenCalledWith(GUARDIAN_AUTH, CHILD_OTHER);
    // No assignments/exams/quiz queries were issued on the deny path.
    expect(holders.anySourceQueried).toBe(false);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(body).not.toHaveProperty('events');
  });
});

describe('GET /api/parent/calendar — aggregation shape', () => {
  it('merges assignments + school_exams + quiz_activity into one sorted events[]', async () => {
    const { GET } = await import('@/app/api/parent/calendar/route');
    authAsParent();
    holders.mockCanAccess.mockResolvedValue(true);
    withStudent();
    holders.tables = {
      class_enrollments: [{ class_id: 'class-1' }],
      assignments: [
        { id: 'a1', title: 'Algebra HW', subject: 'Math', due_date: '2026-06-20T00:00:00.000Z', status: 'active' },
      ],
      school_exams: [
        { id: 'e1', title: 'Unit Test', subject: 'Science', grade: '8', start_time: '2026-06-25T00:00:00.000Z', status: 'scheduled' },
      ],
      quiz_sessions: [
        { subject: 'Math', score_percent: 80, created_at: '2026-06-10T00:00:00.000Z', is_completed: true },
      ],
    };
    const res = await GET(req(CHILD_OWN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.student_id).toBe(CHILD_OWN);
    // P5: grade is a string.
    expect(body.data.grade).toBe('8');
    expect(typeof body.data.grade).toBe('string');
    expect(body.data.range).toHaveProperty('from');
    expect(body.data.range).toHaveProperty('to');

    const types = body.data.events.map((e: { type: string }) => e.type);
    expect(types).toContain('assignment');
    expect(types).toContain('school_exam');
    expect(types).toContain('quiz_activity');

    // Sorted ascending by date.
    const dates = body.data.events.map((e: { date: string }) => e.date);
    const sorted = [...dates].sort((a, b) => a.localeCompare(b));
    expect(dates).toEqual(sorted);

    // The quiz event carries a rounded percentage subtitle.
    const quiz = body.data.events.find((e: { type: string }) => e.type === 'quiz_activity');
    expect(quiz.subtitle).toBe('80%');
  });

  it('returns 404 when the child cannot be resolved (no event payload)', async () => {
    const { GET } = await import('@/app/api/parent/calendar/route');
    authAsParent();
    holders.mockCanAccess.mockResolvedValue(true);
    holders.mockGetStudent.mockResolvedValue({ ok: true, data: null });
    const res = await GET(req(CHILD_OWN));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty('events');
  });

  it('does not log any student-identifying data on the happy path', async () => {
    const { GET } = await import('@/app/api/parent/calendar/route');
    authAsParent();
    holders.mockCanAccess.mockResolvedValue(true);
    withStudent();
    holders.tables = { class_enrollments: [], school_exams: [], quiz_sessions: [] };
    await GET(req(CHILD_OWN));
    // No warn/error logged the student name or auth id on the happy path.
    const allLogs = [...holders.loggerInfo.mock.calls, ...holders.loggerWarn.mock.calls, ...holders.loggerError.mock.calls];
    const serialized = JSON.stringify(allLogs);
    expect(serialized).not.toContain('Aanya');
  });
});
