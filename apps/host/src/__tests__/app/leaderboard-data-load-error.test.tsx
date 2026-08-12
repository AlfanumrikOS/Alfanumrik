/**
 * /leaderboard — a failed read renders an HONEST, retryable error state and is
 * DISTINCT from the genuine empty state (render unit).
 *
 * Frontend-honesty sweep, second half (2026-08-09)
 *   The TODO(backend) in packages/lib/src/supabase.ts deferred the remaining
 *   read helpers with "None of them currently feeds a surface that turns
 *   emptiness into a reassuring CLAIM." Four of this page's tabs disproved it:
 *
 *     rankings read fails             → "No rankings yet"
 *     getCompetitions fails           → "No competitions right now"
 *     getHallOfFame fails             → the Hall-of-Fame "Finish in the Top 3 …"
 *     getCompetitionLeaderboard fails → "No scores yet. Take a quiz to compete!"
 *
 *   Every one of those is a statement about the world that a 500 cannot
 *   establish. BOTH DIRECTIONS are asserted per tab: on failure the error card
 *   renders and the reassuring copy does NOT; on a successful-but-empty read the
 *   reassuring copy renders and the error card does NOT. A failure-only suite
 *   would pass just as happily against a build that deleted the empty state —
 *   and a real pre-launch cohort genuinely has an empty board.
 *
 * SEV1 rewire (2026-08-11) — WHY THIS FILE CHANGED SHAPE
 *   Four tabs used to read cross-student tables from the BROWSER with the anon
 *   key (`performance_scores`, `score_history`, `challenge_streaks`,
 *   `student_titles`). All four are own-row-only (or service-role-only) under
 *   RLS, so each read returned at most the caller's own row and the page
 *   rendered that as a peer board — the student was permanently rank #1 with a
 *   gold medal, "My Titles" was permanently empty, "Streaks" was a board of one,
 *   and "My Class" always said "you're not in a class" (it keyed off
 *   `students.class_id`, a column that does not exist).
 *
 *   Those tabs now read /api/v1/leaderboard{,/titles,/streaks,/my-class}, so the
 *   harness drives `fetch` instead of the postgrest builder. The Compete and
 *   Hall-of-Fame tabs still go through the supabase.ts ServiceResult helpers and
 *   are asserted exactly as before.
 *
 *   Harness mirrors progress-data-load-error.test.tsx: the REAL page is mounted
 *   against a mocked transport, so the page's own error/empty branching is what
 *   is under test. SWR is REAL (each render gets a fresh cache provider) so the
 *   loading→error / loading→empty transitions are the real ones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';

/* ── Mutable auth state (isHi flips for the bilingual test) ─────────────── */
const { authState } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', grade: '8', name: 'Test Student' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

/* ── The read helpers still used by the Compete / Hall-of-Fame tabs ──────
 * Mocked at `@alfanumrik/lib/supabase` (not the pure client) because what is
 * being pinned here is the PAGE's decision, not the helpers' mapping — the
 * helper contract itself is pinned in lib/supabase-read-result-contract.test.ts.
 * `supabase.from` is kept ONLY so the "no client-side table reads" assertions
 * below have something to observe: after the rewire it must never be called for
 * `student_titles` / `challenge_streaks` / `performance_scores` / `score_history`. */
const {
  getCompetitions, getHallOfFame, getCompetitionLeaderboard, fromSpy,
} = vi.hoisted(() => ({
  getCompetitions: vi.fn(),
  getHallOfFame: vi.fn(),
  getCompetitionLeaderboard: vi.fn(),
  fromSpy: vi.fn(),
}));

vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'in'];
  return {
    getCompetitions: (...a: unknown[]) => getCompetitions(...a),
    getHallOfFame: (...a: unknown[]) => getHallOfFame(...a),
    getCompetitionLeaderboard: (...a: unknown[]) => getCompetitionLeaderboard(...a),
    joinCompetition: vi.fn(),
    // Named exports packages/lib/src/swr.tsx imports at module scope. The real
    // `useLeaderboard` is exercised below, so that module is genuinely loaded.
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
      from: vi.fn((table: string) => {
        fromSpy(table);
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject);
        return builder;
      }),
    },
  };
});

// Real `useLeaderboard` (the CDN-cached hook the Rankings tab now adopts);
// only the flags hook is stubbed, since the mastery tab is out of scope here.
vi.mock('@alfanumrik/lib/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/swr')>();
  return { ...actual, useFeatureFlags: () => ({ data: {} }) };
});

vi.mock('@alfanumrik/ui/admin-ui', () => ({ BarChart: () => null }));
vi.mock('@alfanumrik/ui/challenge/StreakBadge', () => ({ default: () => null }));
vi.mock('@alfanumrik/ui/leaderboard/PercentileBandCard', () => ({
  PercentileBandCard: () => null,
}));
vi.mock('@alfanumrik/ui/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: warnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import LeaderboardPage from '@/app/(student)/leaderboard/page';

const FAIL = (msg: string) => ({ ok: false, error: msg, code: 'DB_ERROR' as const });
const OK = (data: unknown[]) => ({ ok: true, data });

/** The page's shared bilingual failure copy. */
const ERROR_EN = 'Failed to load data';
const ERROR_HI = 'डेटा लोड नहीं हो सका';

/* ── HTTP transport double ──────────────────────────────────────────────
 * Only `ok`, `status` and `json()` are consumed by the page, so a literal is
 * enough and avoids depending on a global Response implementation. */
type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const res = (status: number, body: unknown): FakeRes => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** longest-prefix routing, so `/leaderboard/titles` wins over `/leaderboard`. */
const routes = new Map<string, () => FakeRes>();
function route(prefix: string, handler: () => FakeRes) {
  routes.set(prefix, handler);
}

function resetRoutes() {
  routes.clear();
  // Healthy-and-empty defaults; each test overrides the one route it is about.
  route('/api/v1/leaderboard?', () => res(200, { data: [], period: 'weekly', ranked_by: 'xp' }));
  route('/api/v1/leaderboard/me', () =>
    res(200, {
      success: true,
      data: {
        period: 'weekly', rank: null, percentile: null, xp: 0, band: null,
        neighbours: [], performance_score: null, level_name: null,
      },
    }));
  route('/api/v1/leaderboard/titles', () =>
    res(200, { success: true, data: { schemaVersion: 1, resolvedAt: 'x', titles: [] } }));
  route('/api/v1/leaderboard/streaks', () =>
    res(200, {
      success: true,
      data: { schemaVersion: 1, resolvedAt: 'x', threshold: 3, items: [], me: null },
    }));
  // 404 = ff_class_leaderboard_v1 off — the CURRENT production state.
  route('/api/v1/leaderboard/my-class', () => res(404, { success: false, error: 'not_found' }));
  route('/api/v1/leaderboard/mastery', () => res(404, { error: 'not_found' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.isHi = false;
  resetRoutes();
  getCompetitions.mockResolvedValue(OK([]));
  getHallOfFame.mockResolvedValue(OK([]));
  getCompetitionLeaderboard.mockResolvedValue(OK([]));

  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    const keys = [...routes.keys()].sort((a, b) => b.length - a.length);
    for (const k of keys) if (url.includes(k)) return routes.get(k)!();
    throw new Error(`unrouted fetch: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Fresh SWR cache per render — otherwise test N+1 reads test N's response. */
function renderPage() {
  return render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 } },
      React.createElement(LeaderboardPage),
    ),
  );
}

/** Tab buttons render as "{icon} {label}", so match by accessible name. */
async function openTab(label: string) {
  renderPage();
  const tab = await waitFor(() => screen.getByRole('button', { name: new RegExp(label) }));
  fireEvent.click(tab);
}

describe('/leaderboard — rankings tab', () => {
  it('a FAILED read shows the error card and NOT "No rankings yet"', async () => {
    route('/api/v1/leaderboard?', () => res(500, { error: 'boom' }));
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText('No rankings yet')).toBeNull();
    // Logged with a reason and no student id (P13).
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        'leaderboard: rankings load failed',
        expect.objectContaining({ reason: expect.any(String) }),
      ));
    expect(JSON.stringify(warnSpy.mock.calls[0][1])).not.toContain('stu-1');
  });

  it('a GENUINELY EMPTY board shows "No rankings yet" and NO error card', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('No rankings yet')).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the failure copy is bilingual (P7)', async () => {
    authState.isHi = true;
    route('/api/v1/leaderboard?', () => res(500, { error: 'boom' }));
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_HI)).toBeInTheDocument());
    expect(screen.queryByText('अभी कोई रैंकिंग नहीं')).toBeNull();
  });

  it('declares the 44px touch floor on the Retry control (WCAG 2.5.8)', async () => {
    route('/api/v1/leaderboard?', () => res(500, { error: 'boom' }));
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    // Declaration only. JSDOM loads no stylesheet, so getComputedStyle proves
    // nothing about layout here; the real boundingBox() measurement at nine
    // viewports lives in e2e/ui-error-states.spec.ts. Same two-layer split as
    // progress-data-load-error.test.tsx:405.
    const retry = screen.getByText(/Retry/).closest('button')!;
    expect(retry.className).toContain('min-h-[44px]');
    expect(retry.className).toContain('min-w-[44px]');
  });

  it('Retry re-reads and recovers the surface', async () => {
    let failed = false;
    route('/api/v1/leaderboard?', () => {
      if (!failed) { failed = true; return res(500, { error: 'boom' }); }
      return res(200, {
        data: [{ rank: 1, student_id: 's1', name: 'Aarav', grade: '8', total_xp: 500, sessions: 4, streak: 3 }],
        period: 'weekly',
        ranked_by: 'xp',
      });
    });
    renderPage();

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Retry/));

    await waitFor(() => expect(screen.queryByText(ERROR_EN)).toBeNull());
    expect(screen.queryByText('No rankings yet')).toBeNull();
  });

  /* SEV1 pins. The defect these replace: the page re-sorted the server board by
     a client-read Performance Score that RLS reduced to the caller's own row, so
     every peer sorted to -1 and the CALLER was rendered at #1 with a 🥇 under a
     "Top 10 by Performance Score" header the server never produced. */
  it('renders the SERVER rank — the caller is not promoted to #1', async () => {
    route('/api/v1/leaderboard?', () => res(200, {
      data: [
        { rank: 1, student_id: 's1', name: 'Aarav', grade: '8', total_xp: 900, sessions: 9, streak: 5 },
        { rank: 2, student_id: 's2', name: 'Bhavya', grade: '8', total_xp: 800, sessions: 8, streak: 4 },
        { rank: 3, student_id: 's3', name: 'Chirag', grade: '8', total_xp: 700, sessions: 7, streak: 3 },
        { rank: 4, student_id: 'stu-1', name: 'Test Student', grade: '8', total_xp: 100, sessions: 1, streak: 1 },
      ],
      period: 'weekly',
      ranked_by: 'xp',
    }));
    renderPage();

    // The caller sits at the rank the SERVER gave them…
    await waitFor(() => expect(screen.getByText('#4')).toBeInTheDocument());
    // …and holds no medal (only ranks 1-3 do, and none of those is the caller).
    expect(screen.getAllByText('🥇')).toHaveLength(2); // podium + list row, both s1
    expect(screen.queryByText('#1')).toBeNull();
  });

  it('labels the board from the server\'s ranked_by, not "Performance Score"', async () => {
    route('/api/v1/leaderboard?', () => res(200, {
      data: [{ rank: 1, student_id: 's1', name: 'Aarav', grade: '8', total_xp: 900, sessions: 9, streak: 5 }],
      period: 'weekly',
      ranked_by: 'xp',
    }));
    renderPage();

    await waitFor(() => expect(screen.getByText('Top 10 by XP')).toBeInTheDocument());
    expect(screen.queryByText(/Performance Score/)).toBeNull();
  });

  it('never reads performance_scores or score_history from the browser', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('No rankings yet')).toBeInTheDocument());
    expect(fromSpy).not.toHaveBeenCalledWith('performance_scores');
    expect(fromSpy).not.toHaveBeenCalledWith('score_history');
  });
});

describe('/leaderboard — competitions tab', () => {
  it('a FAILED read shows the error card and NOT "No competitions right now"', async () => {
    getCompetitions.mockResolvedValue(FAIL('getCompetitions: rpc down'));
    await openTab('Compete');

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText('No competitions right now')).toBeNull();
  });

  it('a GENUINELY EMPTY list shows "No competitions right now" and NO error card', async () => {
    getCompetitions.mockResolvedValue(OK([]));
    await openTab('Compete');

    await waitFor(() =>
      expect(screen.getByText('No competitions right now')).toBeInTheDocument(),
    );
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });
});

describe('/leaderboard — hall of fame tab', () => {
  it('a FAILED read shows the error card and NOT the Hall-of-Fame invitation', async () => {
    getHallOfFame.mockResolvedValue(FAIL('getHallOfFame: rpc down'));
    await openTab('Hall of Fame');

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText(/your name will be immortalized here/i)).toBeNull();
  });

  it('a GENUINELY EMPTY hall shows the invitation and NO error card', async () => {
    getHallOfFame.mockResolvedValue(OK([]));
    await openTab('Hall of Fame');

    await waitFor(() =>
      expect(screen.getByText(/your name will be immortalized here/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });
});

/* These two tabs used to write their queries inline in the page against tables
 * the browser cannot read. They now go through server routes, and the same
 * both-directions rule applies: a 500 is NEVER an empty state. */
describe('/leaderboard — my titles tab', () => {
  it('a FAILED read shows the error card and NOT "No Titles Yet"', async () => {
    route('/api/v1/leaderboard/titles', () => res(500, { success: false, error: 'titles_read_failed' }));
    await openTab('My Titles');

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText('No Titles Yet')).toBeNull();
  });

  it('a GENUINELY EMPTY list shows "No Titles Yet" and NO error card', async () => {
    await openTab('My Titles');

    await waitFor(() => expect(screen.getByText('No Titles Yet')).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('never reads student_titles from the browser', async () => {
    await openTab('My Titles');
    await waitFor(() => expect(screen.getByText('No Titles Yet')).toBeInTheDocument());
    expect(fromSpy).not.toHaveBeenCalledWith('student_titles');
  });

  it('prefers title_hi under isHi (P7)', async () => {
    authState.isHi = true;
    route('/api/v1/leaderboard/titles', () => res(200, {
      success: true,
      data: {
        schemaVersion: 1,
        resolvedAt: 'x',
        titles: [{
          id: 't1', title: 'Quiz Master', title_hi: 'क्विज़ मास्टर',
          icon: '🏆', tier: 'gold', source: 'competition', earned_at: '2026-07-01T00:00:00Z',
        }],
      },
    }));
    await openTab('मेरे खिताब');

    await waitFor(() => expect(screen.getByText('क्विज़ मास्टर')).toBeInTheDocument());
    expect(screen.queryByText('Quiz Master')).toBeNull();
  });
});

describe('/leaderboard — streaks tab', () => {
  it('a FAILED read shows the error card and NOT "No active streaks yet"', async () => {
    route('/api/v1/leaderboard/streaks', () => res(500, { success: false, error: 'streaks_read_failed' }));
    await openTab('Streaks');

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText('No active streaks yet')).toBeNull();
  });

  it('a GENUINELY EMPTY list shows "No active streaks yet" and NO error card', async () => {
    await openTab('Streaks');

    await waitFor(() =>
      expect(screen.getByText('No active streaks yet')).toBeInTheDocument(),
    );
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('never reads challenge_streaks from the browser', async () => {
    await openTab('Streaks');
    await waitFor(() => expect(screen.getByText('No active streaks yet')).toBeInTheDocument());
    expect(fromSpy).not.toHaveBeenCalledWith('challenge_streaks');
  });

  it('shows "Best:" for the caller only — peers never carry best_streak', async () => {
    route('/api/v1/leaderboard/streaks', () => res(200, {
      success: true,
      data: {
        schemaVersion: 1,
        resolvedAt: 'x',
        threshold: 3,
        items: [
          { rank: 1, student_id: 's1', name: 'Aarav', grade: '8', current_streak: 9, badges: [] },
          { rank: 2, student_id: 'stu-1', name: 'Test Student', grade: '8', current_streak: 5, badges: [] },
        ],
        me: { student_id: 'stu-1', current_streak: 5, best_streak: 12, badges: [], rank: 2, on_board: true },
      },
    }));
    await openTab('Streaks');

    await waitFor(() => expect(screen.getByText('Best: 12')).toBeInTheDocument());
    // Exactly one "Best:" line on the board — the caller's.
    expect(screen.getAllByText(/^Best: /)).toHaveLength(1);
  });
});

/* My Class has FOUR outcomes and they are deliberately not collapsible. The
 * defect: the tab keyed off `students.class_id`, a column that does not exist,
 * so every student — enrolled or not — was told "You're not in a class yet." */
describe('/leaderboard — my class tab', () => {
  it('a 404 (ff_class_leaderboard_v1 OFF) is NOT an error and NOT "not in a class"', async () => {
    await openTab('My Class');

    await waitFor(() =>
      expect(screen.getByText('Class rankings are coming soon')).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
    expect(screen.queryByText("You're not in a class yet.")).toBeNull();
  });

  it('enrolled:false renders "not in a class yet" and NO error card', async () => {
    route('/api/v1/leaderboard/my-class', () => res(200, {
      success: true,
      data: { schemaVersion: 1, period: 'weekly', enrolled: false, class_id: null, resolvedAt: 'x', items: [] },
    }));
    await openTab('My Class');

    await waitFor(() =>
      expect(screen.getByText("You're not in a class yet.")).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('enrolled:true with an empty board renders "No class rankings yet"', async () => {
    route('/api/v1/leaderboard/my-class', () => res(200, {
      success: true,
      data: { schemaVersion: 1, period: 'weekly', enrolled: true, class_id: 'c1', resolvedAt: 'x', items: [] },
    }));
    await openTab('My Class');

    await waitFor(() =>
      expect(screen.getByText('No class rankings yet')).toBeInTheDocument());
    expect(screen.queryByText("You're not in a class yet.")).toBeNull();
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('a 5xx shows the error card and NONE of the three empty states', async () => {
    route('/api/v1/leaderboard/my-class', () => res(500, { success: false, error: 'internal' }));
    await openTab('My Class');

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText("You're not in a class yet.")).toBeNull();
    expect(screen.queryByText('No class rankings yet')).toBeNull();
    expect(screen.queryByText('Class rankings are coming soon')).toBeNull();
  });

  it('renders server ranks and never touches student.class_id', async () => {
    route('/api/v1/leaderboard/my-class', () => res(200, {
      success: true,
      data: {
        schemaVersion: 1, period: 'weekly', enrolled: true, class_id: 'c1', resolvedAt: 'x',
        items: [
          { rank: 1, student_id: 's1', name: 'Aarav', grade: '8', avatar_url: null, xp_total: 900, xp_this_period: 300, quizzes: 6 },
          { rank: 4, student_id: 'stu-1', name: 'Test Student', grade: '8', avatar_url: null, xp_total: 100, xp_this_period: 40, quizzes: 1 },
        ],
      },
    }));
    await openTab('My Class');

    await waitFor(() => expect(screen.getByText('#4')).toBeInTheDocument());
    // The auth student object carries no class_id and the page never asks for one.
    expect('class_id' in authState.student).toBe(false);
  });
});
