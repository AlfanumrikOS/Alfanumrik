/**
 * REG-392 — the IDENTITY-ROUTE FAMILY must resolve a `Authorization: Bearer`
 * caller's own student profile instead of degrading to 404 / empty state.
 *
 * ── THE SHIPPED DEFECT ───────────────────────────────────────────────────────
 * Twelve request-scoped routes built their student-scoped Supabase client with
 * the COOKIE-ONLY `createSupabaseServerClient()`. The Flutter app authenticates
 * with a Bearer header and sends no Supabase cookie, so PostgREST saw no user,
 * `auth.uid()` was NULL, every RLS SELECT denied, and the routes did NOT error —
 * they degraded:
 *
 *   * `/api/v2/today`, `/api/rhythm/today`, `/api/learner/next`,
 *     `/api/learner/revise-stack`, `/api/learner/weak-topics`,
 *     `/api/learner/scheduled`, `/api/dive/state`, `/api/synthesis/state`
 *       → `404 no_student_profile` for a student whose row was perfectly fine;
 *   * `/api/dive/history` → the EMPTY-history success shape (the student's real
 *     dives looked like they had never happened);
 *   * `/api/lesson` → `NO_GRADE`.
 *
 * A silent-empty is the dangerous half: nothing alerts, and the student simply
 * sees an app with no history.
 *
 * ── WHAT THIS SUITE PINS ─────────────────────────────────────────────────────
 * Part 1 (BEHAVIOURAL, the three prioritised routes): with a Bearer header and
 *   NO cookie, the client the route reads student state through is the
 *   Bearer/anon-key client with the caller's JWT forwarded — asserted at the
 *   module boundary, i.e. the cookie-only client is provably NOT the one used —
 *   and the response is the student's real state, not a 404/empty shape. The
 *   same routes are re-run cookie-only to prove web behaviour is unchanged.
 *
 * Part 2 (STRUCTURAL, all twelve routes): every route in the family constructs
 *   its student-scoped client through `createSupabaseRouteClient(request)`, and
 *   any remaining cookie-only construction is an EXPLICITLY DOCUMENTED holdout.
 *   This is a pattern check, and it is honest about being one: it proves the
 *   Bearer-aware helper is wired in, not that each route's RLS reads succeed.
 *   Behavioural proof for the other nine is future work (see the catalog entry).
 *
 * Invariants: P8 (RLS enforced on BOTH transports — never service-role),
 * P9 (RBAC still gates first), P13 (per-student data).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ════════════════════════════════════════════════════════════════════════════
// Shared transport seams. Two clients with a marker so we can tell which one
// the route actually read student state through.
// ════════════════════════════════════════════════════════════════════════════
const createClientSpy = vi.fn();
const createServerClientSpy = vi.fn();

/** Marker put on the client built from the Bearer/anon-key path. */
const BEARER = 'bearer-anon-client';
/** Marker put on the cookie-session client. */
const COOKIE = 'cookie-session-client';

function stubClient(marker: string) {
  const chain: Record<string, unknown> = { __transport: marker };
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'gte', 'lte', 'not']) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(res, rej);
  return {
    __transport: marker,
    from: () => chain,
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts: unknown) => {
    createClientSpy(url, key, opts);
    return stubClient(BEARER);
  },
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => {
    createServerClientSpy();
    return stubClient(COOKIE);
  },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => stubClient('admin'),
  supabaseAdmin: stubClient('admin'),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/redis', () => ({ getRedis: () => null }));

const AUTH_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STUDENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JWT = 'flutter-caller-access-token';

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['study_plan.view'],
  })),
  canAccessStudent: vi.fn(async () => true),
  hasAnyPermission: vi.fn(async () => true),
  logAudit: vi.fn(),
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async () => true),
  PEDAGOGY_V2_FLAGS: { DAILY_RHYTHM: 'ff_pedagogy_v2_daily_rhythm' },
  CONSUMER_MINIMALISM_FLAGS: { TODAY_HOME_V1: 'ff_today_home_v1' },
  ADAPTIVE_REMEDIATION_FLAGS: { V1: 'ff_adaptive_remediation_v1' },
}));

vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: vi.fn(async () => {}),
  hashDistinctId: (v: string) => `h:${v}`,
}));

// ── State builder: records WHICH client it was constructed with ──────────────
/** Every `{ sb }` client the route handed the canonical state builder. */
const builderClients: string[] = [];
/** A StudentState with one weak chapter and idle live state — the resolver's
 *  catch-all branch fires, so the response is deterministic. */
const STATE = {
  studentId: STUDENT_ID,
  mastery: [
    {
      subjectCode: 'math',
      meanMastery: 0.5,
      chapters: [{ chapterNumber: 4, mastery: 0.5, lastUpdatedAt: null, attempts: 20 }],
    },
  ],
  live: { kind: 'idle' },
};
vi.mock('@alfanumrik/lib/state/student-state-builder', () => ({
  createStudentStateBuilder: ({ sb }: { sb: { __transport?: string } }) => {
    builderClients.push(sb?.__transport ?? 'unknown');
    return async () => STATE;
  },
}));

vi.mock('@alfanumrik/lib/state/learner-loop/resolve-next-action', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@alfanumrik/lib/state/learner-loop/resolve-next-action')>();
  return {
    ...actual,
    buildLoopAugmentation: vi.fn(async () => ({
      dueReviewCount: 0,
      attemptedQuizToday: false,
      inProgressLessons: [],
    })),
  };
});

vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: vi.fn(async () => ({ published: false, reason: 'flag_off' })),
}));

// ── rhythm/today's queue builder: records the client it was given ────────────
const rhythmClients: string[] = [];
const RHYTHM_QUEUE = { items: [{ kind: 'srs_review' }] };
vi.mock('@alfanumrik/lib/learn/build-rhythm-queue', () => ({
  buildRhythmQueue: async (sb: { __transport?: string }) => {
    rhythmClients.push(sb?.__transport ?? 'unknown');
    return RHYTHM_QUEUE;
  },
}));

// ── Request builders ────────────────────────────────────────────────────────
function bearerReq(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${JWT}` },
  });
}
function cookieReq(path: string) {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let todayGET: any;
let rhythmGET: any;
let nextGET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // DETERMINISM: the resolvers branch on IST calendar day (weekly dive on
  // Sunday, monthly synthesis at month end). Pin a mid-week, mid-month instant
  // so the asserted catch-all branch is stable on every real calendar date.
  vi.setSystemTime(new Date('2026-06-10T09:00:00+05:30'));
  builderClients.length = 0;
  rhythmClients.length = 0;
  // rhythm/today memoizes per (user, day) in a module-level Map — clear it so
  // each test is independent and actually reaches the builder.
  const { cacheInvalidatePrefix } = await import('@alfanumrik/lib/cache');
  cacheInvalidatePrefix('rhythm:today:');
  todayGET = (await import('@/app/api/v2/today/route')).GET;
  rhythmGET = (await import('@/app/api/rhythm/today/route')).GET;
  nextGET = (await import('@/app/api/learner/next/route')).GET;
});

afterEach(() => {
  vi.useRealTimers();
});

// ════════════════════════════════════════════════════════════════════════════
// Part 1 — behavioural, the three prioritised routes.
// ════════════════════════════════════════════════════════════════════════════
describe('REG-392 GET /api/v2/today — Bearer caller reads state on the Bearer client', () => {
  it('builds student state on the BEARER client, not the cookie-only one', async () => {
    const res = await todayGET(bearerReq('/api/v2/today'), { params: Promise.resolve({}) });

    expect(builderClients).toEqual([BEARER]);
    expect(builderClients).not.toContain(COOKIE);
    expect(createServerClientSpy).not.toHaveBeenCalled();
    // The real regression symptom: a spurious 404 for a student with a row.
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  it('forwards the caller JWT under the anon key (RLS enforced, not service-role)', async () => {
    await todayGET(bearerReq('/api/v2/today'), { params: Promise.resolve({}) });
    expect(createClientSpy).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClientSpy.mock.calls[0];
    expect(url).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(key).toBe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect((opts as any).global.headers.Authorization).toBe(`Bearer ${JWT}`);
  });

  it('cookie-only (web) caller is unchanged: state still built on the cookie client', async () => {
    const res = await todayGET(cookieReq('/api/v2/today'), { params: Promise.resolve({}) });
    expect(builderClients).toEqual([COOKIE]);
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

describe('REG-392 GET /api/rhythm/today — Bearer caller reads the queue on the Bearer client', () => {
  it('builds the rhythm queue on the BEARER client, not the cookie-only one', async () => {
    const res = await rhythmGET(bearerReq('/api/rhythm/today'));

    expect(rhythmClients).toEqual([BEARER]);
    expect(createServerClientSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RHYTHM_QUEUE);
  });

  it('cookie-only (web) caller is unchanged', async () => {
    const res = await rhythmGET(cookieReq('/api/rhythm/today'));
    expect(rhythmClients).toEqual([COOKIE]);
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

describe('REG-392 GET /api/learner/next — Bearer caller resolves a real next action', () => {
  it('builds student state on the BEARER client, not the cookie-only one', async () => {
    const res = await nextGET(bearerReq('/api/learner/next'));

    expect(builderClients).toEqual([BEARER]);
    expect(createServerClientSpy).not.toHaveBeenCalled();
    // Before the fix this route answered 404 no_student_profile for every
    // mobile caller because the builder's RLS reads denied under `anon`.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.action).toBeTruthy();
  });

  it('cookie-only (web) caller is unchanged', async () => {
    const res = await nextGET(cookieReq('/api/learner/next'));
    expect(builderClients).toEqual([COOKIE]);
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part 2 — structural conformance across the whole family.
//
// This is a PATTERN check, deliberately. It proves the Bearer-aware helper is
// wired into every route that resolves a caller's own identity, which is what
// the 2026-08-12 audit found missing in twelve places at once. It does NOT
// prove each route's RLS reads succeed under a real JWT — only the three
// behavioural suites above do that for their routes.
// ════════════════════════════════════════════════════════════════════════════
const API_ROOT = join(process.cwd(), 'src', 'app', 'api');

/**
 * Strip block + line comments so the checks below see CODE only.
 *
 * Every one of these routes now carries a long comment explaining the P0 and
 * naming `createSupabaseServerClient()` in prose. Matching raw source would
 * make the documentation itself fail the test — and, worse, would tempt someone
 * to delete the explanation to make CI green.
 */
function codeOf(rel: string): string {
  return readFileSync(join(API_ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The twelve routes swapped onto the Bearer-aware client (P0, 2026-08-12). */
const IDENTITY_ROUTES = [
  'quiz/submit/route.ts',
  'v2/quiz/submit/route.ts',
  'v2/today/route.ts',
  'rhythm/today/route.ts',
  'learner/next/route.ts',
  'learner/revise-stack/route.ts',
  'learner/weak-topics/route.ts',
  'learner/scheduled/route.ts',
  'dive/state/route.ts',
  'dive/history/route.ts',
  'synthesis/state/route.ts',
  'lesson/route.ts',
] as const;

/**
 * The architect's follow-up batch (APPROVE WITH CONDITIONS on the P0 fix).
 *
 * These are NOT identity-resolution routes — they are the routes whose
 * SECURITY DEFINER RPCs carry the SAME
 * `auth.uid() IS NOT NULL AND NOT EXISTS (…students…)` ownership-guard shape as
 * `submit_quiz_results_v2`. Because a Bearer caller arrived as `anon` with
 * `auth.uid()` NULL, that guard SHORT-CIRCUITED for every mobile caller — the
 * DB half of the check was doing nothing. They also each depend on a residual
 * PUBLIC EXECUTE grant that the anon-revocation campaign is removing (the
 * `REVOKE EXECUTE … FROM anon` in migration 20260515000002 is a no-op while
 * PUBLIC still grants it), so each is one revoke away from the 2026-08-12
 * failure mode.
 *
 *   v2/quiz/start           → start_quiz_session      (predecessor in the funnel)
 *   learner/lesson/progress → update_chapter_progress
 *   v2/student/leaderboard  → get_leaderboard
 */
const OWNERSHIP_GUARD_RPC_ROUTES = [
  'v2/quiz/start/route.ts',
  'learner/lesson/progress/route.ts',
  'v2/student/leaderboard/route.ts',
] as const;

/** Everything that must be wired to the Bearer-aware helper. */
const BEARER_AWARE_ROUTES = [...IDENTITY_ROUTES, ...OWNERSHIP_GUARD_RPC_ROUTES] as const;

/**
 * Cookie-only constructions that are DELIBERATE and must stay. Each entry is a
 * standing decision with a reason; an undocumented reintroduction anywhere else
 * in the family fails the test below.
 */
const DOCUMENTED_COOKIE_HOLDOUTS: Record<string, string> = {
  // POST /api/rhythm/today authenticates via supabase.auth.getUser() (session-
  // based), which cannot work on a stateless Bearer client built with
  // persistSession: false. Its only caller is web (post-submit cache-bust).
  // Making it Bearer-aware means moving it onto authorizeRequest() — an auth-
  // semantics change, deferred to architect.
  'rhythm/today/route.ts': 'POST cache-bust uses session-based auth.getUser()',
};

describe('REG-392 + REG-395 — every route is wired to the Bearer-aware client', () => {
  for (const rel of BEARER_AWARE_ROUTES) {
    it(`${rel} builds its student-scoped client via createSupabaseRouteClient(request)`, () => {
      const src = codeOf(rel);
      expect(src).toContain("from '@alfanumrik/lib/supabase-route'");
      // The request MUST be threaded in — a call with no argument cannot read
      // the Authorization header and silently reverts to the cookie path.
      expect(src).toMatch(/createSupabaseRouteClient\(\s*request\s*\)/);
    });

    it(`${rel} has no UNDOCUMENTED cookie-only client construction left`, () => {
      const src = codeOf(rel);
      const cookieCalls = src.match(/createSupabaseServerClient\(\s*\)/g) ?? [];
      if (DOCUMENTED_COOKIE_HOLDOUTS[rel]) {
        // Exactly one, and it is the documented one.
        expect(cookieCalls.length).toBe(1);
      } else {
        expect(cookieCalls).toEqual([]);
      }
    });
  }

  it('covers every route the P0 fix touched (list drift guard)', () => {
    // If a route is migrated onto the helper without being added here, the
    // family check silently stops covering it. Keep these counts and the lists
    // in step with the fix's blast radius.
    expect(IDENTITY_ROUTES).toHaveLength(12);
    expect(OWNERSHIP_GUARD_RPC_ROUTES).toHaveLength(3);
    expect(BEARER_AWARE_ROUTES).toHaveLength(15);
    expect(new Set(BEARER_AWARE_ROUTES).size).toBe(15);
  });

  it('no route is listed in BOTH families (the two lists mean different things)', () => {
    // IDENTITY_ROUTES = "resolved the caller's own profile and degraded to
    // 404/empty". OWNERSHIP_GUARD_RPC_ROUTES = "called a SECURITY DEFINER RPC
    // whose ownership guard short-circuited". Overlap would blur the rationale.
    for (const r of OWNERSHIP_GUARD_RPC_ROUTES) {
      expect(IDENTITY_ROUTES as readonly string[]).not.toContain(r);
    }
  });
});
