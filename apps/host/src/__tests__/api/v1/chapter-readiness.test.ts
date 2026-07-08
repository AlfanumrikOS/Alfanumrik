import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/v1/chapter-readiness — Phase 1 of Exam-Ready 360°.
 *
 * Covers:
 *  - 401 unauthorized
 *  - 400 invalid/missing subject
 *  - 400 invalid/missing chapter
 *  - 400 invalid student_id format
 *  - 403 cross-student access denied (no parent/teacher linkage)
 *  - 404 student not found
 *  - 422 student has malformed grade (P5 defense)
 *  - 200 happy path returns full readiness shape
 *  - 200 empty RPC resultset returns clean "not_yet" stub shape
 *  - 500 RPC error
 */

// ── RBAC mock ────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _canAccessStudentImpl = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
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

// ── isValidUUID mock ─────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/sanitize', () => ({
  isValidUUID: (s: unknown) =>
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

// ── Logger mock ──────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── supabaseAdmin mock ───────────────────────────────────────────────────────
let _studentRow: { data: unknown; error: unknown } = {
  data: { id: '11111111-1111-1111-1111-111111111111', grade: '9' },
  error: null,
};
let _rpcResult: { data: unknown; error: unknown } = {
  data: [
    {
      level: 'almost',
      score: 78,
      mastery_avg: 75.5,
      concepts_total: 8,
      concepts_mastered: 6,
      recent_quiz_avg: 72.0,
      recent_quiz_count: 3,
      spaced_reviews: 2,
      rag_ready: true,
      next_action: 'spaced_review',
      message_en: 'Almost there.',
      message_hi: 'लगभग तैयार।',
    },
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
  // .single() is the terminal — returns the studentRow result.
  chain['single'] = () => Promise.resolve(_studentRow);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => chainMock(),
    rpc: vi.fn((..._args: unknown[]) => Promise.resolve(_rpcResult)),
  },
}));

function makeRequest(qs = '?subject=science&chapter=4'): Request {
  return new Request(`http://localhost/api/v1/chapter-readiness${qs}`, { method: 'GET' });
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
      {
        level: 'almost',
        score: 78,
        mastery_avg: 75.5,
        concepts_total: 8,
        concepts_mastered: 6,
        recent_quiz_avg: 72.0,
        recent_quiz_count: 3,
        spaced_reviews: 2,
        rag_ready: true,
        next_action: 'spaced_review',
        message_en: 'Almost there.',
        message_hi: 'लगभग तैयार।',
      },
    ],
    error: null,
  };
  const mod = await import('@/app/api/v1/chapter-readiness/route');
  GET = mod.GET;
});

describe('GET /api/v1/chapter-readiness', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing subject', async () => {
    setAuthorized();
    const res = await GET(makeRequest('?chapter=4'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.error).toMatch(/subject/i);
  });

  it('returns 400 for invalid subject (uppercase / special chars)', async () => {
    setAuthorized();
    const res = await GET(makeRequest('?subject=Science!&chapter=4'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing chapter', async () => {
    setAuthorized();
    const res = await GET(makeRequest('?subject=science'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/chapter/i);
  });

  it('returns 400 for non-integer chapter', async () => {
    setAuthorized();
    const res = await GET(makeRequest('?subject=science&chapter=abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for chapter out of range (0 / 51)', async () => {
    setAuthorized();
    const r1 = await GET(makeRequest('?subject=science&chapter=0'));
    expect(r1.status).toBe(400);
    const r2 = await GET(makeRequest('?subject=science&chapter=51'));
    expect(r2.status).toBe(400);
  });

  it('returns 400 for malformed student_id', async () => {
    setAuthorized();
    const res = await GET(makeRequest('?subject=science&chapter=4&student_id=not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller has no access to the requested student', async () => {
    setAuthorized('11111111-1111-1111-1111-111111111111');
    _canAccessStudentImpl.mockResolvedValue(false);
    const res = await GET(
      makeRequest('?subject=science&chapter=4&student_id=99999999-9999-9999-9999-999999999999'),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when student lookup returns no row', async () => {
    setAuthorized();
    setStudentRow({ data: null, error: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it('returns 422 when student has malformed grade (P5 defense)', async () => {
    setAuthorized();
    setStudentRow({
      data: { id: '11111111-1111-1111-1111-111111111111', grade: 'Grade 9' },
      error: null,
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('NO_GRADE');
  });

  it('returns 422 when student grade is null', async () => {
    setAuthorized();
    setStudentRow({
      data: { id: '11111111-1111-1111-1111-111111111111', grade: null },
      error: null,
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(422);
  });

  it('happy path: returns full readiness shape with grade/subject/chapter echoed', async () => {
    setAuthorized();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.level).toBe('almost');
    expect(body.data.score).toBe(78);
    expect(body.data.concepts_total).toBe(8);
    expect(body.data.concepts_mastered).toBe(6);
    expect(body.data.next_action).toBe('spaced_review');
    expect(body.data.message_en).toBe('Almost there.');
    expect(body.data.message_hi).toBe('लगभग तैयार।');
    // Echoed scope so the client doesn't have to track the request.
    expect(body.data.grade).toBe('9');
    expect(body.data.subject).toBe('science');
    expect(body.data.chapter).toBe(4);
  });

  it('returns clean not_yet stub when RPC returns empty resultset', async () => {
    setAuthorized();
    setRpcResult({ data: [], error: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.level).toBe('not_yet');
    expect(body.data.score).toBe(0);
    expect(body.data.concepts_total).toBe(0);
    expect(body.data.next_action).toBe('introduce_concept');
    // Bilingual fallback present
    expect(typeof body.data.message_en).toBe('string');
    expect(typeof body.data.message_hi).toBe('string');
  });

  it('returns 500 when RPC fails', async () => {
    setAuthorized();
    setRpcResult({ data: null, error: { message: 'simulated DB error' } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('RPC_ERROR');
  });
});
