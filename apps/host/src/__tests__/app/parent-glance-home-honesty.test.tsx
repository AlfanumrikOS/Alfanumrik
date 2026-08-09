/**
 * ParentGlanceHome — a failed subject-score read is visible, and an unknown
 * STEM streak is never rendered as a confident number.
 *
 * Frontend audit, Phase 3 Wave B (parent portal).
 *
 *   The parent dashboard read `performance_scores` and `student_lab_streaks`
 *   with `const { data } = await supabase.from(...)`, discarding `error`. The
 *   PostgREST builder RESOLVES with { data, error } rather than rejecting, so:
 *
 *     - the surrounding try/catch was dead code, and
 *     - a failed performance_scores read produced `perfScores: []`, which is
 *       identical to "this child has no scores" — the "Strong / Needs help"
 *       subject chips (the most decision-relevant element on the glance home)
 *       silently disappeared, and
 *     - a failed student_lab_streaks read produced `labStreak: 0` — a number
 *       nobody could stand behind.
 *
 *   `perfScoresError` now distinguishes the two, and an unknown streak is
 *   `null` (omitted) rather than `0` (asserted). Both directions asserted.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@alfanumrik/lib/swr', () => ({ useFeatureFlags: () => ({ data: {} }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ParentGlanceHome from '@alfanumrik/ui/parent/ParentGlanceHome';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const BASE_STATS = {
  xp: 400,
  streak: 4,
  accuracy: 72,
  totalQuizzes: 12,
  minutes: 90,
  totalChats: 3,
  avgScore: 70,
};

const SCORES = [
  { subject: 'Mathematics', overall_score: 82, level_name: 'Proficient' },
  { subject: 'Science', overall_score: 41, level_name: 'Developing' },
];

function renderGlance(overrides: Record<string, unknown> = {}) {
  return render(
    <ParentGlanceHome
      stats={BASE_STATS}
      childName="Aarav"
      grade="8"
      perfScores={SCORES}
      labStreak={null}
      student={{ id: 'child-1', name: 'Aarav', grade: '8' }}
      guardianId="guardian-1"
      canFetchReport={false}
      onRefresh={() => {}}
      onLogout={() => {}}
      isHi={false}
      t={t}
      {...(overrides as never)}
    />,
  );
}

const SCORES_FAIL_EN = "Subject scores couldn't be loaded — tap Refresh to retry.";
const SCORES_FAIL_HI = 'विषय स्कोर लोड नहीं हो सके — फिर से लोड करने के लिए रिफ्रेश दबाएँ।';

afterEach(() => cleanup());

describe('ParentGlanceHome — subject scores: failure is not "no scores"', () => {
  it('a FAILED read shows the notice and suppresses the Strong/Needs-help chips', () => {
    renderGlance({ perfScoresError: true, perfScores: [] });

    expect(screen.getByText(SCORES_FAIL_EN)).toBeTruthy();
    expect(screen.queryByText(/Strong:/)).toBeNull();
    expect(screen.queryByText(/Needs help:/)).toBeNull();
  });

  it('a genuinely EMPTY read shows neither the notice nor the chips', () => {
    renderGlance({ perfScoresError: false, perfScores: [] });

    expect(screen.queryByText(SCORES_FAIL_EN)).toBeNull();
    expect(screen.queryByText(/Strong:/)).toBeNull();
  });

  it('a SUCCESSFUL read shows the chips and no notice', () => {
    renderGlance({ perfScoresError: false });

    expect(screen.getByText('Strong: Mathematics')).toBeTruthy();
    expect(screen.getByText('Needs help: Science')).toBeTruthy();
    expect(screen.queryByText(SCORES_FAIL_EN)).toBeNull();
  });

  it('the failure notice is bilingual (P7)', () => {
    renderGlance({ perfScoresError: true, perfScores: [], isHi: true });

    expect(screen.getByText(SCORES_FAIL_HI)).toBeTruthy();
    expect(screen.queryByText(SCORES_FAIL_EN)).toBeNull();
  });
});

describe('ParentGlanceHome — STEM streak: unknown is not zero', () => {
  it('an UNKNOWN streak (null, i.e. the read failed) renders no STEM streak claim', () => {
    renderGlance({ labStreak: null });

    expect(screen.queryByText(/STEM lab streak/)).toBeNull();
  });

  it('a genuine zero streak also renders no claim (0 is not a milestone)', () => {
    renderGlance({ labStreak: 0 });

    expect(screen.queryByText(/STEM lab streak/)).toBeNull();
  });

  it('a real streak renders the moment', () => {
    renderGlance({ labStreak: 5 });

    expect(screen.getByText('5-day STEM lab streak.')).toBeTruthy();
  });
});
