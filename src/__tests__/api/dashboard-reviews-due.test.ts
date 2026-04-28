import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/dashboard/reviews-due — Phase 2.D spaced-repetition CTA backend.
 *
 * Covers:
 *  - empty state (zero rows → dueCount=0, oldest=null, est=2 min floor)
 *  - single due item
 *  - many due items (estimate calculation, ceil(n*0.5) with min 2)
 *  - unauthorized (401 short-circuit)
 *  - cache headers (private, max-age=300)
 *  - P13 log redaction (no topic IDs / mastery values in logs)
 */

// ── RBAC mock ────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(studentId = 'student-uuid-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId,
    roles: ['student'],
    permissions: ['progress.view_own'],
  });
}

function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── Logger spy (for P13 redaction assertions) ────────────────────────────────
const loggerInfo = vi.fn();
const loggerError = vi.fn();
const loggerWarn = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: (...args: unknown[]) => loggerError(...args),
  },
}));

// ── supabaseAdmin mock ───────────────────────────────────────────────────────
let _queryResult: { data: unknown; error: unknown } = { data: [], error: null };

function setQueryResult(result: { data: unknown; error: unknown }) {
  _queryResult = result;
}

function chainMock() {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'lte', 'lt', 'gte', 'order', 'limit'];
  for (const m of methods) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  // Make the chain awaitable (terminal node).
  (chain as { then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise<unknown> }).then =
    (resolve, reject) => Promise.resolve(_queryResult).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => chainMock(),
  },
}));

function makeRequest(): Request {
  return new Request('http://localhost/api/dashboard/reviews-due', { method: 'GET' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _queryResult = { data: [], error: null };
  const mod = await import('@/app/api/dashboard/reviews-due/route');
  GET = mod.GET;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/reviews-due', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns dueCount=0 and estimatedMinutes=2 (floor) when no rows are due', async () => {
    setAuthorized();
    setQueryResult({ data: [], error: null });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.dueCount).toBe(0);
    expect(body.data.oldestDueDate).toBeNull();
    expect(body.data.estimatedMinutes).toBe(2);
  });

  it('returns dueCount=1 with floor 2-min estimate for a single due item', async () => {
    setAuthorized();
    setQueryResult({
      data: [{ next_review_date: '2026-04-20', mastery_probability: 0.6 }],
      error: null,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.dueCount).toBe(1);
    expect(body.data.oldestDueDate).toBe('2026-04-20');
    // Math.max(2, ceil(1 * 0.5)) === Math.max(2, 1) === 2
    expect(body.data.estimatedMinutes).toBe(2);
  });

  it('computes estimate as ceil(dueCount * 0.5) for many items', async () => {
    setAuthorized();
    // 11 items → ceil(5.5) = 6 minutes
    const rows = Array.from({ length: 11 }, (_, i) => ({
      next_review_date: `2026-04-${String(10 + i).padStart(2, '0')}`,
      mastery_probability: 0.5,
    }));
    setQueryResult({ data: rows, error: null });

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.dueCount).toBe(11);
    expect(body.data.estimatedMinutes).toBe(6);
    // First row in ascending order is oldest
    expect(body.data.oldestDueDate).toBe('2026-04-10');
  });

  it('sets Cache-Control: private, max-age=300', async () => {
    setAuthorized();
    setQueryResult({ data: [], error: null });

    const res = await GET(makeRequest());
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('private');
    expect(cc).toContain('max-age=300');
  });

  it('does NOT log topic IDs, titles, mastery values, or student_id (P13)', async () => {
    setAuthorized('student-PII-uuid');
    setQueryResult({
      data: [
        { next_review_date: '2026-04-20', mastery_probability: 0.42 },
        { next_review_date: '2026-04-21', mastery_probability: 0.81 },
      ],
      error: null,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    // P13: serialize ALL info() / warn() / error() calls and assert none of
    // the redacted fields leak. We allow dueCount and estimatedMinutes (the
    // documented public surface), but no topic IDs, titles, mastery values,
    // raw dates beyond the aggregated count, or the student UUID.
    const allLogs = JSON.stringify([
      ...loggerInfo.mock.calls,
      ...loggerWarn.mock.calls,
      ...loggerError.mock.calls,
    ]);

    expect(allLogs).not.toContain('student-PII-uuid');
    expect(allLogs).not.toContain('mastery_probability');
    expect(allLogs).not.toContain('0.42');
    expect(allLogs).not.toContain('0.81');
    expect(allLogs).not.toContain('topic_id');
    // dueCount IS allowed in logs (aggregate count is the success metric).
    expect(allLogs).toContain('reviews_due_served');
  });
});
