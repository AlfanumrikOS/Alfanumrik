import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Diagnostic API route tests
 *
 * Covers:
 *   POST /api/diagnostic/start  — auth, grade validation, subject validation
 *   POST /api/diagnostic/complete — auth, session_id validation, RPC fallback
 *
 * P5: diagnostic grades are strings "6"-"10" (grade "11" is invalid for diagnostic)
 * P9: both routes require authorizeRequest('diagnostic.attempt' / 'diagnostic.complete')
 *
 * Mock strategy (matching api-routes.test.ts standard):
 *   - Mock @/lib/rbac authorizeRequest directly — most reliable way to control
 *     the P9 gate without fighting Supabase JWT resolution in unit tests.
 *   - Mock @/lib/supabase-admin for database operations.
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

vi.mock('@/lib/rbac', () => ({
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

vi.mock('@/lib/supabase-admin', () => ({
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
vi.mock('@/lib/logger', () => ({
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

  it('returns 400 when grade is "11" (diagnostic only covers grades 6-10)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '11', subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('INVALID_GRADE');
  });

  it('returns 400 when grade is "12" (above diagnostic range)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '12', subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_GRADE');
  });

  it('returns 400 when grade is "5" (below diagnostic range)', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '5', subject: 'math' }));
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

describe('POST /api/diagnostic/start — full success path', () => {
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
    setFromResult('diagnostic_sessions', { data: { id: 'session-uuid-1' }, error: null });
  });

  it('returns 200 with session_id and questions on valid request', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.session_id).toBeDefined();
    expect(Array.isArray(body.data.questions)).toBe(true);
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

describe('POST /api/diagnostic/complete — RPC fallback (P1 score accuracy)', () => {
  beforeEach(() => {
    setAuthorized();
    setFromResult('students', { data: { id: 'student-1' }, error: null });
    setFromResult('diagnostic_sessions', { data: { id: 'session-1', status: 'in_progress' }, error: null });
    setFromResult('diagnostic_responses', { data: null, error: null });
  });

  it('falls back to in-process score calculation when RPC fails, using P1 formula', async () => {
    // RPC fails — route falls back to Math.round((correct / total) * 100)
    setRpcResult({ data: null, error: { message: 'RPC unavailable' } });
    const { POST } = await import('@/app/api/diagnostic/complete/route');

    const responses = [
      { question_id: 'q1', selected_answer_index: 0, is_correct: true,  time_taken_seconds: 10, topic: 'algebra',  difficulty: 2, bloom_level: 'understand' },
      { question_id: 'q2', selected_answer_index: 1, is_correct: true,  time_taken_seconds: 8,  topic: 'algebra',  difficulty: 2, bloom_level: 'apply' },
      { question_id: 'q3', selected_answer_index: 2, is_correct: false, time_taken_seconds: 12, topic: 'geometry', difficulty: 3, bloom_level: 'analyze' },
      { question_id: 'q4', selected_answer_index: 0, is_correct: false, time_taken_seconds: 6,  topic: 'geometry', difficulty: 3, bloom_level: 'remember' },
    ];

    const res = await POST(makeCompleteRequest({ session_id: 'session-1', responses }));
    // Fallback returns 200 even when RPC fails
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // 2 correct out of 4 = Math.round((2/4)*100) = 50
    expect(body.data.score_percent).toBe(50);
    expect(body.data.correct_answers).toBe(2);
    expect(body.data.total_questions).toBe(4);
    expect(body.data.rpc_failed).toBe(true);
  });
});
