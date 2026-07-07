import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/diagnostic/complete — contract tests
 *
 * Contracts pinned (P0 cross-layer gap batch, 2026-06-10):
 *   1. P1 score formula: score_percent = Math.round((correct / total) * 100),
 *      computed SERVER-side from the submitted responses.
 *   2. 409 ALREADY_COMPLETED when the assessment row has is_completed = true
 *      (idempotency guard — double submit must not double-write).
 *   3. Delete-then-insert on diagnostic_responses: prior rows for the
 *      assessment are deleted BEFORE the new batch is inserted, so a retry
 *      after a partial failure can never produce duplicate responses.
 *   4. Response envelope the /diagnostic page consumes: session_id,
 *      score_percent, correct_answers, total_questions, weak_topics,
 *      strong_topics, recommended_difficulty.
 *   5. recommended_difficulty thresholds: <40 → easy, 40-69 → medium,
 *      ≥70 → hard (boundary cases 39 / 40 / 69 / 70).
 *
 * Mock strategy follows src/__tests__/diagnostic-api.test.ts (mock
 * @alfanumrik/lib/rbac + @alfanumrik/lib/supabase-admin), upgraded to a recording builder so
 * operation ORDER and payloads can be asserted.
 */

// ── RBAC mock ─────────────────────────────────────────────────────────────────

const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorize(...a),
}));

function setAuthorized(userId = 'auth-user-1') {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    roles: ['student'],
    permissions: ['diagnostic.complete'],
  });
}

function setUnauthorized() {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    ),
  });
}

// ── Recording Supabase admin mock ─────────────────────────────────────────────

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

const recorded: RecordedQuery[] = [];
const results = new Map<string, { data: unknown; error: unknown }>();

function setResult(key: string, result: { data: unknown; error: unknown }) {
  results.set(key, result);
}

function makeBuilder(table: string) {
  const rec: RecordedQuery = { table, op: 'select', filters: [] };
  recorded.push(rec);
  const resolveResult = () =>
    results.get(`${rec.table}.${rec.op}`) ?? { data: null, error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    insert: (rows: unknown) => {
      rec.op = 'insert';
      rec.payload = rows;
      return builder;
    },
    update: (vals: unknown) => {
      rec.op = 'update';
      rec.payload = vals;
      return builder;
    },
    delete: () => {
      rec.op = 'delete';
      return builder;
    },
    single: () => Promise.resolve(resolveResult()),
    maybeSingle: () => Promise.resolve(resolveResult()),
    then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(resolveResult()).then(onF, onR),
  };
  for (const f of ['eq', 'neq', 'in', 'gte', 'lte']) {
    builder[f] = (col: string, val: unknown) => {
      rec.filters.push([f, col, val]);
      return builder;
    };
  }
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST } from '@/app/api/diagnostic/complete/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-1';
const SESSION_ID = '11111111-1111-1111-1111-111111111111';

function makeResponses(total: number, correct: number) {
  return Array.from({ length: total }, (_, i) => ({
    question_id: `q-${i}`,
    selected_answer_index: i % 4,
    is_correct: i < correct,
    time_taken_seconds: 6,
    topic: null,
    difficulty: 2,
    bloom_level: 'understand',
  }));
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/diagnostic/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

/** Standard happy-path DB state: student exists, assessment open, writes succeed. */
function setHappyPathDb() {
  setResult('students.select', { data: { id: STUDENT_ID }, error: null });
  setResult('diagnostic_assessments.select', {
    data: { id: SESSION_ID, is_completed: false },
    error: null,
  });
  setResult('question_bank.select', { data: [], error: null });
  setResult('diagnostic_responses.delete', { data: null, error: null });
  setResult('diagnostic_responses.insert', { data: null, error: null });
  setResult('diagnostic_assessments.update', { data: null, error: null });
}

function queriesFor(table: string, op: RecordedQuery['op']) {
  return recorded.filter((r) => r.table === table && r.op === op);
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  results.clear();
  setAuthorized();
  setHappyPathDb();
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — auth (P9)', () => {
  it('returns 401 when unauthenticated and touches no tables', async () => {
    setUnauthorized();
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    expect(res.status).toBe(401);
    expect(recorded.length).toBe(0);
  });
});

describe('POST /api/diagnostic/complete — P1 score formula', () => {
  it('computes Math.round((7/10)*100) = 70 for 7 correct of 10', async () => {
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(10, 7) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score_percent).toBe(70);
    expect(body.data.correct_answers).toBe(7);
    expect(body.data.total_questions).toBe(10);
  });

  it('rounds 1/3 to exactly 33 (integer, never 33.33)', async () => {
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(3, 1) }));
    const body = await res.json();
    expect(body.data.score_percent).toBe(33);
    expect(Number.isInteger(body.data.score_percent)).toBe(true);
  });

  it('rounds 2/3 up to 67', async () => {
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(3, 2) }));
    const body = await res.json();
    expect(body.data.score_percent).toBe(67);
  });

  it('returns 0 for zero correct and 100 for all correct', async () => {
    let res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(5, 0) }));
    expect((await res.json()).data.score_percent).toBe(0);

    recorded.length = 0;
    res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(5, 5) }));
    expect((await res.json()).data.score_percent).toBe(100);
  });
});

describe('POST /api/diagnostic/complete — recommended_difficulty thresholds', () => {
  const cases: Array<[number, string]> = [
    [39, 'easy'], // 39% — just below the medium boundary
    [40, 'medium'], // 40% — boundary: medium starts here
    [69, 'medium'], // 69% — just below the hard boundary
    [70, 'hard'], // 70% — boundary: hard starts here
  ];

  for (const [correct, expected] of cases) {
    it(`recommends "${expected}" at exactly ${correct}%`, async () => {
      const res = await POST(
        makeRequest({ session_id: SESSION_ID, responses: makeResponses(100, correct) })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.score_percent).toBe(correct);
      expect(body.data.recommended_difficulty).toBe(expected);
    });
  }
});

describe('POST /api/diagnostic/complete — response envelope', () => {
  it('returns every field the /diagnostic page expects', async () => {
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.session_id).toBe(SESSION_ID);
    expect(body.data.score_percent).toBe(50);
    expect(body.data.correct_answers).toBe(2);
    expect(body.data.total_questions).toBe(4);
    expect(Array.isArray(body.data.weak_topics)).toBe(true);
    expect(Array.isArray(body.data.strong_topics)).toBe(true);
    expect(['easy', 'medium', 'hard']).toContain(body.data.recommended_difficulty);
  });
});

describe('POST /api/diagnostic/complete — 409 on already-completed assessment', () => {
  it('returns 409 ALREADY_COMPLETED and never touches diagnostic_responses', async () => {
    setResult('diagnostic_assessments.select', {
      data: { id: SESSION_ID, is_completed: true },
      error: null,
    });

    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('ALREADY_COMPLETED');

    // Idempotency guard: no delete, no insert, no summary update
    expect(queriesFor('diagnostic_responses', 'delete').length).toBe(0);
    expect(queriesFor('diagnostic_responses', 'insert').length).toBe(0);
    expect(queriesFor('diagnostic_assessments', 'update').length).toBe(0);
  });
});

describe('POST /api/diagnostic/complete — delete-then-insert (retry safety)', () => {
  it('deletes prior responses for the assessment BEFORE inserting the new batch', async () => {
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    expect(res.status).toBe(200);

    const deleteIdx = recorded.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'delete'
    );
    const insertIdx = recorded.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'insert'
    );
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(insertIdx);

    // Delete is scoped to THIS assessment only
    expect(recorded[deleteIdx].filters).toContainEqual(['eq', 'assessment_id', SESSION_ID]);

    // Insert carries exactly one row per response, all bound to the assessment
    const rows = recorded[insertIdx].payload as Array<Record<string, unknown>>;
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.assessment_id).toBe(SESSION_ID);
      expect(row.student_id).toBe(STUDENT_ID);
    }
  });

  it('a retry (second submit while still incomplete) re-runs delete-then-insert — no duplicate accumulation path', async () => {
    await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    // Simulate retry: assessment still open (e.g. summary update failed earlier)
    const before = recorded.length;
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 3) }));
    expect(res.status).toBe(200);

    const secondRun = recorded.slice(before);
    const deleteIdx = secondRun.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'delete'
    );
    const insertIdx = secondRun.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'insert'
    );
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(insertIdx);
  });
});

describe('POST /api/diagnostic/complete — summary write to diagnostic_assessments', () => {
  it('marks the assessment complete with the P1 score in raw_score_pct', async () => {
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(10, 7) }));
    expect(res.status).toBe(200);

    const updates = queriesFor('diagnostic_assessments', 'update');
    expect(updates.length).toBe(1);
    const payload = updates[0].payload as Record<string, unknown>;
    expect(payload.is_completed).toBe(true);
    expect(payload.raw_score_pct).toBe(70);
    expect(payload.total_questions).toBe(10);
    expect(payload.correct_answers).toBe(7);
    expect((payload.next_path as Record<string, unknown>).recommended_difficulty).toBe('hard');
    // Update is scoped to this assessment AND this student (ownership)
    expect(updates[0].filters).toContainEqual(['eq', 'id', SESSION_ID]);
    expect(updates[0].filters).toContainEqual(['eq', 'student_id', STUDENT_ID]);
  });

  it('still returns 200 with the score when the summary update fails (responses are saved)', async () => {
    setResult('diagnostic_assessments.update', {
      data: null,
      error: { message: 'transient write failure' },
    });
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score_percent).toBe(50);
  });
});

describe('POST /api/diagnostic/complete — error paths', () => {
  it('returns 500 INSERT_ERROR and skips the summary update when the response insert fails', async () => {
    setResult('diagnostic_responses.insert', {
      data: null,
      error: { message: 'insert exploded' },
    });
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('INSERT_ERROR');
    expect(queriesFor('diagnostic_assessments', 'update').length).toBe(0);
  });

  it('returns 404 SESSION_NOT_FOUND when the assessment does not belong to the student', async () => {
    setResult('diagnostic_assessments.select', {
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns 404 NO_STUDENT when no student profile exists for the auth user', async () => {
    setResult('students.select', { data: null, error: { message: 'No rows' } });
    const res = await POST(makeRequest({ session_id: SESSION_ID, responses: makeResponses(4, 2) }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_STUDENT');
  });
});
