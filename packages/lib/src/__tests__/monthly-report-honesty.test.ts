/**
 * Monthly-report metrics — "omit, don't invent" contract (Phase 6 / Risk R4).
 *
 * `computeMonthlyReportMetrics` used to return a NUMBER for every field no
 * matter how little evidence stood behind it:
 *
 *   - `predictedScore` came from `predictExamScore(chapters, totalMarks)`, and
 *     the only caller (/reports) synthesised `chapters` out of thin air — one
 *     fake chapter per bloom_progression row, `marksWeightage: 10` for every
 *     one, `totalMarks: 80` for every subject and every grade. A board-mark
 *     forecast computed in the browser from invented inputs.
 *   - `syllabusCompletionPct` rode the same fabricated array: its denominator
 *     was the rows the student had already touched, so it trended to 100%
 *     regardless of how much of the actual syllabus was covered.
 *   - `retentionScore` was `avg(last 5 quiz score_percent)` — nothing to do
 *     with retention, and it was rendered under a "7-Day Retention" dial.
 *   - `conceptMasteryPct` / `timeEfficiency` returned a hard 0 when there was
 *     no mastery row / no logged study time, which reads as "you scored zero",
 *     not "we don't know yet".
 *   - `improvementAreas` / `achievements` were ENGLISH PROSE assembled in the
 *     engine ("Focus on: …", "Increase study consistency") and rendered under
 *     bilingual headings, so a Hindi user got English (P7 violation).
 *
 * The contract asserted here: a metric with no reliable source comes back
 * `null` (or, for the insights, a machine CODE the UI renders bilingually) —
 * never a plausible-looking default.
 *
 * Scoring invariants are untouched: P1's score formula and P2's XP constants
 * live in xp-rules.ts / submitQuizResults() and are not read by this module.
 */

import { describe, it, expect } from 'vitest';
import {
  computeMonthlyReportMetrics,
  RECENT_QUIZ_WINDOW,
  type ExamChapter,
} from '../cognitive-engine';

/** Minimal always-valid params; each test overrides only what it examines. */
function baseParams() {
  return {
    masteries: [] as Array<{ mastery: number; label: string }>,
    quizScores: [] as number[],
    weeklyAccuracies: [null, null, null, null] as Array<number | null>,
    totalMinutes: 0,
    totalQuestions: 0,
    daysActive: 0,
    daysInMonth: 30,
  };
}

describe('computeMonthlyReportMetrics — no invented exam forecast', () => {
  it('returns null predictedScore when no exam blueprint is supplied', () => {
    const r = computeMonthlyReportMetrics(baseParams());
    expect(r.predictedScore).toBeNull();
    expect(r.predictedScoreMaxMarks).toBeNull();
  });

  it('returns null syllabusCompletionPct when no exam blueprint is supplied', () => {
    const r = computeMonthlyReportMetrics({
      ...baseParams(),
      masteries: [
        { mastery: 0.9, label: 'math' },
        { mastery: 0.2, label: 'science' },
      ],
    });
    // Mastery rows are NOT a syllabus. Having two of them says nothing about
    // how much of the course has been covered.
    expect(r.syllabusCompletionPct).toBeNull();
  });

  it('computes predictedScore only from a real blueprint, echoing its max marks', () => {
    const chapters: ExamChapter[] = [
      { chapterNumber: 1, chapterTitle: 'Real Numbers', marksWeightage: 6, difficultyWeight: 1, studentMastery: 1, isCovered: true },
      { chapterNumber: 2, chapterTitle: 'Polynomials', marksWeightage: 4, difficultyWeight: 1, studentMastery: 0, isCovered: false },
    ];
    const r = computeMonthlyReportMetrics({ ...baseParams(), chapters, totalMarks: 100 });
    expect(r.predictedScore).toBeGreaterThan(0);
    expect(r.predictedScoreMaxMarks).toBe(100);
    expect(r.syllabusCompletionPct).toBe(50);
  });
});

describe('computeMonthlyReportMetrics — honest quiz average', () => {
  it('names the metric for what it is and reports how many quizzes it covers', () => {
    const r = computeMonthlyReportMetrics({ ...baseParams(), quizScores: [10, 20, 30, 40, 50, 60] });
    // avg of the last RECENT_QUIZ_WINDOW scores: (20+30+40+50+60)/5 = 40
    expect(RECENT_QUIZ_WINDOW).toBe(5);
    expect(r.recentQuizAveragePct).toBe(40);
    expect(r.recentQuizCount).toBe(5);
    // The misleading name must be gone — it never measured retention.
    expect('retentionScore' in r).toBe(false);
  });

  it('reports fewer than the window when fewer quizzes exist', () => {
    const r = computeMonthlyReportMetrics({ ...baseParams(), quizScores: [80, 90] });
    expect(r.recentQuizAveragePct).toBe(85);
    expect(r.recentQuizCount).toBe(2);
  });

  it('returns null (not 0) when the student took no quizzes', () => {
    const r = computeMonthlyReportMetrics(baseParams());
    expect(r.recentQuizAveragePct).toBeNull();
    expect(r.recentQuizCount).toBe(0);
  });
});

describe('computeMonthlyReportMetrics — absence is null, not zero', () => {
  it('returns null conceptMasteryPct when there are no mastery rows', () => {
    expect(computeMonthlyReportMetrics(baseParams()).conceptMasteryPct).toBeNull();
  });

  it('returns null timeEfficiency when no study time was logged', () => {
    const r = computeMonthlyReportMetrics({ ...baseParams(), totalQuestions: 20, totalMinutes: 0 });
    expect(r.timeEfficiency).toBeNull();
  });

  it('preserves a null week in the accuracy trend instead of zero-filling it', () => {
    const r = computeMonthlyReportMetrics({ ...baseParams(), weeklyAccuracies: [70, null, 40, null] });
    expect(r.accuracyTrend).toEqual([70, null, 40, null]);
  });
});

describe('computeMonthlyReportMetrics — insights are bilingual-renderable codes (P7)', () => {
  it('emits machine codes with their referenced areas, never English prose', () => {
    const r = computeMonthlyReportMetrics({
      ...baseParams(),
      masteries: [
        { mastery: 0.1, label: 'science' },
        { mastery: 0.2, label: 'hindi' },
      ],
      daysActive: 2,
      daysInMonth: 30,
    });

    const codes = r.improvements.map((i) => i.code);
    expect(codes).toContain('focus_weak_areas');
    expect(codes).toContain('increase_consistency');

    const focus = r.improvements.find((i) => i.code === 'focus_weak_areas');
    expect(focus?.areas).toEqual(['science', 'hindi']);

    // No pre-rendered sentence may escape the engine — the UI owns the words.
    const serialised = JSON.stringify(r.improvements) + JSON.stringify(r.achievements);
    expect(serialised).not.toMatch(/Focus on|Increase study|Work on speed/i);
  });

  it('emits achievement codes rather than English sentences', () => {
    const r = computeMonthlyReportMetrics({
      ...baseParams(),
      masteries: [
        { mastery: 0.95, label: 'math' },
        { mastery: 0.9, label: 'science' },
        { mastery: 0.85, label: 'english' },
        { mastery: 0.82, label: 'hindi' },
      ],
      daysActive: 28,
      daysInMonth: 30,
    });
    const codes = r.achievements.map((a) => a.code);
    expect(codes).toContain('high_overall_mastery');
    expect(codes).toContain('consistent_study_habit');
    expect(codes).toContain('multiple_areas_mastered');
    expect(JSON.stringify(r.achievements)).not.toMatch(/High overall|Consistent study|Multiple chapters/i);
  });
});
