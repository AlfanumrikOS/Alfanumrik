/**
 * /api/school-admin/reports (GET) — row-cap + truncation contract (Task 3.2,
 * RCA fix for unbounded query risk).
 *
 * WHY THIS EXISTS
 *   `schoolOverview`, `classPerformance`, and `subjectGaps` previously read
 *   `quiz_sessions` within a time window with NO cap. This suite seeds a mock
 *   dataset LARGER than the handler's row cap and asserts:
 *     (a) the response's aggregates are computed over a CAPPED dataset (not
 *         the full oversized one — e.g. `total_quizzes`/`quiz_count` never
 *         exceeds the cap),
 *     (b) `truncated: true` is set when the cap is hit,
 *     (c) with a small (under-cap) dataset, `truncated: false` and all rows
 *         are reflected in the aggregates.
 *
 * The mock DB stub's `.limit()` is a no-op passthrough (mirrors the sibling
 * `reports-envelope-contract.test.ts` stub), so it returns every seeded row
 * regardless of the requested limit — exactly like a real Postgres query
 * WOULD if the code never called `.limit()` at all. This is what makes the
 * test meaningful: the safety net has to live in the handler's own
 * fetch-N+1-then-slice logic, not merely rely on the DB honoring `.limit()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHOOL = '11111111-1111-4111-a111-111111111111';
const CLASS_ID = '22222222-2222-4222-a222-222222222222';

const holders = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  counts: {} as Record<string, number>,
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => holders.authorizeSchoolAdmin(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Same minimal thenable query-builder stub as reports-envelope-contract.test.ts.
// `.limit()` is intentionally a NO-OP passthrough — see file header.
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

/** Build N quiz_sessions rows, all within the active time window. */
function bigQuizSet(n: number, opts: { studentId?: string; subject?: string } = {}) {
  const now = new Date().toISOString();
  return Array.from({ length: n }, (_, i) => ({
    subject: opts.subject ?? 'Maths',
    score_percent: 70,
    student_id: opts.studentId ?? `student-${i % 10}`,
    created_at: now,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {};
  holders.counts = {};
});

describe('GET /api/school-admin/reports — school_overview row cap (10,000)', () => {
  it('caps total_quizzes at the row cap and sets truncated:true for an over-cap dataset', async () => {
    authOk();
    holders.tables.students = [{ id: 'student-0', grade: '7', is_active: true, last_active: null }];
    holders.tables.quiz_sessions = bigQuizSet(10_050); // > SCHOOL_WIDE_QUIZ_ROW_CAP
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=school_overview'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.truncated).toBe(true);
    expect(json.data.total_quizzes).toBe(10_000);
  });

  it('is NOT truncated and reflects every row for a small dataset', async () => {
    authOk();
    holders.tables.students = [{ id: 'student-0', grade: '7', is_active: true, last_active: null }];
    holders.tables.quiz_sessions = bigQuizSet(3);
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=school_overview'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.truncated).toBe(false);
    expect(json.data.total_quizzes).toBe(3);
  });
});

describe('GET /api/school-admin/reports — class_performance row cap (2,000)', () => {
  it('caps subject_breakdown quiz_count total at the row cap and sets truncated:true', async () => {
    authOk();
    holders.tables.classes = [{ id: CLASS_ID, name: '7A', grade: '7', section: 'A' }];
    holders.tables.class_enrollments = [{ student_id: 'student-0' }];
    holders.tables.quiz_sessions = bigQuizSet(2_500, { studentId: 'student-0' }); // > CLASS_QUIZ_ROW_CAP
    holders.tables.students = [{ id: 'student-0', name: 'Aarav', grade: '7' }];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq(`?type=class_performance&class_id=${CLASS_ID}`));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.truncated).toBe(true);
    // Every seeded row shares one subject → subject_breakdown[0].quiz_count is
    // the capped total, not the full 2,500 seeded.
    expect(json.data.subject_breakdown[0].quiz_count).toBe(2_000);
  });

  it('is NOT truncated for a small class roster/quiz volume', async () => {
    authOk();
    holders.tables.classes = [{ id: CLASS_ID, name: '7A', grade: '7', section: 'A' }];
    holders.tables.class_enrollments = [{ student_id: 'student-0' }];
    holders.tables.quiz_sessions = bigQuizSet(4, { studentId: 'student-0' });
    holders.tables.students = [{ id: 'student-0', name: 'Aarav', grade: '7' }];
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq(`?type=class_performance&class_id=${CLASS_ID}`));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.truncated).toBe(false);
    expect(json.data.subject_breakdown[0].quiz_count).toBe(4);
  });
});

describe('GET /api/school-admin/reports — subject_gaps row cap (10,000)', () => {
  it('caps quiz_count at the row cap and sets truncated:true for an over-cap dataset', async () => {
    authOk();
    holders.tables.quiz_sessions = bigQuizSet(10_200); // > SCHOOL_WIDE_QUIZ_ROW_CAP
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=subject_gaps'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.truncated).toBe(true);
    expect(json.data.gaps[0].quiz_count).toBe(10_000);
  });

  it('is NOT truncated and includes every row for a small dataset', async () => {
    authOk();
    holders.tables.quiz_sessions = bigQuizSet(5);
    const { GET } = await import('@/app/api/school-admin/reports/route');
    const res = await GET(getReq('?type=subject_gaps'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.truncated).toBe(false);
    expect(json.data.gaps[0].quiz_count).toBe(5);
  });
});
