/**
 * /progress — mastery predictions and "retention" (Phase 6 / Risk R4).
 *
 * Two numbers on this page were not what their labels claimed:
 *
 *  1. `predictMasteryDate(rate, rate)`. The signature is
 *     `(currentMastery, velocity, targetMastery = 0.95)`. The page passed the
 *     WEEKLY mastery rate as BOTH the current mastery AND the DAILY velocity,
 *     so the arithmetic was `(0.95 - weeklyRate) / weeklyRate` days — a date
 *     with no defensible meaning, rendered as "Predicted by <date>" under a
 *     heading that reads "Mastery Predictions".
 *
 *  2. `retentionPct = Math.round(mastery_probability * 100)` rendered as
 *     "<n>% retained". `concept_mastery.mastery_probability` is a BKT mastery
 *     posterior, not a memory-retention measurement. Relabelling a mastery
 *     estimate as retention is exactly the fabrication acceptance-criterion 8
 *     forbids.
 *
 * The fix keeps every server-supplied number (`predicted_mastery_date`,
 * `mastery_probability`) and drops/renames only what the client was inventing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@alfanumrik/lib/usePermissions', () => ({
  usePermissions: () => ({ can: () => false, loading: false }),
}));
vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({
  useMyPulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
}));
vi.mock('@alfanumrik/ui/admin-ui', () => ({ LineChart: () => null }));

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

function seed() {
  tableResults.clear();
  rpcResults.clear();
  tableResults.set('student_learning_profiles', {
    data: [{ id: 'p1', subject: 'math', total_questions_asked: 20, total_questions_answered_correctly: 15, total_sessions: 4, xp_earned: 100, total_time_minutes: 30 }],
    error: null,
  });
  tableResults.set('subjects', { data: [{ code: 'math', name: 'Mathematics', name_hi: 'गणित', color: '#f60', icon: '📐' }], error: null });
}

beforeEach(() => {
  authState.isHi = false;
  seed();
});
afterEach(() => cleanup());

function seedVelocity(predicted_mastery_date: string | null) {
  tableResults.set('learning_velocity', {
    data: [{ id: 'v1', subject: 'math', weekly_mastery_rate: 0.05, predicted_mastery_date }],
    error: null,
  });
}

/** The Learning Velocity block lives behind the "Deep Analysis" tab. */
function openDeepAnalysis() {
  fireEvent.click(screen.getByText('Deep Analysis'));
}

describe('/progress — mastery predictions (Overview tab)', () => {
  it('shows no predicted date when the server did not supply one', async () => {
    seedVelocity(null);

    render(<ProgressPage />);
    await waitFor(() => expect(screen.getByText(/Mastery Predictions/i)).toBeTruthy());

    // predictMasteryDate(0.05, 0.05) = (0.95 - 0.05) / 0.05 = 18 days from
    // today — the meaningless number the page used to print.
    expect(screen.queryByTestId('mastery-prediction-date')).toBeNull();
    expect(screen.getByTestId('mastery-prediction-none')).toBeTruthy();
  });

  it('shows the server-supplied predicted date when there is one', async () => {
    seedVelocity(new Date(Date.now() + 30 * 86400000).toISOString());

    render(<ProgressPage />);
    await waitFor(() => expect(screen.getByTestId('mastery-prediction-date')).toBeTruthy());
    expect(screen.queryByTestId('mastery-prediction-none')).toBeNull();
  });
});

describe('/progress — learning velocity (Deep Analysis tab)', () => {
  it('shows no predicted date when the server did not supply one', async () => {
    seedVelocity(null);

    render(<ProgressPage />);
    await waitFor(() => expect(screen.getByText('Deep Analysis')).toBeTruthy());
    openDeepAnalysis();

    await waitFor(() => expect(screen.getByText(/Learning Velocity/i)).toBeTruthy());
    expect(screen.queryByTestId('velocity-predicted-date')).toBeNull();
  });

  it('shows the server-supplied predicted date when there is one', async () => {
    seedVelocity(new Date(Date.now() + 30 * 86400000).toISOString());

    render(<ProgressPage />);
    await waitFor(() => expect(screen.getByText('Deep Analysis')).toBeTruthy());
    openDeepAnalysis();

    await waitFor(() => expect(screen.getByTestId('velocity-predicted-date')).toBeTruthy());
  });
});

describe('/progress — lowest-mastery topics', () => {
  it('labels a BKT mastery probability as mastery, never as retention', async () => {
    // Source re-pointed 2026-08 (defect #10): the list reads the
    // `topic_mastery_rollup` view (which joins curriculum_topics + subjects)
    // instead of a bare, unjoined `concept_mastery` select whose only label was
    // a UUID prefix. The heading changed with it — the query has no
    // next_review_at bound, so it is a LOW-MASTERY list, not a due list.
    tableResults.set('topic_mastery_rollup', {
      data: [{
        subject: 'math',
        topic_tag: 'Fractions',
        chapter_number: 2,
        mastery_probability: 0.42,
        next_review_at: new Date().toISOString(),
      }],
      error: null,
    });

    render(<ProgressPage />);
    await waitFor(() => expect(screen.getByText(/Lowest mastery/i)).toBeTruthy());
    // The real title is on screen, not a UUID prefix.
    expect(screen.getByText('Fractions')).toBeTruthy();

    const chip = screen.getByTestId('decay-mastery-value');
    expect(chip.textContent).toContain('42%');
    expect(chip.textContent).not.toMatch(/retained/i);
    expect(chip.textContent).toMatch(/master/i);
  });
});
