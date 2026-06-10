import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/v1/school/reports — error propagation + quiz_sessions contract
 *
 * Contracts pinned (P0 cross-layer gap batch, 2026-06-10):
 *   1. A quiz-stats query error is NOT swallowed: the route returns an
 *      explicit 500 { success: false } — it must never report zeros
 *      (0 quizzes / 0 avg score) to a paying school on a silent DB failure.
 *   2. The success path queries `quiz_sessions` (not the dead `quiz_results`
 *      table) and filters on is_completed = true.
 *   3. The average score is rounded ONCE on the final average
 *      (Math.round(sum/count)) — score_percent is double precision in the DB,
 *      so per-row rounding before averaging would drift.
 *
 * Mock strategy follows src/__tests__/api/school-admin-students-seat-cap.test.ts
 * conventions: auth + rate-limit module-mocked, supabase-admin replaced with a
 * recording builder using per-table FIFO result queues (the overview report
 * issues three sequential `students` queries).
 */

// ── Auth + rate-limit mocks ───────────────────────────────────────────────────

const { mockAuthApiKey, mockRateLimit } = vi.hoisted(() => ({
  mockAuthApiKey: vi.fn(),
  mockRateLimit: vi.fn(),
}));

vi.mock('@/lib/school-api-auth', () => ({
  authenticateApiKey: (...a: unknown[]) => mockAuthApiKey(...a),
}));
vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Recording Supabase admin mock with per-table FIFO result queues ───────────

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  filters: Array<[string, string, unknown]>;
}

const recorded: RecordedQuery[] = [];
const queues = new Map<string, Array<Record<string, unknown>>>();

function queueResult(table: string, result: Record<string, unknown>) {
  if (!queues.has(table)) queues.set(table, []);
  queues.get(table)!.push(result);
}

function makeBuilder(table: string) {
  const rec: RecordedQuery = { table, op: 'select', filters: [] };
  recorded.push(rec);
  // Pop the table's next queued result at builder-creation time (one builder
  // per route query; the route awaits each query before issuing the next).
  const result = queues.get(table)?.shift() ?? { data: null, error: null, count: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    insert: () => {
      rec.op = 'insert';
      return builder;
    },
    update: () => {
      rec.op = 'update';
      return builder;
    },
    delete: () => {
      rec.op = 'delete';
      return builder;
    },
    order: () => builder,
    range: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onF, onR),
  };
  for (const f of ['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'ilike']) {
    builder[f] = (col: string, val: unknown) => {
      rec.filters.push([f, col, val]);
      return builder;
    };
  }
  return builder;
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

import { GET } from '@/app/api/v1/school/reports/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCHOOL_ID = '00000000-0000-0000-0000-0000000000cc';

function makeRequest(type: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/school/reports?type=${type}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer sk_school_test_key' },
  });
}

function quizSessionQueries() {
  return recorded.filter((r) => r.table === 'quiz_sessions');
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  queues.clear();
  mockAuthApiKey.mockResolvedValue({
    schoolId: SCHOOL_ID,
    keyId: 'key-1',
    permissions: ['reports.read'],
  });
  mockRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 99,
    resetAt: Math.ceil(Date.now() / 1000) + 60,
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/school/reports — auth gate', () => {
  it('returns 401 for an invalid API key', async () => {
    mockAuthApiKey.mockResolvedValue(null);
    const res = await GET(makeRequest('overview'));
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
    expect(recorded.length).toBe(0);
  });

  it('returns 403 when the key lacks reports.read', async () => {
    mockAuthApiKey.mockResolvedValue({
      schoolId: SCHOOL_ID,
      keyId: 'key-1',
      permissions: ['students.read'],
    });
    const res = await GET(makeRequest('overview'));
    expect(res.status).toBe(403);
    expect((await res.json()).success).toBe(false);
  });

  it('returns 400 for an unknown report type', async () => {
    const res = await GET(makeRequest('bogus'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/school/reports?type=overview — error propagation', () => {
  it('returns explicit 500 (NOT zeros) when the quiz_sessions query fails', async () => {
    queueResult('students', { count: 10, error: null }); // total
    queueResult('students', { count: 5, error: null }); // active
    queueResult('students', { data: [{ id: 's1' }, { id: 's2' }], error: null }); // ids
    queueResult('quiz_sessions', { data: null, error: { message: 'db exploded' } });

    const res = await GET(makeRequest('overview'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    // The silent-zero regression: a failed quiz query must never surface as
    // a "successful" report with quizzes_this_month: 0 / avg_score: 0.
    expect(body.data).toBeUndefined();
  });

  it('returns explicit 500 when the student-ids query fails', async () => {
    queueResult('students', { count: 10, error: null });
    queueResult('students', { count: 5, error: null });
    queueResult('students', { data: null, error: { message: 'db exploded' } });

    const res = await GET(makeRequest('overview'));
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});

describe('GET /api/v1/school/reports?type=overview — success path', () => {
  it('queries quiz_sessions with is_completed = true, scoped to the school students', async () => {
    queueResult('students', { count: 10, error: null });
    queueResult('students', { count: 5, error: null });
    queueResult('students', { data: [{ id: 's1' }, { id: 's2' }], error: null });
    queueResult('quiz_sessions', {
      data: [
        { student_id: 's1', score_percent: 80 },
        { student_id: 's2', score_percent: 60 },
      ],
      error: null,
    });

    const res = await GET(makeRequest('overview'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.total_students).toBe(10);
    expect(body.data.active_students).toBe(5);
    expect(body.data.quizzes_this_month).toBe(2);
    expect(body.data.avg_score).toBe(70);

    const quizQ = quizSessionQueries();
    expect(quizQ.length).toBe(1); // queries quiz_sessions, not quiz_results
    expect(quizQ[0].filters).toContainEqual(['eq', 'is_completed', true]);
    expect(quizQ[0].filters).toContainEqual(['in', 'student_id', ['s1', 's2']]);
    expect(quizQ[0].filters.some(([f, col]) => f === 'gte' && col === 'created_at')).toBe(true);
  });

  it('rounds the average ONCE on the final value (float score_percent rows)', async () => {
    queueResult('students', { count: 2, error: null });
    queueResult('students', { count: 2, error: null });
    queueResult('students', { data: [{ id: 's1' }], error: null });
    // sum = 66.9, avg = 33.45 → Math.round once = 33.
    // Per-row rounding first (33 + 34 = 67 → 33.5 → 34) would drift to 34.
    queueResult('quiz_sessions', {
      data: [
        { student_id: 's1', score_percent: 33.4 },
        { student_id: 's1', score_percent: 33.5 },
      ],
      error: null,
    });

    const res = await GET(makeRequest('overview'));
    const body = await res.json();
    expect(body.data.avg_score).toBe(33);
    expect(Number.isInteger(body.data.avg_score)).toBe(true);
  });

  it('returns zeros without querying quiz_sessions when the school has no students', async () => {
    queueResult('students', { count: 0, error: null });
    queueResult('students', { count: 0, error: null });
    queueResult('students', { data: [], error: null });

    const res = await GET(makeRequest('overview'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.quizzes_this_month).toBe(0);
    expect(body.data.avg_score).toBe(0);
    expect(quizSessionQueries().length).toBe(0);
  });
});

describe('GET /api/v1/school/reports?type=student_summary', () => {
  const studentRows = [
    { id: 's1', name: 'Asha', grade: '8', is_active: true, xp_total: 320, last_active: null },
    { id: 's2', name: 'Vikram', grade: '10', is_active: true, xp_total: 150, last_active: null },
  ];

  it('returns explicit 500 (NOT zeroed rows) when the quiz_sessions query fails', async () => {
    queueResult('students', { data: studentRows, count: 2, error: null });
    queueResult('quiz_sessions', { data: null, error: { message: 'db exploded' } });

    const res = await GET(makeRequest('student_summary'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('aggregates completed quiz_sessions per student, rounding each average once', async () => {
    queueResult('students', { data: studentRows, count: 2, error: null });
    // s1: sum 140.9 → avg 70.45 → round once = 70
    // (per-row rounding first: 71 + 70 = 141 → 70.5 → 71 would drift)
    queueResult('quiz_sessions', {
      data: [
        { student_id: 's1', score_percent: 70.5 },
        { student_id: 's1', score_percent: 70.4 },
      ],
      error: null,
    });

    const res = await GET(makeRequest('student_summary'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const s1 = body.data.students.find((s: { id: string }) => s.id === 's1');
    const s2 = body.data.students.find((s: { id: string }) => s.id === 's2');
    expect(s1.avg_score).toBe(70);
    expect(s1.total_quizzes).toBe(2);
    // Student with no completed quizzes: zeros (legitimate, not an error)
    expect(s2.avg_score).toBe(0);
    expect(s2.total_quizzes).toBe(0);
    // P5: grade stays a string in the public API contract
    expect(s1.grade).toBe('8');
    expect(typeof s2.grade).toBe('string');

    const quizQ = quizSessionQueries();
    expect(quizQ.length).toBe(1);
    expect(quizQ[0].filters).toContainEqual(['eq', 'is_completed', true]);
  });
});
