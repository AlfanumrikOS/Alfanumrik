import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Super-admin grounding API smoke tests.
 *
 * Scope:
 *   - Auth gate: every route returns 401 when authorizeRequest denies
 *   - Permission code: every route requests `super_admin.access`
 *   - Happy-path shape: response has `success` + `data` and includes the
 *     contract fields Tasks 3.16/3.17 render (top-level keys only — deep
 *     value-equality is brittle).
 *   - Supabase client is mocked at the boundary — no network.
 */

// ─── Mocks ────────────────────────────────────────────────────────────

const mockAuthorizeRequest = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

// Chainable supabase query mock. Each method returns `this`, the terminal is
// a thenable (returns `{ data, error, count }`). We reset the canned result
// per test via `setSupabaseResult(...)`.
let supabaseResult: { data: unknown; error: unknown; count?: number } = { data: [], error: null };

function setSupabaseResult(r: { data?: unknown; error?: unknown; count?: number }) {
  supabaseResult = { data: r.data ?? [], error: r.error ?? null, count: r.count };
}

function makeChainable() {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(supabaseResult).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChainable()),
  },
  getSupabaseAdmin: () => ({
    from: vi.fn(() => makeChainable()),
  }),
}));

// Auth result helpers
const AUTH_OK = {
  authorized: true as const,
  userId: '11111111-1111-1111-1111-111111111111',
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  userId: null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
});

function buildRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSupabaseResult({ data: [], error: null, count: 0 });
});

// ─── /health ──────────────────────────────────────────────────────────

describe('GET /api/super-admin/grounding/health', () => {
  it('returns 401 when auth denies', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/grounding/health/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/health') as never);
    expect(res.status).toBe(401);
  });

  it('checks the super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/health/route');
    await GET(buildRequest('http://localhost/api/super-admin/grounding/health') as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(
      expect.anything(),
      'super_admin.access',
    );
  });

  it('happy path returns the expected top-level shape', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({ data: [], error: null, count: 0 });
    const { GET } = await import('@/app/api/super-admin/grounding/health/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/health') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(expect.objectContaining({
      callsPerMin: expect.any(Object),
      groundedRate: expect.any(Object),
      abstainBreakdown: expect.any(Object),
      latency: expect.objectContaining({ p50: expect.any(Number), p95: expect.any(Number), p99: expect.any(Number) }),
      circuitStates: expect.any(Object),
      voyageErrorRate: expect.any(Number),
      claudeErrorRate: expect.any(Number),
    }));
    // All 5 callers must be present in callsPerMin + groundedRate
    for (const c of ['foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic']) {
      expect(body.data.callsPerMin).toHaveProperty(c);
      expect(body.data.groundedRate).toHaveProperty(c);
    }
  });
});

// ─── /coverage ───────────────────────────────────────────────────────

describe('GET /api/super-admin/grounding/coverage', () => {
  it('returns 401 when auth denies', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/grounding/coverage/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/coverage') as never);
    expect(res.status).toBe(401);
  });

  it('checks super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/coverage/route');
    await GET(buildRequest('http://localhost/api/super-admin/grounding/coverage') as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });

  it('computes summary severity buckets from gap rows', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({
      data: [
        { board: 'CBSE', grade: '10', subject_code: 'science', severity: 'critical', request_count: 5, potential_affected_students: 100, chapter_number: 1, chapter_title: 'A', subject_display: 'Sci', rag_status: 'missing', chunk_count: 0, verified_question_count: 0, last_verified_at: null },
        { board: 'CBSE', grade: '10', subject_code: 'science', severity: 'critical', request_count: 2, potential_affected_students: 50, chapter_number: 2, chapter_title: 'B', subject_display: 'Sci', rag_status: 'missing', chunk_count: 0, verified_question_count: 0, last_verified_at: null },
        { board: 'CBSE', grade: '10', subject_code: 'math', severity: 'high', request_count: 1, potential_affected_students: 20, chapter_number: 1, chapter_title: 'M', subject_display: 'Math', rag_status: 'partial', chunk_count: 5, verified_question_count: 1, last_verified_at: null },
        { board: 'CBSE', grade: '9', subject_code: 'science', severity: 'medium', request_count: 0, potential_affected_students: 10, chapter_number: 1, chapter_title: 'C', subject_display: 'Sci', rag_status: 'partial', chunk_count: 15, verified_question_count: 5, last_verified_at: null },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/grounding/coverage/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/coverage') as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.summary).toEqual({ total_gaps: 4, critical: 2, high: 1, medium: 1 });
    expect(body.data.gaps).toHaveLength(4);
    expect(body.data.filters).toEqual({ grade: null, subject: null });
  });

  it('passes grade+subject filters through query params', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/coverage/route');
    const res = await GET(
      buildRequest('http://localhost/api/super-admin/grounding/coverage?grade=10&subject=science') as never,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.filters).toEqual({ grade: '10', subject: 'science' });
  });
});

// ─── /verification-queue ─────────────────────────────────────────────

describe('GET /api/super-admin/grounding/verification-queue', () => {
  it('returns 401 when auth denies', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/verification-queue') as never);
    expect(res.status).toBe(401);
  });

  it('checks super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    await GET(buildRequest('http://localhost/api/super-admin/grounding/verification-queue') as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });

  it('happy path returns counts + byPair + failedSample + throughput', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({ data: [], error: null, count: 0 });
    const { GET } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/verification-queue') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(expect.objectContaining({
      counts: expect.objectContaining({
        legacy_unverified: expect.any(Number),
        pending: expect.any(Number),
        verified: expect.any(Number),
        failed: expect.any(Number),
      }),
      byPair: expect.any(Array),
      failedSample: expect.any(Array),
      throughputLast24h: expect.objectContaining({
        verified_per_hour: expect.any(Number),
        failed_per_hour: expect.any(Number),
      }),
    }));
  });
});

// ─── /traces ─────────────────────────────────────────────────────────

describe('GET /api/super-admin/grounding/traces', () => {
  it('returns 401 when auth denies', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/grounding/traces/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/traces?traceId=11111111-1111-1111-1111-111111111111') as never);
    expect(res.status).toBe(401);
  });

  it('rejects request with no search mode (400)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/traces/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/traces') as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/traceId|studentId|abstainReason/);
  });

  it('rejects malformed UUID (400)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/traces/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/traces?traceId=not-a-uuid') as never);
    expect(res.status).toBe(400);
  });

  it('rejects invalid abstainReason (400)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/traces/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/traces?abstainReason=bogus') as never);
    expect(res.status).toBe(400);
  });

  it('traceId search happy path', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({
      data: [{ id: '11111111-1111-1111-1111-111111111111', grounded: true, caller: 'foxy' }],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/grounding/traces/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/traces?traceId=11111111-1111-1111-1111-111111111111') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.traces).toHaveLength(1);
    expect(body.data.count).toBe(1);
  });

  it('abstainReason search accepts valid reason', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({ data: [], error: null });
    const { GET } = await import('@/app/api/super-admin/grounding/traces/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/traces?abstainReason=chapter_not_ready') as never);
    expect(res.status).toBe(200);
  });
});

// ─── /ai-issues ──────────────────────────────────────────────────────

describe('GET /api/super-admin/grounding/ai-issues', () => {
  it('returns 401 when auth denies', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/ai-issues') as never);
    expect(res.status).toBe(401);
  });

  it('checks super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    await GET(buildRequest('http://localhost/api/super-admin/grounding/ai-issues') as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });

  it('rejects invalid status', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/ai-issues?status=bogus') as never);
    expect(res.status).toBe(400);
  });

  it('empty result returns zero issues with expected shape', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({ data: [], error: null });
    const { GET } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const res = await GET(buildRequest('http://localhost/api/super-admin/grounding/ai-issues?status=pending') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(expect.objectContaining({
      issues: [],
      count: 0,
      status: 'pending',
    }));
  });

  it('accepts status=resolved and status=all', async () => {
    for (const s of ['resolved', 'all'] as const) {
      mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
      setSupabaseResult({ data: [], error: null });
      const { GET } = await import('@/app/api/super-admin/grounding/ai-issues/route');
      const res = await GET(buildRequest(`http://localhost/api/super-admin/grounding/ai-issues?status=${s}`) as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe(s);
    }
  });
});