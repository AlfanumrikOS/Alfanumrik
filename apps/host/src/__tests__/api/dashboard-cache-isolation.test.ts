/**
 * Phase 5 — server-side aggregate cache safety (P13: per-student data must
 * never be shared).
 *
 * Six read-only per-student GET routes now wrap their expensive Supabase read
 * in `cacheFetchAsync` (CACHE_TTL.USER = 30s) keyed by the AUTHENTICATED
 * student_id/userId. The cache store is a module-level in-memory Map that
 * survives between requests, so this suite pins the four invariants that keep
 * that cache from leaking one student's data to another:
 *
 *   1. NO CROSS-USER LEAK — two different authenticated students get their own
 *      payloads even inside the same 30s window (the key includes their id).
 *   2. NO AUTH BYPASS — a denied request returns the auth error and never
 *      receives a cached body (the cache read is keyed off the id derived
 *      AFTER authorizeRequest; a denied request never reaches the cache).
 *   3. TTL COALESCES — a repeat call for the SAME student within the window
 *      collapses to a single DB fetch (the cache short-circuits the read).
 *   4. ERROR/404 NOT PINNED — a transient DB error / no-profile branch is not
 *      cached; a subsequent success returns fresh data.
 *
 * Heaviest route under test: /api/v2/student/progress (still on the
 * service-role supabase-admin client). One more: the
 * /api/dashboard/reviews-due count route, which XC-3 Phase 2 batch 2
 * (REG-218) migrated to the RLS-respecting createSupabaseServerClient().
 * Both share the authorizeRequest → cacheFetchAsync shape; the cache key is
 * the authenticated student_id either way, so the P13 isolation invariants
 * hold against whichever data client the route reads through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC mock (shared) ────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function authAs(studentId: string | null) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: `auth-${studentId}`,
    studentId,
    roles: ['student'],
    permissions: ['progress.view_own'],
  });
}

function authDenied(status = 403) {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'FORBIDDEN', code: 'FORBIDDEN' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// v2/student/progress mock harness — per-student DB rows + a read spy so we
// can assert the cache collapses repeat reads.
// ─────────────────────────────────────────────────────────────────────────
// Keyed by student_id so each student returns DISTINCT data.
const progressRowsByStudent: Record<string, { performance: unknown[] }> = {};
// Forced error: when set for a student_id, the performance_scores read throws.
const progressErrorFor = new Set<string>();
const progressReadSpy = vi.fn();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  // v2/student/progress uses getSupabaseAdmin()
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'lt']) chain[m] = () => chain;
      // .eq('student_id', id) captures which student is being read.
      let boundStudent = '';
      chain.eq = (_col: string, val: string) => {
        boundStudent = val;
        return chain;
      };
      const resolve = () => {
        progressReadSpy(table, boundStudent);
        if (table === 'performance_scores') {
          if (progressErrorFor.has(boundStudent)) {
            throw new Error('transient_db_error');
          }
          return { data: progressRowsByStudent[boundStudent]?.performance ?? [] };
        }
        // concept_mastery / learning_velocity not central to isolation — keep empty.
        return { data: [] };
      };
      chain.limit = () => Promise.resolve(resolve());
      chain.then = (res: (v: unknown) => unknown) => res(resolve());
      return chain;
    },
    rpc: () => Promise.resolve({ data: [] }),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────
// dashboard/reviews-due mock harness — XC-3 Phase 2 batch 2 (REG-218): the
// route migrated from the RLS-bypassing service-role `supabaseAdmin` singleton
// to the RLS-respecting `createSupabaseServerClient()`. The cache-isolation
// invariants (REG-115/P13) are unchanged — they are now enforced against the
// server client. Per-student rows are keyed by the bound student_id and a read
// spy lets us assert the 30s cache collapses repeat reads.
// ─────────────────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      let boundStudent = '';
      for (const m of ['select', 'lte', 'lt', 'gte', 'order']) chain[m] = () => chain;
      chain.eq = (_col: string, val: string) => {
        boundStudent = val;
        return chain;
      };
      (chain as { then: (r: (v: unknown) => void, j: (e: unknown) => void) => Promise<unknown> }).then =
        (resolve, reject) => {
          reviewsReadSpy(boundStudent);
          if (reviewsErrorFor.has(boundStudent)) {
            return Promise.resolve({ data: null, error: { message: 'transient_db_error' } }).then(resolve, reject);
          }
          return Promise.resolve({
            data: reviewsRowsByStudent[boundStudent] ?? [],
            error: null,
          }).then(resolve, reject);
        };
      return chain;
    },
  })),
}));

// reviews-due harness state
const reviewsRowsByStudent: Record<string, unknown[]> = {};
const reviewsErrorFor = new Set<string>();
const reviewsReadSpy = vi.fn();

async function clearCaches() {
  const { cacheInvalidatePrefix } = await import('@alfanumrik/lib/cache');
  cacheInvalidatePrefix('v2:student:progress:');
  cacheInvalidatePrefix('dashboard:reviews-due:');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let progressGET: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reviewsGET: any;

const progressReq = () =>
  new Request('http://localhost/api/v2/student/progress', { method: 'GET' });
const reviewsReq = () =>
  new Request('http://localhost/api/dashboard/reviews-due', { method: 'GET' });

beforeEach(async () => {
  vi.clearAllMocks();
  progressReadSpy.mockClear();
  reviewsReadSpy.mockClear();
  progressErrorFor.clear();
  reviewsErrorFor.clear();
  for (const k of Object.keys(progressRowsByStudent)) delete progressRowsByStudent[k];
  for (const k of Object.keys(reviewsRowsByStudent)) delete reviewsRowsByStudent[k];
  await clearCaches();
  progressGET = (await import('@/app/api/v2/student/progress/route')).GET;
  reviewsGET = (await import('@/app/api/dashboard/reviews-due/route')).GET;
});

describe('Phase 5 cache isolation — /api/v2/student/progress', () => {
  it('does NOT leak student A cached data to student B (distinct keys → distinct payloads)', async () => {
    progressRowsByStudent[STUDENT_A] = {
      performance: [{ subject: 'math', overall_score: 11, level_name: 'A-level', updated_at: '2026-06-01' }],
    };
    progressRowsByStudent[STUDENT_B] = {
      performance: [{ subject: 'science', overall_score: 99, level_name: 'B-level', updated_at: '2026-06-01' }],
    };

    // Student A populates the cache.
    authAs(STUDENT_A);
    const aBody = await (await progressGET(progressReq())).json();
    expect(aBody.data.student_id).toBe(STUDENT_A);
    expect(aBody.data.performance_scores[0].overall_score).toBe(11);

    // Student B — same 30s window — must get THEIR OWN data, never A's.
    authAs(STUDENT_B);
    const bBody = await (await progressGET(progressReq())).json();
    expect(bBody.data.student_id).toBe(STUDENT_B);
    expect(bBody.data.performance_scores[0].overall_score).toBe(99);
    expect(bBody.data.performance_scores[0].subject).toBe('science');
    // Hard negative: B never sees A's value.
    expect(JSON.stringify(bBody)).not.toContain('A-level');
    expect(bBody.data.performance_scores[0].overall_score).not.toBe(11);
  });

  it('a denied request returns the auth error and NEVER receives a prior student cached body', async () => {
    progressRowsByStudent[STUDENT_A] = {
      performance: [{ subject: 'math', overall_score: 11, level_name: 'A-level', updated_at: '2026-06-01' }],
    };
    // Prime the cache as authorized student A.
    authAs(STUDENT_A);
    const ok = await progressGET(progressReq());
    expect(ok.status).toBe(200);

    // Now a denied request: must short-circuit at authorizeRequest, returning
    // the auth error — the cache read happens AFTER auth and is keyed off the
    // authorized id, so a denied caller can never reach A's cached payload.
    authDenied(403);
    const denied = await progressGET(progressReq());
    expect(denied.status).toBe(403);
    const deniedBody = await denied.json();
    expect(deniedBody.code).toBe('FORBIDDEN');
    expect(JSON.stringify(deniedBody)).not.toContain('A-level');
    expect(JSON.stringify(deniedBody)).not.toContain(STUDENT_A);
  });

  it('collapses a repeat call for the same student within the 30s TTL to a single DB fetch', async () => {
    progressRowsByStudent[STUDENT_A] = {
      performance: [{ subject: 'math', overall_score: 50, level_name: 'X', updated_at: '2026-06-01' }],
    };
    authAs(STUDENT_A);

    await progressGET(progressReq());
    const readsAfterFirst = progressReadSpy.mock.calls.filter((c) => c[0] === 'performance_scores').length;
    expect(readsAfterFirst).toBe(1);

    // Second call within TTL — served from cache, does NOT re-hit the DB read.
    await progressGET(progressReq());
    const readsAfterSecond = progressReadSpy.mock.calls.filter((c) => c[0] === 'performance_scores').length;
    expect(readsAfterSecond).toBe(1);
  });

  it('does NOT cache a transient DB error — a later success returns fresh data', async () => {
    authAs(STUDENT_A);
    progressErrorFor.add(STUDENT_A); // first call throws inside the fetcher
    const errRes = await progressGET(progressReq());
    expect(errRes.status).toBe(500);

    // Recover: the error must not have been pinned, so a retry fetches fresh.
    progressErrorFor.delete(STUDENT_A);
    progressRowsByStudent[STUDENT_A] = {
      performance: [{ subject: 'math', overall_score: 77, level_name: 'OK', updated_at: '2026-06-01' }],
    };
    const okRes = await progressGET(progressReq());
    expect(okRes.status).toBe(200);
    const body = await okRes.json();
    expect(body.data.performance_scores[0].overall_score).toBe(77);
  });
});

describe('Phase 5 cache isolation — /api/dashboard/reviews-due', () => {
  it('does NOT leak student A cached count to student B', async () => {
    // A has 3 due rows, B has 1. Fixtures use next_review_at (timestamptz) —
    // the real SM-2 schedule; next_review_date is a deprecated ghost column.
    reviewsRowsByStudent[STUDENT_A] = [
      { next_review_at: '2026-04-10T08:00:00+00:00', mastery_probability: 0.4 },
      { next_review_at: '2026-04-11T08:00:00+00:00', mastery_probability: 0.5 },
      { next_review_at: '2026-04-12T08:00:00+00:00', mastery_probability: 0.6 },
    ];
    reviewsRowsByStudent[STUDENT_B] = [
      { next_review_at: '2026-04-20T08:00:00+00:00', mastery_probability: 0.3 },
    ];

    authAs(STUDENT_A);
    const a = await (await reviewsGET(reviewsReq())).json();
    expect(a.data.dueCount).toBe(3);
    expect(a.data.oldestDueDate).toBe('2026-04-10');

    authAs(STUDENT_B);
    const b = await (await reviewsGET(reviewsReq())).json();
    expect(b.data.dueCount).toBe(1);
    expect(b.data.oldestDueDate).toBe('2026-04-20');
  });

  it('a denied request returns the auth error, not a prior cached count', async () => {
    reviewsRowsByStudent[STUDENT_A] = [
      { next_review_at: '2026-04-10T08:00:00+00:00', mastery_probability: 0.4 },
    ];
    authAs(STUDENT_A);
    expect((await reviewsGET(reviewsReq())).status).toBe(200);

    authDenied(403);
    const denied = await reviewsGET(reviewsReq());
    expect(denied.status).toBe(403);
    const body = await denied.json();
    expect(body.code).toBe('FORBIDDEN');
    expect(JSON.stringify(body)).not.toContain('dueCount');
  });

  it('collapses a repeat call within the 30s TTL to a single DB fetch', async () => {
    reviewsRowsByStudent[STUDENT_A] = [
      { next_review_at: '2026-04-10T08:00:00+00:00', mastery_probability: 0.4 },
    ];
    authAs(STUDENT_A);

    await reviewsGET(reviewsReq());
    expect(reviewsReadSpy.mock.calls.filter((c) => c[0] === STUDENT_A).length).toBe(1);

    await reviewsGET(reviewsReq());
    // Still 1 — second call served from cache.
    expect(reviewsReadSpy.mock.calls.filter((c) => c[0] === STUDENT_A).length).toBe(1);
  });

  it('does NOT cache a transient DB error — a later success returns fresh', async () => {
    authAs(STUDENT_A);
    reviewsErrorFor.add(STUDENT_A);
    const errRes = await reviewsGET(reviewsReq());
    expect(errRes.status).toBe(500);

    reviewsErrorFor.delete(STUDENT_A);
    reviewsRowsByStudent[STUDENT_A] = [
      { next_review_at: '2026-04-10T08:00:00+00:00', mastery_probability: 0.4 },
      { next_review_at: '2026-04-11T08:00:00+00:00', mastery_probability: 0.5 },
    ];
    const okRes = await reviewsGET(reviewsReq());
    expect(okRes.status).toBe(200);
    const body = await okRes.json();
    expect(body.data.dueCount).toBe(2);
  });
});
