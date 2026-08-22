/**
 * /learn (subject grid) — a failed/degraded subject read renders an HONEST,
 * retryable state and is NEVER rendered as a plan lock (render unit).
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 * The grid was a bare `allowedSubjects.map()` + `lockedSubjects.map()` with no
 * other branch. `GET /api/student/subjects` fails CLOSED: when
 * `get_available_subjects` errors or returns nothing, the route rebuilds the
 * list from grade_subject_map ⋈ subjects(is_active) and stamps EVERY row
 * `isLocked: true`, because plan context is unavailable on that path. Two
 * consequences, both shipped:
 *
 *   • `{ subjects: [] }` → the heading "Grade 8 · Choose a subject to study"
 *     rendered over an empty grid.
 *   • a NON-empty fallback → every subject rendered as a LockedCard reading
 *     "Upgrade to unlock", under an "Unlock N more subjects" strip. A student
 *     already paying for Pro or Unlimited was told to buy what they had
 *     already bought.
 *
 * The second is the serious one. It is not a merchandising miss; it is the app
 * making a false claim about what a paying customer purchased, triggered by
 * its own backend failure.
 *
 * ── WHAT IS ASSERTED ─────────────────────────────────────────────────────
 * Both directions in every case, so the suite cannot be satisfied by a page
 * that simply deleted the upgrade path:
 *   degraded → honest failure, upgrade copy ABSENT, retry refetches
 *   locked   → upgrade copy PRESENT, failure copy absent
 *   empty    → genuine empty, failure copy absent, prompt heading absent
 *   loaded   → the grid + prompt heading, neither of the above
 *
 * Sibling of learn-chapter-list-load-error.test.tsx, which covers the DIFFERENT
 * seam (the chapter read for an already-selected subject) on the same page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

type SubjectStub = {
  code: string; name: string; nameHi: string; icon: string; color: string;
  subjectKind: string; isCore: boolean; isLocked: boolean;
};

const MATH: SubjectStub = {
  code: 'math', name: 'Mathematics', nameHi: 'गणित', icon: '∑', color: '#7C3AED',
  subjectKind: 'cbse_core', isCore: true, isLocked: false,
};
const SCIENCE_LOCKED: SubjectStub = {
  code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#059669',
  subjectKind: 'cbse_core', isCore: true, isLocked: true,
};

const { authState, subjectsState, refreshSpy, pushSpy } = vi.hoisted(() => ({
  authState: {
    // Deliberately a PAID plan: this is the student the defect libels.
    student: { id: 'stu-1', grade: '8', subscription_plan: 'unlimited', onboarding_completed: true },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
  subjectsState: {
    subjects: [] as SubjectStub[],
    unlocked: [] as SubjectStub[],
    locked: [] as SubjectStub[],
    isLoading: false,
    degraded: false,
  },
  refreshSpy: vi.fn(),
  pushSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
  usePathname: () => '/learn',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ ...subjectsState, error: null, refresh: refreshSpy }),
}));

vi.mock('@alfanumrik/lib/useSubjectReadiness', () => ({
  useSubjectReadiness: () => ({ readiness: null, isLoading: false, error: null }),
}));

vi.mock('@alfanumrik/lib/use-subjects-os-flag', () => ({
  useSubjectsOsFlag: () => false,
  getSubjectsOsFlagSync: () => false,
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));

vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'in', 'single', 'maybeSingle'];
  return {
    getChaptersForSubject: vi.fn(async () => ({ ok: true, data: [] })),
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

import LearnPage from '@/app/(student)/learn/page';

const PROMPT = 'Grade 8 · Choose a subject to study';
const FAILURE_TITLE = "Couldn't load your subjects";
const EMPTY_TITLE = 'No subjects set up yet';

/** Every way this page can say "your plan is the reason". */
const UPGRADE_COPY = [/Upgrade to unlock/i, /Unlock \d+ more subject/i, /Upgrade to/i];

beforeEach(() => {
  authState.isHi = false;
  subjectsState.subjects = [];
  subjectsState.unlocked = [];
  subjectsState.locked = [];
  subjectsState.isLoading = false;
  subjectsState.degraded = false;
  refreshSpy.mockClear();
  pushSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('/learn subject grid — a degraded read is never a plan lock', () => {
  it('renders the grid and the prompt when the list loads (control)', () => {
    subjectsState.subjects = [MATH, SCIENCE_LOCKED];
    subjectsState.unlocked = [MATH];
    subjectsState.locked = [SCIENCE_LOCKED];
    render(React.createElement(LearnPage));

    expect(screen.getByText(PROMPT)).toBeDefined();
    expect(screen.getByText('Mathematics')).toBeDefined();
    // A PROVABLE lock still merchandises — this path is untouched.
    expect(screen.getByText(/Unlock 1 more subject/)).toBeDefined();
    expect(screen.queryByText(FAILURE_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('renders placeholders and asserts nothing while the list is in flight', () => {
    subjectsState.isLoading = true;
    render(React.createElement(LearnPage));

    expect(document.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.queryByText(FAILURE_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    for (const pattern of UPGRADE_COPY) expect(screen.queryByText(pattern)).toBeNull();
  });

  it('renders the honest failure — and NO upgrade CTA — on a degraded non-empty list', () => {
    // Exactly the fail-closed fallback shape: rows present, all locked.
    subjectsState.subjects = [MATH, SCIENCE_LOCKED].map(s => ({ ...s, isLocked: true }));
    subjectsState.unlocked = [];
    subjectsState.locked = subjectsState.subjects;
    subjectsState.degraded = true;
    render(React.createElement(LearnPage));

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(FAILURE_TITLE)).toBeDefined();
    expect(
      screen.getByText("This doesn't mean you've lost access to anything — please try again."),
    ).toBeDefined();

    // THE defect: an Unlimited subscriber must not be told to upgrade because
    // an RPC failed. Neither the per-card CTA nor the strip may render.
    for (const pattern of UPGRADE_COPY) expect(screen.queryByText(pattern)).toBeNull();
    expect(screen.queryByText(PROMPT)).toBeNull();
    // Nor may it be reported as an empty catalogue.
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('renders the honest failure on a degraded EMPTY list too', () => {
    subjectsState.degraded = true; // subjects: []
    render(React.createElement(LearnPage));

    expect(screen.getByText(FAILURE_TITLE)).toBeDefined();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('gives the failure state a real, accessible, 44px-declared retry that refetches', () => {
    subjectsState.degraded = true;
    render(React.createElement(LearnPage));

    const retry = screen.getByRole('button', { name: /Try again/ });
    // JSDOM loads no stylesheet; the browser-layer measurement lives in
    // e2e/ui-error-states.spec.ts. Here we pin the declared contract.
    expect(retry.className).toContain('touchable');

    fireEvent.click(retry);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the genuine empty (no retry, no upgrade) when the list loaded with nothing', () => {
    subjectsState.subjects = [];
    subjectsState.degraded = false;
    render(React.createElement(LearnPage));

    expect(screen.getByText(EMPTY_TITLE)).toBeDefined();
    expect(screen.queryByText(FAILURE_TITLE)).toBeNull();
    expect(screen.queryByText(PROMPT)).toBeNull();
    for (const pattern of UPGRADE_COPY) expect(screen.queryByText(pattern)).toBeNull();
  });

  it('renders the Hindi failure copy when isHi is true (P7)', () => {
    subjectsState.degraded = true;
    authState.isHi = true;
    render(React.createElement(LearnPage));

    expect(screen.getByText('तुम्हारे विषय लोड नहीं हो सके')).toBeDefined();
    expect(
      screen.getByText('इसका मतलब यह नहीं कि तुम्हारी पहुँच चली गई — दोबारा कोशिश करो।'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /फिर से कोशिश करो/ })).toBeDefined();
    expect(screen.queryByText(FAILURE_TITLE)).toBeNull();
  });
});
