/**
 * /reports — the monthly report may not invent numbers (Phase 6 / Risk R4).
 *
 * Acceptance criterion 8: "Never fill missing backend data with fabricated
 * metrics." This page violated it five ways at once:
 *
 *  1. It built a WHOLLY SYNTHETIC exam blueprint — `chapterNumber` was an array
 *     index, `chapterTitle` was actually the subject, every chapter got
 *     `marksWeightage: 10` and `difficultyWeight: 1`, and `totalMarks: 80` was
 *     hardcoded for every subject and every grade — then rendered the result as
 *     "Predicted Score / 80". A board-mark forecast from invented inputs.
 *  2. Weeks with no quizzes were zero-filled (`weeklyAccuracies.push(0)`), so
 *     the "Weekly Accuracy Trend" drew a 0% bar for a week the student simply
 *     didn't study — visually identical to scoring zero.
 *  3. `retentionScore` (= avg of the last 5 quiz scores) was labelled
 *     "7-Day Retention".
 *  4. Chips headed "Strong/Weak Chapters" listed subjects — and the query that
 *     fed them selected a column (`topic`) that does not exist on
 *     `bloom_progression`, so the request errored, the error was discarded, and
 *     the page rendered a confident 0% Concept Mastery dial instead.
 *  5. The insight strings were assembled in English inside the cognitive engine
 *     and rendered under bilingual headings — Hindi users got English (P7).
 *
 * Plus the stored-report path: `generate_monthly_report()` writes
 * `report_data = {generated_at, month}` — metrics live in sibling COLUMNS — and
 * the page cast that object straight to `MonthlyReportData`, producing NaN
 * dials and a `.length` crash on `strongChapters`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const { authState } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', name: 'Asha', grade: '10' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

/* Configurable supabase stub. Mirrors postgrest-js: it RESOLVES with
 * `{ data, error }` on failure rather than rejecting — which is exactly why a
 * page has to inspect `error` instead of leaning on try/catch. */
const { tableResults, selectArgs } = vi.hoisted(() => ({
  tableResults: new Map<string, unknown>(),
  selectArgs: new Map<string, string>(),
}));

vi.mock('@alfanumrik/lib/supabase-client', () => {
  const CHAIN = ['eq', 'neq', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'single', 'maybeSingle'];
  return {
    supabase: {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.select = vi.fn((cols: string) => { selectArgs.set(table, cols); return builder; });
        builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(tableResults.get(table) ?? { data: [], error: null }).then(resolve, reject);
        return builder;
      }),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    },
    supabaseUrl: 'http://localhost:54321',
    supabaseAnonKey: 'test-anon-key',
  };
});

import ReportsPage from '@/app/(student)/reports/page';

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth();
/** ISO timestamp for the Nth day of the currently-selected (latest) month. */
function dayOfThisMonth(day: number): string {
  return new Date(Date.UTC(YEAR, MONTH, day, 10, 0, 0)).toISOString();
}

function seed(opts: {
  quizzes?: unknown[];
  quizError?: unknown;
  bloom?: unknown[];
  bloomError?: unknown;
  storedReport?: unknown;
  profiles?: unknown[];
} = {}) {
  tableResults.clear();
  selectArgs.clear();
  tableResults.set('monthly_reports', { data: opts.storedReport ?? null, error: null });
  tableResults.set('quiz_sessions', { data: opts.quizzes ?? [], error: opts.quizError ?? null });
  tableResults.set('student_learning_profiles', { data: opts.profiles ?? [{ total_time_minutes: 60 }], error: null });
  tableResults.set('bloom_progression', { data: opts.bloom ?? [], error: opts.bloomError ?? null });
}

beforeEach(() => {
  authState.isHi = false;
  seed();
});
afterEach(() => cleanup());

/** Two quizzes, both in week 1 of the month — weeks 2/3/4 have none. */
const WEEK1_ONLY = [
  { score_percent: 80, completed_at: dayOfThisMonth(2), subject: 'math', total_questions: 10, time_taken_seconds: 300 },
  { score_percent: 60, completed_at: dayOfThisMonth(3), subject: 'math', total_questions: 10, time_taken_seconds: 300 },
];

describe('/reports — no fabricated board-mark forecast', () => {
  it('does not render a Predicted Score built from a synthetic blueprint', async () => {
    seed({ quizzes: WEEK1_ONLY, bloom: [{ subject: 'math', remember_mastery: 0.9, understand_mastery: 0.8, apply_mastery: 0.7 }] });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByText(/Quiz Scores/i)).toBeTruthy());

    expect(screen.queryByText(/Predicted Score/i)).toBeNull();
    expect(screen.queryByText('/80')).toBeNull();
    // Syllabus completion rode the same invented array (its denominator was the
    // rows the student had already touched, so it trended to 100%).
    expect(screen.queryByText(/Syllabus Complete/i)).toBeNull();
  });
});

describe('/reports — a week without quizzes is not a zero', () => {
  it('renders an explicit no-data marker, not a 0% bar, for unstudied weeks', async () => {
    seed({ quizzes: WEEK1_ONLY });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByText(/Weekly Accuracy Trend/i)).toBeTruthy());

    // Week 1 has a real average: (80 + 60) / 2 = 70.
    const values = screen.getAllByTestId('weekly-accuracy-value').map((n) => n.textContent);
    expect(values).toEqual(['70%']);
    // Weeks 2-4 must NOT be reported as 0% — asserted per-element rather than
    // against the whole subtree, because "70%" trivially contains "0%".
    expect(values).not.toContain('0%');
    // …and must be visibly marked as "no quizzes", not silently blank.
    expect(screen.getAllByTestId('weekly-accuracy-nodata').length).toBe(3);
  });
});

describe('/reports — the quiz average is called what it is', () => {
  it('never labels avg(last 5 quiz scores) as 7-day retention', async () => {
    seed({ quizzes: WEEK1_ONLY });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByText(/Quiz Scores/i)).toBeTruthy());

    expect(screen.queryByText(/7-Day Retention/i)).toBeNull();
    expect(screen.queryByText(/7-दिन स्मृति/)).toBeNull();
    expect(screen.getByTestId('recent-quiz-average').textContent).toMatch(/last 2 quizzes/i);
  });
});

describe('/reports — mastery chips name the right thing, from a column that exists', () => {
  it('queries bloom_progression by subject (there is no `topic` column)', async () => {
    seed({ quizzes: WEEK1_ONLY, bloom: [{ subject: 'science', remember_mastery: 0.2, understand_mastery: 0.1, apply_mastery: 0.1 }] });
    render(<ReportsPage />);

    await waitFor(() => expect(selectArgs.get('bloom_progression')).toBeTruthy());
    const cols = selectArgs.get('bloom_progression') ?? '';
    expect(cols).toContain('subject');
    expect(cols.split(',').map((c) => c.trim())).not.toContain('topic');
  });

  it('labels the chips as subjects, never as chapters', async () => {
    seed({ quizzes: WEEK1_ONLY, bloom: [{ subject: 'science', remember_mastery: 0.2, understand_mastery: 0.1, apply_mastery: 0.1 }] });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByText(/Weak subjects/i)).toBeTruthy());
    expect(screen.queryByText(/Weak Chapters/i)).toBeNull();
    expect(screen.queryByText(/Strong Chapters/i)).toBeNull();
    expect(screen.queryByText(/Unknown/)).toBeNull();
  });

  it('shows an honest error + retry when the mastery query fails, not a 0% dial', async () => {
    seed({ quizzes: WEEK1_ONLY, bloomError: { message: 'column bloom_progression.topic does not exist', code: '42703' } });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByTestId('mastery-load-error')).toBeTruthy());
    expect(screen.queryByTestId('concept-mastery-dial')).toBeNull();
  });
});

describe('/reports — insights are bilingual (P7)', () => {
  it('renders Hindi insight copy in Hindi mode', async () => {
    authState.isHi = true;
    seed({
      quizzes: WEEK1_ONLY,
      bloom: [{ subject: 'science', remember_mastery: 0.1, understand_mastery: 0.1, apply_mastery: 0.1 }],
    });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByTestId('report-insights')).toBeTruthy());
    const insights = screen.getByTestId('report-insights');
    // Devanagari present…
    expect(insights.textContent).toMatch(/[ऀ-ॿ]/);
    // …and the old English-only engine prose gone.
    expect(insights.textContent).not.toMatch(/Focus on|Increase study consistency|Work on speed/i);
  });
});

describe('/reports — a stored report row is validated before it is trusted', () => {
  it('does not render NaN (or crash) for a report_data blob that carries no metrics', async () => {
    // Exactly what generate_monthly_report() writes: metrics go to sibling
    // COLUMNS, report_data holds only provenance.
    seed({
      storedReport: { report_data: { generated_at: new Date().toISOString(), month: `${YEAR}-01-01` } },
      quizzes: WEEK1_ONLY,
    });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByText(/Quiz Scores/i)).toBeTruthy());
    expect(document.body.textContent).not.toContain('NaN');
  });
});

describe('/reports — failure is distinct from empty', () => {
  it('renders a retryable error, not "No data for this month", when the quiz fetch fails', async () => {
    seed({ quizError: { message: 'boom', code: '500' } });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByTestId('report-load-error')).toBeTruthy());
    expect(screen.queryByText(/No data for this month/i)).toBeNull();
  });

  it('still shows the genuine empty state when the fetch succeeds with nothing', async () => {
    seed({ quizzes: [] });
    render(<ReportsPage />);

    await waitFor(() => expect(screen.getByText(/No data for this month/i)).toBeTruthy());
    expect(screen.queryByTestId('report-load-error')).toBeNull();
  });
});
