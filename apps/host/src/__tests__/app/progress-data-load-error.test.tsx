/**
 * /progress — a failed data fetch renders an HONEST, retryable error state and
 * is DISTINCT from the genuine empty state (render unit).
 *
 * Frontend audit, Phase 3 Wave A
 *   The page previously fetched its four analytics sources with
 *   `.catch(() => {})` and its Performance-Score block with
 *   `.catch(() => setPerfLoading(false))`, tracking no error state at all. A
 *   failed request therefore rendered IDENTICALLY to a genuine empty result:
 *
 *     - knowledge gaps failed  → "No knowledge gaps detected!"  (a clean bill
 *       of academic health, told to a student whose request had just 500'd)
 *     - core profiles failed   → "Your progress will show up here" + a 0%
 *       accuracy ring (a returning student shown the first-run empty state)
 *     - performance scores fail→ "Performance Score will be calculated soon"
 *     - all cognitive sources  → "Start learning to see your progress"
 *
 *   Each source now settles independently and records its own failure; every
 *   reassuring empty is gated on `settled && !error`.
 *
 *   These tests mount the REAL page against a supabase stub whose per-table /
 *   per-RPC results are configurable, and assert BOTH directions for each
 *   surface: on failure the error card renders and the reassuring copy does
 *   NOT; on a successful-but-empty fetch the reassuring copy renders and the
 *   error card does NOT. A test that only asserted the failure direction would
 *   pass even if the fix had simply deleted the empty state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';

/* ── Mutable auth state (isHi flips for the bilingual test) ─────────────── */
const { authState } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', grade: '8', preferred_subject: 'math' },
    snapshot: null as unknown,
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
    refreshSnapshot: () => {},
  },
}));

// Stable router spy — the "Revise Now" destination assertions below need to
// read the pushes, so the mock must not mint a fresh fn on every render.
const { pushSpy } = vi.hoisted(() => ({ pushSpy: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

// usePermissions is UI-convenience only (P9). `can` returns false so the
// My-Pulse lens stays unmounted and the assertions below are about the data
// surfaces under test.
vi.mock('@alfanumrik/lib/usePermissions', () => ({
  usePermissions: () => ({ can: () => false, loading: false }),
}));

vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({
  useMyPulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
}));

/* The reachable-subject set (defect #11). Mocked so the Subject-Mastery scope
 * is deterministic instead of depending on a real /api/student/subjects fetch.
 * `allowedSubjects.subjects` is mutable so one case can flip the grade band. */
const { allowedSubjects } = vi.hoisted(() => ({
  allowedSubjects: {
    subjects: [
      { code: 'math', name: 'Mathematics' },
      { code: 'science', name: 'Science' },
    ] as { code: string; name: string }[],
  },
}));
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    subjects: allowedSubjects.subjects,
    unlocked: allowedSubjects.subjects,
    locked: [],
    isLoading: false,
    error: null,
    degraded: false,
    refresh: vi.fn(),
  }),
}));

// Recharts is heavy and irrelevant to error/empty gating.
vi.mock('@alfanumrik/ui/admin-ui', () => ({ LineChart: () => null }));

// Assert we LOG the failure rather than swallowing it into the void.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: warnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/* ── Configurable supabase stub ──────────────────────────────────────────
 * Every query builder method returns the builder; the builder is thenable and
 * resolves to whatever this table/RPC was configured with. Mirrors the shape
 * postgrest-js actually returns: it RESOLVES with `{ data, error }` on failure
 * rather than rejecting — which is exactly why the page has to inspect
 * `error` instead of relying on `.catch()`.
 *
 * A map value may also be a PROMISE of that shape, which keeps a source
 * deliberately in flight — that is how the "no flash" and "pending placeholder
 * is announced" cases below observe the loading state at all.
 *
 * The stub is installed at `@alfanumrik/lib/supabase-client` (the pure client
 * module), NOT at `@alfanumrik/lib/supabase`. That keeps the REAL shared read
 * helpers — getStudentProfiles / getSubjects / getBloomProgression /
 * getLearningVelocity / getKnowledgeGaps — in the module graph, so these tests
 * still exercise the actual table names, RPC names and `ServiceResult` mapping
 * the page depends on rather than a re-declared test double. Same technique as
 * study-path-integrity.test.ts. */
const { tableResults, rpcResults } = vi.hoisted(() => ({
  tableResults: new Map<string, unknown>(),
  rpcResults: new Map<string, unknown>(),
}));

vi.mock('@alfanumrik/lib/supabase-client', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'single', 'maybeSingle'];
  return {
    supabase: {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(tableResults.get(table) ?? { data: [], error: null }).then(resolve, reject);
        return builder;
      }),
      rpc: vi.fn(async (fn: string) => rpcResults.get(fn) ?? { data: [], error: null }),
    },
    supabaseUrl: 'http://localhost:54321',
    supabaseAnonKey: 'test-anon-key',
  };
});

import ProgressPage from '@/app/(student)/progress/page';

/** Everything succeeds and returns genuinely nothing. */
function seedAllHealthyAndEmpty() {
  tableResults.clear();
  rpcResults.clear();
  tableResults.set('coin_balances', { data: { balance: 0 }, error: null });
}

const pgError = (message: string) => ({ message, details: '', hint: '', code: '500' });

/** A returning student's core row — `total_sessions > 0`, so the first-run
 *  empty state must NOT apply. Values are fixtures only; no test below asserts
 *  a derived number, so none of them pin a formula. */
const RETURNING_PROFILE = {
  id: 'prof-1',
  student_id: 'stu-1',
  subject: 'math',
  xp: 120,
  total_sessions: 4,
  total_time_minutes: 30,
  total_questions_asked: 20,
  total_questions_answered_correctly: 15,
};

/** One settled Performance-Score row. `overall_score` is echoed straight into
 *  ScoreHero's aria-label by the page, so asserting it round-trips proves the
 *  LAST-KNOWN-GOOD value survived — it does not re-derive anything. */
const PERF_ROW = {
  id: 'ps-1',
  student_id: 'stu-1',
  subject: 'math',
  overall_score: 72,
  performance_component: 70,
  behavior_component: 74,
  level_name: 'Rising Star',
  updated_at: new Date().toISOString(),
};

/** ScoreHero's accessible name for PERF_ROW, in either language (P7): the page
 *  passes `overall_score` straight through, so matching this proves the value
 *  is still on screen. It asserts nothing about HOW the value was derived. */
const SCORE_72_LABEL = /(?:Overall score|समग्र स्कोर): 72/;

beforeEach(() => {
  authState.isHi = false;
  authState.student = { id: 'stu-1', grade: '8', preferred_subject: 'math' };
  allowedSubjects.subjects = [
    { code: 'math', name: 'Mathematics' },
    { code: 'science', name: 'Science' },
  ];
  warnSpy.mockClear();
  seedAllHealthyAndEmpty();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render, then switch to the "Deep Analysis" (cognitive) tab. */
async function renderCognitiveTab(hindi = false) {
  render(React.createElement(ProgressPage));
  const tab = await screen.findByText(hindi ? 'गहन विश्लेषण' : 'Deep Analysis');
  fireEvent.click(tab);
}

describe('/progress — knowledge gaps: failure is never a clean bill of health', () => {
  it('renders the error card and NOT "No knowledge gaps detected!" when the fetch fails', async () => {
    rpcResults.set('get_knowledge_gaps', { data: null, error: pgError('gaps rpc exploded') });
    await renderCognitiveTab();

    await waitFor(() =>
      expect(screen.getByText("Couldn't check your knowledge gaps")).toBeDefined(),
    );
    // The reassuring empty must be absent — this is the whole defect.
    expect(screen.queryByText('No knowledge gaps detected!')).toBeNull();
    // Retryable, not a dead end.
    expect(screen.getByText(/Retry/)).toBeDefined();
    // Logged, not swallowed.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('renders "No knowledge gaps detected!" and NO error card when the fetch succeeds with zero gaps', async () => {
    rpcResults.set('get_knowledge_gaps', { data: [], error: null });
    await renderCognitiveTab();

    await waitFor(() =>
      expect(screen.getByText('No knowledge gaps detected!')).toBeDefined(),
    );
    // Distinct states: the genuine empty must NOT be replaced by the error card.
    expect(screen.queryByText("Couldn't check your knowledge gaps")).toBeNull();
  });
});

describe('/progress — core profiles: failure is never the first-run empty state', () => {
  it('renders the error card and NOT "Your progress will show up here" when profiles fail', async () => {
    tableResults.set('student_learning_profiles', { data: null, error: pgError('rls denied') });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load your progress")).toBeDefined(),
    );
    expect(screen.queryByText('Your progress will show up here')).toBeNull();
    expect(screen.queryByText('Take First Quiz')).toBeNull();
  });

  it('renders the first-run empty state when the fetch succeeds with no history', async () => {
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText('Your progress will show up here')).toBeDefined(),
    );
    expect(screen.queryByText("Couldn't load your progress")).toBeNull();
  });
});

/* Fixture note (Finding #2 follow-up): both cases below seed a RETURNING
 * student. They previously left core at the healthy-empty default, which since
 * the Finding #2 fix routes a zero-history student to the first-run welcome
 * card — the correct outcome for a brand-new learner, but it means the
 * Performance-Score surface under test is never reached. The assertions are
 * unchanged and un-weakened; only the learner the fixture describes is now one
 * who actually has a Performance-Score surface to fail. The brand-new-learner
 * direction is covered explicitly in the Finding #2 suite below. */
describe('/progress — Performance Score: failure is never "calculated soon"', () => {
  it('renders the error card and NOT the "will be calculated soon" promise', async () => {
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('performance_scores', { data: null, error: pgError('timeout') });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load your Performance Score")).toBeDefined(),
    );
    expect(screen.queryByText('Performance Score will be calculated soon')).toBeNull();
  });

  it('does not render a "0" coin balance when the balance is unknown', async () => {
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('coin_balances', { data: null, error: pgError('coin table unreachable') });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load your Performance Score")).toBeDefined(),
    );
    // CoinBalance renders role="status" with an "N Foxy Coins" aria-label.
    // A number we can't stand behind must not be shown at all.
    expect(screen.queryByLabelText(/Foxy Coins/)).toBeNull();
  });
});

describe('/progress — cognitive tab: failure is never "start learning"', () => {
  it('suppresses the "Start learning to see your progress" empty state when every source failed', async () => {
    rpcResults.set('get_bloom_progression', { data: null, error: pgError('down') });
    rpcResults.set('get_knowledge_gaps', { data: null, error: pgError('down') });
    tableResults.set('learning_velocity', { data: null, error: pgError('down') });
    tableResults.set('cognitive_session_metrics', { data: null, error: pgError('down') });

    await renderCognitiveTab();

    await waitFor(() =>
      expect(screen.getByText("Couldn't check your knowledge gaps")).toBeDefined(),
    );
    expect(screen.queryByText('Start learning to see your progress')).toBeNull();
    expect(screen.getByText("Couldn't load your Bloom's mastery")).toBeDefined();
    expect(screen.getByText("Couldn't load your learning velocity")).toBeDefined();
    expect(screen.getByText("Couldn't load your quiz sessions")).toBeDefined();
  });

  it('still shows "Start learning to see your progress" when every source succeeds with nothing', async () => {
    await renderCognitiveTab();

    await waitFor(() =>
      expect(screen.getByText('Start learning to see your progress')).toBeDefined(),
    );
    expect(screen.queryByText("Couldn't check your knowledge gaps")).toBeNull();
  });
});

describe('/progress — error states are bilingual (P7)', () => {
  it('renders the Hindi error copy when isHi is true', async () => {
    authState.isHi = true;
    rpcResults.set('get_knowledge_gaps', { data: null, error: pgError('gaps rpc exploded') });
    await renderCognitiveTab(true);

    await waitFor(() =>
      expect(screen.getByText('ज्ञान की कमियाँ जाँची नहीं जा सकीं')).toBeDefined(),
    );
    expect(screen.getByRole('button', { name: /फिर से कोशिश करो/ })).toBeDefined();
    // English copy must not leak into the Hindi surface.
    expect(screen.queryByText("Couldn't check your knowledge gaps")).toBeNull();
  });

  it('renders the Hindi core-failure copy when isHi is true', async () => {
    authState.isHi = true;
    tableResults.set('student_learning_profiles', { data: null, error: pgError('rls denied') });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText('तुम्हारी प्रगति लोड नहीं हो सकी')).toBeDefined(),
    );
    expect(screen.queryByText('तुम्हारी प्रगति यहाँ दिखेगी')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Quality review follow-ups — Findings #2, #3, #5
   ═══════════════════════════════════════════════════════════════════════════ */

describe('/progress — first-run status is derived from CORE, not from perf (Finding #2)', () => {
  it('still welcomes a genuinely-new student when the unrelated Performance Score fetch FAILS', async () => {
    // Core succeeded and truthfully reports zero history …
    tableResults.set('student_learning_profiles', { data: [], error: null });
    // … while an independent source 500s. The old gate required perf to have
    // settled cleanly, so this student got the full dashboard rendered at 0%
    // instead of the welcome card.
    tableResults.set('performance_scores', { data: null, error: pgError('perf 500') });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText('Your progress will show up here')).toBeDefined(),
    );
    expect(screen.getByText('Take First Quiz')).toBeDefined();
    // The dashboard-at-0% regression must be absent.
    expect(screen.queryByText('Overall Accuracy')).toBeNull();
    expect(screen.queryByLabelText(/Overall score:/)).toBeNull();
  });

  it('does NOT show the first-run card to a returning student when perf fails (other direction)', async () => {
    // Core says this student has history, so "no history yet" would be a lie
    // no matter what perf does.
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('performance_scores', { data: null, error: pgError('perf 500') });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load your Performance Score")).toBeDefined(),
    );
    expect(screen.queryByText('Your progress will show up here')).toBeNull();
    expect(screen.queryByText('Take First Quiz')).toBeNull();
  });

  it('does not flash: the card appears once core settles and survives perf resolving later', async () => {
    let resolvePerf: (v: unknown) => void = () => {};
    tableResults.set('student_learning_profiles', { data: [], error: null });
    tableResults.set(
      'performance_scores',
      new Promise<unknown>((r) => { resolvePerf = r; }),
    );
    render(React.createElement(ProgressPage));

    // Appears as soon as CORE settles, while perf is still in flight …
    await waitFor(() =>
      expect(screen.getByText('Your progress will show up here')).toBeDefined(),
    );
    // … with no intervening dashboard render.
    expect(screen.queryByText('Overall Accuracy')).toBeNull();

    // … and is still there after perf settles: appear → (no disappear) → stay.
    await act(async () => { resolvePerf({ data: [], error: null }); });
    expect(screen.getByText('Your progress will show up here')).toBeDefined();
  });
});

describe('/progress — a failed REFRESH preserves last-known-good data (Finding #3)', () => {
  /** Loads perf successfully, then re-runs the page's load effect (the student
   *  id is the effect's only dependency) against a now-failing perf source. */
  async function loadThenFailRefresh() {
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('performance_scores', { data: [PERF_ROW], error: null });
    const { rerender } = render(React.createElement(ProgressPage));

    await waitFor(() => expect(screen.getByLabelText(SCORE_72_LABEL)).toBeDefined());

    tableResults.set('performance_scores', { data: null, error: pgError('perf 500 on refresh') });
    authState.student = { ...authState.student, id: 'stu-2' };
    rerender(React.createElement(ProgressPage));
    return rerender;
  }

  it('keeps the score on screen and shows a non-destructive notice instead of the error card', async () => {
    await loadThenFailRefresh();

    await waitFor(() =>
      expect(screen.getByText("Couldn't refresh — showing your last saved data.")).toBeDefined(),
    );
    // The valid number the student was already reading survives the failure.
    expect(screen.getByLabelText(SCORE_72_LABEL)).toBeDefined();
    // It must NOT be replaced by the initial-load error card.
    expect(screen.queryByText("Couldn't load your Performance Score")).toBeNull();
    // Logged, not swallowed.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('offers a 44px retry control that recovers the surface on success', async () => {
    await loadThenFailRefresh();
    await waitFor(() =>
      expect(screen.getByText("Couldn't refresh — showing your last saved data.")).toBeDefined(),
    );

    const refresh = screen.getByRole('button', { name: /Refresh/ });
    // P-invariant of every interactive control on this page.
    expect(refresh.className).toContain('min-h-[44px]');

    tableResults.set('performance_scores', { data: [PERF_ROW], error: null });
    fireEvent.click(refresh);

    await waitFor(() =>
      expect(screen.queryByText("Couldn't refresh — showing your last saved data.")).toBeNull(),
    );
    expect(screen.getByLabelText(SCORE_72_LABEL)).toBeDefined();
  });

  it('still shows the destructive error card when the FIRST load fails (other direction)', async () => {
    // Nothing good was ever fetched, so there is nothing to preserve — the
    // honest error card is correct here and the stale affordance would be a lie.
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('performance_scores', { data: null, error: pgError('perf 500') });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load your Performance Score")).toBeDefined(),
    );
    expect(screen.queryByText("Couldn't refresh — showing your last saved data.")).toBeNull();
  });

  it('renders the Hindi refresh-failure copy when isHi is true (P7)', async () => {
    authState.isHi = true;
    await loadThenFailRefresh();

    await waitFor(() =>
      expect(screen.getByText('ताज़ा नहीं हो सका — पिछली बार का सुरक्षित डेटा दिख रहा है।')).toBeDefined(),
    );
    // English copy must not leak into the Hindi surface.
    expect(screen.queryByText("Couldn't refresh — showing your last saved data.")).toBeNull();
  });
});

describe('/progress — the pending placeholder is announced (Finding #5, WCAG 2.2 AA 4.1.3)', () => {
  it('gives DataPendingCard role="status" + aria-busy and swaps to role="alert" on failure', async () => {
    let resolveCore: (v: unknown) => void = () => {};
    tableResults.set(
      'student_learning_profiles',
      new Promise<unknown>((r) => { resolveCore = r; }),
    );
    render(React.createElement(ProgressPage));

    const label = await screen.findByText('Loading your progress…');
    const region = label.closest('[role="status"]');
    expect(region).not.toBeNull();
    expect(region!.getAttribute('aria-busy')).toBe('true');
    // The shimmer stays aria-hidden so the live region announces the label
    // once, rather than firing a second, empty announcement.
    expect(region!.querySelector('.animate-pulse')!.getAttribute('aria-hidden')).toBe('true');

    // Once it settles the busy region is GONE — it cannot re-announce.
    await act(async () => { resolveCore({ data: null, error: pgError('boom') }); });
    expect(document.querySelector('[role="status"][aria-busy="true"]')).toBeNull();
    // Sibling precedent is untouched: the error card is still role="alert".
    expect(screen.getByText("Couldn't load your progress").closest('[role="alert"]')).not.toBeNull();
  });
});

/* ══ Defect #10 — the low-mastery list must name the topic ══════════════════
 *
 * `loadPerf` used to select `id, topic_id, mastery_probability, next_review_at`
 * from `concept_mastery` with NO join, then render
 * `topic_id.substring(0, 8) + '…'`. The student read "a3f2b1c0…" with an empty
 * subject, and "Revise Now" pushed `/foxy?topic=a3f2b1c0%E2%80%A6` — a param
 * Foxy stashes verbatim with no lookup and no switchSubject, so the tap read as
 * "nothing happened".
 *
 * It now reads `public.topic_mastery_rollup` (the security_invoker view that
 * already joins curriculum_topics + subjects), so the title and the subject
 * CODE are real. The heading was corrected too: the query filters on
 * `mastery_probability < 0.5` with NO next_review_at bound, so it is a
 * LOW-MASTERY list, not a DUE list — "due" belongs to /revision.
 *
 * NOTE on matchers: SectionHeader renders `{icon} {children}` as two sibling
 * text nodes, so the heading element's text includes the icon. Headings are
 * matched with a regex substring for that reason.
 */
const ROLLUP_ROWS = [
  {
    subject: 'math',
    topic_tag: 'Real Numbers',
    chapter_number: 1,
    mastery_probability: 0.21,
    next_review_at: null,
  },
  {
    subject: 'science',
    topic_tag: 'Light and Reflection',
    chapter_number: 10,
    mastery_probability: 0.34,
    next_review_at: null,
  },
];

describe('/progress — low-mastery list reads topic_mastery_rollup, not a bare UUID', () => {
  it('renders the REAL topic title, never a UUID prefix', async () => {
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('topic_mastery_rollup', { data: ROLLUP_ROWS, error: null });
    render(React.createElement(ProgressPage));

    await waitFor(() => expect(screen.getByText('Real Numbers')).toBeDefined());
    expect(screen.getByText('Light and Reflection')).toBeDefined();
    // The exact shape of the old defect: an 8-hex-char chip ending in an ellipsis.
    expect(screen.queryByText(/^[0-9a-f]{8}…$/)).toBeNull();
  });

  it('is titled as a LOW-MASTERY list, not a due list (that concept belongs to /revision)', async () => {
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('topic_mastery_rollup', { data: ROLLUP_ROWS, error: null });
    render(React.createElement(ProgressPage));

    await waitFor(() => expect(screen.getByText(/Lowest mastery/)).toBeDefined());
    expect(screen.queryByText(/Topics that need revision/)).toBeNull();
  });

  it('"Revise Now" navigates to a subject + topic scoped destination Foxy actually reads', async () => {
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('topic_mastery_rollup', { data: [ROLLUP_ROWS[0]], error: null });
    render(React.createElement(ProgressPage));

    await waitFor(() => expect(screen.getByText('Real Numbers')).toBeDefined());
    fireEvent.click(screen.getByText('Revise Now'));

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const dest = String(pushSpy.mock.calls[0][0]);
    const q = new URLSearchParams(dest.slice('/foxy?'.length));
    expect(q.get('topic')).toBe('Real Numbers');
    expect(q.get('subject')).toBe('math'); // a CODE, from subjects.code
    expect(q.get('chapter')).toBe('1');
    // The unreachable dead branch is gone — no UUID-shaped topic param.
    expect(dest).not.toMatch(/topic=[0-9a-f]{8}/);
  });

  it('BILINGUAL (P7): the Hindi heading replaces the English one', async () => {
    authState.isHi = true;
    tableResults.set('student_learning_profiles', { data: [RETURNING_PROFILE], error: null });
    tableResults.set('topic_mastery_rollup', { data: ROLLUP_ROWS, error: null });
    render(React.createElement(ProgressPage));

    await waitFor(() =>
      expect(screen.getByText(/सबसे कम महारत वाले विषय/)).toBeDefined(),
    );
    expect(screen.queryByText(/Lowest mastery/)).toBeNull();
  });
});

/* ══ Defect #11 — Subject Mastery shows only the reachable subjects ═════════
 *
 * student_learning_profiles carries a row for EVERY subject the student ever
 * touched. This list rendered all of them, while the dashboard's mastery
 * widgets were scoped — two different answers to "which subjects?" one tap
 * apart. Both now key off /api/student/subjects (= grade_subject_map).
 */
describe('/progress — Subject Mastery scope matches grade_subject_map (defect #11)', () => {
  const profileFor = (subject: string) => ({
    ...RETURNING_PROFILE,
    id: `prof-${subject}`,
    subject,
  });

  it('grade 9: shows math + science, hides a stale english profile', async () => {
    tableResults.set('student_learning_profiles', {
      data: [profileFor('math'), profileFor('science'), profileFor('english')],
      error: null,
    });
    tableResults.set('subjects', {
      data: [
        { code: 'math', name: 'Mathematics', name_hi: 'गणित', icon: 'M', color: '#f00' },
        { code: 'science', name: 'Science', name_hi: 'विज्ञान', icon: 'S', color: '#0f0' },
        { code: 'english', name: 'English', name_hi: 'अंग्रेज़ी', icon: 'E', color: '#00f' },
      ],
      error: null,
    });
    render(React.createElement(ProgressPage));

    await waitFor(() => expect(screen.getByText(/Subject Mastery/)).toBeDefined());
    expect(screen.getByText('Mathematics')).toBeDefined();
    expect(screen.getByText('Science')).toBeDefined();
    expect(screen.queryByText('English')).toBeNull();
  });

  it('grade 11: Physics/Chemistry/Biology are NOT dropped (the old hardcode bug)', async () => {
    allowedSubjects.subjects = [
      { code: 'biology', name: 'Biology' },
      { code: 'chemistry', name: 'Chemistry' },
      { code: 'math', name: 'Mathematics' },
      { code: 'physics', name: 'Physics' },
    ];
    tableResults.set('student_learning_profiles', {
      data: [
        profileFor('physics'),
        profileFor('chemistry'),
        profileFor('biology'),
        profileFor('math'),
      ],
      error: null,
    });
    tableResults.set('subjects', {
      data: [
        { code: 'physics', name: 'Physics', name_hi: 'भौतिकी', icon: 'P', color: '#f00' },
        { code: 'chemistry', name: 'Chemistry', name_hi: 'रसायन', icon: 'C', color: '#0f0' },
        { code: 'biology', name: 'Biology', name_hi: 'जीव विज्ञान', icon: 'B', color: '#00f' },
        { code: 'math', name: 'Mathematics', name_hi: 'गणित', icon: 'M', color: '#ff0' },
      ],
      error: null,
    });
    render(React.createElement(ProgressPage));

    await waitFor(() => expect(screen.getByText(/Subject Mastery/)).toBeDefined());
    for (const name of ['Physics', 'Chemistry', 'Biology', 'Mathematics']) {
      expect(screen.getByText(name)).toBeDefined();
    }
  });
});
