import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/v1/subject-readiness — Phase 3 of Exam-Ready 360°.
 *
 * Mirrors the chapter-readiness test suite but for the batch endpoint.
 * Covers: 401, 400 (subject), 400 (student_id), 403 (cross-student),
 * 404 (no student), 422 (malformed grade), 200 happy path with summary
 * computation, 200 empty-chapter list, 500 RPC error.
 */

const _authorizeImpl = vi.fn();
const _canAccessStudentImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  canAccessStudent: (...args: unknown[]) => _canAccessStudentImpl(...args),
}));

function setAuthorized(studentId = '11111111-1111-1111-1111-111111111111') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: '22222222-2222-2222-2222-222222222222',
    studentId,
    roles: ['student'],
    permissions: ['progress.view_own'],
  });
}

function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

vi.mock('@/lib/sanitize', () => ({
  isValidUUID: (s: unknown) =>
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let _studentRow: { data: unknown; error: unknown } = {
  data: { id: '11111111-1111-1111-1111-111111111111', grade: '9' },
  error: null,
};
let _rpcResult: { data: unknown; error: unknown } = {
  data: [
    { chapter_number: 1, level: 'ready', score: 92, concepts_total: 8, concepts_mastered: 7, recent_quiz_count: 5, rag_ready: true },
    { chapter_number: 2, level: 'almost', score: 75, concepts_total: 8, concepts_mastered: 6, recent_quiz_count: 3, rag_ready: true },
    { chapter_number: 3, level: 'building', score: 45, concepts_total: 6, concepts_mastered: 2, recent_quiz_count: 1, rag_ready: true },
    { chapter_number: 4, level: 'not_yet', score: 5, concepts_total: 7, concepts_mastered: 0, recent_quiz_count: 0, rag_ready: false },
  ],
  error: null,
};

function setStudentRow(row: { data: unknown; error: unknown }) {
  _studentRow = row;
}

function setRpcResult(result: { data: unknown; error: unknown }) {
  _rpcResult = result;
}

function chainMock() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit']) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  chain['single'] = () => Promise.resolve(_studentRow);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => chainMock(),
    rpc: vi.fn((..._args: unknown[]) => Promise.resolve(_rpcResult)),
  },
}));

function makeRequest(qs = '?subject=science'): Request {
  return new Request(`http://localhost/api/v1/subject-readiness${qs}`, { method: 'GET' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _studentRow = {
    data: { id: '11111111-1111-1111-1111-111111111111', grade: '9' },
    error: null,
  };
  _rpcResult = {
    data: [
      { chapter_number: 1, level: 'ready', score: 92, concepts_total: 8, concepts_mastered: 7, recent_quiz_count: 5, rag_ready: true },
      { chapter_number: 2, level: 'almost', score: 75, concepts_total: 8, concepts_mastered: 6, recent_quiz_count: 3, rag_ready: true },
      { chapter_number: 3, level: 'building', score: 45, concepts_total: 6, concepts_mastered: 2, recent_quiz_count: 1, rag_ready: true },
      { chapter_number: 4, level: 'not_yet', score: 5, concepts_total: 7, concepts_mastered: 0, recent_quiz_count: 0, rag_ready: false },
    ],
    error: null,
  };
  const mod = await import('@/app/api/v1/subject-readiness/route');
  GET = mod.GET;
});

describe('GET /api/v1/subject-readiness', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing subject', async () => {
    setAuthorized();
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid subject (uppercase / special chars)', async () => {
    setAuthorized();
    const res = await GET(makeRequest('?subject=Science!'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed student_id', async () => {
    setAuthorized();
    const res = await GET(makeRequest('?subject=science&student_id=not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller has no access to requested student', async () => {
    setAuthorized();
    _canAccessStudentImpl.mockResolvedValue(false);
    const res = await GET(
      makeRequest('?subject=science&student_id=99999999-9999-9999-9999-999999999999'),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when student lookup returns no row', async () => {
    setAuthorized();
    setStudentRow({ data: null, error: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it('returns 422 when student grade is malformed (P5 defense)', async () => {
    setAuthorized();
    setStudentRow({ data: { id: '11111111-1111-1111-1111-111111111111', grade: 'Class 9' }, error: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(422);
  });

  it('happy path: returns chapters + computed summary', async () => {
    setAuthorized();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.grade).toBe('9');
    expect(body.data.subject).toBe('science');
    expect(body.data.chapters).toHaveLength(4);
    // Summary computed from level field
    expect(body.data.summary).toEqual({ ready: 1, almost: 1, building: 1, not_yet: 1 });
  });

  it('returns zero-summary when RPC returns no chapters', async () => {
    setAuthorized();
    setRpcResult({ data: [], error: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.chapters).toHaveLength(0);
    expect(body.data.summary).toEqual({ ready: 0, almost: 0, building: 0, not_yet: 0 });
  });

  it('returns 500 when RPC errors', async () => {
    setAuthorized();
    setRpcResult({ data: null, error: { message: 'simulated DB error' } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('RPC_ERROR');
  });

  it('correctly counts multiple chapters in the same bucket', async () => {
    setAuthorized();
    setRpcResult({
      data: [
        { chapter_number: 1, level: 'ready', score: 90, concepts_total: 8, concepts_mastered: 7, recent_quiz_count: 5, rag_ready: true },
        { chapter_number: 2, level: 'ready', score: 95, concepts_total: 8, concepts_mastered: 8, recent_quiz_count: 5, rag_ready: true },
        { chapter_number: 3, level: 'ready', score: 87, concepts_total: 8, concepts_mastered: 7, recent_quiz_count: 5, rag_ready: true },
      ],
      error: null,
    });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.summary).toEqual({ ready: 3, almost: 0, building: 0, not_yet: 0 });
  });
});
