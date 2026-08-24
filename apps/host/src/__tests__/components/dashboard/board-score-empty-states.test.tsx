/**
 * BoardScoreWidget — an empty BoardScore must never blame the student.
 *
 * PRODUCTION FACTS this suite encodes (measured read-only 2026-08-24):
 *   - `ff_board_score_v1` is ON at 100%, so students reach the EMPTY branch,
 *     not the flag-off "Coming Soon" branch.
 *   - `board_score_predictions` has 0 rows — the nightly compute has never
 *     produced anything for anyone.
 *   - `cbse_chapter_weights` exists ONLY for grades 10 (57 rows) and 12 (60).
 *     Grades 6, 7, 8, 9 and 11 have none, so BoardScore is structurally
 *     impossible there.
 *   - 37 of 38 active grade-10/12 students have an EMPTY
 *     `students.selected_subjects`, and `getStudentBoardSubjects()` returns []
 *     on empty and "never falls back to a broader set".
 *
 * The widget used to render ONE card — "No Data Yet" / "Practice quizzes and
 * study with Foxy — your predicted score will appear here." — for all three.
 * For a Class 9 student that is false (nothing they do can produce a board
 * score at their grade) and for the 37 it is false in a costlier way: the real
 * fix was one tap away and the copy never said so.
 *
 * Seam: `@alfanumrik/lib/authed-fetch` (the module the widget fetches through),
 * plus the picker's two write/read hooks so the CTA can be driven end to end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

// ── authedFetch seam ──────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/authed-fetch', () => ({
  authedFetch: vi.fn(),
  getAccessToken: vi.fn(async () => 'test-token'),
}));

// ── The picker's dependencies (both already-live modules; mocked so the CTA
//    can be exercised without a network or a Supabase session). ──────────────
const saveSubjectsMock = vi.fn(async () => ({ ok: true as const }));
vi.mock('@alfanumrik/lib/onboarding/use-setup', () => ({
  useSetup: () => ({
    saving: false,
    error: null,
    saveGrade: vi.fn(),
    saveSubjects: saveSubjectsMock,
    inviteGuardian: vi.fn(),
    finish: vi.fn(),
  }),
  getMinorSignal: vi.fn(async () => ({ isMinor: false, parentConsentEmail: null })),
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    subjects: [],
    unlocked: [
      { code: 'math', name: 'Maths', nameHi: 'गणित', icon: '📐', color: '#2563EB', isLocked: false },
      { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '⚗️', color: '#059669', isLocked: false },
    ],
    locked: [],
    isLoading: false,
    error: null,
    degraded: false,
    refresh: vi.fn(),
  }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Eligibility = {
  grade: string;
  grade_has_board_weights: boolean;
  selected_subject_count: number;
  eligible_subject_count: number;
};

async function renderWidget(eligibility: Eligibility | undefined, isHi = false) {
  const { authedFetch } = await import('@alfanumrik/lib/authed-fetch');
  vi.mocked(authedFetch).mockResolvedValue(
    jsonResponse(eligibility ? { code: 'ok', data: [], eligibility } : { code: 'ok', data: [] }),
  );
  const { default: BoardScoreWidget } = await import('@alfanumrik/ui/dashboard/os/BoardScoreWidget');
  return render(
    React.createElement(
      SWRConfig,
      // Fresh cache per render — every test shares studentId 'stu-1'.
      { value: { provider: () => new Map() } },
      React.createElement(BoardScoreWidget, { isHi, studentId: 'stu-1' }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BoardScoreWidget — grade with no CBSE chapter weights (6, 7, 8, 9, 11)', () => {
  it('a grade-9 student is told BoardScore is for Classes 10 and 12 — never "No Data Yet"', async () => {
    await renderWidget({
      grade: '9',
      grade_has_board_weights: false,
      selected_subject_count: 0,
      eligible_subject_count: 0,
    });

    const strip = await screen.findByTestId('board-score-grade-unsupported');
    expect(strip.textContent).toContain('Classes 10 and 12');
    // The lie must be gone from the rendered output entirely.
    expect(screen.queryByText('No Data Yet')).toBeNull();
    expect(screen.queryByTestId('board-score-pending')).toBeNull();
    expect(screen.queryByTestId('board-score-needs-subjects')).toBeNull();
  });

  it('does not tell a grade-9 student to practise more (the gap is not theirs)', async () => {
    await renderWidget({
      grade: '9',
      grade_has_board_weights: false,
      selected_subject_count: 0,
      eligible_subject_count: 0,
    });

    const strip = await screen.findByTestId('board-score-grade-unsupported');
    expect(strip.textContent).not.toMatch(/practice|practise/i);
  });

  it('states the same thing in Hindi under isHi (P7)', async () => {
    await renderWidget(
      { grade: '9', grade_has_board_weights: false, selected_subject_count: 0, eligible_subject_count: 0 },
      true,
    );

    const strip = await screen.findByTestId('board-score-grade-unsupported');
    expect(strip.textContent).toMatch(/[ऀ-ॿ]/);
    expect(strip.textContent).toContain('10');
    expect(strip.textContent).toContain('12');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BoardScoreWidget — board grade with an empty selected_subjects (37 of 38 students)', () => {
  const emptySubjects: Eligibility = {
    grade: '10',
    grade_has_board_weights: true,
    selected_subject_count: 0,
    eligible_subject_count: 0,
  };

  it('renders the actionable subject-selection state, not "No Data Yet"', async () => {
    await renderWidget(emptySubjects);

    const card = await screen.findByTestId('board-score-needs-subjects');
    expect(card.textContent).toContain('Choose your board subjects');
    expect(screen.queryByText('No Data Yet')).toBeNull();
    expect(screen.getByTestId('board-score-choose-subjects')).toBeTruthy();
  });

  it('the CTA is a WORKING one: it opens the picker and writes through set_selected_subjects', async () => {
    await renderWidget(emptySubjects);

    fireEvent.click(await screen.findByTestId('board-score-choose-subjects'));

    // The picker is code-split (next/dynamic) — wait for it to resolve.
    await waitFor(() => expect(screen.getByTestId('board-subject-picker')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Maths/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await waitFor(() => expect(saveSubjectsMock).toHaveBeenCalled());
    expect(saveSubjectsMock).toHaveBeenCalledWith(['math'], 'math');
  });

  it('also fires when the student selected subjects but none are board-eligible at their grade', async () => {
    await renderWidget({
      grade: '10',
      grade_has_board_weights: true,
      selected_subject_count: 2, // e.g. platform electives only
      eligible_subject_count: 0,
    });

    expect(await screen.findByTestId('board-score-needs-subjects')).toBeTruthy();
  });

  it('is bilingual (P7)', async () => {
    await renderWidget(emptySubjects, true);

    const card = await screen.findByTestId('board-score-needs-subjects');
    expect(card.textContent).toMatch(/[ऀ-ॿ]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BoardScoreWidget — eligible but no computed prediction yet', () => {
  it('says the first prediction arrives after the next overnight update', async () => {
    await renderWidget({
      grade: '10',
      grade_has_board_weights: true,
      selected_subject_count: 3,
      eligible_subject_count: 3,
    });

    const card = await screen.findByTestId('board-score-pending');
    expect(card.textContent).toMatch(/overnight/i);
    expect(screen.queryByText('No Data Yet')).toBeNull();
  });

  it('falls back to the pending state when the server sends no eligibility block', async () => {
    // Fail-safe: the only one of the three states that asserts nothing about
    // the student. A missing eligibility block must never re-introduce a
    // student-blaming default.
    await renderWidget(undefined);

    expect(await screen.findByTestId('board-score-pending')).toBeTruthy();
    expect(screen.queryByText('No Data Yet')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BoardScoreWidget — the retired copy cannot come back', () => {
  it('the source contains no "No Data Yet" rendered literal', () => {
    const src = readFileSync(
      path.resolve(REPO_ROOT, 'packages/ui/src/dashboard/os/BoardScoreWidget.tsx'),
      'utf8',
    );
    // The comment block explaining the removal is allowed to name the string
    // in prose; what must not exist is the quoted literal.
    expect(src).not.toContain("'No Data Yet'");
    expect(src).not.toContain('"No Data Yet"');
  });
});
