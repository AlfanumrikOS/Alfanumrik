/**
 * QuizSetup — the subject chooser has four states, and a FAILED subject read
 * is never rendered as an upgrade prompt (render unit).
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 * The chooser was a bare `allowedSubjects.map()` with no other branch:
 *
 *     {allowedSubjects.map(s => <button .../>)}
 *
 * `allowedSubjects` is `useAllowedSubjects().unlocked`. `GET /api/student/
 * subjects` fails CLOSED — when `get_available_subjects` errors or returns
 * nothing it rebuilds the list from grade_subject_map ⋈ subjects(is_active)
 * and stamps EVERY row `isLocked: true` because it cannot evaluate the plan
 * join. So on ANY fallback hit `unlocked` is `[]` and the grid rendered zero
 * tiles under the heading "1. Choose your subject" — a chooser with nothing
 * to choose and not one word of explanation. That is not an edge case: it is
 * every single fallback hit, which the just-landed subject restriction makes
 * strictly more likely.
 *
 * ── WHAT IS ASSERTED ─────────────────────────────────────────────────────
 * All four directions, because a one-directional test would pass against a
 * page that simply never shows the empty state (a different, also-wrong
 * product):
 *   loading  → placeholders, no claim either way
 *   failure  → honest, retryable error AND NOT the upgrade CTA
 *   locked   → the upgrade CTA, and only when the lock is provable
 *   empty    → the genuine empty, and no error
 *   loaded   → the tiles, and neither of the above (control)
 *
 * The failure/upgrade separation is the load-bearing one: `degraded` comes
 * from the producer, never from `unlocked.length === 0` (a free-tier student
 * legitimately has few unlocked subjects, and telling them their subjects
 * failed to load would be its own lie).
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

const { subjectsState, refreshSpy } = vi.hoisted(() => ({
  subjectsState: {
    subjects: [] as SubjectStub[],
    unlocked: [] as SubjectStub[],
    locked: [] as SubjectStub[],
    isLoading: false,
    degraded: false,
  },
  refreshSpy: vi.fn(),
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ ...subjectsState, error: null, refresh: refreshSpy }),
}));

// The chapter read is a different seam (already pinned elsewhere); keep it
// inert so nothing below the subject grid interferes.
vi.mock('@alfanumrik/lib/supabase', () => ({
  getChaptersForSubject: vi.fn(async () => ({ ok: true, data: [] })),
}));

import QuizSetup from '@alfanumrik/ui/quiz/QuizSetup';

function renderSetup(isHi = false) {
  return render(
    React.createElement(QuizSetup, {
      isHi,
      initialSubject: null,
      initialMode: 'practice' as const,
      loading: false,
      studentGrade: '8',
      onStart: vi.fn(),
      onGoBack: vi.fn(),
    }),
  );
}

/** Copy that must be ABSENT from the failure state — the whole point. */
const UPGRADE_COPY = [/upgrade/i, /see plans/i, /अपग्रेड/, /प्लान देखो/];

beforeEach(() => {
  subjectsState.subjects = [];
  subjectsState.unlocked = [];
  subjectsState.locked = [];
  subjectsState.isLoading = false;
  subjectsState.degraded = false;
  refreshSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuizSetup subject chooser — four states', () => {
  it('renders the tiles when the list loads (control)', () => {
    subjectsState.subjects = [MATH];
    subjectsState.unlocked = [MATH];
    renderSetup();

    expect(screen.getByText('Mathematics')).toBeDefined();
    expect(screen.queryByText("Couldn't load your subjects")).toBeNull();
    expect(screen.queryByText('No subjects set up yet')).toBeNull();
    expect(screen.queryByText('No subjects unlocked on your plan')).toBeNull();
  });

  it('renders placeholders (and no claim) while the list is in flight', () => {
    subjectsState.isLoading = true;
    renderSetup();

    const pending = document.querySelector('[role="status"][aria-busy="true"]');
    expect(pending).not.toBeNull();
    // Nothing may be asserted about this student's access yet.
    expect(screen.queryByText("Couldn't load your subjects")).toBeNull();
    expect(screen.queryByText('No subjects set up yet')).toBeNull();
    expect(screen.queryByText('No subjects unlocked on your plan')).toBeNull();
  });

  it('renders the honest failure — NOT the upgrade CTA — when the list is degraded', () => {
    // The shape the fail-closed fallback actually produces: rows exist, every
    // one of them is locked, so `unlocked` is empty.
    subjectsState.subjects = [SCIENCE_LOCKED];
    subjectsState.locked = [SCIENCE_LOCKED];
    subjectsState.degraded = true;
    renderSetup();

    expect(screen.getByText("Couldn't load your subjects")).toBeDefined();
    expect(
      screen.getByText("This doesn't mean you've lost access to anything — please try again."),
    ).toBeDefined();
    // A failure is announced assertively, not as a status.
    expect(screen.getByRole('alert')).toBeDefined();

    // THE defect: a student we cannot prove anything about is never sold an
    // upgrade, and is never told their plan is the reason.
    for (const pattern of UPGRADE_COPY) {
      expect(screen.queryByText(pattern)).toBeNull();
    }
    expect(screen.queryByText('No subjects unlocked on your plan')).toBeNull();
    // ...nor told the catalogue is empty.
    expect(screen.queryByText('No subjects set up yet')).toBeNull();
  });

  it('gives the failure state a real, accessible, 44px-declared retry that refetches', () => {
    subjectsState.degraded = true;
    renderSetup();

    const retry = screen.getByRole('button', { name: /Try again/ });
    // JSDOM loads no stylesheet, so this layer asserts the DECLARED tap-target
    // contract; e2e/ui-error-states.spec.ts measures the box in a browser.
    expect(retry.className).toContain('touchable');

    fireEvent.click(retry);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the upgrade CTA only when every subject is a PROVABLE plan lock', () => {
    subjectsState.subjects = [SCIENCE_LOCKED];
    subjectsState.locked = [SCIENCE_LOCKED];
    subjectsState.degraded = false; // the gating source answered
    renderSetup();

    expect(screen.getByText('No subjects unlocked on your plan')).toBeDefined();
    expect(screen.getByRole('link', { name: /See plans/ }).getAttribute('href')).toBe('/pricing');
    // And it is a status, not an alert — nothing failed.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText("Couldn't load your subjects")).toBeNull();
  });

  it('renders the genuine empty when the list loaded with nothing in it', () => {
    subjectsState.subjects = [];
    subjectsState.degraded = false;
    renderSetup();

    expect(screen.getByText('No subjects set up yet')).toBeDefined();
    expect(screen.queryByText("Couldn't load your subjects")).toBeNull();
    expect(screen.queryByText('No subjects unlocked on your plan')).toBeNull();
  });

  it('renders the Hindi failure copy when isHi is true (P7)', () => {
    subjectsState.degraded = true;
    renderSetup(true);

    expect(screen.getByText('तुम्हारे विषय लोड नहीं हो सके')).toBeDefined();
    expect(
      screen.getByText('इसका मतलब यह नहीं कि तुम्हारी पहुँच चली गई — दोबारा कोशिश करो।'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /फिर से कोशिश करो/ })).toBeDefined();
    // English must not leak into the Hindi surface.
    expect(screen.queryByText("Couldn't load your subjects")).toBeNull();
  });

  it('renders the Hindi plan-lock and empty copy when isHi is true (P7)', () => {
    subjectsState.subjects = [SCIENCE_LOCKED];
    subjectsState.locked = [SCIENCE_LOCKED];
    renderSetup(true);
    expect(screen.getByText('तुम्हारे प्लान में कोई विषय अनलॉक नहीं है')).toBeDefined();

    cleanup();
    subjectsState.subjects = [];
    subjectsState.locked = [];
    renderSetup(true);
    expect(screen.getByText('अभी कोई विषय सेट नहीं है')).toBeDefined();
  });
});
