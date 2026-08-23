/**
 * /exam-prep — the "Review" action button on a `review`/`revision` study-plan
 * task must navigate somewhere real, never a 404 (launch-readiness audit,
 * release/launch-readiness).
 *
 * BACKGROUND — what the audit flagged and what investigation found
 *   The audit reported the button's `router.push('/review')` as a confirmed
 *   404 because `apps/host/src/app/review/` is a genuinely empty directory
 *   (no page.tsx). That half is true in isolation, but it is not the whole
 *   picture: `apps/host/next.config.js` `redirects()` carries
 *     { source: '/review', destination: '/refresh?tab=flashcards', permanent: true }
 *   — a deliberate, pre-existing Study Menu v2 redirect (see
 *   `apps/host/src/__tests__/internal-href-route-resolution.test.ts`, describe
 *   block "'/review' is redirect-served, so the links still pointing at it are
 *   not dead", which already documents this exact mechanism protecting
 *   ReviewsDueCard, QuizResults, NextActionCard, TodaysFocus, and the
 *   learner-loop next-action — all of which push/link to `/review` the same
 *   way this button does). So a Next.js redirect intercepts the request
 *   BEFORE routing ever needs a page.tsx at `/review` — the button does not
 *   404 today.
 *
 *   No code change was made to this button as a result (changing it to
 *   `/revision` — the new, flag-gated Alfa OS Revision Center hub — would
 *   have been an unrelated, unnecessary behavior change and would have made
 *   this one call site inconsistent with every other `/review` caller above,
 *   which all still rely on the same redirect).
 *
 * WHAT THIS TEST PINS
 *   1. Clicking the Review button on a `review`/`revision` task still
 *      navigates to `/review` (behavioral regression guard — if this literal
 *      ever changes, the diff should be reviewed against the redirect table).
 *   2. The next.config.js redirect for `/review` → `/refresh?tab=flashcards`
 *      still exists (the ONLY thing keeping this button off a 404 — if this
 *      line is ever deleted without a replacement page, this test fails).
 *   3. `/review` still has no page.tsx of its own (confirms the redirect,
 *      not a page, is what serves it — if this ever stops being true the
 *      audit's literal premise would need re-checking).
 *   4. The redirect destination `/refresh` is itself a real, non-trivial page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';

const { authState, studyPlanRead, mockPush } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', grade: '8', subscription_plan: 'pro' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
  studyPlanRead: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const MATH = { code: 'math', name: 'Mathematics', name_hi: 'गणित', icon: '∑', color: '#7C3AED', isLocked: false };
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ subjects: [MATH], unlocked: [MATH], locked: [], isLoading: false }),
}));

vi.mock('@alfanumrik/ui/study-plan/TodayLoopCard', () => ({ default: () => null }));

vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'in', 'single', 'maybeSingle', 'update'];
  return {
    getStudyPlan: studyPlanRead,
    generateStudyPlan: vi.fn().mockResolvedValue(null),
    supabase: {
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve_: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve_);
        return builder;
      }),
    },
  };
});

import ExamPrepPage from '@/app/(student)/exam-prep/page';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const NEXT_CONFIG_PATH = resolve(REPO_ROOT, 'apps/host/next.config.js');
const REVIEW_PAGE_PATH = resolve(REPO_ROOT, 'apps/host/src/app/review/page.tsx');
const REFRESH_PAGE_PATH = resolve(REPO_ROOT, 'apps/host/src/app/refresh/page.tsx');

const TODAY = new Date().toISOString().split('T')[0];

const REVIEW_TASK = {
  id: 'task-review-1',
  day_number: 1,
  scheduled_date: TODAY,
  task_order: 1,
  task_type: 'review',
  title: 'Revise Algebra Basics',
  description: '',
  subject: 'math',
  chapter_number: null,
  chapter_title: null,
  topic: null,
  duration_minutes: 15,
  question_count: null,
  difficulty: 1,
  status: 'pending',
  xp_reward: 10,
  xp_earned: 0,
  score_percent: null,
};

const PLAN_WITH_REVIEW_TASK = {
  has_plan: true,
  plan: {
    id: 'plan-1',
    subject: 'math',
    title: 'Math Sprint',
    description: '',
    plan_type: 'exam',
    start_date: TODAY,
    end_date: TODAY,
    total_tasks: 1,
    completed_tasks: 0,
    progress_percent: 0,
    ai_reasoning: '',
  },
  tasks: [REVIEW_TASK],
};

beforeEach(() => {
  authState.isHi = false;
  studyPlanRead.mockReset();
  mockPush.mockClear();
  studyPlanRead.mockResolvedValue({ ok: true, data: PLAN_WITH_REVIEW_TASK });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('/exam-prep — Review button on a review/revision task never 404s', () => {
  it('clicking Review navigates to /review (component behavior, pinned)', async () => {
    render(React.createElement(ExamPrepPage));

    const reviewButton = await waitFor(() => screen.getByRole('button', { name: /Review/ }));
    fireEvent.click(reviewButton);

    expect(mockPush).toHaveBeenCalledWith('/review');
  });

  it('the next.config.js redirect that makes /review non-dead still exists', () => {
    const nextConfigSrc = readFileSync(NEXT_CONFIG_PATH, 'utf8');
    expect(
      /source:\s*['"]\/review['"]\s*,\s*destination:\s*['"]\/refresh\?tab=flashcards['"]/.test(nextConfigSrc),
      'the /review → /refresh?tab=flashcards redirect in apps/host/next.config.js is missing — ' +
        'every surface (including this exam-prep button) that still pushes/links to /review will 404 without it',
    ).toBe(true);
  });

  it('/review still has no page.tsx of its own — the redirect is doing the work, not a page', () => {
    expect(existsSync(REVIEW_PAGE_PATH)).toBe(false);
  });

  it('the redirect destination /refresh is a real, non-trivial page', () => {
    expect(existsSync(REFRESH_PAGE_PATH)).toBe(true);
    const refreshSrc = readFileSync(REFRESH_PAGE_PATH, 'utf8');
    expect(refreshSrc.length).toBeGreaterThan(200);
    expect(refreshSrc).toMatch(/export default function/);
  });
});
