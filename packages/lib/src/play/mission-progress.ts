/**
 * ALFANUMRIK — Play framework mission-progress derivation (Phase 5 S1.6 / U7).
 *
 * Pure derivation: consume existing-table row snapshots and report per-step
 * done/pending. NO schema change. NO new XP path. Reading a mission's
 * progress must NEVER award XP or write anywhere — this file has no I/O.
 */

import type {
  ConceptStep,
  ExperimentStep,
  MissionConfig,
  MissionStep,
  MysteryStep,
  TeachBackStep,
} from './mission-configs';

// ─── Input shapes (existing table row snapshots) ─────────────

/**
 * Subset of a dive_artifacts row we need. Real table also has
 * student_id / picker_option / student_voice etc — irrelevant here.
 */
export interface DiveArtifactSnapshot {
  phenomenonSlug: string | null;
  isoWeek: string;
}

/**
 * Subset of a challenge attempt sufficient to count concept-chain
 * completion (chapter + subject + successful order).
 */
export interface ChallengeAttemptSnapshot {
  subject: string;
  chapterNumber: number;
  /** True iff the attempt completed the chain in the correct order. */
  chainCompleted: boolean;
}

/**
 * Subset of a quiz_sessions row. `subject` and `chapter_number` are the
 * only columns the play-framework derivation cares about; `is_completed`
 * gates whether the row counts.
 */
export interface QuizSessionSnapshot {
  subject: string;
  chapterNumber: number;
  isCompleted: boolean;
}

/**
 * Subset of a Foxy session sufficient for the teach_back derivation.
 * `mode` is the Foxy mode string ('explorer', 'learn', etc.), `presetKey`
 * is the optional preset handshake (see mission-configs).
 */
export interface FoxySessionSnapshot {
  mode: string;
  presetKey: string | null;
  studentTurnCount: number;
}

export interface MissionProgressInputs {
  diveArtifacts: DiveArtifactSnapshot[];
  challengeAttempts: ChallengeAttemptSnapshot[];
  quizSessions: QuizSessionSnapshot[];
  foxySessions: FoxySessionSnapshot[];
}

// ─── Output shape ────────────────────────────────────────────

export interface MissionStepProgress {
  stepIndex: number;
  kind: MissionStep['kind'];
  done: boolean;
}

export interface MissionProgress {
  missionId: string;
  steps: MissionStepProgress[];
  allDone: boolean;
}

// ─── Per-step evaluators ─────────────────────────────────────

function conceptDone(step: ConceptStep, inputs: MissionProgressInputs): boolean {
  const chainMatches = inputs.challengeAttempts.filter(
    (a) => a.subject === step.subject && a.chapterNumber === step.chapterNumber && a.chainCompleted,
  ).length;
  const quizMatches = inputs.quizSessions.filter(
    (q) => q.subject === step.subject && q.chapterNumber === step.chapterNumber && q.isCompleted,
  ).length;
  return chainMatches + quizMatches >= step.requiredCount;
}

function mysteryDone(step: MysteryStep, inputs: MissionProgressInputs): boolean {
  if (!step.requireDiveArtifact) return true;
  return inputs.diveArtifacts.some((a) => a.phenomenonSlug === step.phenomenonSlug);
}

function experimentDone(step: ExperimentStep, inputs: MissionProgressInputs): boolean {
  // We cannot observe simulation opens from existing tables — the
  // signal we DO have is the follow-up quiz completing. That is the
  // honest completion oracle for this step (matches the "read from
  // existing table data — no schema change" rule).
  const completed = inputs.quizSessions.filter(
    (q) =>
      q.subject === step.followupQuizSubject &&
      q.chapterNumber === step.followupQuizChapter &&
      q.isCompleted,
  ).length;
  return completed >= step.followupQuizCount;
}

function teachBackDone(step: TeachBackStep, inputs: MissionProgressInputs): boolean {
  return inputs.foxySessions.some(
    (s) =>
      s.mode === step.foxyMode &&
      s.presetKey === step.foxyPresetKey &&
      s.studentTurnCount >= step.minStudentTurns,
  );
}

function stepDone(step: MissionStep, inputs: MissionProgressInputs): boolean {
  switch (step.kind) {
    case 'concept':
      return conceptDone(step, inputs);
    case 'mystery':
      return mysteryDone(step, inputs);
    case 'experiment':
      return experimentDone(step, inputs);
    case 'teach_back':
      return teachBackDone(step, inputs);
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = step;
      void _exhaustive;
      return false;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Derive per-step done/pending for a mission from existing-table
 * snapshots. Pure — no I/O, no XP, no writes.
 */
export function deriveMissionProgress(
  config: MissionConfig,
  inputs: MissionProgressInputs,
): MissionProgress {
  const steps: MissionStepProgress[] = config.steps.map((step, stepIndex) => ({
    stepIndex,
    kind: step.kind,
    done: stepDone(step, inputs),
  }));
  return {
    missionId: config.id,
    steps,
    allDone: steps.length > 0 && steps.every((s) => s.done),
  };
}
