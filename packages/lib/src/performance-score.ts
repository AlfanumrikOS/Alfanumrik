/**
 * ALFANUMRIK -- Performance Score Calculation Engine
 *
 * Pure functions that compute the 0-100 Performance Score per subject.
 * No side effects, no database calls, no imports beyond score-config
 * and cognitive-engine.
 *
 * Subject Score = (Performance x 0.80) + (Behavior x 0.20)
 *
 * where Performance is a syllabus-weighted sum of per-topic effective
 * scores (mastery x retention x bloom_ceiling), and Behavior is a
 * weighted composite of six engagement signals.
 *
 * IMPORTANT: Grades are STRINGS "6" through "12" (Product Invariant P5).
 */

import {
  PERFORMANCE_WEIGHT,
  BEHAVIOR_WEIGHT,
  BLOOM_CEILING,
  BEHAVIOR_WEIGHTS,
  getLevelFromScore,
  getGradeRetentionFloor,
  type BloomLevel,
  type BehaviorSignal,
} from './score-config';

import {
  predictRetention,
  getHighestMasteredBloom,
  type BloomMastery,
} from './cognitive-engine';

// ─── Topic Score ────────────────────────────────────────────────

/** Input data for computing a single topic's effective score. */
export interface TopicScoreInput {
  topicId: string;
  /** BKT P(Know), 0-1, from concept_mastery table. */
  bktPKnow: number;
  /** Days since the student last practiced this topic. */
  daysSinceLastPractice: number;
  /** SM-2 retention strength parameter (higher = slower decay). */
  retentionStrength: number;
  /** Bloom's mastery array for this topic. mastery >= 0.7 counts as "mastered". */
  bloomMasteries: Array<{ bloomLevel: BloomLevel; mastery: number }>;
  /** Relative syllabus weight for this topic (used for weighted average). */
  syllabusWeight: number;
  /** Grade as a string, "6" through "12" (P5: never an integer). */
  grade: string;
}

/** Result of computing a single topic's effective score. */
export interface TopicScoreResult {
  /** mastery x retention x bloom_ceiling, before syllabus weighting. */
  effectiveScore: number;
  /** Retention after the grade-specific floor has been applied. */
  retention: number;
  /** Ceiling multiplier from the highest mastered Bloom's level. */
  bloomCeiling: number;
  /** effectiveScore x syllabusWeight -- the numerator contribution. */
  weightedContribution: number;
}

/**
 * Compute the effective score for a single topic.
 *
 * Formula:
 *   retention      = max(predictRetention(days, strength), gradeFloor)
 *   bloomCeiling   = BLOOM_CEILING[highestMasteredBloom]
 *   effectiveScore = bktPKnow x retention x bloomCeiling
 *   weightedContribution = effectiveScore x syllabusWeight
 *
 * The grade floor prevents younger students' scores from cratering
 * during holidays. The bloom ceiling rewards deeper cognitive mastery.
 *
 * @param input - Topic-level mastery, retention, and bloom data.
 * @returns Computed effective score and its syllabus-weighted contribution.
 */
export function calculateTopicScore(input: TopicScoreInput): TopicScoreResult {
  // Step 1: Compute raw retention via Ebbinghaus forgetting curve.
  const rawRetention = predictRetention(
    input.daysSinceLastPractice,
    input.retentionStrength
  );

  // Step 2: Apply grade-specific retention floor.
  // Younger students (grade "6") get a higher floor (0.30) than
  // board-exam students (grade "12", floor 0.10).
  const gradeFloor = getGradeRetentionFloor(input.grade);
  const retention = Math.max(rawRetention, gradeFloor);

  // Step 3: Determine highest mastered Bloom's level.
  // Convert the input format to BloomMastery[] expected by cognitive-engine.
  // A bloom level counts as "mastered" if mastery >= 0.7
  // (this threshold is baked into getHighestMasteredBloom).
  const bloomMasteryObjects: BloomMastery[] = input.bloomMasteries.map((bm) => ({
    bloomLevel: bm.bloomLevel,
    mastery: bm.mastery,
    attempts: 0, // not needed for getHighestMasteredBloom
    correct: 0,  // not needed for getHighestMasteredBloom
  }));

  const highestBloom = getHighestMasteredBloom(bloomMasteryObjects);

  // Step 4: Look up the ceiling multiplier.
  // A student who only masters "remember" is capped at 0.45.
  // Mastering "create" unlocks the full 1.0 ceiling.
  const bloomCeiling = BLOOM_CEILING[highestBloom];

  // Step 5: Compute effective score = mastery x retention x bloom ceiling.
  const effectiveScore = input.bktPKnow * retention * bloomCeiling;

  // Step 6: Weight by syllabus importance for the weighted average.
  const weightedContribution = effectiveScore * input.syllabusWeight;

  return {
    effectiveScore,
    retention,
    bloomCeiling,
    weightedContribution,
  };
}

// ─── Performance Component ──────────────────────────────────────

/** Input data for computing the Performance component (0-100). */
export interface PerformanceInput {
  /** All topics in the subject with their mastery data. */
  topics: TopicScoreInput[];
  /** Grade as a string, "6" through "12" (P5). */
  grade: string;
}

/** Result of computing the Performance component. */
export interface PerformanceResult {
  /** Performance score, 0-100. */
  score: number;
  /** Per-topic breakdown for drill-down display. */
  topicBreakdown: Array<TopicScoreResult & { topicId: string }>;
}

/**
 * Compute the Performance component of the Subject Score (0-100).
 *
 * Formula:
 *   Performance = SUM(weightedContribution) / SUM(syllabusWeight) x 100
 *
 * Each topic's weighted contribution = effectiveScore x syllabusWeight,
 * where effectiveScore = bktPKnow x retention x bloomCeiling.
 *
 * Returns 0 if there are no topics (avoids division by zero).
 * Result is clamped to [0, 100].
 *
 * @param input - All topics and the student's grade.
 * @returns Performance score and per-topic breakdown.
 */
export function calculatePerformanceComponent(input: PerformanceInput): PerformanceResult {
  if (input.topics.length === 0) {
    return { score: 0, topicBreakdown: [] };
  }

  const topicBreakdown: Array<TopicScoreResult & { topicId: string }> = [];
  let sumWeightedContribution = 0;
  let sumSyllabusWeight = 0;

  for (const topic of input.topics) {
    const result = calculateTopicScore(topic);
    topicBreakdown.push({ ...result, topicId: topic.topicId });
    sumWeightedContribution += result.weightedContribution;
    sumSyllabusWeight += topic.syllabusWeight;
  }

  // Avoid division by zero when all syllabus weights are 0.
  if (sumSyllabusWeight === 0) {
    return { score: 0, topicBreakdown };
  }

  // Performance = weighted average of effective scores, scaled to 0-100.
  const rawScore = (sumWeightedContribution / sumSyllabusWeight) * 100;

  // Clamp to [0, 100].
  const score = Math.max(0, Math.min(100, rawScore));

  return { score, topicBreakdown };
}

// ─── Behavior Component ─────────────────────────────────────────

/** Input data for computing the Behavior component (0-100). */
export interface BehaviorInput {
  /** Days the student was active within the 14-day consistency window. */
  daysActiveInWindow: number;
  /** Questions attempted that were within the student's ZPD. */
  questionsInZPD: number;
  /** Total questions attempted in the challenge window. */
  totalQuestions: number;
  /** Decaying topics that the student revisited in the revision window. */
  decayingTopicsRevised: number;
  /** Total topics currently in a decaying state. */
  decayingTopicsTotal: number;
  /** Quizzes the student completed (submitted, not abandoned). */
  quizzesCompleted: number;
  /** Quizzes the student started (including abandoned ones). */
  quizzesStarted: number;
  /** Array of percentage time spent per subject (e.g. [40, 35, 25]). */
  subjectShares: number[];
  /** Mastery points gained this week (0-1 scale or absolute). */
  masteryGainThisWeek: number;
  /** Target mastery gain per week (grade-dependent). */
  targetGainPerWeek: number;
}

/** Breakdown of all six behavior sub-scores. */
export interface BehaviorResult {
  /** Final behavior score, 0-100. */
  score: number;
  /** Individual factor scores, each 0-100. */
  breakdown: Record<BehaviorSignal, number>;
}

/**
 * Clamp a value to the [0, 100] range.
 */
function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Compute the Behavior component of the Subject Score (0-100).
 *
 * Six behavioral signals, each scored 0-100, then combined using
 * BEHAVIOR_WEIGHTS (which sum to 20):
 *
 *   Behavior = SUM(factor_score x factor_weight) / SUM(weights)
 *
 * This means each weight point is worth 5% of the behavior score
 * (e.g. consistency weight=4 means consistency contributes up to 20%).
 *
 * Individual factor formulas:
 *   consistency = (daysActive / 14) x 100
 *   challenge   = (questionsInZPD / totalQuestions) x 100
 *   revision    = (revised / total) x 100, or 100 if nothing decaying
 *   persistence = (completed / started) x 100
 *   breadth     = (min_subject_share / equal_share) x 100
 *   velocity    = min(100, (gain / target) x 100)
 *
 * @param input - Behavioral engagement data.
 * @returns Behavior score and per-factor breakdown.
 */
export function calculateBehaviorComponent(input: BehaviorInput): BehaviorResult {
  // ── Consistency: how often the student shows up ──
  // Days active in a 14-day window. 14/14 = 100%.
  const consistency = clamp0to100(
    (input.daysActiveInWindow / 14) * 100
  );

  // ── Challenge-seeking: fraction of questions in the ZPD ──
  // Students who attempt harder questions (within their ZPD) score higher.
  const challenge = clamp0to100(
    (input.questionsInZPD / Math.max(input.totalQuestions, 1)) * 100
  );

  // ── Revision: revisiting decaying topics ──
  // Full marks if nothing is decaying (nothing to revise = job done).
  const revision = input.decayingTopicsTotal > 0
    ? clamp0to100(
        (input.decayingTopicsRevised / input.decayingTopicsTotal) * 100
      )
    : 100;

  // ── Persistence: finishing what you start ──
  // Ratio of completed quizzes to started quizzes.
  const persistence = clamp0to100(
    (input.quizzesCompleted / Math.max(input.quizzesStarted, 1)) * 100
  );

  // ── Breadth: studying across subjects, not just favorites ──
  // Measured as min_subject_share / equal_share.
  // If a student has 4 subjects and spends 25% on each, breadth = 100%.
  // If they spend 5%/5%/5%/85%, breadth = (5 / 25) x 100 = 20%.
  // With 0 or 1 subjects, breadth is always 100 (nothing to balance).
  let breadth: number;
  if (input.subjectShares.length <= 1) {
    breadth = 100;
  } else {
    const equalShare = 100 / input.subjectShares.length;
    const minShare = Math.min(...input.subjectShares);
    breadth = clamp0to100((minShare / equalShare) * 100);
  }

  // ── Velocity: mastery gain rate vs target ──
  // How fast the student is progressing relative to a grade-dependent target.
  const velocity = clamp0to100(
    Math.min(
      100,
      (input.masteryGainThisWeek / Math.max(input.targetGainPerWeek, 0.001)) * 100
    )
  );

  // ── Weighted combination ──
  // BEHAVIOR_WEIGHTS sum to 20. Each point = 5% of the behavior score.
  // Formula: SUM(factor x weight) / SUM(weights)
  const breakdown: Record<BehaviorSignal, number> = {
    consistency,
    challenge,
    revision,
    persistence,
    breadth,
    velocity,
  };

  const weightedSum =
    consistency  * BEHAVIOR_WEIGHTS.consistency +
    challenge    * BEHAVIOR_WEIGHTS.challenge +
    revision     * BEHAVIOR_WEIGHTS.revision +
    persistence  * BEHAVIOR_WEIGHTS.persistence +
    breadth      * BEHAVIOR_WEIGHTS.breadth +
    velocity     * BEHAVIOR_WEIGHTS.velocity;

  // Total weight = 4 + 3 + 4 + 3 + 3 + 3 = 20
  const totalWeight = Object.values(BEHAVIOR_WEIGHTS).reduce(
    (sum, w) => sum + w,
    0
  );

  // Each factor is 0-100 and weights sum to 20, so:
  //   weightedSum ranges from 0 to 100*20 = 2000
  //   Dividing by totalWeight (20) brings it back to 0-100.
  const score = clamp0to100(weightedSum / totalWeight);

  return { score, breakdown };
}

// ─── Subject Score ──────────────────────────────────────────────

/** Input data for computing the full Subject Score. */
export interface SubjectScoreInput {
  /** Performance (mastery) data. */
  performance: PerformanceInput;
  /** Behavior (engagement) data. */
  behavior: BehaviorInput;
}

/** Complete Subject Score result with component breakdown. */
export interface SubjectScoreResult {
  /** Final subject score, 0-100. */
  overall: number;
  /** Performance component value (0-100), before weighting. */
  performanceComponent: number;
  /** Behavior component value (0-100), before weighting. */
  behaviorComponent: number;
  /** Human-readable level name from score-config thresholds. */
  levelName: string;
  /** Per-factor behavior breakdown for UI drill-down. */
  behaviorBreakdown: Record<BehaviorSignal, number>;
}

/**
 * Compute the full Subject Score (0-100).
 *
 * Formula:
 *   overall = (performanceComponent x PERFORMANCE_WEIGHT)
 *           + (behaviorComponent x BEHAVIOR_WEIGHT)
 *
 * where PERFORMANCE_WEIGHT = 0.80 and BEHAVIOR_WEIGHT = 0.20.
 *
 * The level name is derived from the overall score using the
 * thresholds defined in score-config.ts (never hardcoded).
 *
 * @param input - Performance and behavior data for a single subject.
 * @returns Overall score, components, level name, and behavior breakdown.
 */
export function calculateSubjectScore(input: SubjectScoreInput): SubjectScoreResult {
  const performanceResult = calculatePerformanceComponent(input.performance);
  const behaviorResult = calculateBehaviorComponent(input.behavior);

  const performanceComponent = performanceResult.score;
  const behaviorComponent = behaviorResult.score;

  // Weighted composite: 80% performance + 20% behavior.
  const rawOverall =
    performanceComponent * PERFORMANCE_WEIGHT +
    behaviorComponent * BEHAVIOR_WEIGHT;

  // Clamp to [0, 100].
  const overall = Math.max(0, Math.min(100, rawOverall));

  // Level name from score-config thresholds (never hardcoded strings).
  const levelName = getLevelFromScore(overall);

  return {
    overall,
    performanceComponent,
    behaviorComponent,
    levelName,
    behaviorBreakdown: behaviorResult.breakdown,
  };
}

// ─── Overall Score (cross-subject) ──────────────────────────────

/**
 * Compute the overall Performance Score across all subjects.
 *
 * Supports both weighted and equal-weight modes:
 * - If any entry provides a `weight`, uses weighted average.
 * - Otherwise, uses simple arithmetic mean.
 *
 * Result is clamped to [0, 100].
 *
 * @param subjectScores - Per-subject scores, optionally with weights.
 * @returns Overall score, 0-100.
 */
export function calculateOverallScore(
  subjectScores: Array<{ subject: string; score: number; weight?: number }>
): number {
  if (subjectScores.length === 0) {
    return 0;
  }

  // Check if any entry provides an explicit weight.
  const hasWeights = subjectScores.some((s) => s.weight !== undefined);

  if (hasWeights) {
    // Weighted average: SUM(score x weight) / SUM(weight).
    let sumWeighted = 0;
    let sumWeight = 0;
    for (const s of subjectScores) {
      const w = s.weight ?? 1; // default to 1 if some entries lack weight
      sumWeighted += s.score * w;
      sumWeight += w;
    }
    if (sumWeight === 0) return 0;
    return Math.max(0, Math.min(100, sumWeighted / sumWeight));
  }

  // Equal-weight average.
  const sum = subjectScores.reduce((acc, s) => acc + s.score, 0);
  return Math.max(0, Math.min(100, sum / subjectScores.length));
}

// ─── Score Delta ────────────────────────────────────────────────

/** Result of comparing two scores for delta display. */
export interface ScoreDeltaResult {
  /** Numeric difference: newScore - previousScore. */
  delta: number;
  /** Direction of change. */
  direction: 'up' | 'down' | 'unchanged';
  /** English message for the UI (P7: bilingual). */
  message: string;
  /** Hindi message for the UI (P7: bilingual). */
  messageHi: string;
}

/**
 * Calculate the delta between two Performance Scores for post-quiz display.
 *
 * Produces bilingual messages like:
 *   EN: "Math went up 3 points!"
 *   HI: "Math 3 ank badha!"
 *
 * Note: The `subject` parameter is not taken here -- the caller is
 * responsible for interpolating the subject name into the message
 * if needed, or using the generic messages as-is.
 *
 * @param previousScore - Score before the quiz (0-100).
 * @param newScore - Score after the quiz (0-100).
 * @returns Delta value, direction, and bilingual messages.
 */
export function calculateScoreDelta(
  previousScore: number,
  newScore: number
): ScoreDeltaResult {
  const delta = Math.round(newScore - previousScore);

  if (delta > 0) {
    return {
      delta,
      direction: 'up',
      message: `Score went up ${delta} point${delta !== 1 ? 's' : ''}!`,
      messageHi: `Score ${delta} \u0905\u0902\u0915 \u092C\u0922\u093C\u093E!`,
    };
  }

  if (delta < 0) {
    const absDelta = Math.abs(delta);
    return {
      delta,
      direction: 'down',
      message: `Score went down ${absDelta} point${absDelta !== 1 ? 's' : ''}!`,
      messageHi: `Score ${absDelta} \u0905\u0902\u0915 \u0918\u091F\u093E!`,
    };
  }

  return {
    delta: 0,
    direction: 'unchanged',
    message: 'Score unchanged.',
    messageHi: 'Score \u0935\u0939\u0940 \u0930\u0939\u093E\u0964',
  };
}
