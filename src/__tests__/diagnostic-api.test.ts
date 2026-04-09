import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Diagnostic API route tests
 *
 * Covers:
 *   POST /api/diagnostic/start  — auth, grade validation, subject validation
 *   POST /api/diagnostic/complete — auth, session_id validation
 *
 * P5: diagnostic grades are strings "6"-"10" (grade "11" is invalid for diagnostic)
 * P9: both routes require an authenticated session
 */

// ── Mock: createSupabaseServerClient ─────────────────────────────────────────
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

// ── Mock: getSupabaseAdmin (service-role client) ──────────────────────────────
// Per-table result map — tests call setFromResult(table, result) to control responses.
let _tableResults: Map<string, unknown> = new Map();
let _rpcResult: unknown = { data: null, error: null };

function setFromResult(table: string, result: unknown) {
  _tableResults.set(table, result);
}

function setRpcResult(result: unknown) {
  _rpcResult = result;
}

// Chain proxy: supports await, .select(), .eq(), .single(), .insert(), .limit(), .order()
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

const mockRpc = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: string) => chain(_tableResults.get(table) ?? { data: null, error: null }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  })),
  supabaseAdmin: {
    from: (table: string) => chain(_tableResults.get(table) ?? { data: null, error: null }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStartRequest(body: unknown, token?: string): NextRequest {
  return new NextRequest('http://localhost/api/diagnostic/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeCompleteRequest(body: unknown, token?: string): NextRequest {
  return new NextRequest('http://localhost/api/diagnostic/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const MOCK_USER = { id: 'auth-user-1', email: 'student@test.com' };

beforeEach(() => {
  vi.clearAllMocks();
  _tableResults = new Map();
  _rpcResult = { data: null, error: null };
  mockRpc.mockResolvedValue({ data: null, error: null });
  // Default: not authenticated
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } });
});

// =============================================================================
// POST /api/diagnostic/start
// =============================================================================

describe('POST /api/diagnostic/start — authentication', () => {
  it('returns 401 when user is not authenticated', async () => {
    // mockGetUser is already defaulting to unauthenticated
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 when getUser returns null user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/diagnostic/start — grade validation (P5)', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  });

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
    // Authenticated, but student not found — still verifies grade is accepted
    setFromResult('students', { data: null, error: { message: 'Not found' } });
    const { POST } = await import('@/app/api/diagnostic/start/route');
    const res = await POST(makeStartRequest({ grade: '6', subject: 'math' }));
    // Should not be 400 INVALID_GRADE — may be 404 for missing student
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
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  });

  it('returns 400 when subject is invalid for the given grade', async () => {
    const { POST } = await import('@/app/api/diagnostic/start/route');
    // Grade 6 only allows math, science — not physics
    const res = await POST(makeStartRequest({ grade: '6', subject: 'physics' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('INVALID_SUBJECT');
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
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    setFromResult('students', { data: { id: 'student-1', grade: '9' }, error: null });
    setFromResult('questions', {
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

describe('POST /api/diagnostic/complete — authentication', () => {
  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } });
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const res = await POST(
      makeCompleteRequest({ session_id: 'session-1', responses: [] }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_REQUIRED');
  });
});

describe('POST /api/diagnostic/complete — input validation', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  });

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
    const res = await POST(
      makeCompleteRequest({ session_id: '', responses: [] }),
    );
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
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    const { POST } = await import('@/app/api/diagnostic/complete/route');
    const req = new NextRequest('http://localhost/api/diagnostic/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    setFromResult('students', { data: { id: 'student-1' }, error: null });
    setFromResult('diagnostic_sessions', { data: { id: 'session-1', status: 'in_progress' }, error: null });
    setFromResult('diagnostic_responses', { data: null, error: null });
  });

  it('falls back to in-process score calculation when RPC fails, using P1 formula', async () => {
    // RPC fails — route falls back to Math.round((correct / total) * 100)
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
    const { POST } = await import('@/app/api/diagnostic/complete/route');

    const responses = [
      { question_id: 'q1', selected_answer_index: 0, is_correct: true,  time_taken_seconds: 10, topic: 'algebra', difficulty: 2, bloom_level: 'understand' },
      { question_id: 'q2', selected_answer_index: 1, is_correct: true,  time_taken_seconds: 8,  topic: 'algebra', difficulty: 2, bloom_level: 'apply' },
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
