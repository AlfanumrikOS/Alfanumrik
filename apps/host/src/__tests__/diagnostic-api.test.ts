import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Diagnostic API route tests
 *
 * Covers:
 *   POST /api/diagnostic/start  — auth, grade validation, subject validation
 *   POST /api/diagnostic/complete — auth, session_id validation, server-side
 *     P1 scoring (full contract pinned in api/diagnostic-complete-contract.test.ts)
 *
 * P5: diagnostic grades are STRINGS "6".."12". Grades "11" and "12" became VALID
 *     on 2026-07-29 (spec `2026-07-29-diagnostic-cold-start-correctness.md` §4 G1:
 *     `resolve-next-action` routes every zero-mastery student to /diagnostic, so
 *     the old "6".."10" range made a Class 11 student's very first CTA a 400).
 *     The two tests that asserted 400 for "11"/"12" were correct for the old
 *     range and are INVERTED here — the assertion is not weakened, the spec moved.
 *     Integer grades are still rejected (P5).
 * P9: both routes require authorizeRequest('diagnostic.attempt' / 'diagnostic.complete')
 *
 * Mock strategy (matching api-routes.test.ts standard):
 *   - Mock @alfanumrik/lib/rbac authorizeRequest directly — most reliable way to control
 *     the P9 gate without fighting Supabase JWT resolution in unit tests.
 *   - Mock @alfanumrik/lib/supabase-admin for database operations.
 */

// ── Shared thenable chain proxy ────────────────────────────────────────────────
function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then')        return p.then.bind(p);
      if (prop === 'catch')       return p.catch.bind(p);
      if (prop === 'finally')     return p.finally.bind(p);
      if (prop === 'single')      return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

// ── RBAC mock ─────────────────────────────────────────────────────────────────
// authorizeRequest is mocked at module level; tests control return value via
// _authorizeImpl.  Default: unauthorized (returns 401 AUTH_REQUIRED).

const _authorizeImpl = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['student'],
    permissions: ['diagnostic.attempt', 'diagnostic.complete'],
  });
}

function setUnauthorized(status = 401, code = 'AUTH_REQUIRED') {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: code, code }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── supabaseAdmin mock ────────────────────────────────────────────────────────
let _tableResults: Map<string, unknown> = new Map();
const mockRpc = vi.fn();

function setFromResult(table: string, result: unknown) {
  _tableResults.set(table, result);
}

function setRpcResult(result: unknown) {
  mockRpc.mockResolvedValue(result);
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: string) => chain(_tableResults.get(table) ?? { data: null, error: null }),
    rpc:  (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  })),
  supabaseAdmin: {
    from: (table: string) => chain(_tableResults.get(table) ?? { data: null, error: null }),
    rpc:  (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  },
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStartRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/diagnostic/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function makeCompleteRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/diagnostic/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _tableResults = new Map();
  mockRpc.mockResolvedValue({ data: null, error: null });
  // Default: unauthorized — tests opt in by calling setAuthorized()
  setUnauthorized();
});

// =============================================================================
// POST /api/diagnostic/start
// =============================================================================

describe('POST /api/diagnostic/start — authentication (P9)', () => {
  it('returns 401 when user is not authenticated', async () => {
    setUnauthorized(401, 'AUTH_REQUIRED');
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 403 when authenticated user lacks diagnostic.attempt permission', async () => {
    setUnauthorized(403, 'NO_PERMISSION');
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe('POST /api/diagnostic/start — grade validation (P5)', () => {
  beforeEach(() => { setAuthorized(); });

  // ── INVERTED 2026-07-29 (spec §4 G1). These two asserted 400 for "11"/"12",
  //    which was correct while VALID_DIAGNOSTIC_GRADES was ['6'..'10']. The spec
  //    widened the range to ['6'..'12'] because resolve-next-action sends every
  //    zero-mastery student — all grades — to /diagnostic, so a Class 11
  //    student's first CTA used to be a hard 400. AC-14.
  it('accepts grade "11" as a STRING (AC-14 — senior grades are in range)', async () => {
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '11', subject: 'math' }));
    const body = await res.json();
    expect(body.code).not.toBe('INVALID_GRADE');
  });

  it('accepts grade "12" as a STRING (AC-14)', async () => {
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '12', subject: 'math' }));
    const body = await res.json();
    expect(body.code).not.toBe('INVALID_GRADE');
  });

  it('returns 400 when grade is "5" (below diagnostic range)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '5', subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_GRADE');
  });

  it('returns 400 when grade is "13" (above the widened range — the range moved, it did not vanish)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '13', subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_GRADE');
  });

  it('returns 400 when grade is integer 9 (P5: must be string)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: 9, subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_GRADE');
  });

  it('returns 400 when grade is integer 11 (P5 / AC-15: the widened range is STRINGS only)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: 11, subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_GRADE');
  });

  it('accepts every string grade "6".."12" and rejects its integer twin (P5, table-driven)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      setFromResult('students', { data: null, error: { message: 'Not found' } });
      const ok = await POST(makeStartRequest({ grade: g, subject: 'math' }));
      expect((await ok.json()).code, `string grade "${g}"`).not.toBe('INVALID_GRADE');

      const bad = await POST(makeStartRequest({ grade: Number(g), subject: 'math' }));
      expect(bad.status, `integer grade ${g}`).toBe(400);
      expect((await bad.json()).code).toBe('INVALID_GRADE');
    }
  });

  it('returns 400 when grade is missing', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_GRADE');
  });

  it('accepts grade "6" (lowest valid diagnostic grade)', async () => {
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '6', subject: 'math' }));
    const body = await res.json();
    expect(body.code).not.toBe('INVALID_GRADE');
  });

  it('accepts grade "10" (highest valid diagnostic grade)', async () => {
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '10', subject: 'math' }));
    const body = await res.json();
    expect(body.code).not.toBe('INVALID_GRADE');
  });
});

describe('POST /api/diagnostic/start — subject validation', () => {
  beforeEach(() => { setAuthorized(); });

  it('returns 422 when subject is not allowed for the student (Phase C: validateSubjectWrite)', async () => {
    // Phase C subject governance: after resolving the student, route calls
    // get_available_subjects RPC. If the requested subject isn't in the allowed
    // list (grade × stream × plan), the route returns 422 subject_not_allowed.
    setFromResult('students', { data: { id: 'student-1', grade: '6' }, error: null });
    // RPC returns only math + science for grade 6 — physics is not allowed.
    setRpcResult({
      data: [
        { code: 'math', name: 'Math', name_hi: null, icon: '', color: '', subject_kind: 'cbse_core', is_core: true, is_locked: false },
        { code: 'science', name: 'Science', name_hi: null, icon: '', color: '', subject_kind: 'cbse_core', is_core: true, is_locked: false },
      ],
      error: null,
    });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '6', subject: 'physics' }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('subject_not_allowed');
    expect(body.subject).toBe('physics');
    expect(body.reason).toBe('grade');
  });

  it('returns 400 when subject is missing', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_SUBJECT');
  });

  it('returns 400 when subject is an empty string', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_SUBJECT');
  });

  it('accepts "math" for grade "6"', async () => {
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '6', subject: 'math' }));
    const body = await res.json();
    expect(body.code).not.toBe('INVALID_SUBJECT');
  });

  it('accepts "physics" for grade "9"', async () => {
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: 'physics' }));
    const body = await res.json();
    expect(body.code).not.toBe('INVALID_SUBJECT');
  });

  it('subject matching is case-insensitive', async () => {
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '8', subject: 'SCIENCE' }));
    const body = await res.json();
    expect(body.code).not.toBe('INVALID_SUBJECT');
  });
});

/**
 * ── REWRITTEN 2026-07-29 (spec §5.3 F2/F3) ─────────────────────────────────
 * This block was called "full success path" and asserted a session_id from a
 * ONE-item, chapter-less, unverified fixture. Under the old
 * `ORDER BY difficulty ASC LIMIT 15` selector that fixture happened to produce
 * a session; under the §1 blueprint + §2 Tier-0 gate it cannot satisfy any
 * rung (no in-scope chapters, no hard band, no HOTS), so the honest outcome is
 * the Rung-4 stop. The fixture describes an EMPTY pool, so that is what it now
 * asserts — the assertion is corrected, not weakened.
 *
 * A genuinely well-supplied pool (Rung 0, 15 questions, session created) is
 * covered in src/__tests__/api/diagnostic-start-contract.test.ts.
 */
describe('POST /api/diagnostic/start — insufficient pool → Rung 4 honest stop', () => {
  beforeEach(() => {
    setAuthorized();
    setFromResult('students', { data: { id: 'student-1', grade: '9' }, error: null });
    // Phase C: get_available_subjects RPC must return the requested subject as
    // allowed (is_locked=false) for validateSubjectWrite to pass.
    setRpcResult({
      data: [
        { code: 'math', name: 'Math', name_hi: null, icon: '', color: '', subject_kind: 'cbse_core', is_core: true, is_locked: false },
      ],
      error: null,
    });
    // NOTE: table name is question_bank (not questions) per P-schema
    setFromResult('question_bank', {
      data: [
        {
          id: 'q1', question_text: 'What is 2+2?', options: ['2', '3', '4', '5'],
          correct_answer_index: 2, explanation: 'Basic addition', difficulty: 1, bloom_level: 'remember',
        },
      ],
      error: null,
    });
    // P0 cross-layer fix (2026-06-10): the route now writes to
    // diagnostic_assessments (the table /api/diagnostic/complete reads),
    // not the orphaned diagnostic_sessions table.
    setFromResult('diagnostic_assessments', { data: { id: 'session-uuid-1' }, error: null });
  });

  it('returns HTTP 200 (never a 4xx/5xx dead end) with content_insufficient for an unservable pool', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.diagnostic).toBeNull();
    expect(body.insufficientContent).toBe(true);
    expect(body.reason).toBe('INSUFFICIENT_POOL');
    expect(body.data.content_insufficient).toBe(true);
    // AC-22 — the student is never handed a dead end.
    expect(Array.isArray(body.alternatives)).toBe(true);
    expect(body.alternatives.length).toBeGreaterThanOrEqual(1);
    // No half-started session is offered.
    expect(body.data.session_id).toBeUndefined();
  });
});

// =============================================================================
// POST /api/diagnostic/complete
// =============================================================================

describe('POST /api/diagnostic/complete — authentication (P9)', () => {
  it('returns 401 when user is not authenticated', async () => {
    setUnauthorized(401, 'AUTH_REQUIRED');
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const res = await POST(makeCompleteRequest({ session_id: 'session-1', responses: [] }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 403 when authenticated user lacks diagnostic.complete permission', async () => {
    setUnauthorized(403, 'NO_PERMISSION');
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const res = await POST(makeCompleteRequest({ session_id: 'session-1', responses: [] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe('POST /api/diagnostic/complete — input validation', () => {
  beforeEach(() => { setAuthorized(); });

  it('returns 400 when session_id is missing', async () => {
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const res = await POST(
      makeCompleteRequest({ responses: [{ question_id: 'q1', selected_answer_index: 0, is_correct: true, time_taken_seconds: 5, topic: null, difficulty: 1, bloom_level: 'remember' }] }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('MISSING_SESSION_ID');
  });

  it('returns 400 when session_id is an empty string', async () => {
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const res = await POST(makeCompleteRequest({ session_id: '', responses: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('MISSING_SESSION_ID');
  });

  it('returns 400 when responses array is missing', async () => {
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const res = await POST(makeCompleteRequest({ session_id: 'session-1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('MISSING_RESPONSES');
  });

  it('returns 400 when responses is an empty array', async () => {
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const res = await POST(makeCompleteRequest({ session_id: 'session-1', responses: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('MISSING_RESPONSES');
  });

  it('returns 400 when request body is not valid JSON', async () => {
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const req = new NextRequest('http://localhost/api/diagnostic/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: 'not-json{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_BODY');
  });
});

describe('POST /api/diagnostic/complete — server-side scoring (P1 score accuracy)', () => {
  // P0 cross-layer fix (2026-06-10): the route no longer calls an RPC. It
  // verifies the diagnostic_assessments row, replaces diagnostic_responses
  // (delete-then-insert), and computes the summary in-process with the P1
  // formula. Full contract (409, thresholds, ordering) is pinned in
  // src/__tests__/api/diagnostic-complete-contract.test.ts.
  // C1 (spec §7A, 2026-07-29): correctness is re-derived SERVER-side from
  // question_bank.correct_answer_index. This block therefore needs a REAL bank
  // fixture — the previous `question_bank: []` stub could only produce a
  // non-zero score if the route trusted the client's `is_correct`, so it was
  // pinning the very defect the route now closes. Full adversarial coverage
  // lives in src/__tests__/api/diagnostic-complete-contract.test.ts.
  const BANK = [
    { id: 'q1', question_text: 'Synthetic algebra item one — pick the correct option.', options: ['a', 'b', 'c', 'd'], correct_answer_index: 0 },
    { id: 'q2', question_text: 'Synthetic algebra item two — pick the correct option.', options: ['a', 'b', 'c', 'd'], correct_answer_index: 1 },
    { id: 'q3', question_text: 'Synthetic geometry item one — pick the correct option.', options: ['a', 'b', 'c', 'd'], correct_answer_index: 3 },
    { id: 'q4', question_text: 'Synthetic geometry item two — pick the correct option.', options: ['a', 'b', 'c', 'd'], correct_answer_index: 2 },
  ];

  beforeEach(() => {
    setAuthorized();
    setFromResult('students', { data: { id: 'student-1' }, error: null });
    setFromResult('diagnostic_assessments', { data: { id: 'session-1', is_completed: false }, error: null });
    setFromResult('diagnostic_responses', { data: null, error: null });
    setFromResult('question_bank', { data: BANK, error: null });
  });

  it('computes the summary server-side with the P1 formula (no RPC involved)', async () => {
    const { POST } = await import('@/app/api/diagnostic/complete/route');

    // q1 (picked 0, correct 0) ✓ ; q2 (picked 1, correct 1) ✓ ;
    // q3 (picked 2, correct 3) ✗ ; q4 (picked 0, correct 2) ✗
    const responses = [
      { question_id: 'q1', selected_answer_index: 0, is_correct: true,  time_taken_seconds: 10, topic: 'algebra',  difficulty: 2, bloom_level: 'understand' },
      { question_id: 'q2', selected_answer_index: 1, is_correct: true,  time_taken_seconds: 8,  topic: 'algebra',  difficulty: 2, bloom_level: 'apply' },
      { question_id: 'q3', selected_answer_index: 2, is_correct: false, time_taken_seconds: 12, topic: 'geometry', difficulty: 3, bloom_level: 'analyze' },
      { question_id: 'q4', selected_answer_index: 0, is_correct: false, time_taken_seconds: 6,  topic: 'geometry', difficulty: 3, bloom_level: 'remember' },
    ];

    const res = await POST(makeCompleteRequest({ session_id: 'session-1', responses }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // 2 server-verified correct out of 4 = Math.round((2/4)*100) = 50
    expect(body.data.score_percent).toBe(50);
    expect(body.data.correct_answers).toBe(2);
    expect(body.data.total_questions).toBe(4);
    // The completion path is direct table writes — no RPC may be invoked
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('ignores the client is_correct flag entirely (C1) — an all-true claim on the same indices still scores 50', async () => {
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const responses = [
      { question_id: 'q1', selected_answer_index: 0, is_correct: true, time_taken_seconds: 10, topic: 'algebra',  difficulty: 2, bloom_level: 'understand' },
      { question_id: 'q2', selected_answer_index: 1, is_correct: true, time_taken_seconds: 8,  topic: 'algebra',  difficulty: 2, bloom_level: 'apply' },
      { question_id: 'q3', selected_answer_index: 2, is_correct: true, time_taken_seconds: 12, topic: 'geometry', difficulty: 3, bloom_level: 'analyze' },
      { question_id: 'q4', selected_answer_index: 0, is_correct: true, time_taken_seconds: 6,  topic: 'geometry', difficulty: 3, bloom_level: 'remember' },
    ];
    const res = await POST(makeCompleteRequest({ session_id: 'session-1', responses }));
    const body = await res.json();
    expect(body.data.score_percent).toBe(50);
    expect(body.data.correct_answers).toBe(2);
  });
});
