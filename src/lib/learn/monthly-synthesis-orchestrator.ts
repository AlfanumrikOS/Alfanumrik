/**
 * Alfanumrik — Pedagogy v2 / Wave 3
 * Monthly Synthesis Orchestrator.
 *
 * Pure-function bundle composer. Same architectural pattern as Wave 1A's
 * `daily-rhythm-orchestrator` and Wave 2's `weekly-dive-orchestrator`:
 * the orchestrator owns the data shape; the consumer (Edge Function in
 * Task 4) handles the IO of fetching artifacts, calling the HPC RPC,
 * and inserting the row.
 *
 * ZERO IO, ZERO React, ZERO PII handling at this layer (the synthesis
 * row may eventually carry student name + grade, but that's set by the
 * caller, not derived here).
 *
 * Pre-flight audit (encoded; verify against canonical before each rebuild):
 *   C1 guardians.monthly_synthesis_optin column (Task 1 migration)
 *   C2 whatsapp-notify Edge Function (Task 6 caller)
 *   C3 daily-cron action registry (Task 7 trigger)
 *   C4 chapter-mock generation entry point (Task 4 caller)
 *   C5 HPC delta generator (Task 4 caller)
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md §5.3
 * Plan: docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-3-monthly-synthesis.md
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MonthBoundaries {
  /** First day of the month, UTC, midnight. */
  startIso: string;
  /** First day of the NEXT month, UTC, midnight. Exclusive upper bound. */
  endIso: string;
  /** 'YYYY-MM' label. */
  monthLabel: string;
}

export interface MasteryDelta {
  /** Distinct chapters the student touched in the month (display titles). */
  chaptersTouched: string[];
  /** Topics that crossed the mastery threshold this month. */
  topicsMastered: number;
  /** Topics whose mastery probability improved. */
  topicsImproved: number;
  /** Topics whose mastery probability regressed. */
  topicsRegressed: number;
}

export interface ChapterMockSummary {
  chapters: string[];
  totalQuestions: number;
  /** 0..1 sigmoid-mapped target difficulty for the mock. */
  targetDifficulty: number;
}

export interface SynthesisBundle {
  monthLabel: string;
  weeklyArtifactIds: string[];
  masteryDelta: MasteryDelta;
  chapterMockSummary: ChapterMockSummary | null;
}

export interface ComposeSynthesisBundleInput {
  monthBoundaries: MonthBoundaries;
  weeklyArtifactIds: string[];
  masteryDelta: MasteryDelta;
  chapterMockSummary: ChapterMockSummary | null;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute UTC month boundaries for a given date.
 * Returns the first instant of the date's UTC month and the first instant
 * of the next UTC month (exclusive). Pure.
 */
export function monthBoundariesOf(date: Date): MonthBoundaries {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const monthLabel = `${year}-${String(month + 1).padStart(2, '0')}`;
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    monthLabel,
  };
}

/**
 * Compose a SynthesisBundle from the structured inputs the Edge Function
 * (Task 4) has already gathered. This function is intentionally trivial —
 * its job is to enforce the data shape and provide a single anchor point
 * for the bundle contract; future bundle additions (e.g., retention check
 * scores) extend this signature.
 *
 * Defensively copies arrays so the consumer can mutate inputs after the
 * call without affecting the bundle.
 */
export function composeSynthesisBundle(input: ComposeSynthesisBundleInput): SynthesisBundle {
  return {
    monthLabel: input.monthBoundaries.monthLabel,
    weeklyArtifactIds: [...input.weeklyArtifactIds],
    masteryDelta: {
      chaptersTouched: [...input.masteryDelta.chaptersTouched],
      topicsMastered: input.masteryDelta.topicsMastered,
      topicsImproved: input.masteryDelta.topicsImproved,
      topicsRegressed: input.masteryDelta.topicsRegressed,
    },
    chapterMockSummary: input.chapterMockSummary
      ? {
          chapters: [...input.chapterMockSummary.chapters],
          totalQuestions: input.chapterMockSummary.totalQuestions,
          targetDifficulty: input.chapterMockSummary.targetDifficulty,
        }
      : null,
  };
}
