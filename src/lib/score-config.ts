/**
 * ALFANUMRIK — Performance Score Configuration
 *
 * Replaces the inflationary XP-level system with a bounded 0-100
 * Performance Score per subject.  The score is a weighted composite:
 *
 *   Subject Score = (Performance x 0.80) + (Behavior x 0.20)
 *
 * where:
 *   Performance = SUM(topic_mastery x retention x bloom_ceiling x syllabus_weight)
 *                 / SUM(syllabus_weight) x 100
 *
 * Design principles:
 * - Bounded 0-100: students always know where they stand
 * - Bloom's ceiling rewards deeper understanding, not just recall
 * - Retention decay encourages regular revision
 * - Behavior component rewards consistency and challenge-seeking
 * - Grade-specific retention floors prevent unfair decay for younger students
 *
 * IMPORTANT: Grades are STRINGS "6" through "12" (Product Invariant P5).
 */

// ─── Formula Weights ─────────────────────────────────────
//
// Performance measures how well the student has mastered content.
// Behavior measures how they engage with the platform over time.
// Together they must sum to 1.0.

/** Weight applied to the Performance (mastery) component of Subject Score. */
export const PERFORMANCE_WEIGHT = 0.80 as const;

/** Weight applied to the Behavior (engagement) component of Subject Score. */
export const BEHAVIOR_WEIGHT = 0.20 as const;

// ─── Bloom's Ceiling Multipliers ─────────────────────────
//
// Each Bloom's level imposes a ceiling on the maximum score a student
// can achieve from questions at that level.  A student who only answers
// "remember" questions can reach at most 45% mastery on a topic.
// To break through, they must succeed at higher cognitive levels.

/** Maximum score multiplier per Bloom's taxonomy level. */
export const BLOOM_CEILING = {
  remember:   0.45,
  understand: 0.60,
  apply:      0.75,
  analyze:    0.85,
  evaluate:   0.95,
  create:     1.00,
} as const;

export type BloomLevel = keyof typeof BLOOM_CEILING;

/** Ordered Bloom's levels from lowest to highest cognitive demand. */
export const BLOOM_LEVELS_ORDERED: readonly BloomLevel[] = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const;

// ─── Grade Retention Floor ───────────────────────────────
//
// Retention decays over time when a student does not revise a topic.
// Younger students get a higher floor so their scores don't crater
// during breaks.  Older students (board exam prep) decay more
// aggressively to motivate consistent revision.
//
// Grades are STRINGS per P5.

/** Minimum retention value per grade — scores cannot decay below this floor. */
export const GRADE_RETENTION_FLOOR: Record<string, number> = {
  '6':  0.30,
  '7':  0.30,
  '8':  0.20,
  '9':  0.20,
  '10': 0.15,
  '11': 0.10,
  '12': 0.10,
} as const;

/**
 * Returns the retention floor for the given grade string.
 * Falls back to 0.10 (strictest) for unknown grades.
 *
 * @param grade - Grade as a string ("6" through "12"). Never an integer.
 */
export function getGradeRetentionFloor(grade: string): number {
  return GRADE_RETENTION_FLOOR[grade] ?? 0.10;
}

// ─── Behavior Sub-Scores ─────────────────────────────────
//
// Six behavioral signals, each measured over a rolling window.
// Weights sum to 20 for easy mental math (each point = 1% of the
// behavior component, which itself is 20% of the total score).

/**
 * Weights for each behavior signal.  Sum = 20.
 *
 * - consistency: days active in window / window length
 * - challenge:   fraction of questions attempted above current Bloom level
 * - revision:    fraction of decaying topics revisited in window
 * - persistence: sessions completed despite low early scores
 * - breadth:     fraction of enrolled subjects with activity in window
 * - velocity:    questions answered per day in window
 */
export const BEHAVIOR_WEIGHTS = {
  consistency: 4,
  challenge:   3,
  revision:    4,
  persistence: 3,
  breadth:     3,
  velocity:    3,
} as const;

/**
 * Rolling window (in days) over which each behavior signal is measured.
 */
export const BEHAVIOR_WINDOWS = {
  consistency: 14,
  challenge:   30,
  revision:    14,
  persistence: 30,
  breadth:     30,
  velocity:    7,
} as const;

export type BehaviorSignal = keyof typeof BEHAVIOR_WEIGHTS;

// ─── Level Thresholds ────────────────────────────────────
//
// Maps score ranges to human-readable level names.
// Same names as the old XP system for continuity, but driven by
// a bounded 0-100 score instead of unbounded XP.

export interface LevelThreshold {
  readonly min: number;
  readonly max: number;
  readonly name: string;
}

/** Score-to-level mapping. Ranges are inclusive on both ends. */
export const LEVEL_THRESHOLDS: readonly LevelThreshold[] = [
  { min:  0, max: 19, name: 'Curious Cub' },
  { min: 20, max: 34, name: 'Quick Learner' },
  { min: 35, max: 49, name: 'Rising Star' },
  { min: 50, max: 64, name: 'Knowledge Seeker' },
  { min: 65, max: 74, name: 'Smart Fox' },
  { min: 75, max: 84, name: 'Quiz Champion' },
  { min: 85, max: 89, name: 'Study Master' },
  { min: 90, max: 94, name: 'Brain Ninja' },
  { min: 95, max: 97, name: 'Scholar Fox' },
  { min: 98, max: 100, name: 'Grand Master' },
] as const;

/**
 * Returns the level name for a given Performance Score (0-100).
 * Clamps the score to [0, 100] before lookup.
 *
 * @param score - Subject Performance Score, 0-100.
 */
export function getLevelFromScore(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const threshold = LEVEL_THRESHOLDS.find(
    (t) => clamped >= t.min && clamped <= t.max
  );
  return threshold?.name ?? 'Curious Cub';
}
