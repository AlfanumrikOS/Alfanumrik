/**
 * /exam-prep — a failed study-plan read renders an HONEST, retryable error
 * state and is DISTINCT from "this student genuinely has no plan yet"
 * (render unit).
 *
 * THE DEFECT THIS PINS
 *   load() did `try { const data = await getStudyPlan(...) } catch { setHasPlan(false) }`,
 *   and getStudyPlan swallowed its PostgREST error into `{ has_plan: false }`
 *   anyway. Both routes led to the same place: the "Your AI Study Plan /
 *   generate one" screen. So a student who HAD a plan was told they had none
 *   the moment the read 500'd — and invited to generate a new one over the top
 *   of it.
 *
 *   getStudyPlan now returns a `ServiceResult`; `has_plan: false` is reachable
 *   ONLY from a successful read (including the PGRST116 "no rows" case, which
 *   genuinely means no plan).
 *
 *   Both directions are asserted. A test that only checked the failure
 *   direction would pass even if the fix had deleted the generate screen, which
 *   is the correct destination for a real first-time student.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const { authState, studyPlanRead, warnSpy } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', grade: '8', subscription_plan: 'pro' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
  studyPlanRead: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: warnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const MATH = { code: 'math', name: 'Mathematics', name_hi: 'गणित', icon: '∑', color: '#7C3AED', isLocked: false };
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ subjects: [MATH], unlocked: [MATH], locked: [], isLoading: false }),
}));

// Learner-loop card is an independent surface; irrelevant to plan gating.
vi.mock('@alfanumrik/ui/study-plan/TodayLoopCard', () => ({ default: () => null }));

/* getStudyPlan is the seam under test. The page's two best-effort enrichment
 * reads (cognitive_session_metrics, knowledge_gaps) go through `supabase` and
 * resolve to nothing — they are deliberately non-blocking and are NOT what this
 * suite is about. */
vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'in', 'single', 'maybeSingle'];
  return {
    getStudyPlan: studyPlanRead,
    generateStudyPlan: vi.fn().mockResolvedValue(null),
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

import ExamPrepPage from '@/app/(student)/exam-prep/page';

/** A settled plan. Values are fixtures only — no assertion below derives a
 *  number from them, so nothing here pins a formula. */
const ACTIVE_PLAN = {
  has_plan: true,
  plan: { id: 'plan-1', title: 'Math Sprint', total_days: 7, daily_minutes: 60, subject: 'math' },
  tasks: [],
};

beforeEach(() => {
  authState.isHi = false;
  studyPlanRead.mockReset();
  warnSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('/exam-prep — a failed plan read is never "you have no plan"', () => {
  it('renders the error card and NOT the generate screen when the read fails', async () => {
    studyPlanRead.mockResolvedValue({ ok: false, error: 'study_plans timeout', code: 'DB_ERROR' });
    render(React.createElement(ExamPrepPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load your study plan")).toBeDefined(),
    );
    // The false "you have no plan" claim must be absent — this is the defect.
    expect(screen.queryByText('Your AI Study Plan')).toBeNull();
    // Retryable, not a dead end.
    expect(screen.getByRole('button', { name: /Try again/ })).toBeDefined();
    // Logged, not swallowed.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('renders the generate screen and NO error card when the student genuinely has no plan', async () => {
    studyPlanRead.mockResolvedValue({ ok: true, data: { has_plan: false } });
    render(React.createElement(ExamPrepPage));

    await waitFor(() => expect(screen.getByText('Your AI Study Plan')).toBeDefined());
    expect(screen.queryByText("Couldn't load your study plan")).toBeNull();
  });

  it('renders the plan when the read succeeds with one (control)', async () => {
    studyPlanRead.mockResolvedValue({ ok: true, data: ACTIVE_PLAN });
    render(React.createElement(ExamPrepPage));

    await waitFor(() => expect(screen.getByText('Math Sprint')).toBeDefined());
    expect(screen.queryByText("Couldn't load your study plan")).toBeNull();
    expect(screen.queryByText('Your AI Study Plan')).toBeNull();
  });

  it('recovers the plan on retry', async () => {
    studyPlanRead.mockResolvedValue({ ok: false, error: 'study_plans timeout', code: 'DB_ERROR' });
    render(React.createElement(ExamPrepPage));
    await waitFor(() =>
      expect(screen.getByText("Couldn't load your study plan")).toBeDefined(),
    );

    studyPlanRead.mockResolvedValue({ ok: true, data: ACTIVE_PLAN });
    const retry = screen.getByRole('button', { name: /Try again/ });
    // P-invariant of every interactive control on this surface.
    expect(retry.className).toContain('min-h-[44px]');
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText('Math Sprint')).toBeDefined());
    expect(screen.queryByText("Couldn't load your study plan")).toBeNull();
  });

  it('still lets the student choose to generate a plan after a failure (escape hatch)', async () => {
    studyPlanRead.mockResolvedValue({ ok: false, error: 'study_plans timeout', code: 'DB_ERROR' });
    render(React.createElement(ExamPrepPage));
    await waitFor(() =>
      expect(screen.getByText("Couldn't load your study plan")).toBeDefined(),
    );

    // Generating must remain reachable — but only as a deliberate choice, never
    // as the screen a 500 renders by default.
    fireEvent.click(screen.getByRole('button', { name: /Create a new plan/ }));
    await waitFor(() => expect(screen.getByText('Your AI Study Plan')).toBeDefined());
  });

  it('renders the Hindi failure copy when isHi is true (P7)', async () => {
    authState.isHi = true;
    studyPlanRead.mockResolvedValue({ ok: false, error: 'study_plans timeout', code: 'DB_ERROR' });
    render(React.createElement(ExamPrepPage));

    await waitFor(() =>
      expect(screen.getByText('तुम्हारी योजना लोड नहीं हो सकी')).toBeDefined(),
    );
    // English copy must not leak into the Hindi surface.
    expect(screen.queryByText("Couldn't load your study plan")).toBeNull();
    expect(screen.queryByText('तुम्हारा AI Study Plan')).toBeNull();
  });
});
