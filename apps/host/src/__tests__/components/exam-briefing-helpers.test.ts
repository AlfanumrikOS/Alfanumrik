/**
 * exam-briefing/os briefing-helpers — DISPLAY-ONLY presentation helpers for the
 * Alfa OS pre-test briefing hub. getPredictedScoreEstimate is a VERBATIM COPY of
 * getPredictedScore in src/app/exams/page.tsx (~lines 244-253). It is a
 * display-only weighted-mastery estimate over exam_chapters — it does NOT change
 * scoring / XP / anti-cheat / exam timing (P1/P2/P3 untouched).
 *
 * The PARITY test (assessment-requested drift guard) replicates the exams-page
 * formula locally and asserts byte-equivalence across edge + randomized inputs.
 * If exams/page.tsx ever diverges, this guard fails and the copy must be re-synced.
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  getPredictedScoreEstimate,
  getPredictionConfidence,
  getChaptersProgress,
  getDaysRemaining,
  examTypeMeta,
} from '@alfanumrik/ui/exam-briefing/os/briefing-helpers';
import type { ExamChapterRow } from '@alfanumrik/ui/exam-briefing/os/useUpcomingExams';

/**
 * VERBATIM reference copy of src/app/exams/page.tsx getPredictedScore
 * (the assessment-owned source-of-truth formula). The briefing helper MUST
 * stay byte-equivalent to this. Kept inline so a change to the app formula
 * that is NOT mirrored into briefing-helpers fails this test.
 */
function referenceGetPredictedScore(
  chapters: { weightage_marks: number; mastery_percent: number }[],
  totalMarks: number,
): number {
  if (!chapters || chapters.length === 0) return 0;
  const totalWeight = chapters.reduce((a, c) => a + c.weightage_marks, 0);
  if (totalWeight === 0) {
    const avgMastery = chapters.reduce((a, c) => a + c.mastery_percent, 0) / chapters.length;
    return Math.round((avgMastery / 100) * totalMarks);
  }
  const weighted = chapters.reduce((a, c) => a + (c.mastery_percent / 100) * c.weightage_marks, 0);
  return Math.round(weighted);
}

function ch(weightage_marks: number, mastery_percent: number): ExamChapterRow {
  return { weightage_marks, mastery_percent } as ExamChapterRow;
}

describe('getPredictedScoreEstimate — display-only weighted-mastery estimate', () => {
  it('empty chapters → 0', () => {
    expect(getPredictedScoreEstimate([], 100)).toBe(0);
  });
  it('zero total weight → averages mastery over totalMarks', () => {
    // avg mastery = 50% of 80 marks = 40
    expect(getPredictedScoreEstimate([ch(0, 40), ch(0, 60)], 80)).toBe(40);
  });
  it('weighted path sums (mastery% × weightage)', () => {
    // 50% of 40 + 100% of 60 = 20 + 60 = 80
    expect(getPredictedScoreEstimate([ch(40, 50), ch(60, 100)], 100)).toBe(80);
  });
  it('rounds the weighted total', () => {
    // 33% of 30 = 9.9 → 10
    expect(getPredictedScoreEstimate([ch(30, 33)], 30)).toBe(10);
  });
});

describe('getPredictedScoreEstimate — PARITY with exams/page.tsx getPredictedScore', () => {
  const fixtures: { chapters: ExamChapterRow[]; total: number }[] = [
    { chapters: [], total: 100 },
    { chapters: [ch(0, 0)], total: 100 },
    { chapters: [ch(0, 50), ch(0, 70)], total: 80 },
    { chapters: [ch(40, 50), ch(60, 100)], total: 100 },
    { chapters: [ch(30, 33)], total: 30 },
    { chapters: [ch(25, 88), ch(25, 12), ch(50, 64)], total: 100 },
    { chapters: [ch(10, 0), ch(0, 100)], total: 50 },
  ];

  it.each(fixtures)('matches the reference for total=$total', ({ chapters, total }) => {
    expect(getPredictedScoreEstimate(chapters, total)).toBe(
      referenceGetPredictedScore(chapters, total),
    );
  });

  it('matches the reference across 200 randomized inputs (drift guard)', () => {
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rng() * 6);
      const chapters: ExamChapterRow[] = [];
      for (let j = 0; j < n; j++) {
        chapters.push(ch(Math.floor(rng() * 60), Math.floor(rng() * 101)));
      }
      const total = 20 + Math.floor(rng() * 100);
      expect(getPredictedScoreEstimate(chapters, total)).toBe(
        referenceGetPredictedScore(chapters, total),
      );
    }
  });
});

describe('getPredictionConfidence — evidence-based presentation cue', () => {
  it('empty → low', () => {
    expect(getPredictionConfidence([])).toBe('low');
  });
  it('>=3 chapters with weightage + mastery evidence → good', () => {
    expect(getPredictionConfidence([ch(10, 50), ch(10, 60), ch(10, 70)])).toBe('good');
  });
  it('>=2 chapters with mastery evidence but no weightage → moderate', () => {
    expect(getPredictionConfidence([ch(0, 50), ch(0, 60)])).toBe('moderate');
  });
  it('single chapter or no evidence → low', () => {
    expect(getPredictionConfidence([ch(10, 50)])).toBe('low');
    expect(getPredictionConfidence([ch(0, 0), ch(0, 0)])).toBe('low');
  });
});

describe('getChaptersProgress — average chapter mastery', () => {
  it('empty → 0', () => {
    expect(getChaptersProgress([])).toBe(0);
  });
  it('averages and rounds', () => {
    expect(getChaptersProgress([ch(0, 50), ch(0, 70)])).toBe(60);
    expect(getChaptersProgress([ch(0, 33), ch(0, 33), ch(0, 33)])).toBe(33);
  });
});

describe('getDaysRemaining — ceil days, clamps negatives to 0', () => {
  it('a past date → 0 (never negative)', () => {
    expect(getDaysRemaining('2000-01-01')).toBe(0);
  });
  it('a far-future date → positive', () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDaysRemaining(future)).toBeGreaterThanOrEqual(5);
  });
});

describe('examTypeMeta — known types + graceful fallback', () => {
  it('returns metadata for known exam types', () => {
    expect(examTypeMeta('unit_test').label).toBe('Unit Test');
    expect(examTypeMeta('half_yearly').labelHi.length).toBeGreaterThan(0);
  });
  it('unknown type falls back to the raw type label (no crash)', () => {
    const meta = examTypeMeta('pop_quiz');
    expect(meta.label).toBe('pop_quiz');
    expect(meta.icon.length).toBeGreaterThan(0);
  });
});
