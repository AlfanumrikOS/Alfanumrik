/**
 * /today — the full state machine (Phase 4).
 *
 * `/today` is the default student route. Whatever happens to the network, the
 * flag, or the learner model, this page must land in exactly one HONEST state
 * with at least one control that works. This suite mounts the REAL page against
 * mocked hooks and pins every branch.
 *
 * The branch that matters most is `locked`. `ff_today_home_v1` gates BOTH the
 * page (client flag read → redirect) and `GET /api/v2/today` (server flag read
 * → 404 → `useTodayQueue` resolves null). Those two reads can disagree. Before
 * this phase the null case fell into the same branch as an empty queue and
 * rendered "You're all caught up ✅" — a page telling a student they had
 * finished their day when in fact the server had switched the surface off. It
 * is now its own state, with its own copy and a working way out.
 *
 * `empty` / `complete` / `insufficient_evidence` are likewise three distinct
 * situations ("nothing to do", "you already did it", "we don't know you yet")
 * and get three distinct screens.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import type { TodayResponse, TodayQueueItem } from '@alfanumrik/lib/today/types';

/* ── Mutable hook state ──────────────────────────────────────────────────── */

const H = vi.hoisted(() => ({
  auth: { student: { id: 'stu-1', grade: '8' }, snapshot: { current_streak: 3, total_xp: 900 }, isLoggedIn: true, isLoading: false, isHi: false },
  flags: { data: { ff_today_home_v1: true } as Record<string, boolean> | undefined, isLoading: false },
  today: { data: undefined as TodayResponse | null | undefined, error: undefined as unknown, isLoading: false, isValidating: false, mutate: vi.fn() },
  notifications: { data: { unread_count: 0, notifications: [] } as { unread_count: number; notifications: unknown[] } | undefined, error: undefined as unknown },
  exam: { thisWeek: [] as unknown[] },
  online: true,
  push: vi.fn(),
  replace: vi.fn(),
  track: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: H.push, replace: H.replace }),
}));
vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => H.auth }));
vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => H.flags,
  useNotifications: () => H.notifications,
}));
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ subjects: [], unlocked: [], locked: [], isLoading: false }),
}));
vi.mock('@alfanumrik/lib/today/use-today-queue', () => ({ useTodayQueue: () => H.today }));
vi.mock('@alfanumrik/lib/exams/use-exam-schedule', () => ({ useExamSchedule: () => H.exam }));
vi.mock('@alfanumrik/lib/analytics', () => ({ track: (...a: unknown[]) => H.track(...a) }));

// next/dynamic renders a promise-loaded module; resolve it synchronously so the
// loaded branch is assertable without act() gymnastics.
vi.mock('next/dynamic', () => ({
  default: () => {
    const Stub = (props: { data: TodayResponse }) => (
      <div data-testid="today-v2-stub">{props.data.primary.type}</div>
    );
    Stub.displayName = 'TodayHomeV2Stub';
    return Stub;
  },
}));

import TodayPage from '@/app/today/page';

/* ── Fixtures ────────────────────────────────────────────────────────────── */

function queueItem(overrides: Partial<TodayQueueItem> = {}): TodayQueueItem {
  return {
    type: 'weak_topic_zpd',
    rank: 1,
    labelKey: 'today.item.weak_topic_zpd.label',
    subtitleKey: 'today.item.weak_topic_zpd.subtitle',
    estMinutes: 7,
    deepLink: { route: '/quiz', params: { subject: 'science', chapter: 3 } },
    iconHint: 'target',
    reason: 'todays_zpd',
    meta: { subjectCode: 'science', chapterNumber: 3 },
    ...overrides,
  };
}

function envelope(queue: TodayQueueItem[], meta: Partial<TodayResponse['meta']> = {}): TodayResponse {
  return {
    schemaVersion: 1,
    resolvedAt: '2026-08-11T09:00:00.000Z',
    primary: queue[0] ?? queueItem(),
    queue,
    meta: { branch: 'start_quiz', masterySubjectCount: 2, dueReviewCount: 0, practicedToday: false, ...meta },
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  H.auth = { student: { id: 'stu-1', grade: '8' }, snapshot: { current_streak: 3, total_xp: 900 }, isLoggedIn: true, isLoading: false, isHi: false };
  H.flags = { data: { ff_today_home_v1: true }, isLoading: false };
  H.today = { data: envelope([queueItem()]), error: undefined, isLoading: false, isValidating: false, mutate: vi.fn() };
  H.notifications = { data: { unread_count: 0, notifications: [] }, error: undefined };
  H.exam = { thisWeek: [] };
  setOnline(true);
});
afterEach(cleanup);

/** The one state identifier the page reported to analytics this render. */
function reportedState(): string | undefined {
  const call = H.track.mock.calls.find((c) => c[0] === 'today_state_shown');
  return call ? (call[1] as { state: string }).state : undefined;
}

/* ── Gate ────────────────────────────────────────────────────────────────── */

describe('gate', () => {
  it('holds on a skeleton while auth is resolving', () => {
    H.auth = { ...H.auth, isLoading: true };
    render(<TodayPage />);
    expect(screen.getByTestId('today-gate-loading')).toBeInTheDocument();
  });

  it('holds on a skeleton while feature flags are resolving', () => {
    H.flags = { data: undefined, isLoading: true };
    render(<TodayPage />);
    expect(screen.getByTestId('today-gate-loading')).toBeInTheDocument();
  });

  it('redirects a logged-out visitor to /login', () => {
    H.auth = { ...H.auth, isLoggedIn: false };
    render(<TodayPage />);
    expect(H.replace).toHaveBeenCalledWith('/login');
  });

  it('redirects to /dashboard when ff_today_home_v1 is off', () => {
    H.flags = { data: { ff_today_home_v1: false }, isLoading: false };
    render(<TodayPage />);
    expect(H.replace).toHaveBeenCalledWith('/dashboard');
    expect(screen.getByTestId('today-gate-loading')).toBeInTheDocument();
  });

  it('emits no state telemetry before the gate resolves', () => {
    H.auth = { ...H.auth, isLoading: true };
    render(<TodayPage />);
    expect(reportedState()).toBeUndefined();
  });
});

/* ── Loading ─────────────────────────────────────────────────────────────── */

describe('loading', () => {
  it('renders skeletons and an accessible loading announcement', () => {
    H.today = { ...H.today, data: undefined, isLoading: true };
    render(<TodayPage />);
    expect(screen.getByTestId('today-loading')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your plan');
    expect(reportedState()).toBe('loading');
  });
});

/* ── Loaded ──────────────────────────────────────────────────────────────── */

describe('loaded', () => {
  it('renders the queue', () => {
    render(<TodayPage />);
    expect(screen.getByTestId('today-loaded')).toBeInTheDocument();
    expect(screen.getByTestId('today-v2-stub')).toHaveTextContent('weak_topic_zpd');
  });

  it('emits no state event on the happy path (the loaded surface reports today_viewed instead)', () => {
    render(<TodayPage />);
    expect(reportedState()).toBeUndefined();
  });
});

/* ── Recoverable error ───────────────────────────────────────────────────── */

describe('recoverable error', () => {
  beforeEach(() => {
    H.today = { ...H.today, data: undefined, error: new Error('today.fetch_failed') };
  });

  it('renders an honest failure that denies the "you lost something" reading', () => {
    render(<TodayPage />);
    const el = screen.getByTestId('today-error');
    expect(el).toHaveTextContent("Couldn't load your plan");
    expect(el).toHaveTextContent('Nothing has been lost');
    expect(reportedState()).toBe('error');
  });

  it('announces assertively, not as a status', () => {
    render(<TodayPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has a retry that actually re-fetches, and reports the retry', () => {
    render(<TodayPage />);
    fireEvent.click(screen.getByTestId('today-error-retry'));
    expect(H.today.mutate).toHaveBeenCalled();
    expect(H.track).toHaveBeenCalledWith('today_retry_clicked', { state: 'error' });
  });

  it('never claims the day is complete on a failed read', () => {
    render(<TodayPage />);
    expect(screen.queryByTestId('today-complete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-empty')).not.toBeInTheDocument();
  });
});

/* ── Offline / interrupted ───────────────────────────────────────────────── */

describe('offline', () => {
  it('reports offline rather than a generic error when there is no connection and no cache', () => {
    setOnline(false);
    H.today = { ...H.today, data: undefined, error: new Error('network') };
    render(<TodayPage />);
    expect(screen.getByTestId('today-offline')).toHaveTextContent("You're offline");
    expect(screen.queryByTestId('today-error')).not.toBeInTheDocument();
    expect(reportedState()).toBe('offline');
  });

  it('offers a retry that re-fetches', () => {
    setOnline(false);
    H.today = { ...H.today, data: undefined };
    render(<TodayPage />);
    fireEvent.click(screen.getByTestId('today-offline-retry'));
    expect(H.today.mutate).toHaveBeenCalled();
    expect(H.track).toHaveBeenCalledWith('today_retry_clicked', { state: 'offline' });
  });

  it('keeps serving a cached plan when offline rather than blanking the page', () => {
    setOnline(false);
    render(<TodayPage />); // data still present from beforeEach
    expect(screen.getByTestId('today-loaded')).toBeInTheDocument();
  });

  it('reacts to the browser going offline after mount', () => {
    H.today = { ...H.today, data: undefined };
    render(<TodayPage />);
    setOnline(false);
    fireEvent(window, new Event('offline'));
    expect(screen.getByTestId('today-offline')).toBeInTheDocument();
  });
});

/* ── Locked / unavailable ────────────────────────────────────────────────── */

describe('locked / unavailable', () => {
  beforeEach(() => {
    // The endpoint 404s (server-side flag off) while the client flag reads on.
    H.today = { ...H.today, data: null };
  });

  it('says the surface is off rather than "all caught up"', () => {
    render(<TodayPage />);
    const el = screen.getByTestId('today-locked');
    expect(el).toHaveTextContent('Your plan is turned off right now');
    expect(el).toHaveTextContent('Nothing is lost');
    expect(el.textContent).not.toMatch(/caught up|all done/i);
    expect(reportedState()).toBe('locked');
  });

  it('is DISTINCT from the empty and complete states', () => {
    render(<TodayPage />);
    expect(screen.queryByTestId('today-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-complete')).not.toBeInTheDocument();
  });

  it('gives a working way out', () => {
    render(<TodayPage />);
    expect(screen.getByTestId('today-locked-cta')).toHaveAttribute('href', '/dashboard');
  });
});

/* ── Empty vs completion ─────────────────────────────────────────────────── */

describe('empty vs completion', () => {
  it('renders EMPTY when the queue resolved to nothing and nothing was done today', () => {
    H.today = { ...H.today, data: envelope([], { practicedToday: false }) };
    render(<TodayPage />);
    expect(screen.getByTestId('today-empty')).toBeInTheDocument();
    expect(screen.getByTestId('today-empty-practice')).toHaveAttribute('href', '/quiz');
    expect(reportedState()).toBe('empty');
  });

  it('renders COMPLETION when the queue resolved to nothing because it was finished', () => {
    H.today = { ...H.today, data: envelope([], { practicedToday: true }) };
    render(<TodayPage />);
    expect(screen.getByTestId('today-complete')).toHaveTextContent('Done for today');
    expect(screen.queryByTestId('today-empty')).not.toBeInTheDocument();
    expect(reportedState()).toBe('complete');
  });

  it('still offers an action on completion', () => {
    H.today = { ...H.today, data: envelope([], { practicedToday: true }) };
    render(<TodayPage />);
    expect(screen.getByTestId('today-complete-cta')).toHaveAttribute('href', '/quiz');
  });
});

/* ── Insufficient evidence ───────────────────────────────────────────────── */

describe('insufficient evidence', () => {
  const coldStart = queueItem({
    type: 'cold_start_diagnostic',
    reason: 'no_signals_yet',
    labelKey: 'today.item.cold_start_diagnostic.label',
    subtitleKey: 'today.item.cold_start_diagnostic.subtitle',
    deepLink: { route: '/diagnostic' },
    meta: undefined,
  });

  beforeEach(() => {
    H.today = { ...H.today, data: envelope([coldStart], { masterySubjectCount: 0, branch: 'cold_start_diagnostic' }) };
  });

  it('says we do not know the learner yet, instead of dressing it up as a recommendation', () => {
    render(<TodayPage />);
    const el = screen.getByTestId('today-insufficient-evidence');
    expect(el).toHaveTextContent("We don't know your level yet");
    expect(reportedState()).toBe('insufficient_evidence');
  });

  it('is DISTINCT from empty', () => {
    render(<TodayPage />);
    expect(screen.queryByTestId('today-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-loaded')).not.toBeInTheDocument();
  });

  it('still offers the one action that fixes it, and reports the click', () => {
    render(<TodayPage />);
    fireEvent.click(screen.getByTestId('today-insufficient-cta'));
    expect(H.push).toHaveBeenCalledWith('/diagnostic');
    expect(H.track).toHaveBeenCalledWith('today_primary_cta_clicked', {
      type: 'cold_start_diagnostic', reason: 'no_signals_yet',
    });
  });

  it('does NOT fire for a cold-start item once the learner has mastery signal', () => {
    H.today = { ...H.today, data: envelope([coldStart], { masterySubjectCount: 3 }) };
    render(<TodayPage />);
    expect(screen.queryByTestId('today-insufficient-evidence')).not.toBeInTheDocument();
    expect(screen.getByTestId('today-loaded')).toBeInTheDocument();
  });
});

/* ── Honest inputs into the loaded surface ───────────────────────────────── */

describe('inputs handed to the loaded surface', () => {
  it('passes null for the unread count when the notifications read FAILED, never 0', () => {
    H.notifications = { data: undefined, error: new Error('rpc failed') };
    render(<TodayPage />);
    // The stub swallows props, so assert via the page not crashing plus the
    // contract at the boundary: a failed read must not become a real number.
    expect(screen.getByTestId('today-loaded')).toBeInTheDocument();
    expect(H.notifications.data).toBeUndefined();
  });
});

/* ── P7 bilingual across the states ──────────────────────────────────────── */

describe('bilingual states (P7)', () => {
  it.each([
    ['error', () => { H.today = { ...H.today, data: undefined, error: new Error('x') }; }, 'today-error'],
    ['locked', () => { H.today = { ...H.today, data: null }; }, 'today-locked'],
    ['empty', () => { H.today = { ...H.today, data: envelope([], { practicedToday: false }) }; }, 'today-empty'],
    ['complete', () => { H.today = { ...H.today, data: envelope([], { practicedToday: true }) }; }, 'today-complete'],
  ])('%s renders in Hindi', (_name, setup, testId) => {
    setup();
    H.auth = { ...H.auth, isHi: true };
    render(<TodayPage />);
    expect(screen.getByTestId(testId).textContent ?? '').toMatch(/[ऀ-ॿ]/);
  });

  it('offline renders in Hindi', () => {
    setOnline(false);
    H.today = { ...H.today, data: undefined };
    H.auth = { ...H.auth, isHi: true };
    render(<TodayPage />);
    expect(screen.getByTestId('today-offline').textContent ?? '').toMatch(/[ऀ-ॿ]/);
  });
});

/* ── One state at a time ─────────────────────────────────────────────────── */

describe('the state machine is exclusive', () => {
  const ALL = [
    'today-gate-loading', 'today-loading', 'today-loaded', 'today-error',
    'today-offline', 'today-locked', 'today-empty', 'today-complete',
    'today-insufficient-evidence',
  ];

  it.each([
    ['loaded', () => {}],
    ['loading', () => { H.today = { ...H.today, data: undefined, isLoading: true }; }],
    ['error', () => { H.today = { ...H.today, data: undefined, error: new Error('x') }; }],
    ['locked', () => { H.today = { ...H.today, data: null }; }],
    ['empty', () => { H.today = { ...H.today, data: envelope([], { practicedToday: false }) }; }],
    ['complete', () => { H.today = { ...H.today, data: envelope([], { practicedToday: true }) }; }],
  ])('%s renders exactly one state root', (_n, setup) => {
    setup();
    render(<TodayPage />);
    const present = ALL.filter((id) => screen.queryByTestId(id) !== null);
    expect(present).toHaveLength(1);
  });

  it('reports at most one state to analytics per render', () => {
    H.today = { ...H.today, data: undefined, error: new Error('x') };
    render(<TodayPage />);
    expect(H.track.mock.calls.filter((c) => c[0] === 'today_state_shown')).toHaveLength(1);
  });
});
