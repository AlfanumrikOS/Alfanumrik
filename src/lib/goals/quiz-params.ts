/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 2 (Layer 2)
 * Goal-aware Quiz Parameter Resolver
 *
 * Owner: assessment
 * Founder constraint: pure NEW module. ZERO mutation of existing behavior.
 * Effect is wired in by the caller behind the `ff_goal_aware_selection`
 * feature flag — when the flag is OFF, no caller invokes this and existing
 * quiz selection logic is byte-identical to today.
 *
 * Pure function: deterministically derives quiz parameters (count, difficulty,
 * Bloom level, source-priority list, rationale) from a frozen GoalProfile +
 * lightweight per-attempt hints.
 *
 * Decision rules are author-written and exhaustively tested in
 * `src/__tests__/goals/quiz-params.test.ts`. Do NOT change a rule without
 * updating the matching test row in the same PR.
 *
 * Pure data + types. ZERO IO, ZERO React, ZERO side effects, ZERO PII handling.
 *
 * Invariants:
 *  - count ∈ [1, 20] (caller-supplied requestedCount may push below 5; goal
 *    default is clamped to [5, 15])
 *  - difficulty ∈ {1,2,3,4,5} after nudging
 *  - bloomLevel is a valid BloomLevel string
 *  - sourceTags references the frozen profile.sourcePriority — callers MUST
 *    NOT mutate it (returned as ReadonlyArray for compile-time safety; the
 *    underlying array is also frozen via deepFreeze in goal-profile.ts)
 *  - rationale is a single-line, ASCII-safe diagnostic string for trace logs
 *
 * P5: grade-format invariant unaffected — this module never reads a grade.
 * P6: question quality invariant unaffected — this module produces hints
 *     only, the question-bank/RPC remains the authority on what gets served.
 */

import {
  resolveGoalProfile,
  type GoalCode,
  type GoalProfile,
  type SourceTag,
} from './goal-profile';

// ─── Types ────────────────────────────────────────────────────────────────

export interface QuizParamHints {
  /** Caller-supplied count override (e.g. user typed "give me 10 questions").
   *  When provided AND in [1, 20], it overrides the goal default. */
  requestedCount?: number;
  /** Number of correct answers in the student's last quiz of the same subject
   *  (used to nudge difficulty +/- 1). */
  recentCorrect?: number;
  /** Total questions in the student's last quiz of the same subject. */
  recentTotal?: number;
}

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export type BloomLevelLabel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export interface QuizParams {
  /** 5..15 by default (derived from dailyTargetMinutes / ~3 min per question);
   *  caller-supplied requestedCount in [1, 20] overrides. */
  count: number;
  /** 1 = easy, 5 = hard. Mapped from goal.difficultyMix weighted average,
   *  then nudged by recent-accuracy hints. */
  difficulty: DifficultyLevel;
  /** Middle of goal.bloomBand, rounded half away from zero. */
  bloomLevel: BloomLevelLabel;
  /** Hint to the SQL RPC for question source preference. Pass-through of
   *  goal.sourcePriority — readonly so callers can't mutate the frozen
   *  underlying array. */
  sourceTags: ReadonlyArray<SourceTag>;
  /** Diagnostic — explains why these params were picked. Useful in trace logs.
   *  Format:
   *    "goal=<code>, count=<n>(base|requested), difficulty=<n>(<reason>),
   *     bloom=<level>(midband=<x>), sources=<comma-list>"
   */
  rationale: string;
}

// ─── Internal mappings ────────────────────────────────────────────────────

const BLOOM_INDEX_TO_LABEL: Record<number, BloomLevelLabel> = {
  1: 'remember',
  2: 'understand',
  3: 'apply',
  4: 'analyze',
  5: 'evaluate',
  6: 'create',
};

const MINUTES_PER_QUESTION = 3;
const COUNT_FLOOR = 5;
const COUNT_CEIL = 15;
const HINT_COUNT_MIN = 1;
const HINT_COUNT_MAX = 20;
const NUDGE_UP_THRESHOLD = 0.8;
const NUDGE_DOWN_THRESHOLD = 0.4;

// ─── Helpers ──────────────────────────────────────────────────────────────

function clampDifficulty(value: number): DifficultyLevel {
  if (value <= 1) return 1;
  if (value >= 5) return 5;
  return value as DifficultyLevel;
}

function deriveBaseCount(profile: GoalProfile): number {
  const raw = Math.round(profile.dailyTargetMinutes / MINUTES_PER_QUESTION);
  return Math.max(COUNT_FLOOR, Math.min(COUNT_CEIL, raw));
}

function isValidRequestedCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= HINT_COUNT_MIN &&
    value <= HINT_COUNT_MAX
  );
}

function deriveCount(
  profile: GoalProfile,
  hints: QuizParamHints | undefined,
): { count: number; reason: 'requested' | 'base' } {
  if (hints && isValidRequestedCount(hints.requestedCount)) {
    return { count: hints.requestedCount, reason: 'requested' };
  }
  return { count: deriveBaseCount(profile), reason: 'base' };
}

function deriveBaseDifficulty(profile: GoalProfile): {
  level: DifficultyLevel;
  weighted: number;
} {
  const { easy, medium, hard } = profile.difficultyMix;
  const weighted = 1 * easy + 3 * medium + 5 * hard;
  return { level: clampDifficulty(Math.round(weighted)), weighted };
}

function applyAccuracyNudge(
  base: DifficultyLevel,
  hints: QuizParamHints | undefined,
): { level: DifficultyLevel; nudge: 'up' | 'down' | 'none' } {
  if (
    !hints ||
    typeof hints.recentCorrect !== 'number' ||
    typeof hints.recentTotal !== 'number' ||
    hints.recentTotal <= 0
  ) {
    return { level: base, nudge: 'none' };
  }
  const accuracy = hints.recentCorrect / hints.recentTotal;
  if (accuracy >= NUDGE_UP_THRESHOLD) {
    return { level: clampDifficulty(base + 1), nudge: 'up' };
  }
  if (accuracy < NUDGE_DOWN_THRESHOLD) {
    return { level: clampDifficulty(base - 1), nudge: 'down' };
  }
  return { level: base, nudge: 'none' };
}

function deriveBloom(profile: GoalProfile): {
  label: BloomLevelLabel;
  midband: number;
} {
  const { min, max } = profile.bloomBand;
  // Math.round in JS rounds half toward +Infinity, which equals
  // "round half away from zero" for positive integers/halves.
  const mid = Math.round((min + max) / 2);
  // Clamp safety: bloomBand is enforced to {1..6} by goal-profile types.
  const clamped = Math.max(1, Math.min(6, mid));
  return { label: BLOOM_INDEX_TO_LABEL[clamped], midband: clamped };
}

function buildRationale(parts: {
  goal: GoalCode;
  count: number;
  countReason: 'requested' | 'base';
  difficulty: DifficultyLevel;
  difficultyReason: string;
  bloomLabel: BloomLevelLabel;
  bloomMid: number;
  sources: ReadonlyArray<SourceTag>;
}): string {
  return (
    `goal=${parts.goal}, ` +
    `count=${parts.count}(${parts.countReason}), ` +
    `difficulty=${parts.difficulty}(${parts.difficultyReason}), ` +
    `bloom=${parts.bloomLabel}(midband=${parts.bloomMid}), ` +
    `sources=${parts.sources.join(',')}`
  );
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Pick quiz parameters from a resolved GoalProfile.
 *
 * Pure, deterministic, ZERO IO. Caller is responsible for:
 *  - Feature-flag gating (`ff_goal_aware_selection`)
 *  - Resolving the GoalProfile via `resolveGoalProfile(code)`
 *  - Translating `bloomLevel` / `difficulty` / `sourceTags` into the SQL
 *    RPC params (see `pickQuizParamsByCode` for a CODE-only convenience)
 */
export function pickQuizParams(
  profile: GoalProfile,
  hints?: QuizParamHints,
): QuizParams {
  const { count, reason: countReason } = deriveCount(profile, hints);
  const { level: baseDifficulty, weighted } = deriveBaseDifficulty(profile);
  const { level: difficulty, nudge } = applyAccuracyNudge(baseDifficulty, hints);
  const { label: bloomLevel, midband } = deriveBloom(profile);

  const difficultyReason =
    nudge === 'up'
      ? `nudged+1 from ${baseDifficulty} (recent>=${NUDGE_UP_THRESHOLD})`
      : nudge === 'down'
        ? `nudged-1 from ${baseDifficulty} (recent<${NUDGE_DOWN_THRESHOLD})`
        : `midmix=${weighted.toFixed(1)}`;

  const rationale = buildRationale({
    goal: profile.code,
    count,
    countReason,
    difficulty,
    difficultyReason,
    bloomLabel: bloomLevel,
    bloomMid: midband,
    sources: profile.sourcePriority,
  });

  return {
    count,
    difficulty,
    bloomLevel,
    sourceTags: profile.sourcePriority,
    rationale,
  };
}

/**
 * Convenience wrapper for callers that only have a GoalCode string.
 * Resolves via `resolveGoalProfile`. Throws if the code is unknown — callers
 * that may receive arbitrary input MUST guard with `isKnownGoalCode` first
 * or handle the throw, since unknown goals indicate a programmer bug
 * (an unresolved students.academic_goal value should have been caught by
 * the flag-gating layer before reaching here).
 */
export function pickQuizParamsByCode(
  goal: GoalCode,
  hints?: QuizParamHints,
): QuizParams {
  const profile = resolveGoalProfile(goal);
  if (!profile) {
    throw new Error(`pickQuizParamsByCode: unknown goal code "${goal}"`);
  }
  return pickQuizParams(profile, hints);
}
