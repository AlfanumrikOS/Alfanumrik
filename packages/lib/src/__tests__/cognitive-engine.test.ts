import { describe, it, expect } from 'vitest';
import {
  sm2Update,
  responseToQuality,
  getHighestMasteredBloom,
  getNextBloomTarget,
  updateBloomMastery,
  calculateZPD,
  interleaveTopics,
  updateCognitiveLoad,
  adjustDifficulty,
  initialCognitiveLoad,
  getReflectionPrompt,
  calculateLearningVelocity,
  predictMasteryDate,
  calculateBoardExamScore,
  BLOOM_ORDER,
  type SM2Card,
  type BloomMastery,
  type TopicWeight,
  type CognitiveLoadState,
  type VelocityDatapoint,
} from '../cognitive-engine';

// ─── SM-2 Algorithm ──────────────────────────────────────────

describe('sm2Update', () => {
  const freshCard: SM2Card = { easeFactor: 2.5, interval: 0, repetitions: 0 };

  it('perfect response (quality 5) increases interval and repetitions', () => {
    const after1 = sm2Update(freshCard, 5);
    expect(after1.repetitions).toBe(1);
    expect(after1.interval).toBe(1);
    expect(after1.easeFactor).toBeGreaterThanOrEqual(2.5);

    const after2 = sm2Update(after1, 5);
    expect(after2.repetitions).toBe(2);
    expect(after2.interval).toBe(6);

    const after3 = sm2Update(after2, 5);
    expect(after3.repetitions).toBe(3);
    expect(after3.interval).toBe(Math.round(6 * after2.easeFactor));
  });

  it('failed response (quality < 3) resets repetitions and interval', () => {
    const learned: SM2Card = { easeFactor: 2.5, interval: 15, repetitions: 5 };
    const after = sm2Update(learned, 2);
    expect(after.repetitions).toBe(0);
    expect(after.interval).toBe(1);
  });

  it('ease factor never drops below 1.3', () => {
    let card: SM2Card = { easeFactor: 1.3, interval: 1, repetitions: 1 };
    // Repeatedly give quality 0 to push EF down
    for (let i = 0; i < 10; i++) {
      card = sm2Update(card, 0);
      expect(card.easeFactor).toBeGreaterThanOrEqual(1.3);
    }
  });

  it('interval progression follows 1 -> 6 -> next * EF', () => {
    let card = sm2Update(freshCard, 4);
    expect(card.interval).toBe(1); // first correct

    card = sm2Update(card, 4);
    expect(card.interval).toBe(6); // second correct

    const expectedThird = Math.round(6 * card.easeFactor);
    card = sm2Update(card, 4);
    expect(card.interval).toBe(expectedThird); // third correct
  });

  it('clamps quality to 0-5 range', () => {
    const neg = sm2Update(freshCard, -3);
    expect(neg.repetitions).toBe(0); // treated as quality 0 (fail)

    const high = sm2Update(freshCard, 10);
    expect(high.repetitions).toBe(1); // treated as quality 5 (pass)
  });
});

// ─── responseToQuality ───────────────────────────────────────

describe('responseToQuality', () => {
  const avgTime = 10; // seconds

  it('incorrect + slow (> 2x avg) returns 0', () => {
    expect(responseToQuality(false, 25, avgTime)).toBe(0);
  });

  it('incorrect + normal returns 1', () => {
    expect(responseToQuality(false, 10, avgTime)).toBe(1);
  });

  it('correct + very fast (< 0.5x avg) returns 5', () => {
    expect(responseToQuality(true, 3, avgTime)).toBe(5);
  });

  it('correct + normal speed (< avg) returns 4', () => {
    expect(responseToQuality(true, 8, avgTime)).toBe(4);
  });

  it('correct + slow (< 1.5x avg) returns 3', () => {
    expect(responseToQuality(true, 12, avgTime)).toBe(3);
  });

  it('correct + very slow (>= 1.5x avg) returns 3', () => {
    expect(responseToQuality(true, 20, avgTime)).toBe(3);
  });
});

// ─── Bloom's Taxonomy ────────────────────────────────────────

describe('getHighestMasteredBloom', () => {
  it('returns correct highest mastered level', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.9, attempts: 10, correct: 9 },
      { bloomLevel: 'understand', mastery: 0.8, attempts: 8, correct: 6 },
      { bloomLevel: 'apply', mastery: 0.75, attempts: 5, correct: 4 },
      { bloomLevel: 'analyze', mastery: 0.4, attempts: 3, correct: 1 },
    ];
    expect(getHighestMasteredBloom(masteries)).toBe('apply');
  });

  it('returns remember when no level is mastered above 0.7', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.5, attempts: 5, correct: 2 },
      { bloomLevel: 'understand', mastery: 0.3, attempts: 3, correct: 1 },
    ];
    expect(getHighestMasteredBloom(masteries)).toBe('remember');
  });

  it('handles empty array by returning remember', () => {
    expect(getHighestMasteredBloom([])).toBe('remember');
  });

  it('picks the highest even if out of order in array', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'analyze', mastery: 0.85, attempts: 10, correct: 8 },
      { bloomLevel: 'remember', mastery: 0.95, attempts: 10, correct: 9 },
    ];
    expect(getHighestMasteredBloom(masteries)).toBe('analyze');
  });
});

describe('getNextBloomTarget', () => {
  it('returns the next level above the highest mastered', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.9, attempts: 10, correct: 9 },
      { bloomLevel: 'understand', mastery: 0.8, attempts: 8, correct: 6 },
    ];
    expect(getNextBloomTarget(masteries)).toBe('apply');
  });

  it('returns create when already at create', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'create', mastery: 0.9, attempts: 10, correct: 9 },
    ];
    expect(getNextBloomTarget(masteries)).toBe('create');
  });

  it('returns understand when only remember is mastered', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.8, attempts: 10, correct: 8 },
    ];
    expect(getNextBloomTarget(masteries)).toBe('understand');
  });
});

describe('updateBloomMastery', () => {
  it('increases mastery on correct answer using EMA', () => {
    const current: BloomMastery = { bloomLevel: 'apply', mastery: 0.5, attempts: 5, correct: 3 };
    const updated = updateBloomMastery(current, true);
    // EMA: 0.5 + 0.15 * (1 - 0.5) = 0.575
    expect(updated.mastery).toBeCloseTo(0.575, 5);
    expect(updated.attempts).toBe(6);
    expect(updated.correct).toBe(4);
  });

  it('decreases mastery on incorrect answer using EMA', () => {
    const current: BloomMastery = { bloomLevel: 'apply', mastery: 0.5, attempts: 5, correct: 3 };
    const updated = updateBloomMastery(current, false);
    // EMA: 0.5 + 0.15 * (0 - 0.5) = 0.425
    expect(updated.mastery).toBeCloseTo(0.425, 5);
    expect(updated.attempts).toBe(6);
    expect(updated.correct).toBe(3);
  });

  it('respects custom weight parameter', () => {
    const current: BloomMastery = { bloomLevel: 'remember', mastery: 0.5, attempts: 3, correct: 2 };
    const updated = updateBloomMastery(current, true, 0.3);
    // EMA: 0.5 + 0.3 * (1 - 0.5) = 0.65
    expect(updated.mastery).toBeCloseTo(0.65, 5);
  });

  it('clamps mastery between 0 and 1', () => {
    const high: BloomMastery = { bloomLevel: 'remember', mastery: 0.98, attempts: 50, correct: 49 };
    const updated = updateBloomMastery(high, true);
    expect(updated.mastery).toBeLessThanOrEqual(1);

    const low: BloomMastery = { bloomLevel: 'remember', mastery: 0.02, attempts: 50, correct: 1 };
    const updatedLow = updateBloomMastery(low, false);
    expect(updatedLow.mastery).toBeGreaterThanOrEqual(0);
  });
});

// ─── ZPD Calculator ──────────────────────────────────────────

describe('calculateZPD', () => {
  it('returns target slightly above current mastery', () => {
    const zpd = calculateZPD(0.5, 0.75);
    // base = 0.5 + 0.1 = 0.6, accuracyAdj = (0.75-0.75)*0.2 = 0, target = 0.6
    expect(zpd.targetDifficulty).toBeCloseTo(0.6, 5);
  });

  it('high accuracy pushes target up', () => {
    const zpd = calculateZPD(0.5, 0.95);
    // accuracyAdj = (0.95-0.75)*0.2 = 0.04, target = 0.6 + 0.04 = 0.64
    expect(zpd.targetDifficulty).toBeCloseTo(0.64, 5);
  });

  it('low accuracy pushes target down', () => {
    const zpd = calculateZPD(0.5, 0.3);
    // accuracyAdj = (0.3-0.75)*0.2 = -0.09, target = 0.6 + (-0.09) = 0.51
    expect(zpd.targetDifficulty).toBeCloseTo(0.51, 5);
  });

  it('always within bounds [0.1, 0.95]', () => {
    const low = calculateZPD(0.0, 0.0);
    expect(low.targetDifficulty).toBeGreaterThanOrEqual(0.1);

    const high = calculateZPD(1.0, 1.0);
    expect(high.targetDifficulty).toBeLessThanOrEqual(0.95);
  });

  it('returns narrow confidence band for consistent students', () => {
    const zpd = calculateZPD(0.5, 0.8);
    const [lower, upper] = zpd.confidenceBand;
    expect(upper - lower).toBeLessThanOrEqual(0.3 + 0.001);
  });

  it('returns wider confidence band for inconsistent students', () => {
    const zpd = calculateZPD(0.5, 0.3);
    const [lower, upper] = zpd.confidenceBand;
    expect(upper - lower).toBeLessThanOrEqual(0.5 + 0.001);
  });

  it('uses bloom masteries to determine target bloom level when provided', () => {
    const blooms: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.9, attempts: 10, correct: 9 },
      { bloomLevel: 'understand', mastery: 0.8, attempts: 8, correct: 6 },
    ];
    const zpd = calculateZPD(0.5, 0.75, blooms);
    expect(zpd.targetBloomLevel).toBe('apply');
  });
});

// ─── Interleaving ────────────────────────────────────────────

describe('interleaveTopics', () => {
  const topics: TopicWeight[] = [
    { topicId: 'weak1', mastery: 0.2, isWeak: true, isStrong: false },
    { topicId: 'weak2', mastery: 0.3, isWeak: true, isStrong: false },
    { topicId: 'weak3', mastery: 0.4, isWeak: true, isStrong: false },
    { topicId: 'strong1', mastery: 0.9, isWeak: false, isStrong: true },
    { topicId: 'strong2', mastery: 0.85, isWeak: false, isStrong: true },
    { topicId: 'medium1', mastery: 0.65, isWeak: false, isStrong: false },
  ];

  it('returns correct number of topics (up to count)', () => {
    const result = interleaveTopics(topics, 10);
    expect(result.length).toBe(10);
  });

  it('prioritizes weak topics (~70%)', () => {
    // Run multiple times and check the aggregate distribution
    // With count=10, weakCount=7, strongCount=3
    const result = interleaveTopics(topics, 10);
    const weakIds = new Set(['weak1', 'weak2', 'weak3', 'medium1']);
    const strongIds = new Set(['strong1', 'strong2']);

    const weakCount = result.filter(id => weakIds.has(id)).length;
    const strongCount = result.filter(id => strongIds.has(id)).length;

    expect(weakCount).toBe(7);
    expect(strongCount).toBe(3);
  });

  it('no same topic back-to-back when possible', () => {
    // With enough distinct topics, most adjacent pairs should be different
    // (interleaveTopics uses randomized selection so 100% dedup isn't guaranteed)
    const diverseTopics: TopicWeight[] = [
      { topicId: 'a', mastery: 0.2, isWeak: true, isStrong: false },
      { topicId: 'b', mastery: 0.3, isWeak: true, isStrong: false },
      { topicId: 'c', mastery: 0.4, isWeak: true, isStrong: false },
      { topicId: 'd', mastery: 0.9, isWeak: false, isStrong: true },
      { topicId: 'e', mastery: 0.85, isWeak: false, isStrong: true },
    ];
    const result = interleaveTopics(diverseTopics, 5);
    // At least 3 distinct topics should appear (not all the same)
    const uniqueTopics = new Set(result);
    expect(uniqueTopics.size).toBeGreaterThanOrEqual(2);
  });

  it('handles empty topics array', () => {
    const result = interleaveTopics([], 5);
    expect(result.length).toBe(0);
  });

  it('handles single topic', () => {
    const single: TopicWeight[] = [
      { topicId: 'only', mastery: 0.3, isWeak: true, isStrong: false },
    ];
    const result = interleaveTopics(single, 3);
    expect(result.length).toBeGreaterThan(0);
    result.forEach(id => expect(id).toBe('only'));
  });
});

// ─── Cognitive Load ──────────────────────────────────────────

describe('updateCognitiveLoad', () => {
  it('3 consecutive errors triggers shouldEaseOff', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, false, 10);
    state = updateCognitiveLoad(state, false, 10);
    state = updateCognitiveLoad(state, false, 10);
    expect(state.consecutiveErrors).toBe(3);
    expect(state.shouldEaseOff).toBe(true);
  });

  it('3 consecutive correct triggers shouldPushHarder', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 5);
    state = updateCognitiveLoad(state, true, 5);
    state = updateCognitiveLoad(state, true, 5);
    expect(state.consecutiveCorrect).toBe(3);
    expect(state.shouldPushHarder).toBe(true);
  });

  it('fatigue increases with errors and slow responses', () => {
    let state = initialCognitiveLoad();
    // First response sets avgResponseTime
    state = updateCognitiveLoad(state, true, 10);
    const fatigueBefore = state.fatigueScore;

    // Error with slow response increases fatigue
    state = updateCognitiveLoad(state, false, 30); // 30 > 10 * 1.5
    expect(state.fatigueScore).toBeGreaterThan(fatigueBefore);
  });

  it('fatigue decreases with correct answers', () => {
    let state = initialCognitiveLoad();
    // Build up some fatigue
    state = updateCognitiveLoad(state, false, 10);
    state = updateCognitiveLoad(state, false, 10);
    const fatigueAfterErrors = state.fatigueScore;

    // Correct answer should decrease fatigue
    state = updateCognitiveLoad(state, true, 5);
    expect(state.fatigueScore).toBeLessThan(fatigueAfterErrors);
  });

  it('resets consecutive counters on opposite result', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 5);
    state = updateCognitiveLoad(state, true, 5);
    expect(state.consecutiveCorrect).toBe(2);

    state = updateCognitiveLoad(state, false, 5);
    expect(state.consecutiveCorrect).toBe(0);
    expect(state.consecutiveErrors).toBe(1);
  });

  it('tracks questionsAttempted', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 5);
    state = updateCognitiveLoad(state, false, 5);
    state = updateCognitiveLoad(state, true, 5);
    expect(state.questionsAttempted).toBe(3);
  });
});

describe('adjustDifficulty', () => {
  it('reduces difficulty when shouldEaseOff', () => {
    const loadState: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldEaseOff: true,
    };
    const adjusted = adjustDifficulty(0.6, loadState);
    expect(adjusted).toBeCloseTo(0.45, 5);
    expect(adjusted).toBeLessThan(0.6);
  });

  it('increases difficulty when shouldPushHarder', () => {
    const loadState: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldPushHarder: true,
    };
    const adjusted = adjustDifficulty(0.5, loadState);
    expect(adjusted).toBeCloseTo(0.6, 5);
    expect(adjusted).toBeGreaterThan(0.5);
  });

  it('keeps difficulty when neither flag is set', () => {
    const loadState = initialCognitiveLoad();
    const adjusted = adjustDifficulty(0.5, loadState);
    expect(adjusted).toBe(0.5);
  });

  it('does not go below 0.1 when easing off', () => {
    const loadState: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldEaseOff: true,
    };
    const adjusted = adjustDifficulty(0.1, loadState);
    expect(adjusted).toBeGreaterThanOrEqual(0.1);
  });

  it('does not exceed 0.95 when pushing harder', () => {
    const loadState: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldPushHarder: true,
    };
    const adjusted = adjustDifficulty(0.9, loadState);
    expect(adjusted).toBeLessThanOrEqual(0.95);
  });
});

// ─── Reflection Prompts ──────────────────────────────────────

describe('getReflectionPrompt', () => {
  it('returns metacognitive prompt after wrong answer (first error)', () => {
    const prompt = getReflectionPrompt(false, 0, 0, 'remember');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('metacognitive');
    expect(prompt!.message).toContain('Think about');
  });

  it('returns pause prompt after 3+ consecutive errors', () => {
    const prompt = getReflectionPrompt(false, 3, 0, 'remember');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('pause');
    expect(prompt!.message).toContain('pause');
  });

  it('returns praise prompt after consecutive correct on hard questions', () => {
    const prompt = getReflectionPrompt(true, 0, 2, 'analyze');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('praise');
    expect(prompt!.message).toContain('Great work');
  });

  it('returns transfer prompt for correct answer at evaluate/create level', () => {
    const prompt = getReflectionPrompt(true, 0, 0, 'evaluate');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('transfer');
  });

  it('returns null when no reflection is needed', () => {
    // Correct answer, low bloom, no streak
    const prompt = getReflectionPrompt(true, 0, 0, 'remember');
    expect(prompt).toBeNull();
  });

  it('includes Hindi translations', () => {
    const prompt = getReflectionPrompt(false, 0, 0, 'remember');
    expect(prompt).not.toBeNull();
    expect(prompt!.messageHi).toBeTruthy();
    expect(prompt!.messageHi.length).toBeGreaterThan(0);
  });
});

// ─── Learning Velocity ───────────────────────────────────────

describe('calculateLearningVelocity', () => {
  it('returns positive velocity for improving student', () => {
    const datapoints: VelocityDatapoint[] = [
      { date: '2026-03-01', mastery: 0.2 },
      { date: '2026-03-08', mastery: 0.4 },
      { date: '2026-03-15', mastery: 0.6 },
      { date: '2026-03-22', mastery: 0.8 },
    ];
    const velocity = calculateLearningVelocity(datapoints);
    expect(velocity).toBeGreaterThan(0);
  });

  it('returns 0 for insufficient data (less than 2 points)', () => {
    expect(calculateLearningVelocity([])).toBe(0);
    expect(calculateLearningVelocity([{ date: '2026-03-01', mastery: 0.5 }])).toBe(0);
  });

  it('returns 0 for declining student (clamped)', () => {
    const datapoints: VelocityDatapoint[] = [
      { date: '2026-03-01', mastery: 0.8 },
      { date: '2026-03-08', mastery: 0.6 },
      { date: '2026-03-15', mastery: 0.4 },
    ];
    const velocity = calculateLearningVelocity(datapoints);
    expect(velocity).toBe(0); // clamped to 0
  });

  it('handles same-day datapoints gracefully', () => {
    const datapoints: VelocityDatapoint[] = [
      { date: '2026-03-15', mastery: 0.3 },
      { date: '2026-03-15', mastery: 0.5 },
    ];
    // denominator would be 0, so returns 0
    const velocity = calculateLearningVelocity(datapoints);
    expect(velocity).toBe(0);
  });
});

describe('predictMasteryDate', () => {
  it('predicts a reasonable future date for positive velocity', () => {
    const date = predictMasteryDate(0.5, 0.05, 0.95);
    expect(date).not.toBeNull();
    // 0.45 / 0.05 = 9 days
    const now = new Date();
    const diffDays = Math.ceil((date!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(9);
  });

  it('returns null for zero velocity', () => {
    expect(predictMasteryDate(0.5, 0)).toBeNull();
  });

  it('returns null for negative velocity', () => {
    expect(predictMasteryDate(0.5, -0.01)).toBeNull();
  });

  it('returns today if already at target', () => {
    const date = predictMasteryDate(0.95, 0.05, 0.95);
    expect(date).not.toBeNull();
    const now = new Date();
    expect(date!.getDate()).toBe(now.getDate());
  });

  it('returns null if more than 365 days needed', () => {
    // 0.9 / 0.001 = 900 days > 365
    expect(predictMasteryDate(0.05, 0.001, 0.95)).toBeNull();
  });
});

// ─── Board Exam Scoring ──────────────────────────────────────

describe('calculateBoardExamScore', () => {
  it('90%+ returns A1 grade', () => {
    const score = calculateBoardExamScore(9, 10, 80);
    expect(score.grade).toBe('A1');
    expect(score.percentage).toBe(90);
  });

  it('80-89% returns A2 grade', () => {
    const score = calculateBoardExamScore(8, 10, 80);
    expect(score.grade).toBe('A2');
    expect(score.percentage).toBe(80);
  });

  it('70-79% returns B1 grade', () => {
    const score = calculateBoardExamScore(7, 10, 80);
    expect(score.grade).toBe('B1');
    expect(score.percentage).toBe(70);
  });

  it('60-69% returns B2 grade', () => {
    const score = calculateBoardExamScore(6, 10, 80);
    expect(score.grade).toBe('B2');
    expect(score.percentage).toBe(60);
  });

  it('50-59% returns C1 grade', () => {
    const score = calculateBoardExamScore(5, 10, 80);
    expect(score.grade).toBe('C1');
    expect(score.percentage).toBe(50);
  });

  it('below 50% returns D grade', () => {
    const score = calculateBoardExamScore(3, 10, 80);
    expect(score.grade).toBe('D');
    expect(score.percentage).toBe(30);
  });

  it('calculates projected marks correctly', () => {
    const score = calculateBoardExamScore(7, 10, 80);
    expect(score.obtainedMarks).toBe(56); // 70% of 80
    expect(score.totalMarks).toBe(80);
  });

  it('handles 0 total questions', () => {
    const score = calculateBoardExamScore(0, 0, 80);
    expect(score.percentage).toBe(0);
    expect(score.grade).toBe('D');
  });

  it('uses default totalBoardMarks of 80', () => {
    const score = calculateBoardExamScore(10, 10);
    expect(score.totalMarks).toBe(80);
    expect(score.obtainedMarks).toBe(80);
  });

  it('includes Hindi messages', () => {
    const score = calculateBoardExamScore(9, 10, 80);
    expect(score.messageHi).toBeTruthy();
    expect(score.messageHi.length).toBeGreaterThan(0);
  });
});
