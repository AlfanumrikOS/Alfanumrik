/**
 * REG-393 — GET /api/rhythm/today must NOT cache a "no student profile" miss.
 *
 * ── THE SHIPPED DEFECT ───────────────────────────────────────────────────────
 * The route memoizes today's queue per student for CACHE_TTL.USER. The previous
 * implementation could not represent "the build returned nothing" inside a
 * cache that treats `null` as a miss, so it stored a TRUTHY SENTINEL:
 *
 *     return built ?? { __noProfile: true };
 *
 * That sentinel is a cache HIT. Combined with the cookie-only Supabase client
 * (the 2026-08-12 Bearer P0), ONE mobile request was enough to poison the key:
 * the Bearer caller's RLS reads denied → `buildRhythmQueue` returned null → the
 * sentinel was written → and every subsequent request from that student — WEB
 * INCLUDED, and even after the transport bug was fixed — was answered
 * `404 no_student_profile` straight from the cache until the TTL expired.
 * A transient/one-off failure was converted into a pinned outage for that user.
 *
 * ── WHAT THIS SUITE PINS (the property, not the idiom) ───────────────────────
 *   1. A failed/empty build is NOT retained as a cached answer: the NEXT
 *      request re-runs the build instead of being served the failure.
 *   2. Once the build succeeds, the student is served the real queue — i.e.
 *      recovery happens on the very next request, with no TTL wait.
 *   3. No TRUTHY sentinel is ever written under the cache key (the specific
 *      shape that caused the outage — a regression to any truthy marker is
 *      caught here even if it is spelled differently).
 *   4. The PERFORMANCE property the cache exists for is intact: a REAL result
 *      IS cached and the second request does not re-run the build.
 *   5. P13 — the cache key is per-student: one student's queue is never served
 *      to another.
 *
 * Harness note: `@alfanumrik/lib/cache` is deliberately REAL. Mocking it to a
 * pass-through would make this suite vacuous — the whole defect lived in what
 * the route handed the cache and what the cache did with it. Redis (L2) is
 * stubbed to "not configured" so only the deterministic in-memory L1 runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cacheGet, cacheInvalidatePrefix } from '@alfanumrik/lib/cache';

// ── Seams ───────────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Redis "not configured" → cacheGetAsync/SetAsync use L1 only, deterministically.
vi.mock('@alfanumrik/lib/redis', () => ({ getRedis: () => null }));

let _authUserId = 'auth-user-A';
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({ authorized: true, userId: _authUserId })),
  logAudit: vi.fn(),
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async () => true),
  PEDAGOGY_V2_FLAGS: { DAILY_RHYTHM: 'ff_pedagogy_v2_daily_rhythm' },
}));

// The Supabase clients are irrelevant here (buildRhythmQueue is mocked) — they
// just have to construct.
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ __transport: 'cookie' }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ __transport: 'bearer' }),
}));

/** Scripted queue builder: returns the next scripted value, or throws. */
const buildQueueMock = vi.fn();
vi.mock('@alfanumrik/lib/learn/build-rhythm-queue', () => ({
  buildRhythmQueue: (...a: unknown[]) => buildQueueMock(...a),
}));

const REAL_QUEUE = { items: [{ kind: 'srs_review', chapterNumber: 3 }], reflection: 'why?' };

/* eslint-disable @typescript-eslint/no-explicit-any */
let GET: any;

function req() {
  return new Request('http://localhost/api/rhythm/today', { method: 'GET' });
}

/** The exact cache key the route builds, so we can inspect what was stored. */
function cacheKeyFor(userId: string) {
  return `rhythm:today:${userId}:${Math.floor(Date.now() / 86_400_000)}`;
}

let userSeq = 0;
beforeEach(async () => {
  vi.clearAllMocks();
  // Independent test: a fresh userId per test means no test can inherit
  // another's cache entry from the module-level L1 Map.
  userSeq += 1;
  _authUserId = `auth-user-${userSeq}`;
  cacheInvalidatePrefix('rhythm:today:');
  GET = (await import('@/app/api/rhythm/today/route')).GET;
});

describe('REG-393 GET /api/rhythm/today — a no-profile miss is never pinned', () => {
  it('re-runs the build on the NEXT request instead of serving the cached 404', async () => {
    // 1st request: the lookup fails (this is what a Bearer caller saw for
    // months — RLS denied under `anon`, so the build produced nothing).
    buildQueueMock.mockResolvedValueOnce(null);
    const first = await GET(req());
    expect(first.status).toBe(404);
    expect((await first.json()).error).toBe('no_student_profile');
    expect(buildQueueMock).toHaveBeenCalledTimes(1);

    // 2nd request, SAME user, SAME day bucket → the build MUST run again.
    // Before the fix this was a cache hit on `{ __noProfile: true }` and the
    // build was never re-attempted until the TTL expired.
    buildQueueMock.mockResolvedValueOnce(null);
    const second = await GET(req());
    expect(second.status).toBe(404);
    expect(buildQueueMock).toHaveBeenCalledTimes(2);
  });

  it('recovers on the very next request once the build succeeds (no TTL wait)', async () => {
    buildQueueMock.mockResolvedValueOnce(null);
    expect((await GET(req())).status).toBe(404);

    // The underlying cause is fixed (or was transient). The student must be
    // served their real queue immediately — not a 404 for the rest of the TTL.
    buildQueueMock.mockResolvedValueOnce(REAL_QUEUE);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REAL_QUEUE);
  });

  it('writes NO truthy sentinel under the cache key for a failed build', async () => {
    buildQueueMock.mockResolvedValueOnce(null);
    await GET(req());

    // Whatever is (or is not) under the key, `cacheGet` must read back as a
    // MISS. `{ __noProfile: true }` — or any other truthy marker — reads back
    // as a HIT, which is the exact shape that pinned the outage. Both "nothing
    // stored" and "stored null" satisfy this; a sentinel does not.
    const stored = cacheGet<unknown>(cacheKeyFor(_authUserId));
    expect(stored).toBeNull();
    // Belt-and-braces on the historical shape specifically.
    expect(JSON.stringify(stored ?? null)).not.toContain('__noProfile');
  });

  it('does not pin a THROWN lookup failure either (500 is not cached)', async () => {
    buildQueueMock.mockRejectedValueOnce(new Error('supabase timeout'));
    const first = await GET(req());
    expect(first.status).toBe(500);
    expect((await first.json()).error).toBe('student_lookup_failed');

    buildQueueMock.mockResolvedValueOnce(REAL_QUEUE);
    const second = await GET(req());
    expect(second.status).toBe(200);
    expect(buildQueueMock).toHaveBeenCalledTimes(2);
  });
});

describe('REG-393 GET /api/rhythm/today — the cache still does its job', () => {
  it('DOES cache a real queue: the second request does not re-run the build', async () => {
    // The fix must not degrade into "never cache anything" — the route exists
    // partly to collapse ~5 Supabase reads on dashboard mount.
    buildQueueMock.mockResolvedValueOnce(REAL_QUEUE);
    const first = await GET(req());
    expect(first.status).toBe(200);

    const second = await GET(req());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(REAL_QUEUE);
    expect(buildQueueMock).toHaveBeenCalledTimes(1);
  });

  it('keys the cache per student — one student never sees another queue (P13)', async () => {
    const QUEUE_A = { items: ['A'] };
    const QUEUE_B = { items: ['B'] };

    _authUserId = 'student-A';
    buildQueueMock.mockResolvedValueOnce(QUEUE_A);
    expect(await (await GET(req())).json()).toEqual(QUEUE_A);

    _authUserId = 'student-B';
    buildQueueMock.mockResolvedValueOnce(QUEUE_B);
    expect(await (await GET(req())).json()).toEqual(QUEUE_B);

    // And A still gets A's (from A's own key), not B's.
    _authUserId = 'student-A';
    expect(await (await GET(req())).json()).toEqual(QUEUE_A);
  });

  it('never sends a shared/CDN cache header (the cache is server-side only)', async () => {
    buildQueueMock.mockResolvedValueOnce(REAL_QUEUE);
    const res = await GET(req());
    // Vercel's edge does not vary by auth — a public/s-maxage header here would
    // leak one student's queue to another.
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=0, must-revalidate');
  });
});
