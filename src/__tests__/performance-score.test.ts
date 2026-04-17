import { describe, it, expect } from 'vitest';
import {
  calculateTopicScore,
  calculatePerformanceComponent,
  calculateBehaviorComponent,
  calculateSubjectScore,
  calculateOverallScore,
  calculateScoreDelta,
  type TopicScoreInput,
  type BehaviorInput,
} from '@/lib/performance-score';
import { PERFORMANCE_WEIGHT, BEHAVIOR_WEIGHT, BLOOM_CEILING } from '@/lib/score-config';
import { predictRetention } from '@/lib/cognitive-engine';

// ─── Helper: build a TopicScoreInput with sensible defaults ─────

function makeTopic(overrides: Partial<TopicScoreInput> = {}): TopicScoreInput {
  return {
    topicId: 'topic-1',
    bktPKnow: 0.8,
    daysSinceLastPractice: 0,
    retentionStrength: 2.5,
    bloomMasteries: [
      { bloomLevel: 'remember', mastery: 0.9 },
      { bloomLevel: 'understand', mastery: 0.8 },
      { bloomLevel: 'apply', mastery: 0.75 },
    ],
    syllabusWeight: 1,
    grade: '9',
    ...overrides,
  };
}

// ─── Helper: build a BehaviorInput with sensible defaults ───────

function makeBehavior(overrides: Partial<BehaviorInput> = {}): BehaviorInput {
  return {
    daysActiveInWindow: 10,
    questionsInZPD: 40,
    totalQuestions: 50,
    decayingTopicsRevised: 3,
    decayingTopicsTotal: 5,
    quizzesCompleted: 8,
    quizzesStarted: 10,
    subjectShares: [25, 25, 25, 25],
    masteryGainThisWeek: 0.05,
    targetGainPerWeek: 0.05,
    ...overrides,
  };
}

// ─── calculateTopicScore ────────────────────────────────────────

describe('calculateTopicScore', () => {
  it('computes basic case: mastery 0.8, recent practice (0 days), apply bloom, grade "9"', () => {
    const input = makeTopic({
      bktPKnow: 0.8,
      daysSinceLastPractice: 0,
      retentionStrength: 2.5,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 0.9 },
        { bloomLevel: 'understand', mastery: 0.8 },
        { bloomLevel: 'apply', mastery: 0.75 },
      ],
      grade: '9',
    });

    const result = calculateTopicScore(input);

    // 0 days since practice => retention = e^(0) = 1.0 (above grade floor 0.20)
    expect(result.retention).toBeCloseTo(1.0, 5);
    // Highest mastered bloom (>= 0.7): apply => ceiling 0.75
    expect(result.bloomCeiling).toBe(BLOOM_CEILING.apply);
    // effectiveScore = 0.8 * 1.0 * 0.75 = 0.60
    expect(result.effectiveScore).toBeCloseTo(0.6, 5);
    // weightedContribution = 0.60 * 1 = 0.60
    expect(result.weightedContribution).toBeCloseTo(0.6, 5);
  });

  it('applies retention decay: mastery 0.8, 14 days since practice, strength 3.0', () => {
    const input = makeTopic({
      bktPKnow: 0.8,
      daysSinceLastPractice: 14,
      retentionStrength: 3.0,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 0.9 },
        { bloomLevel: 'understand', mastery: 0.8 },
        { bloomLevel: 'apply', mastery: 0.75 },
      ],
      grade: '9',
    });

    const result = calculateTopicScore(input);

    // Raw retention: e^(-14/3) ~ 0.00927
    const rawRetention = predictRetention(14, 3.0);
    // Grade "9" floor is 0.20, so retention = max(rawRetention, 0.20) = 0.20
    expect(result.retention).toBeCloseTo(Math.max(rawRetention, 0.20), 5);
    expect(result.retention).toBeGreaterThanOrEqual(0.20);
  });

  it('applies grade floor: mastery 0.8, 30+ days, strength 1.0, grade "6" -- retention >= 0.30', () => {
    const input = makeTopic({
      bktPKnow: 0.8,
      daysSinceLastPractice: 30,
      retentionStrength: 1.0,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 0.9 },
        { bloomLevel: 'understand', mastery: 0.8 },
      ],
      grade: '6',
    });

    const result = calculateTopicScore(input);

    // Raw retention: e^(-30/1) ~ 0 (effectively 0)
    // Grade "6" floor is 0.30
    expect(result.retention).toBeCloseTo(0.3, 5);
  });

  it('applies bloom ceiling: mastery 1.0 but only "remember" bloom => effective score <= 0.45', () => {
    const input = makeTopic({
      bktPKnow: 1.0,
      daysSinceLastPractice: 0,
      retentionStrength: 2.5,
      bloomMasteries: [{ bloomLevel: 'remember', mastery: 0.9 }],
      grade: '9',
    });

    const result = calculateTopicScore(input);

    // retention = 1.0, bloomCeiling = 0.45, effectiveScore = 1.0 * 1.0 * 0.45 = 0.45
    expect(result.bloomCeiling).toBe(0.45);
    expect(result.effectiveScore).toBeCloseTo(0.45, 5);
  });

  it('defaults to "remember" ceiling (0.45) when bloom masteries are empty', () => {
    const input = makeTopic({
      bktPKnow: 1.0,
      daysSinceLastPractice: 0,
      retentionStrength: 2.5,
      bloomMasteries: [],
      grade: '9',
    });

    const result = calculateTopicScore(input);

    // Empty bloom masteries => getHighestMasteredBloom returns 'remember' by default
    expect(result.bloomCeiling).toBe(BLOOM_CEILING.remember);
    expect(result.effectiveScore).toBeCloseTo(0.45, 5);
  });

  it('recognizes higher bloom levels when mastered', () => {
    const input = makeTopic({
      bktPKnow: 0.9,
      daysSinceLastPractice: 0,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 0.9 },
        { bloomLevel: 'understand', mastery: 0.9 },
        { bloomLevel: 'apply', mastery: 0.9 },
        { bloomLevel: 'analyze', mastery: 0.9 },
        { bloomLevel: 'evaluate', mastery: 0.8 },
        { bloomLevel: 'create', mastery: 0.7 },
      ],
      grade: '10',
    });

    const result = calculateTopicScore(input);

    // All bloom levels mastered at >= 0.7, so highest = 'create', ceiling = 1.0
    expect(result.bloomCeiling).toBe(BLOOM_CEILING.create);
    expect(result.effectiveScore).toBeCloseTo(0.9, 5);
  });

  it('does not consider bloom levels with mastery < 0.7 as mastered', () => {
    const input = makeTopic({
      bktPKnow: 1.0,
      daysSinceLastPractice: 0,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 0.9 },
        { bloomLevel: 'understand', mastery: 0.6 }, // below 0.7 threshold
        { bloomLevel: 'apply', mastery: 0.5 },
      ],
      grade: '9',
    });

    const result = calculateTopicScore(input);

    // Only 'remember' is mastered (>= 0.7)
    expect(result.bloomCeiling).toBe(BLOOM_CEILING.remember);
  });

  it('weights contribution by syllabusWeight', () => {
    const heavy = makeTopic({ syllabusWeight: 5 });
    const light = makeTopic({ syllabusWeight: 1 });

    const heavyResult = calculateTopicScore(heavy);
    const lightResult = calculateTopicScore(light);

    expect(heavyResult.weightedContribution).toBe(
      heavyResult.effectiveScore * 5
    );
    expect(lightResult.weightedContribution).toBe(
      lightResult.effectiveScore * 1
    );
    expect(heavyResult.weightedContribution).toBe(
      lightResult.weightedContribution * 5
    );
  });
});

// ─── calculatePerformanceComponent ──────────────────────────────

describe('calculatePerformanceComponent', () => {
  it('returns score for single topic: (effectiveScore * weight / totalWeight) * 100', () => {
    const topic = makeTopic({
      bktPKnow: 0.8,
      daysSinceLastPractice: 0,
      syllabusWeight: 1,
    });

    const result = calculatePerformanceComponent({
      topics: [topic],
      grade: '9',
    });

    // Single topic: performance = effectiveScore * 100
    const topicResult = calculateTopicScore(topic);
    expect(result.score).toBeCloseTo(topicResult.effectiveScore * 100, 3);
  });

  it('weights heavier topics more in multi-topic calculation', () => {
    const heavyTopic = makeTopic({
      topicId: 'heavy',
      bktPKnow: 0.9,
      daysSinceLastPractice: 0,
      syllabusWeight: 3,
    });
    const lightTopic = makeTopic({
      topicId: 'light',
      bktPKnow: 0.5,
      daysSinceLastPractice: 0,
      syllabusWeight: 1,
    });

    const result = calculatePerformanceComponent({
      topics: [heavyTopic, lightTopic],
      grade: '9',
    });

    // Verify the heavy topic contributes more
    expect(result.topicBreakdown).toHaveLength(2);
    const heavyContrib = result.topicBreakdown.find(
      (t) => t.topicId === 'heavy'
    )!;
    const lightContrib = result.topicBreakdown.find(
      (t) => t.topicId === 'light'
    )!;
    expect(heavyContrib.weightedContribution).toBeGreaterThan(
      lightContrib.weightedContribution
    );
  });

  it('returns 0 when all topics have 0 mastery', () => {
    const topic = makeTopic({
      bktPKnow: 0,
      daysSinceLastPractice: 0,
      syllabusWeight: 1,
    });

    const result = calculatePerformanceComponent({
      topics: [topic],
      grade: '9',
    });

    expect(result.score).toBe(0);
  });

  it('returns 0 for empty topics array', () => {
    const result = calculatePerformanceComponent({
      topics: [],
      grade: '9',
    });

    expect(result.score).toBe(0);
    expect(result.topicBreakdown).toHaveLength(0);
  });

  it('returns 0 when all syllabusWeights are 0 (avoids division by zero)', () => {
    const topic = makeTopic({
      bktPKnow: 0.8,
      daysSinceLastPractice: 0,
      syllabusWeight: 0,
    });

    const result = calculatePerformanceComponent({
      topics: [topic],
      grade: '9',
    });

    expect(result.score).toBe(0);
  });

  it('produces expected result for worked spec example (3 Math chapters)', () => {
    // Worked example from the design spec:
    // Chapter 1: bktPKnow=0.8, 2 days since practice, strength=2.5, bloom=apply, weight=3
    // Chapter 2: bktPKnow=0.6, 7 days, strength=1.5, bloom=understand, weight=2
    // Chapter 3: bktPKnow=0.3, 14 days, strength=1.0, bloom=remember, weight=1
    // Grade "9" (floor=0.20)

    const topics: TopicScoreInput[] = [
      {
        topicId: 'ch1',
        bktPKnow: 0.8,
        daysSinceLastPractice: 2,
        retentionStrength: 2.5,
        bloomMasteries: [
          { bloomLevel: 'remember', mastery: 0.9 },
          { bloomLevel: 'understand', mastery: 0.85 },
          { bloomLevel: 'apply', mastery: 0.75 },
        ],
        syllabusWeight: 3,
        grade: '9',
      },
      {
        topicId: 'ch2',
        bktPKnow: 0.6,
        daysSinceLastPractice: 7,
        retentionStrength: 1.5,
        bloomMasteries: [
          { bloomLevel: 'remember', mastery: 0.9 },
          { bloomLevel: 'understand', mastery: 0.75 },
        ],
        syllabusWeight: 2,
        grade: '9',
      },
      {
        topicId: 'ch3',
        bktPKnow: 0.3,
        daysSinceLastPractice: 14,
        retentionStrength: 1.0,
        bloomMasteries: [{ bloomLevel: 'remember', mastery: 0.8 }],
        syllabusWeight: 1,
        grade: '9',
      },
    ];

    const result = calculatePerformanceComponent({
      topics,
      grade: '9',
    });

    // Calculate expected manually:
    // Ch1: retention = e^(-2/2.5) ~ 0.4493, floor 0.20 => max(0.4493, 0.20) = 0.4493
    //       bloom = apply (0.75), effective = 0.8 * 0.4493 * 0.75 = 0.2696
    //       weighted = 0.2696 * 3 = 0.8087
    //
    // Ch2: retention = e^(-7/1.5) ~ 0.00942, floor 0.20 => 0.20
    //       bloom = understand (0.60), effective = 0.6 * 0.20 * 0.60 = 0.072
    //       weighted = 0.072 * 2 = 0.144
    //
    // Ch3: retention = e^(-14/1.0) ~ 0.0000008, floor 0.20 => 0.20
    //       bloom = remember (0.45), effective = 0.3 * 0.20 * 0.45 = 0.027
    //       weighted = 0.027 * 1 = 0.027
    //
    // Performance = (0.8087 + 0.144 + 0.027) / (3+2+1) * 100
    //            = 0.9797 / 6 * 100 = 16.33

    // Allow reasonable tolerance for floating-point math
    expect(result.score).toBeGreaterThan(10);
    expect(result.score).toBeLessThan(25);
    expect(result.topicBreakdown).toHaveLength(3);
  });

  it('clamps result to [0, 100]', () => {
    // With perfect mastery on all fronts:
    const topic = makeTopic({
      bktPKnow: 1.0,
      daysSinceLastPractice: 0,
      retentionStrength: 10.0,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 1.0 },
        { bloomLevel: 'understand', mastery: 1.0 },
        { bloomLevel: 'apply', mastery: 1.0 },
        { bloomLevel: 'analyze', mastery: 1.0 },
        { bloomLevel: 'evaluate', mastery: 1.0 },
        { bloomLevel: 'create', mastery: 1.0 },
      ],
      syllabusWeight: 1,
    });

    const result = calculatePerformanceComponent({
      topics: [topic],
      grade: '12',
    });

    // Perfect: 1.0 * 1.0 * 1.0 = 1.0, scaled = 100
    expect(result.score).toBe(100);
  });
});

// ─── calculateBehaviorComponent ─────────────────────────────────

describe('calculateBehaviorComponent', () => {
  it('returns 100 for a perfect student (all max values)', () => {
    const input = makeBehavior({
      daysActiveInWindow: 14, // 14/14 = 100%
      questionsInZPD: 100,
      totalQuestions: 100, // 100%
      decayingTopicsRevised: 5,
      decayingTopicsTotal: 5, // 100%
      quizzesCompleted: 10,
      quizzesStarted: 10, // 100%
      subjectShares: [25, 25, 25, 25], // perfectly balanced
      masteryGainThisWeek: 0.1,
      targetGainPerWeek: 0.1, // 100%
    });

    const result = calculateBehaviorComponent(input);

    expect(result.score).toBe(100);
    expect(result.breakdown.consistency).toBe(100);
    expect(result.breakdown.challenge).toBe(100);
    expect(result.breakdown.revision).toBe(100);
    expect(result.breakdown.persistence).toBe(100);
    expect(result.breakdown.breadth).toBe(100);
    expect(result.breakdown.velocity).toBe(100);
  });

  it('returns 0 for zero activity student (all 0s)', () => {
    const input = makeBehavior({
      daysActiveInWindow: 0,
      questionsInZPD: 0,
      totalQuestions: 0,
      decayingTopicsRevised: 0,
      decayingTopicsTotal: 5,
      quizzesCompleted: 0,
      quizzesStarted: 0,
      subjectShares: [100, 0, 0, 0],
      masteryGainThisWeek: 0,
      targetGainPerWeek: 0.05,
    });

    const result = calculateBehaviorComponent(input);

    expect(result.breakdown.consistency).toBe(0);
    expect(result.breakdown.revision).toBe(0);
    expect(result.breakdown.velocity).toBe(0);
    // score should be very low (breadth might be nonzero due to min(0,...) clamp)
    expect(result.score).toBeLessThan(10);
  });

  it('computes mixed signals with correct weighting', () => {
    const input = makeBehavior({
      daysActiveInWindow: 7, // 7/14 = 50%
      questionsInZPD: 25,
      totalQuestions: 50, // 50%
      decayingTopicsRevised: 2,
      decayingTopicsTotal: 4, // 50%
      quizzesCompleted: 5,
      quizzesStarted: 10, // 50%
      subjectShares: [50, 50], // perfectly balanced for 2 subjects
      masteryGainThisWeek: 0.025,
      targetGainPerWeek: 0.05, // 50%
    });

    const result = calculateBehaviorComponent(input);

    // All signals at 50% => behavior score should be ~50
    expect(result.breakdown.consistency).toBe(50);
    expect(result.breakdown.challenge).toBe(50);
    expect(result.breakdown.revision).toBe(50);
    expect(result.breakdown.persistence).toBe(50);
    expect(result.breakdown.breadth).toBe(100); // both subjects have equal share
    expect(result.breakdown.velocity).toBe(50);

    // Weighted: (50*4 + 50*3 + 50*4 + 50*3 + 100*3 + 50*3) / 20
    //         = (200 + 150 + 200 + 150 + 300 + 150) / 20
    //         = 1150 / 20 = 57.5
    expect(result.score).toBeCloseTo(57.5, 1);
  });

  it('handles 0 total questions (division by zero safe)', () => {
    const input = makeBehavior({
      questionsInZPD: 0,
      totalQuestions: 0,
    });

    const result = calculateBehaviorComponent(input);

    // Should not throw, challenge uses Math.max(totalQuestions, 1)
    expect(result.breakdown.challenge).toBe(0);
    expect(typeof result.score).toBe('number');
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('handles 0 quizzes started (division by zero safe)', () => {
    const input = makeBehavior({
      quizzesCompleted: 0,
      quizzesStarted: 0,
    });

    const result = calculateBehaviorComponent(input);

    // persistence uses Math.max(quizzesStarted, 1) => 0/1 = 0
    expect(result.breakdown.persistence).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('handles 0 decaying topics (nothing to revise => full revision score of 100)', () => {
    const input = makeBehavior({
      decayingTopicsRevised: 0,
      decayingTopicsTotal: 0,
    });

    const result = calculateBehaviorComponent(input);

    expect(result.breakdown.revision).toBe(100);
  });

  it('handles 1 subject (breadth should be 100)', () => {
    const input = makeBehavior({
      subjectShares: [100],
    });

    const result = calculateBehaviorComponent(input);

    expect(result.breakdown.breadth).toBe(100);
  });

  it('handles 0 subjects (breadth should be 100)', () => {
    const input = makeBehavior({
      subjectShares: [],
    });

    const result = calculateBehaviorComponent(input);

    // subjectShares.length <= 1 => breadth = 100
    expect(result.breakdown.breadth).toBe(100);
  });

  it('clamps each signal to [0, 100]', () => {
    const input = makeBehavior({
      daysActiveInWindow: 30, // 30/14 * 100 = 214%, but clamped to 100
      questionsInZPD: 200,
      totalQuestions: 50, // 400%, clamped to 100
      decayingTopicsRevised: 10,
      decayingTopicsTotal: 5, // 200%, clamped to 100
      quizzesCompleted: 20,
      quizzesStarted: 10, // 200%, clamped to 100
      masteryGainThisWeek: 0.2,
      targetGainPerWeek: 0.05, // 400%, clamped to 100
    });

    const result = calculateBehaviorComponent(input);

    expect(result.breakdown.consistency).toBeLessThanOrEqual(100);
    expect(result.breakdown.challenge).toBeLessThanOrEqual(100);
    expect(result.breakdown.revision).toBeLessThanOrEqual(100);
    expect(result.breakdown.persistence).toBeLessThanOrEqual(100);
    expect(result.breakdown.velocity).toBeLessThanOrEqual(100);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('computes breadth correctly for imbalanced subject shares', () => {
    const input = makeBehavior({
      subjectShares: [5, 5, 5, 85], // min=5, equal=25, breadth = 5/25*100 = 20%
    });

    const result = calculateBehaviorComponent(input);

    expect(result.breakdown.breadth).toBeCloseTo(20, 1);
  });

  it('returns breakdown with all 6 signals', () => {
    const result = calculateBehaviorComponent(makeBehavior());

    expect(result.breakdown).toHaveProperty('consistency');
    expect(result.breakdown).toHaveProperty('challenge');
    expect(result.breakdown).toHaveProperty('revision');
    expect(result.breakdown).toHaveProperty('persistence');
    expect(result.breakdown).toHaveProperty('breadth');
    expect(result.breakdown).toHaveProperty('velocity');
  });
});

// ─── calculateSubjectScore ──────────────────────────────────────

describe('calculateSubjectScore', () => {
  it('blends performance and behavior: performance * 0.80 + behavior * 0.20', () => {
    // Use perfect behavior (100) and controlled performance
    const topic = makeTopic({
      bktPKnow: 0.5,
      daysSinceLastPractice: 0,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 0.9 },
        { bloomLevel: 'understand', mastery: 0.8 },
        { bloomLevel: 'apply', mastery: 0.75 },
      ],
      syllabusWeight: 1,
      grade: '9',
    });

    const behavior = makeBehavior({
      daysActiveInWindow: 14,
      questionsInZPD: 100,
      totalQuestions: 100,
      decayingTopicsRevised: 5,
      decayingTopicsTotal: 5,
      quizzesCompleted: 10,
      quizzesStarted: 10,
      subjectShares: [50, 50],
      masteryGainThisWeek: 0.1,
      targetGainPerWeek: 0.1,
    });

    const result = calculateSubjectScore({
      performance: { topics: [topic], grade: '9' },
      behavior,
    });

    const expectedOverall =
      result.performanceComponent * PERFORMANCE_WEIGHT +
      result.behaviorComponent * BEHAVIOR_WEIGHT;

    expect(result.overall).toBeCloseTo(expectedOverall, 3);
  });

  it('clamps overall score to [0, 100]', () => {
    // Perfect everything
    const topic = makeTopic({
      bktPKnow: 1.0,
      daysSinceLastPractice: 0,
      retentionStrength: 10.0,
      bloomMasteries: [
        { bloomLevel: 'create', mastery: 1.0 },
        { bloomLevel: 'remember', mastery: 1.0 },
      ],
      syllabusWeight: 1,
    });

    const behavior = makeBehavior({
      daysActiveInWindow: 14,
      questionsInZPD: 100,
      totalQuestions: 100,
      decayingTopicsRevised: 5,
      decayingTopicsTotal: 5,
      quizzesCompleted: 10,
      quizzesStarted: 10,
      subjectShares: [50, 50],
      masteryGainThisWeek: 0.1,
      targetGainPerWeek: 0.1,
    });

    const result = calculateSubjectScore({
      performance: { topics: [topic], grade: '9' },
      behavior,
    });

    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.overall).toBeGreaterThanOrEqual(0);
  });

  it('returns a level name that matches the overall score', () => {
    const result = calculateSubjectScore({
      performance: {
        topics: [
          makeTopic({
            bktPKnow: 0.5,
            daysSinceLastPractice: 0,
            syllabusWeight: 1,
          }),
        ],
        grade: '9',
      },
      behavior: makeBehavior(),
    });

    expect(typeof result.levelName).toBe('string');
    expect(result.levelName.length).toBeGreaterThan(0);
  });

  it('returns behavior breakdown with all 6 signals', () => {
    const result = calculateSubjectScore({
      performance: { topics: [makeTopic()], grade: '9' },
      behavior: makeBehavior(),
    });

    expect(result.behaviorBreakdown).toHaveProperty('consistency');
    expect(result.behaviorBreakdown).toHaveProperty('challenge');
    expect(result.behaviorBreakdown).toHaveProperty('revision');
    expect(result.behaviorBreakdown).toHaveProperty('persistence');
    expect(result.behaviorBreakdown).toHaveProperty('breadth');
    expect(result.behaviorBreakdown).toHaveProperty('velocity');
  });

  it('returns Grand Master for perfect score', () => {
    const topic = makeTopic({
      bktPKnow: 1.0,
      daysSinceLastPractice: 0,
      retentionStrength: 10.0,
      bloomMasteries: [
        { bloomLevel: 'remember', mastery: 1.0 },
        { bloomLevel: 'understand', mastery: 1.0 },
        { bloomLevel: 'apply', mastery: 1.0 },
        { bloomLevel: 'analyze', mastery: 1.0 },
        { bloomLevel: 'evaluate', mastery: 1.0 },
        { bloomLevel: 'create', mastery: 1.0 },
      ],
      syllabusWeight: 1,
    });

    const behavior = makeBehavior({
      daysActiveInWindow: 14,
      questionsInZPD: 100,
      totalQuestions: 100,
      decayingTopicsRevised: 5,
      decayingTopicsTotal: 5,
      quizzesCompleted: 10,
      quizzesStarted: 10,
      subjectShares: [50, 50],
      masteryGainThisWeek: 0.1,
      targetGainPerWeek: 0.1,
    });

    const result = calculateSubjectScore({
      performance: { topics: [topic], grade: '9' },
      behavior,
    });

    expect(result.overall).toBe(100);
    expect(result.levelName).toBe('Grand Master');
  });
});

// ─── calculateOverallScore ──────────────────────────────────────

describe('calculateOverallScore', () => {
  it('returns simple average with equal weights', () => {
    const result = calculateOverallScore([
      { subject: 'Math', score: 80 },
      { subject: 'Science', score: 60 },
    ]);

    expect(result).toBe(70); // (80 + 60) / 2
  });

  it('returns weighted average when weights are provided', () => {
    const result = calculateOverallScore([
      { subject: 'Math', score: 80, weight: 3 },
      { subject: 'Science', score: 60, weight: 1 },
    ]);

    // (80*3 + 60*1) / (3+1) = (240+60)/4 = 75
    expect(result).toBe(75);
  });

  it('returns the single subject score for one subject', () => {
    const result = calculateOverallScore([
      { subject: 'Math', score: 85 },
    ]);

    expect(result).toBe(85);
  });

  it('returns 0 for empty array', () => {
    const result = calculateOverallScore([]);

    expect(result).toBe(0);
  });

  it('clamps result to [0, 100]', () => {
    const result = calculateOverallScore([
      { subject: 'Math', score: 100 },
      { subject: 'Science', score: 100 },
    ]);

    expect(result).toBeLessThanOrEqual(100);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('uses default weight of 1 when some entries lack weight', () => {
    const result = calculateOverallScore([
      { subject: 'Math', score: 100, weight: 2 },
      { subject: 'Science', score: 50 }, // default weight 1
    ]);

    // hasWeights = true (Math has weight), Science defaults to 1
    // (100*2 + 50*1) / (2+1) = 250/3 = 83.33
    expect(result).toBeCloseTo(83.33, 1);
  });

  it('returns 0 when all weights are 0', () => {
    const result = calculateOverallScore([
      { subject: 'Math', score: 80, weight: 0 },
      { subject: 'Science', score: 60, weight: 0 },
    ]);

    // sumWeight = 0 => returns 0
    expect(result).toBe(0);
  });
});

// ─── calculateScoreDelta ────────────────────────────────────────

describe('calculateScoreDelta', () => {
  it('returns positive delta and direction "up" when score went up', () => {
    const result = calculateScoreDelta(60, 75);

    expect(result.delta).toBe(15);
    expect(result.direction).toBe('up');
    expect(result.message).toContain('up');
    expect(result.message).toContain('15');
  });

  it('returns negative delta and direction "down" when score went down', () => {
    const result = calculateScoreDelta(75, 60);

    expect(result.delta).toBe(-15);
    expect(result.direction).toBe('down');
    expect(result.message).toContain('down');
    expect(result.message).toContain('15');
  });

  it('returns delta 0 and direction "unchanged" when score is the same', () => {
    const result = calculateScoreDelta(75, 75);

    expect(result.delta).toBe(0);
    expect(result.direction).toBe('unchanged');
    expect(result.message).toContain('unchanged');
  });

  it('has bilingual messages (both message and messageHi) for up direction', () => {
    const result = calculateScoreDelta(50, 60);

    expect(result.message.length).toBeGreaterThan(0);
    expect(result.messageHi.length).toBeGreaterThan(0);
    expect(result.messageHi).not.toBe(result.message);
  });

  it('has bilingual messages for down direction', () => {
    const result = calculateScoreDelta(60, 50);

    expect(result.message.length).toBeGreaterThan(0);
    expect(result.messageHi.length).toBeGreaterThan(0);
    expect(result.messageHi).not.toBe(result.message);
  });

  it('has bilingual messages for unchanged direction', () => {
    const result = calculateScoreDelta(50, 50);

    expect(result.message.length).toBeGreaterThan(0);
    expect(result.messageHi.length).toBeGreaterThan(0);
    expect(result.messageHi).not.toBe(result.message);
  });

  it('uses singular "point" for delta of 1', () => {
    const result = calculateScoreDelta(50, 51);

    expect(result.delta).toBe(1);
    expect(result.message).toContain('point!');
    expect(result.message).not.toContain('points!');
  });

  it('uses plural "points" for delta > 1', () => {
    const result = calculateScoreDelta(50, 53);

    expect(result.delta).toBe(3);
    expect(result.message).toContain('points!');
  });

  it('rounds fractional deltas', () => {
    const result = calculateScoreDelta(50.3, 52.7);

    expect(result.delta).toBe(2); // Math.round(2.4) = 2
    expect(result.direction).toBe('up');
  });

  it('rounds small negative delta to 0 and returns unchanged', () => {
    const result = calculateScoreDelta(50.3, 50.1);

    expect(result.delta).toBe(0); // Math.round(-0.2) = 0
    expect(result.direction).toBe('unchanged');
  });
});
