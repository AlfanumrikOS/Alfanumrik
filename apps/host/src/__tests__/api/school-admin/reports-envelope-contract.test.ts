/**
 * /api/school-admin/reports (GET) — response-envelope + type contract (E2E fix pass).
 *
 * WHY THIS EXISTS
 *   The portal RBAC SaaS remediation standardised the flexible reports endpoint
 *   on the canonical school-admin envelope `{ success: true, data: <payload> }`
 *   for EVERY report type, and added a NEW `student_search` type (the
 *   student-detail tab's drill-in autocomplete) plus a `class_avg_score` field on
 *   class_performance (the field the reports page's class stat card reads). The
 *   reports page unwraps `json.data` and throws when `!json.success`, so a handler
 *   that ever returned a bare payload (the historical shape on some types) would
 *   render an empty/broken report with no error — a silent failure. These tests
 *   pin the envelope on every type so a refactor cannot regress it.
 *
 * Pins:
 *   - AUTHZ: authorizeSchoolAdmin denies → the route returns its errorResponse
 *     verbatim (no DB touched).
 *   - ENVELOPE: school_overview / class_performance / student_detail /
 *     student_search / subject_gaps each return { success:true, data }.
 *   - NEW TYPE: student_search is a routed type (NOT "Unknown report type") and
 *     returns data as an array; <2-char query short-circuits to [].
 *   - NEW FIELD: class_performance carries `class_avg_score`.
 *   - ERROR PATH: an unknown type → { success:false } + 400 (envelope on the
 *     error branch too).
 *
 * Seams mocked: @alfanumrik/lib/school-admin-auth (authorizeSchoolAdmin),
 * @alfanumrik/lib/supabase-admin (getSupabaseAdmin — a tiny per-table chainable stub).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHOOL = '11111111-1111-4111-a111-111111111111';
const CLASS_ID = '22222222-2222-4222-a222-222222222222';
const STUDENT_ID = '33333333-3333-4333-a333-333333333333';

const holders = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
  // table → rows the chainable stub yields when awaited
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  // table → count returned alongside data (for { count: 'exact' } reads)
  counts: {} as Record<string, number>,
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => holders.authorizeSchoolAdmin(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// A minimal thenable query builder. Every chain method returns the same builder;
// awaiting it (or calling .single()/.maybeSingle()) resolves to the table's rows.
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
      gte() { return chain; },
      lt() { return chain; },
      ilike() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      single() { return Promise.resolve({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'not found' } }); },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
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
  return new Request(`http://localhost/api/school-admin/reports${query}`, {
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

describe('GET /api/school-admin/reports — authz gate', () => {
  it('returns the auth errorResponse verbatim when denied (no DB touched)', async () => {
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const { NextResponse } = await import('next/server');
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: false,
      errorResponse: NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 }),
    });
    const res = await GET(getReq('?type=school_overview'));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe('GET /api/school-admin/reports — {success,data} envelope on every type', () => {
  it('school_overview → { success:true, data }', async () => {
    authOk();
    holders.tables.students = [{ id: STUDENT_ID, grade: '7', is_active: true, last_active: null }];
    holders.tables.quiz_sessions = [];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=school_overview'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeTruthy();
    expect(typeof json.data.avg_score).toBe('number');
  });

  it('school_overview → NEW score_trend field (Phase 2 Task 2.2), all pre-existing fields byte-identical', async () => {
    authOk();
    holders.tables.students = [{ id: STUDENT_ID, grade: '7', is_active: true, last_active: null }];
    holders.tables.quiz_sessions = [
      { subject: 'Maths', score_percent: 80, student_id: STUDENT_ID, created_at: '2026-07-01T10:00:00Z' },
      { subject: 'Science', score_percent: 60, student_id: STUDENT_ID, created_at: '2026-07-01T14:00:00Z' },
      { subject: 'Maths', score_percent: 100, student_id: STUDENT_ID, created_at: '2026-07-02T09:00:00Z' },
    ];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=school_overview'));
    const json = await res.json();
    expect(json.success).toBe(true);

    // BEFORE (pre-Task-2.2) keys, verified against the route source prior to
    // this change: total_quizzes, avg_score, active_students, total_students,
    // completion_rate, trend_vs_last_week, subject_performance,
    // grade_performance — 8 keys, no score_trend.
    const BEFORE_KEYS = [
      'total_quizzes', 'avg_score', 'active_students', 'total_students',
      'completion_rate', 'trend_vs_last_week', 'subject_performance', 'grade_performance',
    ].sort();
    // AFTER (this change) keys — every BEFORE key still present, plus
    // score_trend (Phase 2 Task 2.2) and truncated (Phase 3 Task 3.2 — RCA
    // fix for the unbounded quiz_sessions query; see reports/route.ts's
    // SCHOOL_WIDE_QUIZ_ROW_CAP comment and reports-row-caps.test.ts).
    const AFTER_KEYS = [...BEFORE_KEYS, 'score_trend', 'truncated'].sort();
    expect(Object.keys(json.data).sort()).toEqual(AFTER_KEYS);
    // Every pre-existing key is present with the same shape as before (not
    // just "still exists" — the diff above IS the byte-for-byte key set
    // check; this loop additionally pins each pre-existing value's type).
    expect(typeof json.data.total_quizzes).toBe('number');
    expect(typeof json.data.avg_score).toBe('number');
    expect(typeof json.data.active_students).toBe('number');
    expect(typeof json.data.total_students).toBe('number');
    expect(typeof json.data.completion_rate).toBe('number');
    expect(typeof json.data.trend_vs_last_week).toBe('number');
    expect(Array.isArray(json.data.subject_performance)).toBe(true);
    expect(Array.isArray(json.data.grade_performance)).toBe(true);

    // NEW field shape: date-bucketed (YYYY-MM-DD), sorted ascending, avg
    // rounded per bucket.
    expect(json.data.score_trend).toEqual([
      { date: '2026-07-01', avg_score: 70 }, // avg(80,60) = 70
      { date: '2026-07-02', avg_score: 100 },
    ]);
  });

  it('school_overview → score_trend is [] when there is no quiz activity in the window (not fabricated)', async () => {
    authOk();
    holders.tables.students = [];
    holders.tables.quiz_sessions = [];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=school_overview'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.score_trend).toEqual([]);
  });

  it('default (no type) is school_overview and still wraps in the envelope', async () => {
    authOk();
    holders.tables.students = [];
    holders.tables.quiz_sessions = [];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq());
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeTruthy();
  });

  it('class_performance → { success:true, data } carrying class_avg_score', async () => {
    authOk();
    holders.tables.classes = [{ id: CLASS_ID, name: '7A', grade: '7', section: 'A' }];
    holders.tables.class_enrollments = [{ student_id: STUDENT_ID }];
    holders.tables.quiz_sessions = [{ student_id: STUDENT_ID, subject: 'Science', score_percent: 80 }];
    holders.tables.students = [{ id: STUDENT_ID, name: 'Aarav', grade: '7' }];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq(`?type=class_performance&class_id=${CLASS_ID}`));
    const json = await res.json();
    expect(json.success).toBe(true);
    // The NEW field the page's class stat card reads.
    expect(json.data).toHaveProperty('class_avg_score');
    expect(json.data.class_avg_score).toBe(80);
    // Backward-compat field retained alongside it.
    expect(json.data.avg_score).toBe(80);
  });

  it('class_performance with empty roster still returns class_avg_score:0 in the envelope', async () => {
    authOk();
    holders.tables.classes = [{ id: CLASS_ID, name: '7A', grade: '7', section: 'A' }];
    holders.tables.class_enrollments = [];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq(`?type=class_performance&class_id=${CLASS_ID}`));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.class_avg_score).toBe(0);
  });

  it('student_detail → { success:true, data } with a string grade (P5)', async () => {
    authOk();
    holders.tables.students = [
      { id: STUDENT_ID, name: 'Aarav', grade: '7', xp_total: 100, last_active: null, subscription_plan: 'free' },
    ];
    holders.tables.quiz_sessions = [
      { subject: 'Science', score_percent: 90, total_questions: 10, correct_answers: 9, created_at: '2026-06-01T00:00:00Z' },
    ];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq(`?type=student_detail&student_id=${STUDENT_ID}`));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.student.grade).toBe('7');
    expect(typeof json.data.student.grade).toBe('string'); // P5
  });

  it('subject_gaps → { success:true, data }', async () => {
    authOk();
    holders.tables.quiz_sessions = [
      { subject: 'Maths', score_percent: 40, student_id: STUDENT_ID },
    ];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=subject_gaps'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.gaps)).toBe(true);
  });
});

describe('GET /api/school-admin/reports — student_search (NEW type)', () => {
  it('is a ROUTED type (not "Unknown report type") and returns data as an array', async () => {
    authOk();
    holders.tables.students = [
      { id: STUDENT_ID, name: 'Aarav Sharma', grade: '7', xp_total: 50, last_active: null },
    ];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=student_search&query=Aar'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data[0]).toMatchObject({ id: STUDENT_ID, name: 'Aarav Sharma', grade: '7' });
  });

  it('short-circuits to an empty array for a <2-char query (no DB read)', async () => {
    authOk();
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=student_search&query=A'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });
});

describe('GET /api/school-admin/reports — error branch envelope', () => {
  it('unknown type → 400 with { success:false } (envelope on error too)', async () => {
    authOk();
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=does_not_exist'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(typeof json.error).toBe('string');
  });
});
