/**
 * /leaderboard — a failed read renders an HONEST, retryable error state and is
 * DISTINCT from the genuine empty state (render unit).
 *
 * Frontend-honesty sweep, second half (2026-08-09)
 *   The TODO(backend) in packages/lib/src/supabase.ts deferred the remaining
 *   read helpers with "None of them currently feeds a surface that turns
 *   emptiness into a reassuring CLAIM." Four of this page's tabs disproved it:
 *
 *     getLeaderboard fails            → "No rankings yet"
 *     getCompetitions fails           → "No competitions right now"
 *     getHallOfFame fails             → the Hall-of-Fame "Finish in the Top 3 …"
 *     getCompetitionLeaderboard fails → "No scores yet. Take a quiz to compete!"
 *
 *   Every one of those is a statement about the world that a 500 cannot
 *   establish, and each shipped with a `catch` that was dead code — the
 *   postgrest/RPC client RESOLVES with `{ data, error }` rather than rejecting.
 *   The helpers now return ServiceResult; the loaders throw a failed result
 *   into the existing catch, and every reassuring empty on the page is gated on
 *   `!fetchError`.
 *
 *   BOTH DIRECTIONS are asserted per tab: on failure the error card renders and
 *   the reassuring copy does NOT; on a successful-but-empty read the reassuring
 *   copy renders and the error card does NOT. A failure-only suite would pass
 *   just as happily against a build that deleted the empty state — and a real
 *   pre-launch cohort genuinely has an empty board.
 *
 *   Harness mirrors progress-data-load-error.test.tsx: the REAL page is mounted
 *   against mocked read helpers, so the page's own error/empty branching is
 *   what is under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

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

/* ── The read helpers under test ─────────────────────────────────────────
 * Mocked at `@alfanumrik/lib/supabase` (not the pure client) because what is
 * being pinned here is the PAGE's decision, not the helpers' mapping — the
 * helper contract itself is pinned in lib/supabase-read-result-contract.test.ts.
 * `supabase.from` still has to answer for the titles/streaks tabs' inline
 * queries, which carry the same defect with the query written in the page. */
const {
  getLeaderboard, getCompetitions, getHallOfFame, getCompetitionLeaderboard, tableResults,
} = vi.hoisted(() => ({
  getLeaderboard: vi.fn(),
  getCompetitions: vi.fn(),
  getHallOfFame: vi.fn(),
  getCompetitionLeaderboard: vi.fn(),
  tableResults: new Map<string, unknown>(),
}));

vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'in'];
  return {
    getLeaderboard: (...a: unknown[]) => getLeaderboard(...a),
    getCompetitions: (...a: unknown[]) => getCompetitions(...a),
    getHallOfFame: (...a: unknown[]) => getHallOfFame(...a),
    getCompetitionLeaderboard: (...a: unknown[]) => getCompetitionLeaderboard(...a),
    joinCompetition: vi.fn(),
    supabase: {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(tableResults.get(table) ?? { data: [], error: null }).then(resolve, reject);
        return builder;
      }),
    },
  };
});

// Feature flags: mastery tab OFF (its own SWR hook, unrelated to the gating).
vi.mock('@alfanumrik/lib/swr', () => ({ useFeatureFlags: () => ({ data: {} }) }));

// The class tab reads through useSWR directly; keep it inert here.
vi.mock('swr', () => ({ default: () => ({ data: null, isLoading: false, error: undefined }) }));

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

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  authState.isHi = false;
  // Healthy-and-empty by default; each test overrides the one source it is about.
  getLeaderboard.mockResolvedValue(OK([]));
  getCompetitions.mockResolvedValue(OK([]));
  getHallOfFame.mockResolvedValue(OK([]));
  getCompetitionLeaderboard.mockResolvedValue(OK([]));
});

afterEach(() => {
  cleanup();
});

/** Tab buttons render as "{icon} {label}", so match by accessible name. */
async function openTab(label: string) {
  render(React.createElement(LeaderboardPage));
  const tab = await waitFor(() => screen.getByRole('button', { name: new RegExp(label) }));
  fireEvent.click(tab);
}

describe('/leaderboard — rankings tab', () => {
  it('a FAILED read shows the error card and NOT "No rankings yet"', async () => {
    getLeaderboard.mockResolvedValue(FAIL('getLeaderboard: students unreachable'));
    render(React.createElement(LeaderboardPage));

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText('No rankings yet')).toBeNull();
    // Logged with a reason and no student id (P13).
    expect(warnSpy).toHaveBeenCalledWith(
      'leaderboard: rankings load failed',
      expect.objectContaining({ reason: expect.stringContaining('students unreachable') }),
    );
    expect(JSON.stringify(warnSpy.mock.calls[0][1])).not.toContain('stu-1');
  });

  it('a GENUINELY EMPTY board shows "No rankings yet" and NO error card', async () => {
    getLeaderboard.mockResolvedValue(OK([]));
    render(React.createElement(LeaderboardPage));

    await waitFor(() => expect(screen.getByText('No rankings yet')).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the failure copy is bilingual (P7)', async () => {
    authState.isHi = true;
    getLeaderboard.mockResolvedValue(FAIL('boom'));
    render(React.createElement(LeaderboardPage));

    await waitFor(() => expect(screen.getByText(ERROR_HI)).toBeInTheDocument());
    expect(screen.queryByText('अभी कोई रैंकिंग नहीं')).toBeNull();
  });

  it('declares the 44px touch floor on the Retry control (WCAG 2.5.8)', async () => {
    getLeaderboard.mockResolvedValue(FAIL('boom'));
    render(React.createElement(LeaderboardPage));

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
    getLeaderboard.mockResolvedValueOnce(FAIL('boom'));
    getLeaderboard.mockResolvedValue(OK([
      { rank: 1, student_id: 's1', name: 'Aarav', total_xp: 500, streak: 3 },
    ]));
    render(React.createElement(LeaderboardPage));

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Retry/));

    await waitFor(() => expect(screen.queryByText(ERROR_EN)).toBeNull());
    expect(screen.queryByText('No rankings yet')).toBeNull();
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

/* The titles + streaks tabs write their queries inline in the page rather than
 * going through a supabase.ts helper, but they carried the identical defect:
 * `const { data } = await supabase.from(...)` discards `error`, so their catch
 * was dead code too. Fixing only the helper-fed tabs would have left three
 * siblings in the same file still lying. */
describe('/leaderboard — tabs whose query is inlined in the page', () => {
  it('titles: a FAILED read shows the error card and NOT "No Titles Yet"', async () => {
    tableResults.set('student_titles', { data: null, error: { message: 'titles denied' } });
    await openTab('My Titles');

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText('No Titles Yet')).toBeNull();
  });

  it('titles: a GENUINELY EMPTY list shows "No Titles Yet" and NO error card', async () => {
    tableResults.set('student_titles', { data: [], error: null });
    await openTab('My Titles');

    await waitFor(() => expect(screen.getByText('No Titles Yet')).toBeInTheDocument());
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('streaks: a FAILED read shows the error card and NOT "No active streaks yet"', async () => {
    tableResults.set('challenge_streaks', { data: null, error: { message: 'streaks denied' } });
    await openTab('Streaks');

    await waitFor(() => expect(screen.getByText(ERROR_EN)).toBeInTheDocument());
    expect(screen.queryByText('No active streaks yet')).toBeNull();
  });

  it('streaks: a GENUINELY EMPTY list shows "No active streaks yet" and NO error card', async () => {
    tableResults.set('challenge_streaks', { data: [], error: null });
    await openTab('Streaks');

    await waitFor(() =>
      expect(screen.getByText('No active streaks yet')).toBeInTheDocument(),
    );
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });
});
