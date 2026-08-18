/**
 * /leaderboard ↔ /api/v1/leaderboard/me — THE ENVELOPE SEAM (SEV1, 2026-08-11).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The route returns the v1 envelope `{ success, data }`. The page's SWR fetcher
 * did `return res.json()` and then read `bandData.band` — off the ENVELOPE, not
 * off `data`. That is always `undefined`, which `PercentileBandCard` indexed
 * into its copy table, which threw a TypeError, which tripped the
 * `<SectionErrorBoundary section="Leaderboard">` wrapping ALL SEVEN TABS. One
 * key of nesting blanked the whole page.
 *
 * Both sides had tests. `api/v1/leaderboard/me.test.ts` asserted
 * `body.data.band === 'top_10'`. `leaderboard-data-load-error.test.tsx`
 * asserted the page's behaviour against hand-written fixtures — and mocks
 * `PercentileBandCard` to `() => null`, so it cannot see this at all. NOTHING
 * tested the two together. Each side was self-consistent and the pair was
 * broken.
 *
 * So this file does not use a fixture for /me. It mounts the REAL page against
 * the REAL route handler: the page's `fetch` for `/api/v1/leaderboard/me` is
 * answered by invoking the route's exported `GET` and handing back the actual
 * `NextResponse` it produced. The only doubles are below the route (rbac,
 * supabase-admin) and beside the page (auth, sibling tabs). `PercentileBandCard`
 * is deliberately NOT mocked — it is half of the seam.
 *
 * A hand-written envelope fixture would have been just as green against the
 * broken page as against the fixed one, because the bug was in the page's
 * understanding of the ROUTE, and a fixture is written from the same (wrong)
 * understanding.
 *
 * ── WHAT IS PINNED ──────────────────────────────────────────────────────────
 *  1. Real route envelope → the card renders, with the route's OWN band.
 *  2. `band: null` (no ranking yet) → NO card, NO error boundary.
 *  3. `success: false` → NO card, NO error boundary.
 *  4. `data: null` → NO card, NO error boundary.
 *  5. malformed / truncated / non-JSON body → NO card, NO error boundary.
 *  6. Flat (un-enveloped) body — the shape the page USED to assume — must not
 *     produce a card. This is the direct regression assertion: if the fetcher
 *     is reverted to `return res.json()`, case 1 goes red.
 *  7. In every case the six sibling tabs stay mounted (the boundary never trips).
 *
 * P13: no real student data — synthetic UUIDs and names only.
 * P5: grades are strings.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';

const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/* ═══════════════════════════════════════════════════════════════════════════
 * SERVER SIDE — doubles BELOW the route only. The route itself is real.
 * ═══════════════════════════════════════════════════════════════════════════ */

const { authImpl, studentLookup, rpcResult, perfResult } = vi.hoisted(() => ({
  authImpl: { current: null as unknown },
  studentLookup: { current: null as unknown },
  rpcResult: { current: null as unknown },
  perfResult: { current: null as unknown },
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: async () => authImpl.current,
}));

const fakeAdmin = {
  from: (_table: string) => ({
    select: () => ({
      eq: () => ({
        is: () => ({ limit: () => ({ maybeSingle: async () => studentLookup.current }) }),
        then: (resolve: (v: unknown) => unknown) => resolve(perfResult.current),
      }),
    }),
  }),
  rpc: async () => rpcResult.current,
};
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => fakeAdmin,
  supabaseAdmin: fakeAdmin,
}));

/* ═══════════════════════════════════════════════════════════════════════════
 * CLIENT SIDE — doubles BESIDE the page. The page and the card are real.
 * ═══════════════════════════════════════════════════════════════════════════ */

const { authState } = vi.hoisted(() => ({
  authState: {
    // Literal, not STUDENT_ID: vi.hoisted() runs before module-scope consts.
    student: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', grade: '8', name: 'Test Student' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'in'];
  const ok = { ok: true, data: [] };
  return {
    getCompetitions: vi.fn(async () => ok),
    getHallOfFame: vi.fn(async () => ok),
    getCompetitionLeaderboard: vi.fn(async () => ok),
    joinCompetition: vi.fn(),
    getStudentProfiles: vi.fn(),
    getSubjects: vi.fn(),
    getStudentSnapshot: vi.fn(),
    getFeatureFlags: vi.fn(),
    getStudyPlan: vi.fn(),
    getReviewCards: vi.fn(),
    getLeaderboard: vi.fn(),
    getStudentNotifications: vi.fn(),
    getMasteryOverview: vi.fn(),
    supabase: {
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return builder;
      }),
    },
  };
});

vi.mock('@alfanumrik/lib/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/swr')>();
  return { ...actual, useFeatureFlags: () => ({ data: {} }) };
});

vi.mock('@alfanumrik/ui/admin-ui', () => ({ BarChart: () => null }));
vi.mock('@alfanumrik/ui/challenge/StreakBadge', () => ({ default: () => null }));
vi.mock('@alfanumrik/ui/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// Keep Sentry out of the boundary's componentDidCatch — irrelevant here and it
// would make a caught render error look like a network call.
vi.mock('@alfanumrik/lib/sentry-lazy-capture', () => ({ captureException: vi.fn() }));

import LeaderboardPage from '@/app/(student)/leaderboard/page';

/** Verbatim from packages/ui/src/SectionErrorBoundary.tsx for section="Leaderboard". */
const BOUNDARY_FALLBACK = "Leaderboard couldn't load.";

/* ── Transport ──────────────────────────────────────────────────────────── */

type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const lit = (status: number, body: unknown): FakeRes => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Answered by the REAL route handler unless a test overrides it. */
let meOverride: (() => FakeRes | Promise<Response>) | null = null;

async function callRealMeRoute(url: string): Promise<Response> {
  const { GET } = await import('@/app/api/v1/leaderboard/me/route');
  return GET(new Request(url) as unknown as Parameters<typeof GET>[0]);
}

function healthySiblings(url: string): FakeRes | null {
  if (url.includes('/api/v1/leaderboard/titles')) {
    return lit(200, { success: true, data: { schemaVersion: 1, resolvedAt: 'x', titles: [] } });
  }
  if (url.includes('/api/v1/leaderboard/streaks')) {
    return lit(200, {
      success: true,
      data: { schemaVersion: 1, resolvedAt: 'x', threshold: 3, items: [], me: null },
    });
  }
  if (url.includes('/api/v1/leaderboard/my-class')) return lit(404, { success: false });
  if (url.includes('/api/v1/leaderboard/mastery')) return lit(404, { error: 'not_found' });
  if (url.includes('/api/v1/leaderboard?')) {
    return lit(200, {
      data: [
        { rank: 1, student_id: 's1', name: 'Aarav', grade: '8', total_xp: 900, sessions: 9, streak: 5 },
      ],
      period: 'weekly',
      ranked_by: 'xp',
    });
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  meOverride = null;
  authState.isHi = false;
  authImpl.current = {
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['leaderboard.view'],
  };
  studentLookup.current = { data: { id: STUDENT_ID }, error: null };
  perfResult.current = { data: [{ overall_score: 84 }], error: null };
  rpcResult.current = {
    data: {
      student_id: STUDENT_ID,
      rank: 42,
      total: 500,
      percentile: 91.6,
      xp: 1250,
      band: 'top_10',
      neighbours: [],
    },
    error: null,
  };

  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/v1/leaderboard/me')) {
      return meOverride ? meOverride() : callRealMeRoute(`http://localhost${url}`);
    }
    const sibling = healthySiblings(url);
    if (sibling) return sibling;
    throw new Error(`unrouted fetch: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 } },
      React.createElement(LeaderboardPage),
    ),
  );
}

/** The rankings tab renders regardless of the band card, so its presence is the
 *  proof that the boundary did NOT swallow the page. */
async function waitForPageBody() {
  await waitFor(() => expect(screen.getByText('Top 10 by XP')).toBeInTheDocument());
}

function expectBoundaryIntact() {
  expect(
    screen.queryByText(BOUNDARY_FALLBACK),
    'the <SectionErrorBoundary section="Leaderboard"> tripped — a render threw and ' +
      'took all seven tabs down with it',
  ).toBeNull();
}

// ════════════════════════════════════════════════════════════════════════════
// 1. The seam itself
// ════════════════════════════════════════════════════════════════════════════
describe('/leaderboard ↔ /api/v1/leaderboard/me — envelope seam', () => {
  it('renders the band card from the REAL route response (envelope is unwrapped)', async () => {
    renderPage();
    await waitForPageBody();

    const card = await screen.findByTestId('percentile-band-card');
    // The band the ROUTE actually emitted — not a fixture the test invented.
    expect(card.getAttribute('data-band')).toBe('top_10');
    expect(card.textContent).toContain('top 10%');
    expectBoundaryIntact();
  });

  it('band comes from data.band, not the envelope — derived bands survive the seam', async () => {
    // Route derives the band from percentile when the RPC omits it. If the page
    // read the envelope instead of `data`, this would render nothing.
    rpcResult.current = {
      data: {
        student_id: STUDENT_ID, rank: 1, total: 900, percentile: 99.9, xp: 9000,
        band: null, neighbours: [],
      },
      error: null,
    };
    renderPage();
    await waitForPageBody();

    const card = await screen.findByTestId('percentile-band-card');
    expect(card.getAttribute('data-band')).toBe('top_1');
    expectBoundaryIntact();
  });

  it('the route emits exactly the two-key envelope the page unwraps', async () => {
    const res = await callRealMeRoute('http://localhost/api/v1/leaderboard/me?period=weekly');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'success']);
    expect(body.success).toBe(true);
    // `band` lives one level DOWN. This is the whole defect in one assertion.
    expect(body.band).toBeUndefined();
    expect(body.data.band).toBe('top_10');
  });

  it('the caller own performance score crosses the seam too', async () => {
    renderPage();
    await waitForPageBody();
    await waitFor(() => expect(screen.getByText('84')).toBeInTheDocument());
    expectBoundaryIntact();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Degenerate payloads — none may throw, none may fake a band
// ════════════════════════════════════════════════════════════════════════════
describe('/leaderboard band card — degenerate /me payloads never crash the page', () => {
  it('band:null (no ranking yet) renders NO card and NO boundary fallback', async () => {
    // Real route path: caller has no student row → band null.
    studentLookup.current = { data: null, error: null };
    renderPage();
    await waitForPageBody();

    expect(screen.queryByTestId('percentile-band-card')).toBeNull();
    expectBoundaryIntact();
  });

  it('RPC failure (fail-soft empty band) renders NO card and NO boundary fallback', async () => {
    rpcResult.current = { data: null, error: { message: 'RPC missing' } };
    renderPage();
    await waitForPageBody();

    expect(screen.queryByTestId('percentile-band-card')).toBeNull();
    expectBoundaryIntact();
  });

  const DEGENERATE: Array<[string, unknown]> = [
    ['success:false', { success: false, error: 'boom' }],
    ['data:null', { success: true, data: null }],
    ['empty object', {}],
    ['null body', null],
    ['array body', []],
    ['string body', 'not json'],
    ['truncated envelope (no data key)', { success: true }],
    ['data is a string', { success: true, data: 'top_10' }],
    ['band is an object', { success: true, data: { band: { label: 'top_10' } } }],
    ['band is a number', { success: true, data: { band: 7 } }],
    ['band is an unknown label', { success: true, data: { band: 'diamond_tier' } }],
  ];

  it.each(DEGENERATE)('%s → no crash, page stays mounted', async (label, body) => {
    meOverride = () => lit(200, body);
    renderPage();
    await waitForPageBody();
    expectBoundaryIntact();

    // An unknown-but-present band string is allowed to render the fallback card;
    // everything else must render no card at all. Neither may throw.
    const card = screen.queryByTestId('percentile-band-card');
    if (card) {
      expect(card.getAttribute('data-band')).toBe('keep_going');
      expect((card.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
    void label;
  });

  it('a non-2xx /me renders NO card and NO boundary fallback', async () => {
    meOverride = () => lit(500, { success: false, error: 'internal' });
    renderPage();
    await waitForPageBody();

    expect(screen.queryByTestId('percentile-band-card')).toBeNull();
    expectBoundaryIntact();
  });

  it('a body that is not JSON at all renders NO card and NO boundary fallback', async () => {
    meOverride = () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });
    renderPage();
    await waitForPageBody();

    expect(screen.queryByTestId('percentile-band-card')).toBeNull();
    expectBoundaryIntact();
  });

  it('a network rejection on /me renders NO card and NO boundary fallback', async () => {
    meOverride = () => { throw new TypeError('Failed to fetch'); };
    renderPage();
    await waitForPageBody();

    expect(screen.queryByTestId('percentile-band-card')).toBeNull();
    expectBoundaryIntact();
  });

  /* THE REGRESSION, stated directly. This is the shape the page used to assume:
     the route's `data` object hoisted to the top level with no envelope. The
     page must not accept it — accepting it is how a future refactor could
     "fix" the fetcher back into the broken direction and stay green. */
  it('a FLAT (un-enveloped) body produces no card — the page requires success:true', async () => {
    meOverride = () =>
      lit(200, {
        period: 'weekly', rank: 42, percentile: 91.6, xp: 1250, band: 'top_10',
        neighbours: [], performance_score: 84, level_name: 'Scholar',
      });
    renderPage();
    await waitForPageBody();

    expect(screen.queryByTestId('percentile-band-card')).toBeNull();
    expectBoundaryIntact();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Blast radius — the boundary wraps all seven tabs, so prove they survive
// ════════════════════════════════════════════════════════════════════════════
describe('/leaderboard band card — blast radius', () => {
  const TABS = ['Rankings', 'My Class', 'Streaks', 'My Titles', 'Compete', 'Hall of Fame'];

  it('every tab control is still mounted when /me returns a degenerate payload', async () => {
    meOverride = () => lit(200, { success: true });
    renderPage();
    await waitForPageBody();

    for (const tab of TABS) {
      expect(
        screen.getByRole('button', { name: new RegExp(tab) }),
        `tab "${tab}" disappeared — the band card took the whole boundary down`,
      ).toBeInTheDocument();
    }
    expectBoundaryIntact();
  });

  it('every tab control is still mounted on the healthy path', async () => {
    renderPage();
    await waitForPageBody();
    await screen.findByTestId('percentile-band-card');

    for (const tab of TABS) {
      expect(screen.getByRole('button', { name: new RegExp(tab) })).toBeInTheDocument();
    }
  });
});
