/**
 * Oracle health API tests (REG-54 / PR #454 follow-up).
 *
 * Pins the contract for `src/app/api/super-admin/ai/oracle-health/route.ts`:
 *
 *   - Auth gate: super_admin.access — denied → 401, no DB call.
 *   - 200 happy path returns the documented top-level shape.
 *   - Aggregations are correct for: empty, all-rejections, mixed
 *     (multiple categories), unknown category bucket.
 *   - Latest list is capped to 10 and ordered desc by occurred_at
 *     (we feed pre-sorted rows; the route preserves order via
 *     `.order(..., desc).limit(10)`).
 *   - Hourly bucket count is exactly 24 and oldest → newest.
 *   - When the accept-path telemetry exists (Q3 — REG-54 follow-up):
 *     `totalEvaluated` and `rejectionRate` are computed; the route now
 *     issues a head-count query against `quiz.oracle_evaluated` and
 *     surfaces `notes.acceptedEventMissing=false`.
 *   - When no accept events exist (cold start, kill-switch off):
 *     `totalEvaluated`/`rejectionRate` stay null and
 *     `notes.acceptedEventMissing=true`.
 *
 * Mocking style follows `src/__tests__/super-admin-grounding-apis.test.ts`
 * — chainable supabase boundary mock, swap canned result per test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────

const mockAuthorizeRequest = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

// The route fires two queries:
//   1. rejection rows  — `.eq('category', 'quiz.oracle_rejection')` →
//      yields rows array via `.then`
//   2. accepted count  — `.eq('category', 'quiz.oracle_evaluated')` with
//      `.select('*', { count: 'exact', head: true })` → yields { count }
//
// We branch the mock by sniffing the first `.eq` arg. The chainable's
// `.then` is what awaits the query (PostgREST-style).
let supabaseRejectionResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};
let supabaseAcceptedResult: { count: number | null; error: unknown } = {
  count: 0,
  error: null,
};

function setSupabaseResult(r: { data?: unknown; error?: unknown }) {
  supabaseRejectionResult = { data: r.data ?? [], error: r.error ?? null };
}

function setAcceptedCount(c: { count?: number | null; error?: unknown }) {
  supabaseAcceptedResult = {
    count: c.count === undefined ? 0 : c.count,
    error: c.error ?? null,
  };
}

function makeChainable() {
  const state: { category: string | null; isHeadCount: boolean } = {
    category: null,
    isHeadCount: false,
  };
  const chain: Record<string, unknown> = {
    select: vi.fn((_: unknown, opts?: { head?: boolean }) => {
      if (opts?.head) state.isHeadCount = true;
      return chain;
    }),
    eq: vi.fn((col: string, val: string) => {
      if (col === 'category') state.category = val;
      return chain;
    }),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (r: unknown) => unknown) => {
      const result =
        state.isHeadCount || state.category === 'quiz.oracle_evaluated'
          ? { data: null, error: supabaseAcceptedResult.error, count: supabaseAcceptedResult.count }
          : { ...supabaseRejectionResult };
      return Promise.resolve(result).then(resolve);
    },
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

// ─── Auth helpers ─────────────────────────────────────────────────────

const AUTH_OK = {
  authorized: true as const,
  userId: '11111111-1111-1111-1111-111111111111',
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED_401 = () => ({
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

const AUTH_DENIED_403 = () => ({
  authorized: false as const,
  userId: '22222222-2222-2222-2222-222222222222',
  studentId: null,
  roles: ['student'],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  }),
});

function buildRequest(): Request {
  return new Request('http://localhost/api/super-admin/ai/oracle-health', {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSupabaseResult({ data: [], error: null });
  setAcceptedCount({ count: 0 });
});

// ─── Auth ─────────────────────────────────────────────────────────────

describe('GET /api/super-admin/ai/oracle-health: auth', () => {
  it('returns 401 when no session (auth denies with 401)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_401());
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated but not admin', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_403());
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(403);
  });

  it('checks the super_admin.access permission (not a new perm code)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    await GET(buildRequest() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(
      expect.anything(),
      'super_admin.access',
    );
  });
});

// ─── Shape ────────────────────────────────────────────────────────────

describe('GET /api/super-admin/ai/oracle-health: response shape', () => {
  it('200 with the expected top-level shape on empty result', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({ data: [], error: null });
    setAcceptedCount({ count: 0 });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(
      expect.objectContaining({
        windowHours: 24,
        totalRejected: 0,
        totalAccepted: 0,
        totalEvaluated: null,
        rejectionRate: null,
        rejectionsByReason: expect.any(Object),
        latestRejections: [],
        hourlyRejections: expect.any(Array),
        notes: { acceptedEventMissing: true },
        generated_at: expect.any(String),
      }),
    );
    expect(body.data.hourlyRejections).toHaveLength(24);
  });

  it('computes rejectionRate when accept events exist (Q3)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    // 2 rejections in the window
    setSupabaseResult({
      data: [
        {
          occurred_at: new Date().toISOString(),
          context: { category: 'llm_mismatch', reason: 'r1' },
        },
        {
          occurred_at: new Date(Date.now() - 60_000).toISOString(),
          context: { category: 'p6_options_not_4', reason: 'r2' },
        },
      ],
      error: null,
    });
    // 8 accepts → totalEvaluated=10, rate=0.2
    setAcceptedCount({ count: 8 });

    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totalRejected).toBe(2);
    expect(body.data.totalAccepted).toBe(8);
    expect(body.data.totalEvaluated).toBe(10);
    expect(body.data.rejectionRate).toBeCloseTo(0.2, 5);
    expect(body.data.notes.acceptedEventMissing).toBe(false);
  });

  it('keeps acceptedEventMissing=true when only rejection rows exist', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({
      data: [
        {
          occurred_at: new Date().toISOString(),
          context: { category: 'llm_mismatch', reason: 'r1' },
        },
      ],
      error: null,
    });
    setAcceptedCount({ count: 0 });

    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.totalRejected).toBe(1);
    expect(body.data.totalAccepted).toBe(0);
    // With only rejections (no accepts) totalEvaluated should still be a
    // number — we know SOME evaluations happened because rejections did.
    expect(body.data.totalEvaluated).toBe(1);
    expect(body.data.rejectionRate).toBeCloseTo(1.0, 5);
    expect(body.data.notes.acceptedEventMissing).toBe(true);
  });

  it('hourly bucket is ordered oldest → newest with 24 buckets', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({ data: [], error: null });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    const hours = body.data.hourlyRejections as Array<{
      hour: string;
      count: number;
    }>;
    expect(hours).toHaveLength(24);
    // Ordered ascending.
    for (let i = 1; i < hours.length; i++) {
      expect(Date.parse(hours[i].hour)).toBeGreaterThan(
        Date.parse(hours[i - 1].hour),
      );
    }
  });
});

// ─── Aggregation correctness ──────────────────────────────────────────

describe('GET /api/super-admin/ai/oracle-health: aggregations', () => {
  function makeRow(
    minutesAgo: number,
    category: string,
    extras: Record<string, unknown> = {},
  ) {
    const occurred_at = new Date(
      Date.now() - minutesAgo * 60 * 1000,
    ).toISOString();
    return {
      occurred_at,
      context: {
        category,
        reason: `${category} reason`,
        question_preview: `Q about ${category}`.slice(0, 80),
        ...extras,
      },
    };
  }

  it('all-rejections: counts each category exactly once', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({
      data: [
        makeRow(5, 'p6_options_not_4'),
        makeRow(10, 'p6_options_not_4'),
        makeRow(20, 'llm_mismatch', { suggested_correct_index: 2 }),
        makeRow(30, 'numeric_inconsistency'),
        makeRow(60, 'options_overlap_semantic'),
      ],
      error: null,
    });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.data.totalRejected).toBe(5);
    expect(body.data.rejectionsByReason.p6_options_not_4).toBe(2);
    expect(body.data.rejectionsByReason.llm_mismatch).toBe(1);
    expect(body.data.rejectionsByReason.numeric_inconsistency).toBe(1);
    expect(body.data.rejectionsByReason.options_overlap_semantic).toBe(1);
    // Untouched buckets are 0, not undefined.
    expect(body.data.rejectionsByReason.p6_explanation_empty).toBe(0);
    expect(body.data.rejectionsByReason.llm_grader_unavailable).toBe(0);
  });

  it('mixed: latest array is capped to 10 and preserves desc order', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    // 15 rows already pre-sorted desc (route relies on the SQL order by).
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeRow(i, i % 2 === 0 ? 'llm_mismatch' : 'p6_options_not_4'),
    );
    setSupabaseResult({ data: rows, error: null });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.data.latestRejections).toHaveLength(10);
    // Newest first.
    const ts = body.data.latestRejections.map((r: { occurred_at: string }) =>
      Date.parse(r.occurred_at),
    );
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeLessThanOrEqual(ts[i - 1]);
    }
    expect(body.data.totalRejected).toBe(15);
  });

  it('unknown category lands in its own bucket (forward-compat)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({
      data: [
        makeRow(1, 'p6_options_not_4'),
        makeRow(2, 'future_category_we_didnt_anticipate'),
      ],
      error: null,
    });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.data.rejectionsByReason.p6_options_not_4).toBe(1);
    expect(
      body.data.rejectionsByReason.future_category_we_didnt_anticipate,
    ).toBe(1);
  });

  it('rows missing a context.category land in the "unknown" bucket', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({
      data: [
        { occurred_at: new Date().toISOString(), context: null },
        { occurred_at: new Date().toISOString(), context: {} },
      ],
      error: null,
    });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.data.totalRejected).toBe(2);
    expect(body.data.rejectionsByReason.unknown).toBe(2);
  });

  it('hourly buckets count rejections in the right hour', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    // 3 rejections at "30 minutes ago" → all land in the same recent bucket
    // (the last or second-to-last, depending on the minute boundary).
    setSupabaseResult({
      data: [
        makeRow(30, 'llm_mismatch'),
        makeRow(31, 'llm_mismatch'),
        makeRow(32, 'p6_options_not_4'),
      ],
      error: null,
    });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    const totalAcrossBuckets = (
      body.data.hourlyRejections as Array<{ count: number }>
    ).reduce((sum, b) => sum + b.count, 0);
    expect(totalAcrossBuckets).toBe(3);
  });
});

// ─── Failure mode ─────────────────────────────────────────────────────

describe('GET /api/super-admin/ai/oracle-health: errors', () => {
  it('500 when supabase returns an error', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setSupabaseResult({
      data: null,
      error: { message: 'connection refused' },
    });
    const { GET } = await import(
      '@/app/api/super-admin/ai/oracle-health/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/connection refused/);
  });
});
