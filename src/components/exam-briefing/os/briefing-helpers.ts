/**
 * briefing-helpers — DISPLAY-ONLY presentation helpers for the Alfa OS pre-test
 * briefing hub (ff_test_os_v1, Tier 1 / presentation-only).
 *
 * IMPORTANT — predicted-score provenance:
 * `getPredictedScoreEstimate` is a verbatim COPY of `getPredictedScore` from
 * src/app/exams/page.tsx (~lines 244-253). It is duplicated here (not imported)
 * so the briefing hub is self-contained and the legacy /exams page is never
 * touched. This is a DISPLAY-ONLY estimate over the per-chapter mastery ×
 * weightage already stored on exam_chapters — it does NOT change scoring, XP,
 * anti-cheat, or exam timing (P1/P2/P3 untouched), and it is always surfaced as
 * an "estimate", never a guaranteed/actual score.
 *
 * Keep in sync with src/app/exams/page.tsx if that formula ever changes
 * (assessment owns the source-of-truth formula).
 */

import type { ExamChapterRow } from './useUpcomingExams';

/**
 * Weighted-mastery predicted score. VERBATIM COPY of
 * src/app/exams/page.tsx getPredictedScore(chapters, totalMarks).
 * Returns a marks estimate out of `totalMarks`. Display-only.
 */
export function getPredictedScoreEstimate(
  chapters: ExamChapterRow[],
  totalMarks: number
): number {
  if (!chapters || chapters.length === 0) return 0;
  const totalWeight = chapters.reduce((a, c) => a + c.weightage_marks, 0);
  if (totalWeight === 0) {
    const avgMastery =
      chapters.reduce((a, c) => a + c.mastery_percent, 0) / chapters.length;
    return Math.round((avgMastery / 100) * totalMarks);
  }
  const weighted = chapters.reduce(
    (a, c) => a + (c.mastery_percent / 100) * c.weightage_marks,
    0
  );
  return Math.round(weighted);
}

/**
 * Confidence band for the predicted estimate. Purely a presentation cue derived
 * from how much evidence the prediction rests on (chapter count + whether any
 * weightage is set). NOT a statistical confidence interval — it just tells the
 * student how much to trust the estimate so we never imply a guarantee.
 */
export type PredictionConfidence = 'low' | 'moderate' | 'good';

export function getPredictionConfidence(
  chapters: ExamChapterRow[]
): PredictionConfidence {
  if (!chapters || chapters.length === 0) return 'low';
  const hasWeightage = chapters.some((c) => c.weightage_marks > 0);
  const hasMasteryEvidence = chapters.some((c) => c.mastery_percent > 0);
  if (chapters.length >= 3 && hasWeightage && hasMasteryEvidence) return 'good';
  if (chapters.length >= 2 && hasMasteryEvidence) return 'moderate';
  return 'low';
}

/** Average chapter mastery (0-100), display-only progress framing. */
export function getChaptersProgress(chapters: ExamChapterRow[]): number {
  if (!chapters || chapters.length === 0) return 0;
  const total = chapters.reduce((a, c) => a + c.mastery_percent, 0);
  return Math.round(total / chapters.length);
}

/** Whole days from now until the exam date (ceil; clamps negative to 0). */
export function getDaysRemaining(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** Exam-type display metadata. Mirrors EXAM_TYPES in src/app/exams/page.tsx. */
export const EXAM_TYPE_META: Record<
  string,
  { label: string; labelHi: string; icon: string; color: string }
> = {
  unit_test:   { label: 'Unit Test',   labelHi: 'इकाई परीक्षा',  icon: '📝', color: '#E8581C' },
  half_yearly: { label: 'Half-Yearly', labelHi: 'अर्धवार्षिक',   icon: '📋', color: '#7C3AED' },
  annual:      { label: 'Annual',      labelHi: 'वार्षिक',       icon: '🎓', color: '#0891B2' },
};

export function examTypeMeta(type: string) {
  return EXAM_TYPE_META[type] ?? { label: type, labelHi: type, icon: '📝', color: '#E8581C' };
}
