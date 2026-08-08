/**
 * /learn (subject → chapter browser) — a failed chapter read renders an HONEST,
 * retryable error state and is DISTINCT from "this subject genuinely has no
 * chapters yet" (render unit).
 *
 * THE DEFECT THIS PINS
 *   The page loaded its chapter list with
 *   `getChaptersForSubject(...).then(setChapters).catch(() => setChapters([]))`.
 *   The helper never rejected — it resolved to `[]` on a 401, a 5xx AND a
 *   network error — so the `.catch()` was unreachable and every one of those
 *   failures rendered the empty state:
 *
 *       "No chapters available yet" / "Ask Foxy to teach you this subject"
 *
 *   i.e. the student was told their entire syllabus was missing because an auth
 *   token had gone stale. getChaptersForSubject now returns a `ServiceResult`;
 *   only HTTP 422 ("this subject isn't in your set") is a genuine empty.
 *
 *   Both directions are asserted: on failure the error card renders and the
 *   empty copy does NOT; on a successful-but-empty read the empty copy renders
 *   and the error card does NOT. A test that only checked the failure direction
 *   would pass even if the fix had simply deleted the empty state.
 *
 * Sibling of learn-chapter-load-error.test.tsx, which covers the DIFFERENT page
 * /learn/[subject]/[chapter].
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const { authState, chaptersRead, warnSpy } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', grade: '8', subscription_plan: 'pro' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
  chaptersRead: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/learn',
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

vi.mock('@alfanumrik/lib/useSubjectReadiness', () => ({
  useSubjectReadiness: () => ({ readiness: null, isLoading: false, error: null }),
}));

// Alfa-OS hub replaces the chapter list entirely when ON — keep it OFF so the
// legacy chapter list (the surface under test) renders.
vi.mock('@alfanumrik/lib/use-subjects-os-flag', () => ({
  useSubjectsOsFlag: () => false,
  getSubjectsOsFlagSync: () => false,
}));

// next/dynamic'd children are irrelevant to error/empty gating.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

/* The chapter read is the seam under test; `supabase` serves the page's other
 * (unrelated) reads from a thenable builder that resolves to nothing. */
vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'in', 'single', 'maybeSingle'];
  return {
    getChaptersForSubject: chaptersRead,
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

/** Mount and select the Mathematics subject, which triggers the chapter read.
 *  The subject tile renders `s.name` in both languages (the page does not
 *  translate subject names), so the selector is language-independent. */
async function renderAndSelectSubject(hindi = false) {
  authState.isHi = hindi;
  render(React.createElement(LearnPage));
  const tile = await screen.findByText('Mathematics');
  fireEvent.click(tile);
}

beforeEach(() => {
  authState.isHi = false;
  chaptersRead.mockReset();
  warnSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('/learn — a failed chapter read is never "no chapters available"', () => {
  it('renders the error card and NOT the empty state when the read fails', async () => {
    chaptersRead.mockResolvedValue({ ok: false, error: 'HTTP 503', code: 'EXTERNAL_FAILURE' });
    await renderAndSelectSubject();

    await waitFor(() => expect(screen.getByText("Couldn't load chapters")).toBeDefined());
    // The claim that the student's syllabus is empty must be absent.
    expect(screen.queryByText('No chapters available yet')).toBeNull();
    // Retryable, not a dead end.
    expect(screen.getByRole('button', { name: /Try again/ })).toBeDefined();
    // Logged, not swallowed (P13: the assertion is only that we logged).
    expect(warnSpy).toHaveBeenCalled();
  });

  it('renders the empty state and NO error card when the read succeeds with zero chapters', async () => {
    chaptersRead.mockResolvedValue({ ok: true, data: [] });
    await renderAndSelectSubject();

    await waitFor(() => expect(screen.getByText('No chapters available yet')).toBeDefined());
    expect(screen.queryByText("Couldn't load chapters")).toBeNull();
  });

  it('renders the chapter list when the read succeeds with chapters (control)', async () => {
    chaptersRead.mockResolvedValue({
      ok: true,
      data: [{ chapter_number: 1, title: 'Number Systems', title_hi: null, verified_question_count: 4 }],
    });
    await renderAndSelectSubject();

    await waitFor(() => expect(screen.getByText('Number Systems')).toBeDefined());
    expect(screen.queryByText("Couldn't load chapters")).toBeNull();
    expect(screen.queryByText('No chapters available yet')).toBeNull();
  });

  it('recovers on retry without re-picking the subject', async () => {
    chaptersRead.mockResolvedValue({ ok: false, error: 'HTTP 401', code: 'UNAUTHORIZED' });
    await renderAndSelectSubject();
    await waitFor(() => expect(screen.getByText("Couldn't load chapters")).toBeDefined());

    chaptersRead.mockResolvedValue({
      ok: true,
      data: [{ chapter_number: 1, title: 'Number Systems', title_hi: null, verified_question_count: 4 }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));

    await waitFor(() => expect(screen.getByText('Number Systems')).toBeDefined());
    expect(screen.queryByText("Couldn't load chapters")).toBeNull();
  });

  it('renders the Hindi failure copy when isHi is true (P7)', async () => {
    chaptersRead.mockResolvedValue({ ok: false, error: 'HTTP 503', code: 'EXTERNAL_FAILURE' });
    await renderAndSelectSubject(true);

    await waitFor(() => expect(screen.getByText('अध्याय लोड नहीं हो सके')).toBeDefined());
    // English copy must not leak into the Hindi surface.
    expect(screen.queryByText("Couldn't load chapters")).toBeNull();
    expect(screen.queryByText('अभी कोई अध्याय नहीं मिला')).toBeNull();
  });
});
