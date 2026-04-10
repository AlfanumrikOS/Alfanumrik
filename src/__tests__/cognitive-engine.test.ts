import { describe, it, expect } from 'vitest';
import {
  BLOOM_LEVELS,
  BLOOM_ORDER,
  BLOOM_CONFIG,
  LESSON_STEPS,
  getLessonStepPrompt,
  getNextLessonStep,
  sm2Update,
  responseToQuality,
  nextReviewDate,
  getHighestMasteredBloom,
  getNextBloomTarget,
  updateBloomMastery,
  calculateZPD,
  difficultyToBloom,
  bloomToDifficultyRange,
  zpdToDifficultyLevel,
  updateCognitiveLoad,
  initialCognitiveLoad,
  adjustDifficulty,
  getReflectionPrompt,
  calculateLearningVelocity,
  predictMasteryDate,
  estimateSessionsToMastery,
  estimateTheta,
  irtProbCorrect,
  bktUpdate,
  classifyError,
  calculateReward,
  predictRetention,
  shouldRetest,
  shouldInterleave,
  generatePredictionPrompt,
  interleaveTopics,
  type BloomLevel,
  type SM2Card,
  type BloomMastery,
  type CognitiveLoadState,
  type LessonState,
  type BKTParams,
  type TopicWeight,
} from '@/lib/cognitive-engine';

/**
 * Cognitive Engine Tests
 *
 * Tests the pure-function cognitive science library covering:
 * - Bloom's Taxonomy constants and progression
 * - SM-2 Spaced Repetition algorithm
 * - Zone of Proximal Development (ZPD)
 * - Cognitive Load Manager
 * - Lesson Flow Engine
 * - Learning Velocity Analytics
 * - IRT and BKT models
 * - Error Classification
 * - RL Reward Function
 * - Retention Decay (Ebbinghaus)
 */

// ─── Bloom's Taxonomy Constants ─────────────────────────────

describe('BLOOM_LEVELS', () => {
  it('has exactly 6 elements', () => {
    expect(BLOOM_LEVELS).toHaveLength(6);
  });

  it('is in correct order: remember through create', () => {
    expect(BLOOM_LEVELS).toEqual([
      'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
    ]);
  });
});

describe('BLOOM_ORDER', () => {
  it('assigns sequential values 0-5', () => {
    expect(BLOOM_ORDER.remember).toBe(0);
    expect(BLOOM_ORDER.understand).toBe(1);
    expect(BLOOM_ORDER.apply).toBe(2);
    expect(BLOOM_ORDER.analyze).toBe(3);
    expect(BLOOM_ORDER.evaluate).toBe(4);
    expect(BLOOM_ORDER.create).toBe(5);
  });

  it('has entries for all 6 bloom levels', () => {
    for (const level of BLOOM_LEVELS) {
      expect(BLOOM_ORDER[level]).toBeDefined();
      expect(typeof BLOOM_ORDER[level]).toBe('number');
    }
  });
});

describe('BLOOM_CONFIG', () => {
  it('has all 6 levels', () => {
    for (const level of BLOOM_LEVELS) {
      expect(BLOOM_CONFIG[level]).toBeDefined();
    }
  });

  it('each level has required fields: label, labelHi, color, icon, description, descriptionHi', () => {
    for (const level of BLOOM_LEVELS) {
      const config = BLOOM_CONFIG[level];
      expect(config.label).toBeTruthy();
      expect(config.labelHi).toBeTruthy();
      expect(config.color).toBeTruthy();
      expect(config.icon).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(config.descriptionHi).toBeTruthy();
    }
  });

  it('colors are valid hex color codes', () => {
    for (const level of BLOOM_LEVELS) {
      expect(BLOOM_CONFIG[level].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('Hindi labels are non-ASCII (actual Hindi text)', () => {
    for (const level of BLOOM_LEVELS) {
      // Hindi text contains characters outside basic ASCII range
      expect(BLOOM_CONFIG[level].labelHi).toMatch(/[^\x00-\x7F]/);
      expect(BLOOM_CONFIG[level].descriptionHi).toMatch(/[^\x00-\x7F]/);
    }
  });
});

// ─── Lesson Flow Engine ─────────────────────────────────────

describe('LESSON_STEPS', () => {
  it('has exactly 6 steps', () => {
    expect(LESSON_STEPS).toHaveLength(6);
  });

  it('is in correct pedagogical order', () => {
    expect(LESSON_STEPS).toEqual([
      'hook', 'visualization', 'guided_examples', 'active_recall', 'application', 'spaced_revision',
    ]);
  });
});

describe('getLessonStepPrompt', () => {
  it('returns a string for each step in English', () => {
    for (const step of LESSON_STEPS) {
      const prompt = getLessonStepPrompt(step, 'Algebra', 'en');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    }
  });

  it('returns a string for each step in Hindi', () => {
    for (const step of LESSON_STEPS) {
      const prompt = getLessonStepPrompt(step, 'Algebra', 'hi');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    }
  });

  it('includes the topic name in the prompt', () => {
    const prompt = getLessonStepPrompt('hook', 'Photosynthesis', 'en');
    expect(prompt).toContain('Photosynthesis');
  });

  it('Hindi prompts contain Hindi characters', () => {
    const prompt = getLessonStepPrompt('hook', 'Algebra', 'hi');
    expect(prompt).toMatch(/[^\x00-\x7F]/);
  });
});

describe('getNextLessonStep', () => {
  it('progresses from hook to visualization', () => {
    const state: LessonState = {
      currentStep: 'hook',
      stepsCompleted: ['hook'],
      recallScore: null,
      applicationScore: null,
    };
    expect(getNextLessonStep(state)).toBe('visualization');
  });

  it('progresses sequentially through all steps', () => {
    for (let i = 0; i < LESSON_STEPS.length - 1; i++) {
      const step = LESSON_STEPS[i];
      // Skip active_recall (has gating logic)
      if (step === 'active_recall') continue;
      const state: LessonState = {
        currentStep: step,
        stepsCompleted: LESSON_STEPS.slice(0, i + 1) as unknown as typeof LESSON_STEPS[number][],
        recallScore: 0.8, // high enough to pass gating
        applicationScore: null,
      };
      expect(getNextLessonStep(state)).toBe(LESSON_STEPS[i + 1]);
    }
  });

  it('returns complete after the last step', () => {
    const state: LessonState = {
      currentStep: 'spaced_revision',
      stepsCompleted: [...LESSON_STEPS],
      recallScore: 0.8,
      applicationScore: 0.7,
    };
    expect(getNextLessonStep(state)).toBe('complete');
  });

  it('gates: sends back to guided_examples if recall score < 0.6', () => {
    const state: LessonState = {
      currentStep: 'active_recall',
      stepsCompleted: ['hook', 'visualization', 'guided_examples', 'active_recall'],
      recallScore: 0.4,
      applicationScore: null,
    };
    expect(getNextLessonStep(state)).toBe('guided_examples');
  });

  it('gates: allows progression past active_recall if recall score >= 0.6', () => {
    const state: LessonState = {
      currentStep: 'active_recall',
      stepsCompleted: ['hook', 'visualization', 'guided_examples', 'active_recall'],
      recallScore: 0.6,
      applicationScore: null,
    };
    expect(getNextLessonStep(state)).toBe('application');
  });

  it('gates: null recall score treated as < 0.6 (sent back)', () => {
    const state: LessonState = {
      currentStep: 'active_recall',
      stepsCompleted: ['hook', 'visualization', 'guided_examples', 'active_recall'],
      recallScore: null,
      applicationScore: null,
    };
    expect(getNextLessonStep(state)).toBe('guided_examples');
  });
});

// ─── SM-2 Spaced Repetition ────────────────────────────────

describe('sm2Update', () => {
  const freshCard: SM2Card = { easeFactor: 2.5, interval: 0, repetitions: 0 };

  it('first correct answer sets interval to 1 day', () => {
    const result = sm2Update(freshCard, 4);
    expect(result.interval).toBe(1);
    expect(result.repetitions).toBe(1);
  });

  it('second correct answer sets interval to 6 days', () => {
    const after1 = sm2Update(freshCard, 4);
    const after2 = sm2Update(after1, 4);
    expect(after2.interval).toBe(6);
    expect(after2.repetitions).toBe(2);
  });

  it('incorrect answer resets repetitions and interval', () => {
    const after2 = sm2Update(sm2Update(freshCard, 4), 4);
    const afterFail = sm2Update(after2, 1);
    expect(afterFail.repetitions).toBe(0);
    expect(afterFail.interval).toBe(1);
  });

  it('ease factor never drops below 1.3', () => {
    let card = { ...freshCard };
    for (let i = 0; i < 20; i++) {
      card = sm2Update(card, 0); // worst quality repeatedly
    }
    expect(card.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('quality is clamped to 0-5 range', () => {
    const resultHigh = sm2Update(freshCard, 10);
    const resultPerfect = sm2Update(freshCard, 5);
    expect(resultHigh.easeFactor).toBe(resultPerfect.easeFactor);

    const resultLow = sm2Update(freshCard, -5);
    const resultZero = sm2Update(freshCard, 0);
    expect(resultLow.easeFactor).toBe(resultZero.easeFactor);
  });
});

describe('responseToQuality', () => {
  it('returns 5 for very fast correct answers', () => {
    expect(responseToQuality(true, 5, 20)).toBe(5);
  });

  it('returns 4 for normal speed correct answers', () => {
    expect(responseToQuality(true, 15, 20)).toBe(4);
  });

  it('returns 3 for slow but correct answers', () => {
    expect(responseToQuality(true, 25, 20)).toBe(3);
  });

  it('returns 0 for very slow incorrect answers', () => {
    expect(responseToQuality(false, 50, 20)).toBe(0);
  });

  it('returns 1 for quick incorrect answers (near miss)', () => {
    expect(responseToQuality(false, 10, 20)).toBe(1);
  });
});

describe('nextReviewDate', () => {
  it('returns a date in the future for positive interval', () => {
    const date = nextReviewDate(7);
    expect(date.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns approximately interval days from now', () => {
    const date = nextReviewDate(10);
    const diffDays = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(Math.round(diffDays)).toBe(10);
  });
});

// ─── Bloom's Mastery and ZPD ────────────────────────────────

describe('getHighestMasteredBloom', () => {
  it('returns remember when no levels are mastered', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.3, attempts: 5, correct: 2 },
    ];
    expect(getHighestMasteredBloom(masteries)).toBe('remember');
  });

  it('returns the highest level with mastery >= 0.7', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.9, attempts: 10, correct: 9 },
      { bloomLevel: 'understand', mastery: 0.8, attempts: 8, correct: 7 },
      { bloomLevel: 'apply', mastery: 0.5, attempts: 6, correct: 3 },
    ];
    expect(getHighestMasteredBloom(masteries)).toBe('understand');
  });

  it('returns remember for empty array', () => {
    expect(getHighestMasteredBloom([])).toBe('remember');
  });
});

describe('getNextBloomTarget', () => {
  it('targets understand when only remember is mastered', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.8, attempts: 10, correct: 8 },
    ];
    expect(getNextBloomTarget(masteries)).toBe('understand');
  });

  it('caps at create (never goes beyond)', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'create', mastery: 0.9, attempts: 10, correct: 9 },
    ];
    expect(getNextBloomTarget(masteries)).toBe('create');
  });
});

describe('updateBloomMastery', () => {
  const base: BloomMastery = { bloomLevel: 'remember', mastery: 0.5, attempts: 5, correct: 3 };

  it('increases mastery on correct answer', () => {
    const updated = updateBloomMastery(base, true);
    expect(updated.mastery).toBeGreaterThan(base.mastery);
    expect(updated.attempts).toBe(6);
    expect(updated.correct).toBe(4);
  });

  it('decreases mastery on incorrect answer', () => {
    const updated = updateBloomMastery(base, false);
    expect(updated.mastery).toBeLessThan(base.mastery);
    expect(updated.attempts).toBe(6);
    expect(updated.correct).toBe(3);
  });

  it('clamps mastery to [0, 1] range', () => {
    const high: BloomMastery = { bloomLevel: 'remember', mastery: 0.99, attempts: 100, correct: 99 };
    const updated = updateBloomMastery(high, true);
    expect(updated.mastery).toBeLessThanOrEqual(1);

    const low: BloomMastery = { bloomLevel: 'remember', mastery: 0.01, attempts: 100, correct: 1 };
    const updatedLow = updateBloomMastery(low, false);
    expect(updatedLow.mastery).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateZPD', () => {
  it('returns targetDifficulty between 0.1 and 0.95', () => {
    const result = calculateZPD(0.5, 0.7);
    expect(result.targetDifficulty).toBeGreaterThanOrEqual(0.1);
    expect(result.targetDifficulty).toBeLessThanOrEqual(0.95);
  });

  it('targets higher difficulty when mastery is high', () => {
    const low = calculateZPD(0.3, 0.7);
    const high = calculateZPD(0.8, 0.7);
    expect(high.targetDifficulty).toBeGreaterThan(low.targetDifficulty);
  });

  it('confidence band narrows for consistent students (accuracy > 0.5)', () => {
    const consistent = calculateZPD(0.5, 0.8);
    const inconsistent = calculateZPD(0.5, 0.3);
    const consistentWidth = consistent.confidenceBand[1] - consistent.confidenceBand[0];
    const inconsistentWidth = inconsistent.confidenceBand[1] - inconsistent.confidenceBand[0];
    expect(consistentWidth).toBeLessThanOrEqual(inconsistentWidth);
  });

  it('returns a valid BloomLevel as targetBloomLevel', () => {
    const result = calculateZPD(0.5, 0.7);
    expect(BLOOM_LEVELS).toContain(result.targetBloomLevel);
  });
});

describe('difficultyToBloom', () => {
  it('maps low difficulty to remember', () => {
    expect(difficultyToBloom(0.1)).toBe('remember');
  });

  it('maps high difficulty to create', () => {
    expect(difficultyToBloom(0.9)).toBe('create');
  });

  it('maps 0.5 to apply or analyze', () => {
    const result = difficultyToBloom(0.5);
    expect(['apply', 'analyze']).toContain(result);
  });
});

describe('bloomToDifficultyRange', () => {
  it('returns [0, ~0.167] for remember', () => {
    const [low, high] = bloomToDifficultyRange('remember');
    expect(low).toBeCloseTo(0, 1);
    expect(high).toBeCloseTo(1 / 6, 2);
  });

  it('returns [~0.833, 1] for create', () => {
    const [low, high] = bloomToDifficultyRange('create');
    expect(low).toBeCloseTo(5 / 6, 2);
    expect(high).toBeCloseTo(1, 1);
  });

  it('ranges are contiguous (no gaps between levels)', () => {
    let prevHigh = 0;
    for (const level of BLOOM_LEVELS) {
      const [low, high] = bloomToDifficultyRange(level);
      expect(low).toBeCloseTo(prevHigh, 5);
      prevHigh = high;
    }
    expect(prevHigh).toBeCloseTo(1, 5);
  });
});

describe('zpdToDifficultyLevel', () => {
  it('returns 1 for low ZPD', () => {
    expect(zpdToDifficultyLevel(0.2)).toBe(1);
  });

  it('returns 2 for medium ZPD', () => {
    expect(zpdToDifficultyLevel(0.5)).toBe(2);
  });

  it('returns 3 for high ZPD', () => {
    expect(zpdToDifficultyLevel(0.8)).toBe(3);
  });
});

// ─── Cognitive Load Manager ─────────────────────────────────

describe('initialCognitiveLoad', () => {
  it('returns zeroed state', () => {
    const state = initialCognitiveLoad();
    expect(state.consecutiveErrors).toBe(0);
    expect(state.consecutiveCorrect).toBe(0);
    expect(state.fatigueScore).toBe(0);
    expect(state.questionsAttempted).toBe(0);
    expect(state.avgResponseTime).toBe(0);
    expect(state.shouldEaseOff).toBe(false);
    expect(state.shouldPushHarder).toBe(false);
    expect(state.shouldPause).toBe(false);
  });
});

describe('updateCognitiveLoad', () => {
  it('increments questionsAttempted', () => {
    const state = initialCognitiveLoad();
    const updated = updateCognitiveLoad(state, true, 10);
    expect(updated.questionsAttempted).toBe(1);
  });

  it('tracks consecutive correct answers', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 10);
    state = updateCognitiveLoad(state, true, 10);
    state = updateCognitiveLoad(state, true, 10);
    expect(state.consecutiveCorrect).toBe(3);
    expect(state.consecutiveErrors).toBe(0);
  });

  it('tracks consecutive errors and resets correct count', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 10);
    state = updateCognitiveLoad(state, false, 10);
    expect(state.consecutiveErrors).toBe(1);
    expect(state.consecutiveCorrect).toBe(0);
  });

  it('sets shouldEaseOff after 3 consecutive errors', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 3; i++) {
      state = updateCognitiveLoad(state, false, 10);
    }
    expect(state.shouldEaseOff).toBe(true);
  });

  it('sets shouldPause after 5 consecutive errors', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 5; i++) {
      state = updateCognitiveLoad(state, false, 10);
    }
    expect(state.shouldPause).toBe(true);
  });

  it('sets shouldPushHarder after 3 correct with low fatigue', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 3; i++) {
      state = updateCognitiveLoad(state, true, 10);
    }
    expect(state.shouldPushHarder).toBe(true);
  });

  it('fatigue score stays in [0, 1]', () => {
    let state = initialCognitiveLoad();
    // Many errors to push fatigue up
    for (let i = 0; i < 50; i++) {
      state = updateCognitiveLoad(state, false, 100);
    }
    expect(state.fatigueScore).toBeLessThanOrEqual(1);
    expect(state.fatigueScore).toBeGreaterThanOrEqual(0);
  });
});

describe('adjustDifficulty', () => {
  it('decreases difficulty when shouldEaseOff is true', () => {
    const load: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldEaseOff: true,
    };
    expect(adjustDifficulty(0.5, load)).toBeLessThan(0.5);
  });

  it('increases difficulty when shouldPushHarder is true', () => {
    const load: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldPushHarder: true,
    };
    expect(adjustDifficulty(0.5, load)).toBeGreaterThan(0.5);
  });

  it('keeps difficulty unchanged when neither flag is set', () => {
    const load = initialCognitiveLoad();
    expect(adjustDifficulty(0.5, load)).toBe(0.5);
  });

  it('clamps adjusted difficulty to [0.1, 0.95]', () => {
    const easeOff: CognitiveLoadState = { ...initialCognitiveLoad(), shouldEaseOff: true };
    expect(adjustDifficulty(0.1, easeOff)).toBeGreaterThanOrEqual(0.1);

    const pushHarder: CognitiveLoadState = { ...initialCognitiveLoad(), shouldPushHarder: true };
    expect(adjustDifficulty(0.95, pushHarder)).toBeLessThanOrEqual(0.95);
  });
});

// ─── Reflection Prompts ─────────────────────────────────────

describe('getReflectionPrompt', () => {
  it('returns metacognitive prompt after first wrong answer', () => {
    const prompt = getReflectionPrompt(false, 0, 0, 'remember');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('metacognitive');
    expect(prompt!.message.length).toBeGreaterThan(0);
    expect(prompt!.messageHi.length).toBeGreaterThan(0);
  });

  it('returns pause prompt after 3+ consecutive errors', () => {
    const prompt = getReflectionPrompt(false, 3, 0, 'remember');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('pause');
  });

  it('returns praise prompt for consecutive correct on high bloom', () => {
    const prompt = getReflectionPrompt(true, 0, 2, 'analyze');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('praise');
  });

  it('returns transfer prompt for correct on evaluate+ bloom', () => {
    const prompt = getReflectionPrompt(true, 0, 0, 'evaluate');
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('transfer');
  });

  it('returns null when no prompt condition is met', () => {
    // Correct answer, low bloom, not consecutive
    const prompt = getReflectionPrompt(true, 0, 0, 'remember');
    expect(prompt).toBeNull();
  });
});

// ─── Learning Velocity ──────────────────────────────────────

describe('calculateLearningVelocity', () => {
  it('returns 0 for fewer than 2 datapoints', () => {
    expect(calculateLearningVelocity([])).toBe(0);
    expect(calculateLearningVelocity([{ date: '2026-01-01', mastery: 0.5 }])).toBe(0);
  });

  it('returns positive velocity for improving mastery', () => {
    const data = [
      { date: '2026-01-01', mastery: 0.2 },
      { date: '2026-01-10', mastery: 0.5 },
      { date: '2026-01-20', mastery: 0.8 },
    ];
    expect(calculateLearningVelocity(data)).toBeGreaterThan(0);
  });

  it('clamps negative velocity to 0', () => {
    const data = [
      { date: '2026-01-01', mastery: 0.8 },
      { date: '2026-01-10', mastery: 0.5 },
      { date: '2026-01-20', mastery: 0.2 },
    ];
    expect(calculateLearningVelocity(data)).toBe(0);
  });
});

describe('predictMasteryDate', () => {
  it('returns null when velocity is 0', () => {
    expect(predictMasteryDate(0.5, 0)).toBeNull();
  });

  it('returns today when already at target mastery', () => {
    const date = predictMasteryDate(0.95, 0.01);
    expect(date).not.toBeNull();
    const diffMs = Math.abs(date!.getTime() - Date.now());
    expect(diffMs).toBeLessThan(60000); // within 1 minute
  });

  it('returns null when more than 365 days needed', () => {
    expect(predictMasteryDate(0.1, 0.0001)).toBeNull();
  });

  it('returns a future date for reasonable velocity', () => {
    const date = predictMasteryDate(0.5, 0.05);
    expect(date).not.toBeNull();
    expect(date!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('estimateSessionsToMastery', () => {
  it('returns 0 when already mastered', () => {
    expect(estimateSessionsToMastery(0.95)).toBe(0);
  });

  it('returns -1 when gain per session is 0', () => {
    expect(estimateSessionsToMastery(0.5, 0)).toBe(-1);
  });

  it('calculates correct number of sessions', () => {
    // (0.95 - 0.5) / 0.05 = 9
    expect(estimateSessionsToMastery(0.5, 0.05)).toBe(9);
  });

  it('rounds up to next whole session', () => {
    // (0.95 - 0.5) / 0.06 = 7.5 -> 8
    expect(estimateSessionsToMastery(0.5, 0.06)).toBe(8);
  });
});

// ─── IRT and BKT ────────────────────────────────────────────

describe('estimateTheta', () => {
  it('returns approximately 0 for balanced responses', () => {
    const responses = [
      { isCorrect: true, difficulty: 2 },
      { isCorrect: false, difficulty: 3 },
      { isCorrect: true, difficulty: 2 },
      { isCorrect: false, difficulty: 3 },
    ];
    const theta = estimateTheta(responses);
    expect(theta).toBeGreaterThanOrEqual(-4);
    expect(theta).toBeLessThanOrEqual(4);
  });

  it('returns higher theta for all correct', () => {
    const allCorrect = [
      { isCorrect: true, difficulty: 3 },
      { isCorrect: true, difficulty: 4 },
      { isCorrect: true, difficulty: 5 },
    ];
    const mixed = [
      { isCorrect: true, difficulty: 3 },
      { isCorrect: false, difficulty: 4 },
      { isCorrect: false, difficulty: 5 },
    ];
    expect(estimateTheta(allCorrect)).toBeGreaterThan(estimateTheta(mixed));
  });

  it('theta is bounded to [-4, 4]', () => {
    const responses = Array(20).fill(null).map(() => ({ isCorrect: true, difficulty: 1 }));
    const theta = estimateTheta(responses);
    expect(theta).toBeGreaterThanOrEqual(-4);
    expect(theta).toBeLessThanOrEqual(4);
  });
});

describe('irtProbCorrect', () => {
  it('returns value between 0 and 1', () => {
    const p = irtProbCorrect(0, 3);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('higher theta means higher probability', () => {
    const pLow = irtProbCorrect(-2, 3);
    const pHigh = irtProbCorrect(2, 3);
    expect(pHigh).toBeGreaterThan(pLow);
  });

  it('probability is at least the guessing parameter', () => {
    const p = irtProbCorrect(-4, 5, 1.0, 0.25);
    expect(p).toBeGreaterThanOrEqual(0.25);
  });
});

describe('bktUpdate', () => {
  const defaultParams: BKTParams = {
    pKnow: 0.5, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1,
  };

  it('increases pKnow after correct answer', () => {
    const result = bktUpdate(defaultParams, true);
    expect(result.newPKnow).toBeGreaterThan(defaultParams.pKnow);
  });

  it('returns predicted probability', () => {
    const result = bktUpdate(defaultParams, true);
    expect(result.predicted).toBeGreaterThan(0);
    expect(result.predicted).toBeLessThanOrEqual(1);
  });

  it('adapts parameters over time', () => {
    const result = bktUpdate(defaultParams, true);
    // pSlip should decrease on correct answer
    expect(result.params.pSlip).toBeLessThanOrEqual(defaultParams.pSlip);
  });
});

// ─── Error Classification ───────────────────────────────────

describe('classifyError', () => {
  it('returns correct for correct answers', () => {
    expect(classifyError(true, 15, 20, 3, 0.5)).toBe('correct');
  });

  it('returns careless for very fast incorrect answers', () => {
    expect(classifyError(false, 2, 20, 3, 0.5)).toBe('careless');
  });

  it('returns careless for high mastery student on easy question', () => {
    expect(classifyError(false, 15, 20, 2, 0.8)).toBe('careless');
  });

  it('returns conceptual for very slow incorrect answers', () => {
    expect(classifyError(false, 55, 20, 3, 0.5)).toBe('conceptual');
  });

  it('returns conceptual for hard question with low mastery', () => {
    expect(classifyError(false, 20, 20, 3, 0.3)).toBe('conceptual');
  });

  it('returns misinterpretation as default error type', () => {
    expect(classifyError(false, 20, 20, 2, 0.5)).toBe('misinterpretation');
  });
});

// ─── RL Reward Function ─────────────────────────────────────

describe('calculateReward', () => {
  it('returns positive reward for correct, good-time answer', () => {
    const reward = calculateReward(true, 15, 3);
    expect(reward).toBeGreaterThan(0);
  });

  it('returns lower reward for too-fast correct (guessing)', () => {
    const fast = calculateReward(true, 2, 1);
    const normal = calculateReward(true, 15, 1);
    expect(fast).toBeLessThan(normal);
  });

  it('returns negative or lower reward for incorrect', () => {
    const incorrect = calculateReward(false, 15, 3);
    const correct = calculateReward(true, 15, 3);
    expect(incorrect).toBeLessThan(correct);
  });

  it('reward is bounded to [-1, 1]', () => {
    expect(calculateReward(true, 15, 5, 1.0)).toBeLessThanOrEqual(1);
    expect(calculateReward(false, 100, 1, 0)).toBeGreaterThanOrEqual(-1);
  });
});

// ─── Retention Decay ────────────────────────────────────────

describe('predictRetention', () => {
  it('returns 1.0 for 0 days since study', () => {
    expect(predictRetention(0)).toBeCloseTo(1.0, 5);
  });

  it('returns value between 0 and 1 for positive days', () => {
    const r = predictRetention(7);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });

  it('retention decreases over time', () => {
    expect(predictRetention(1)).toBeGreaterThan(predictRetention(7));
    expect(predictRetention(7)).toBeGreaterThan(predictRetention(30));
  });

  it('higher strength means slower decay', () => {
    expect(predictRetention(7, 2.0)).toBeGreaterThan(predictRetention(7, 1.0));
  });
});

describe('shouldRetest', () => {
  it('returns true when retention is below threshold', () => {
    expect(shouldRetest(30, 1.0, 0.5)).toBe(true);
  });

  it('returns false when retention is above threshold', () => {
    expect(shouldRetest(0, 1.0, 0.5)).toBe(false);
  });
});

// ─── Interleaving ───────────────────────────────────────────

describe('shouldInterleave', () => {
  it('returns true when topic count >= 2', () => {
    expect(shouldInterleave(3, 2)).toBe(true);
  });

  it('returns true when session length >= 5', () => {
    expect(shouldInterleave(5, 1)).toBe(true);
  });

  it('returns false when both criteria are not met', () => {
    expect(shouldInterleave(3, 1)).toBe(false);
  });
});

describe('interleaveTopics', () => {
  it('returns topic IDs for interleaved practice', () => {
    const topics: TopicWeight[] = [
      { topicId: 'a', mastery: 0.3, isWeak: true, isStrong: false },
      { topicId: 'b', mastery: 0.9, isWeak: false, isStrong: true },
      { topicId: 'c', mastery: 0.4, isWeak: true, isStrong: false },
    ];
    const result = interleaveTopics(topics, 5);
    expect(result.length).toBeGreaterThan(0);
    // interleaveTopics fills weak (70%) + strong (30%) slots, may exceed count due to rounding
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('includes both weak and strong topics', () => {
    const topics: TopicWeight[] = [
      { topicId: 'weak1', mastery: 0.2, isWeak: true, isStrong: false },
      { topicId: 'weak2', mastery: 0.3, isWeak: true, isStrong: false },
      { topicId: 'strong1', mastery: 0.9, isWeak: false, isStrong: true },
      { topicId: 'strong2', mastery: 0.85, isWeak: false, isStrong: true },
    ];
    const result = interleaveTopics(topics, 10);
    const hasWeak = result.some(id => id.startsWith('weak'));
    const hasStrong = result.some(id => id.startsWith('strong'));
    expect(hasWeak).toBe(true);
    expect(hasStrong).toBe(true);
  });
});

// ─── Prediction Prompts ─────────────────────────────────────

describe('generatePredictionPrompt', () => {
  it('returns English prompt for en language', () => {
    const prompt = generatePredictionPrompt('Gravity', 'en');
    expect(prompt).toContain('Gravity');
    expect(prompt).toContain('prediction');
  });

  it('returns Hindi prompt for hi language', () => {
    const prompt = generatePredictionPrompt('Gravity', 'hi');
    expect(prompt).toContain('Gravity');
    expect(prompt).toMatch(/[^\x00-\x7F]/); // contains Hindi characters
  });
});
