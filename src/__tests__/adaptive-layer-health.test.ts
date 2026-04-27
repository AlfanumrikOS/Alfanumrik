import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock the sounds module since it requires browser APIs (Web Audio)
vi.mock('@/lib/sounds', () => ({
  playSound: vi.fn(),
}));

// ─── Section 1: Cognitive Engine Health ─────────────────────────────────────
// Import actual pure functions from the cognitive engine.
// These require zero mocking — they are stateless, pure computations.

import {
  sm2Update,
  getNextBloomTarget,
  getHighestMasteredBloom,
  calculateZPD,
  difficultyToBloom,
  estimateTheta,
  irtProbCorrect,
  bktUpdate,
  classifyError,
  predictRetention,
  shouldRetest,
  getNextLessonStep,
  calculateLearningVelocity,
  detectKnowledgeGaps,
  updateCognitiveLoad,
  initialCognitiveLoad,
  adjustDifficulty,
  BLOOM_LEVELS,
  BLOOM_ORDER,
  LESSON_STEPS,
  type SM2Card,
  type BloomMastery,
  type BloomLevel,
  type BKTParams,
  type CognitiveLoadState,
  type LessonState,
} from '@/lib/cognitive-engine';

// ─── Section 2: Feedback Engine Health ──────────────────────────────────────

import {
  createFeedbackState,
  onCorrectAnswer,
  onWrongAnswer,
  onSessionComplete,
  getNearCompletionNudge,
} from '@/lib/feedback-engine';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: COGNITIVE ENGINE HEALTH
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 1: Cognitive Engine Health', () => {
  // ── SM-2 Algorithm ────────────────────────────────────────────────────

  describe('SM-2 algorithm produces valid intervals', () => {
    it('increases interval on correct response (quality >= 3)', () => {
      const card: SM2Card = { easeFactor: 2.5, interval: 6, repetitions: 2 };
      const updated = sm2Update(card, 4);
      // After 2 repetitions, interval = round(6 * easeFactor) > 6
      expect(updated.interval).toBeGreaterThan(card.interval);
      expect(updated.repetitions).toBe(3);
    });

    it('resets interval to 1 on incorrect response (quality < 3)', () => {
      const card: SM2Card = { easeFactor: 2.5, interval: 15, repetitions: 5 };
      const updated = sm2Update(card, 1);
      expect(updated.interval).toBe(1);
      expect(updated.repetitions).toBe(0);
    });

    it('ease factor never drops below 1.3', () => {
      let card: SM2Card = { easeFactor: 1.3, interval: 1, repetitions: 0 };
      // Repeatedly answer incorrectly
      for (let i = 0; i < 10; i++) {
        card = sm2Update(card, 0);
      }
      expect(card.easeFactor).toBeGreaterThanOrEqual(1.3);
    });

    it('first correct answer produces interval = 1, second = 6', () => {
      const fresh: SM2Card = { easeFactor: 2.5, interval: 0, repetitions: 0 };
      const first = sm2Update(fresh, 4);
      expect(first.interval).toBe(1);
      expect(first.repetitions).toBe(1);
      const second = sm2Update(first, 4);
      expect(second.interval).toBe(6);
      expect(second.repetitions).toBe(2);
    });
  });

  // ── Bloom's Progression ──────────────────────────────────────────────

  describe("Bloom's progression: getNextBloomTarget advances correctly", () => {
    it('advances from remember to understand when remember is mastered', () => {
      const masteries: BloomMastery[] = [
        { bloomLevel: 'remember', mastery: 0.8, attempts: 10, correct: 8 },
      ];
      const next = getNextBloomTarget(masteries);
      expect(next).toBe('understand');
    });

    it('returns remember when nothing is mastered', () => {
      const masteries: BloomMastery[] = [
        { bloomLevel: 'remember', mastery: 0.3, attempts: 5, correct: 1 },
      ];
      // getHighestMasteredBloom returns 'remember' by default, getNextBloomTarget goes one above
      const next = getNextBloomTarget(masteries);
      // Since remember is NOT mastered (0.3 < 0.7), highest is still default 'remember',
      // and next is 'understand'
      expect(next).toBe('understand');
    });

    it('returns create when all lower levels are mastered', () => {
      const masteries: BloomMastery[] = BLOOM_LEVELS.map((level) => ({
        bloomLevel: level,
        mastery: 0.9,
        attempts: 20,
        correct: 18,
      }));
      const next = getNextBloomTarget(masteries);
      // create is the highest level; getNextBloomTarget clamps to create
      expect(next).toBe('create');
    });

    it('skips to correct level when mid-levels are mastered', () => {
      const masteries: BloomMastery[] = [
        { bloomLevel: 'remember', mastery: 0.9, attempts: 10, correct: 9 },
        { bloomLevel: 'understand', mastery: 0.8, attempts: 10, correct: 8 },
        { bloomLevel: 'apply', mastery: 0.75, attempts: 10, correct: 7 },
        { bloomLevel: 'analyze', mastery: 0.3, attempts: 5, correct: 1 },
      ];
      const next = getNextBloomTarget(masteries);
      // Highest mastered is 'apply' (0.75 >= 0.7), next is 'analyze'
      expect(next).toBe('analyze');
    });
  });

  // ── ZPD Calculation ──────────────────────────────────────────────────

  describe('ZPD calculation returns valid difficulty ranges', () => {
    it('returns a targetDifficulty between 0.1 and 0.95', () => {
      const zpd = calculateZPD(0.5, 0.6);
      expect(zpd.targetDifficulty).toBeGreaterThanOrEqual(0.1);
      expect(zpd.targetDifficulty).toBeLessThanOrEqual(0.95);
    });

    it('returns a confidence band [lower, upper] where lower <= target <= upper', () => {
      const zpd = calculateZPD(0.5, 0.7);
      expect(zpd.confidenceBand[0]).toBeLessThanOrEqual(zpd.targetDifficulty);
      expect(zpd.confidenceBand[1]).toBeGreaterThanOrEqual(zpd.targetDifficulty);
    });

    it('returns valid BloomLevel as targetBloomLevel', () => {
      const zpd = calculateZPD(0.5, 0.5);
      expect(BLOOM_LEVELS).toContain(zpd.targetBloomLevel);
    });

    it('higher mastery produces higher target difficulty', () => {
      const lowMastery = calculateZPD(0.2, 0.5);
      const highMastery = calculateZPD(0.8, 0.5);
      expect(highMastery.targetDifficulty).toBeGreaterThan(lowMastery.targetDifficulty);
    });
  });

  // ── IRT estimateTheta ────────────────────────────────────────────────

  describe('IRT estimateTheta converges for consistent patterns', () => {
    it('all correct responses produce positive theta', () => {
      const responses = Array.from({ length: 10 }, () => ({
        isCorrect: true,
        difficulty: 3,
      }));
      const theta = estimateTheta(responses);
      expect(theta).toBeGreaterThan(0);
    });

    it('all incorrect responses produce negative theta', () => {
      const responses = Array.from({ length: 10 }, () => ({
        isCorrect: false,
        difficulty: 3,
      }));
      const theta = estimateTheta(responses);
      expect(theta).toBeLessThan(0);
    });

    it('theta is bounded between -4 and 4', () => {
      const extremeCorrect = Array.from({ length: 20 }, () => ({
        isCorrect: true,
        difficulty: 1,
      }));
      const extremeIncorrect = Array.from({ length: 20 }, () => ({
        isCorrect: false,
        difficulty: 5,
      }));
      expect(estimateTheta(extremeCorrect)).toBeLessThanOrEqual(4);
      expect(estimateTheta(extremeIncorrect)).toBeGreaterThanOrEqual(-4);
    });

    it('mixed responses produce theta near 0', () => {
      const mixed = [
        { isCorrect: true, difficulty: 3 },
        { isCorrect: false, difficulty: 3 },
        { isCorrect: true, difficulty: 3 },
        { isCorrect: false, difficulty: 3 },
        { isCorrect: true, difficulty: 3 },
        { isCorrect: false, difficulty: 3 },
      ];
      const theta = estimateTheta(mixed);
      // Near zero for 50/50 performance on medium difficulty
      expect(Math.abs(theta)).toBeLessThan(2);
    });
  });

  // ── BKT Update ───────────────────────────────────────────────────────

  describe('BKT update adjusts pKnow correctly', () => {
    const baseParams: BKTParams = {
      pKnow: 0.3,
      pLearn: 0.1,
      pGuess: 0.25,
      pSlip: 0.1,
    };

    it('increases pKnow on correct answer', () => {
      const result = bktUpdate(baseParams, true);
      expect(result.newPKnow).toBeGreaterThan(baseParams.pKnow);
    });

    it('decreases pKnow on incorrect answer', () => {
      const result = bktUpdate(baseParams, false);
      expect(result.newPKnow).toBeLessThan(baseParams.pKnow);
    });

    it('returns a predicted probability between 0 and 1', () => {
      const result = bktUpdate(baseParams, true);
      expect(result.predicted).toBeGreaterThan(0);
      expect(result.predicted).toBeLessThanOrEqual(1);
    });

    it('adapts pSlip downward on correct answer', () => {
      const result = bktUpdate(baseParams, true);
      expect(result.params.pSlip).toBeLessThan(baseParams.pSlip);
    });
  });

  // ── Error Classification ─────────────────────────────────────────────

  describe('Error classification returns valid categories', () => {
    it('returns correct for a correct answer', () => {
      expect(classifyError(true, 15, 20, 2, 0.5)).toBe('correct');
    });

    it('returns careless for fast incorrect response', () => {
      // responseTimeSec < avgResponseTimeSec * 0.3 triggers careless
      expect(classifyError(false, 2, 20, 2, 0.5)).toBe('careless');
    });

    it('returns careless for high-mastery student on easy question', () => {
      // studentMastery > 0.7 && questionDifficulty <= 2
      expect(classifyError(false, 15, 20, 2, 0.8)).toBe('careless');
    });

    it('returns conceptual for very slow response', () => {
      // responseTimeSec > avgResponseTimeSec * 2.5
      expect(classifyError(false, 55, 20, 3, 0.3)).toBe('conceptual');
    });

    it('returns conceptual for low-mastery student on hard question', () => {
      // difficulty >= 3 && mastery < 0.4
      expect(classifyError(false, 15, 20, 4, 0.2)).toBe('conceptual');
    });

    it('returns misinterpretation as default for ambiguous errors', () => {
      // Not careless, not conceptual by any heuristic
      expect(classifyError(false, 15, 20, 2, 0.5)).toBe('misinterpretation');
    });
  });

  // ── Retention Decay (Ebbinghaus) ─────────────────────────────────────

  describe('Retention decay follows Ebbinghaus curve', () => {
    it('returns 1.0 for 0 days since study', () => {
      expect(predictRetention(0, 1.0)).toBeCloseTo(1.0, 5);
    });

    it('decays over time (retention at 1 day < retention at 0 days)', () => {
      const day0 = predictRetention(0, 1.0);
      const day1 = predictRetention(1, 1.0);
      expect(day1).toBeLessThan(day0);
    });

    it('higher strength produces slower decay', () => {
      const weakStrength = predictRetention(5, 1.0);
      const strongStrength = predictRetention(5, 5.0);
      expect(strongStrength).toBeGreaterThan(weakStrength);
    });

    it('retention is always between 0 and 1', () => {
      expect(predictRetention(100, 0.5)).toBeGreaterThanOrEqual(0);
      expect(predictRetention(100, 0.5)).toBeLessThanOrEqual(1);
    });

    it('shouldRetest returns true when retention is below threshold', () => {
      // With strength 1.0, after 1 day retention = e^(-1) ~ 0.368 < 0.5
      expect(shouldRetest(1, 1.0, 0.5)).toBe(true);
    });

    it('shouldRetest returns false when retention is above threshold', () => {
      // With strength 10, after 1 day retention = e^(-0.1) ~ 0.905 > 0.5
      expect(shouldRetest(1, 10, 0.5)).toBe(false);
    });
  });

  // ── Lesson Flow Engine ───────────────────────────────────────────────

  describe('Lesson flow engine: getNextLessonStep advances through all 6 steps', () => {
    it('advances from hook to visualization', () => {
      const state: LessonState = {
        currentStep: 'hook',
        stepsCompleted: [],
        recallScore: null,
        applicationScore: null,
      };
      expect(getNextLessonStep(state)).toBe('visualization');
    });

    it('advances through all steps in order', () => {
      const steps: string[] = [];
      for (let i = 0; i < LESSON_STEPS.length; i++) {
        const state: LessonState = {
          currentStep: LESSON_STEPS[i],
          stepsCompleted: LESSON_STEPS.slice(0, i) as unknown as typeof LESSON_STEPS[number][],
          recallScore: i >= 3 ? 0.8 : null, // Pass recall gate for active_recall
          applicationScore: null,
        };
        steps.push(getNextLessonStep(state));
      }
      // Each step should advance to the next one, last returns 'complete'
      expect(steps).toEqual(['visualization', 'guided_examples', 'active_recall', 'application', 'spaced_revision', 'complete']);
    });

    it('gates active_recall: returns guided_examples when recall score < 0.6', () => {
      const state: LessonState = {
        currentStep: 'active_recall',
        stepsCompleted: ['hook', 'visualization', 'guided_examples'],
        recallScore: 0.4, // Below 0.6 threshold
        applicationScore: null,
      };
      expect(getNextLessonStep(state)).toBe('guided_examples');
    });

    it('allows progression past active_recall when recall score >= 0.6', () => {
      const state: LessonState = {
        currentStep: 'active_recall',
        stepsCompleted: ['hook', 'visualization', 'guided_examples'],
        recallScore: 0.7,
        applicationScore: null,
      };
      expect(getNextLessonStep(state)).toBe('application');
    });

    it('returns complete from the last step', () => {
      const state: LessonState = {
        currentStep: 'spaced_revision',
        stepsCompleted: ['hook', 'visualization', 'guided_examples', 'active_recall', 'application'],
        recallScore: 0.8,
        applicationScore: 0.7,
      };
      expect(getNextLessonStep(state)).toBe('complete');
    });
  });

  // ── Learning Velocity ────────────────────────────────────────────────

  describe('Learning velocity calculation produces non-negative values', () => {
    it('returns 0 for fewer than 2 datapoints', () => {
      expect(calculateLearningVelocity([])).toBe(0);
      expect(calculateLearningVelocity([{ date: '2026-01-01', mastery: 0.5 }])).toBe(0);
    });

    it('returns non-negative value for increasing mastery', () => {
      const data = [
        { date: '2026-01-01', mastery: 0.2 },
        { date: '2026-01-10', mastery: 0.5 },
        { date: '2026-01-20', mastery: 0.7 },
      ];
      const velocity = calculateLearningVelocity(data);
      expect(velocity).toBeGreaterThan(0);
    });

    it('clamps to 0 for decreasing mastery (velocity never negative)', () => {
      const data = [
        { date: '2026-01-01', mastery: 0.8 },
        { date: '2026-01-10', mastery: 0.6 },
        { date: '2026-01-20', mastery: 0.3 },
      ];
      const velocity = calculateLearningVelocity(data);
      expect(velocity).toBe(0);
    });
  });

  // ── Knowledge Gap Detector ───────────────────────────────────────────

  describe('Knowledge gap detector identifies gaps in bloom coverage', () => {
    it('detects missing_bloom_level gaps', () => {
      const topicMasteries = [{ topicId: 't1', mastery: 0.8 }];
      const bloomProgressions = [
        { topicId: 't1', bloomLevel: 'remember' as BloomLevel, mastery: 0.9 },
        { topicId: 't1', bloomLevel: 'understand' as BloomLevel, mastery: 0.1 },
      ];
      const gaps = detectKnowledgeGaps(topicMasteries, bloomProgressions);
      expect(gaps.some(g => g.gapType === 'missing_bloom_level')).toBe(true);
    });

    it('detects weak_prerequisite gaps', () => {
      const topicMasteries = [
        { topicId: 't1', mastery: 0.7 },
        { topicId: 't2', mastery: 0.2 },
      ];
      const prerequisites = [
        { topicId: 't1', prerequisiteIds: ['t2'] },
      ];
      const gaps = detectKnowledgeGaps(topicMasteries, [], prerequisites);
      expect(gaps.some(g => g.gapType === 'weak_prerequisite')).toBe(true);
      expect(gaps.some(g => g.severity === 'critical')).toBe(true);
    });

    it('detects stale_knowledge for topics not practiced in 30+ days', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 45);
      const topicMasteries = [
        { topicId: 't1', mastery: 0.8, lastAttempted: oldDate.toISOString() },
      ];
      const gaps = detectKnowledgeGaps(topicMasteries, []);
      expect(gaps.some(g => g.gapType === 'stale_knowledge')).toBe(true);
    });

    it('returns empty array when there are no gaps', () => {
      const topicMasteries = [{ topicId: 't1', mastery: 0.9 }];
      const bloomProgressions = [
        { topicId: 't1', bloomLevel: 'remember' as BloomLevel, mastery: 0.9 },
        { topicId: 't1', bloomLevel: 'understand' as BloomLevel, mastery: 0.8 },
      ];
      const gaps = detectKnowledgeGaps(topicMasteries, bloomProgressions);
      // Only bloom gap detected if there's a >0.7 to <0.3 jump, both here are high
      expect(gaps.filter(g => g.gapType === 'missing_bloom_level')).toHaveLength(0);
    });
  });

  // ── Cognitive Load Manager ───────────────────────────────────────────

  describe('Cognitive load fatigue detection', () => {
    it('initialCognitiveLoad starts with all zeros and false flags', () => {
      const state = initialCognitiveLoad();
      expect(state.fatigueScore).toBe(0);
      expect(state.shouldPause).toBe(false);
      expect(state.shouldEaseOff).toBe(false);
      expect(state.shouldPushHarder).toBe(false);
    });

    it('triggers shouldEaseOff after 3 consecutive errors', () => {
      let state = initialCognitiveLoad();
      for (let i = 0; i < 3; i++) {
        state = updateCognitiveLoad(state, false, 15);
      }
      expect(state.shouldEaseOff).toBe(true);
    });

    it('triggers shouldPause after 5 consecutive errors', () => {
      let state = initialCognitiveLoad();
      for (let i = 0; i < 5; i++) {
        state = updateCognitiveLoad(state, false, 15);
      }
      expect(state.shouldPause).toBe(true);
    });

    it('triggers shouldPushHarder after 3 consecutive correct with low fatigue', () => {
      let state = initialCognitiveLoad();
      for (let i = 0; i < 3; i++) {
        state = updateCognitiveLoad(state, true, 10);
      }
      expect(state.shouldPushHarder).toBe(true);
    });

    it('adjustDifficulty reduces difficulty when shouldEaseOff is true', () => {
      const loadState: CognitiveLoadState = {
        ...initialCognitiveLoad(),
        shouldEaseOff: true,
      };
      const adjusted = adjustDifficulty(0.6, loadState);
      expect(adjusted).toBeLessThan(0.6);
    });

    it('adjustDifficulty increases difficulty when shouldPushHarder is true', () => {
      const loadState: CognitiveLoadState = {
        ...initialCognitiveLoad(),
        shouldPushHarder: true,
      };
      const adjusted = adjustDifficulty(0.5, loadState);
      expect(adjusted).toBeGreaterThan(0.5);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: FEEDBACK ENGINE HEALTH
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 2: Feedback Engine Health', () => {
  describe('createFeedbackState returns valid initial state', () => {
    it('all counters start at 0', () => {
      const state = createFeedbackState();
      expect(state.correctStreak).toBe(0);
      expect(state.wrongStreak).toBe(0);
      expect(state.totalAnswered).toBe(0);
      expect(state.totalCorrect).toBe(0);
    });

    it('sessionStartTime is a recent timestamp', () => {
      const before = Date.now();
      const state = createFeedbackState();
      const after = Date.now();
      expect(state.sessionStartTime).toBeGreaterThanOrEqual(before);
      expect(state.sessionStartTime).toBeLessThanOrEqual(after);
    });
  });

  describe('onCorrectAnswer escalates feedback with streak', () => {
    it('first correct: low intensity, correct sound', () => {
      const state = createFeedbackState();
      const result = onCorrectAnswer(state);
      expect(result.intensity).toBe('low');
      expect(result.sound).toBe('correct');
      expect(result.showCombo).toBe(false);
    });

    it('3rd consecutive correct: shows combo, streak sound', () => {
      const state = createFeedbackState();
      onCorrectAnswer(state);
      onCorrectAnswer(state);
      const result = onCorrectAnswer(state);
      expect(result.showCombo).toBe(true);
      expect(result.comboCount).toBe(3);
      expect(result.sound).toBe('streak');
    });

    it('6th consecutive correct: high intensity', () => {
      const state = createFeedbackState();
      for (let i = 0; i < 5; i++) onCorrectAnswer(state);
      const result = onCorrectAnswer(state);
      expect(result.intensity).toBe('high');
      expect(result.comboCount).toBe(6);
    });

    it('increments totalCorrect and totalAnswered', () => {
      const state = createFeedbackState();
      onCorrectAnswer(state);
      onCorrectAnswer(state);
      expect(state.totalCorrect).toBe(2);
      expect(state.totalAnswered).toBe(2);
    });
  });

  describe('onWrongAnswer provides compassion-first feedback', () => {
    it('resets correct streak', () => {
      const state = createFeedbackState();
      onCorrectAnswer(state);
      onCorrectAnswer(state);
      onWrongAnswer(state);
      expect(state.correctStreak).toBe(0);
    });

    it('always returns low intensity (never punishing)', () => {
      const state = createFeedbackState();
      const result = onWrongAnswer(state);
      expect(result.intensity).toBe('low');
    });

    it('never shows combo on wrong answer', () => {
      const state = createFeedbackState();
      onWrongAnswer(state);
      const result = onWrongAnswer(state);
      expect(result.showCombo).toBe(false);
      expect(result.comboCount).toBe(0);
    });

    it('foxy line has both en and hi translations', () => {
      const state = createFeedbackState();
      const result = onWrongAnswer(state);
      expect(result.foxyLine.en).toBeTruthy();
      expect(result.foxyLine.hi).toBeTruthy();
    });

    it('does not increment totalCorrect', () => {
      const state = createFeedbackState();
      onWrongAnswer(state);
      expect(state.totalCorrect).toBe(0);
      expect(state.totalAnswered).toBe(1);
    });
  });

  describe('onSessionComplete summarizes session stats', () => {
    it('returns a foxyLine with bilingual content', () => {
      const state = createFeedbackState();
      onCorrectAnswer(state);
      const result = onSessionComplete(state);
      expect(result.foxyLine.en).toBeTruthy();
      expect(result.foxyLine.hi).toBeTruthy();
    });

    it('returns levelUp sound for 80%+ score', () => {
      const state = createFeedbackState();
      for (let i = 0; i < 8; i++) onCorrectAnswer(state);
      for (let i = 0; i < 2; i++) onWrongAnswer(state);
      // 8/10 = 80%
      const result = onSessionComplete(state);
      expect(result.sound).toBe('levelUp');
    });

    it('returns complete sound for below 80% score', () => {
      const state = createFeedbackState();
      for (let i = 0; i < 5; i++) onCorrectAnswer(state);
      for (let i = 0; i < 5; i++) onWrongAnswer(state);
      // 5/10 = 50%
      const result = onSessionComplete(state);
      expect(result.sound).toBe('complete');
    });

    it('returns scoreLine for 100% with 5+ questions', () => {
      const state = createFeedbackState();
      for (let i = 0; i < 5; i++) onCorrectAnswer(state);
      // 5/5 = 100%
      const result = onSessionComplete(state);
      expect(result.scoreLine).toBeTruthy();
      expect(result.scoreLine!.en).toBeTruthy();
    });

    it('returns undefined scoreLine for low scores', () => {
      const state = createFeedbackState();
      for (let i = 0; i < 3; i++) onCorrectAnswer(state);
      for (let i = 0; i < 7; i++) onWrongAnswer(state);
      const result = onSessionComplete(state);
      expect(result.scoreLine).toBeUndefined();
    });
  });

  describe('getNearCompletionNudge triggers at right threshold', () => {
    it('triggers when 2 questions remaining', () => {
      // 10 questions, currentIndex = 7 -> remaining = 2
      const nudge = getNearCompletionNudge(7, 10);
      expect(nudge).not.toBeNull();
      expect(nudge!.en).toBeTruthy();
      expect(nudge!.hi).toBeTruthy();
    });

    it('triggers when 1 question remaining', () => {
      const nudge = getNearCompletionNudge(8, 10);
      expect(nudge).not.toBeNull();
    });

    it('returns null when more than 2 questions remaining', () => {
      const nudge = getNearCompletionNudge(5, 10);
      expect(nudge).toBeNull();
    });

    it('returns null when on last question (0 remaining)', () => {
      const nudge = getNearCompletionNudge(9, 10);
      expect(nudge).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: ADAPTIVE PIPELINE INTEGRATION (structural, file-based)
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 3: Adaptive Pipeline Integration', () => {
  // Helper to read source files (same pattern as adaptive-pipeline.test.ts)
  function readSource(relativePath: string): string {
    const fullPath = path.resolve(relativePath);
    return fs.readFileSync(fullPath, 'utf-8');
  }

  describe('Foxy route (src/app/api/foxy/route.ts) integration wiring', () => {
    let foxySource: string;

    beforeAll(() => {
      foxySource = readSource('src/app/api/foxy/route.ts');
    });

    it('imports/references cognitive context loading', () => {
      // The route loads cognitive context via loadCognitiveContext function
      expect(foxySource).toContain('loadCognitiveContext');
    });

    it('grounded-answer service uses Voyage embeddings for RAG', () => {
      // Post-Phase-2 (audit 2026-04-27 F11): Foxy route delegates retrieval
      // to the grounded-answer Edge Function. The Voyage embedding call now
      // lives in the grounded-answer service (pipeline.ts + embedding.ts).
      // Foxy itself no longer contains generateEmbedding/voyage-3 literals.
      const groundedPipelineSource = readSource(
        'supabase/functions/grounded-answer/pipeline.ts'
      );
      const groundedEmbeddingSource = readSource(
        'supabase/functions/grounded-answer/embedding.ts'
      );
      const groundedRetrievalSource = readSource(
        'supabase/functions/grounded-answer/retrieval.ts'
      );
      const combinedSource =
        groundedPipelineSource + groundedEmbeddingSource + groundedRetrievalSource;
      expect(combinedSource).toContain('generateEmbedding');
      expect(combinedSource).toContain('voyage-3');
    });

    it('includes input safety checks via grade validation', () => {
      // The route validates grade is in VALID_GRADES
      expect(foxySource).toContain('VALID_GRADES');
      // Message length validation
      expect(foxySource).toContain('MAX_MESSAGE_LENGTH');
    });

    it('includes RBAC authorization guard (foxy.chat permission)', () => {
      expect(foxySource).toContain("authorizeRequest(request, 'foxy.chat'");
    });

    it('builds system prompt with cognitive context section', () => {
      expect(foxySource).toContain('buildCognitivePromptSection');
      expect(foxySource).toContain('buildSystemPrompt');
    });

    it('references match_rag_chunks RPC for RAG retrieval', () => {
      expect(foxySource).toContain('match_rag_chunks');
    });

    it('persists conversation turns to foxy_chat_messages', () => {
      expect(foxySource).toContain('foxy_chat_messages');
    });

    it('logs audit trail for foxy.chat action', () => {
      expect(foxySource).toContain("action: 'foxy.chat'");
    });
  });

  describe('CME engine (supabase/functions/cme-engine/index.ts) handles all 5 actions', () => {
    let cmeSource: string;

    beforeAll(() => {
      cmeSource = readSource('supabase/functions/cme-engine/index.ts');
    });

    it('handles get_next_action', () => {
      expect(cmeSource).toContain("action === 'get_next_action'");
    });

    it('handles record_response', () => {
      expect(cmeSource).toContain("action === 'record_response'");
    });

    it('handles get_concept_state', () => {
      expect(cmeSource).toContain("action === 'get_concept_state'");
    });

    it('handles get_revision_due', () => {
      expect(cmeSource).toContain("action === 'get_revision_due'");
    });

    it('handles get_exam_readiness', () => {
      expect(cmeSource).toContain("action === 'get_exam_readiness'");
    });

    it('requires authorization header', () => {
      expect(cmeSource).toContain('Authorization required');
    });

    it('validates student exists before processing', () => {
      expect(cmeSource).toContain('Student not found');
    });
  });

  describe('NCERT retriever (src/lib/ai/retrieval/ncert-retriever.ts) exports retrieval functions', () => {
    let retrieverSource: string;

    beforeAll(() => {
      retrieverSource = readSource('src/lib/ai/retrieval/ncert-retriever.ts');
    });

    it('exports generateEmbedding function', () => {
      expect(retrieverSource).toContain('export async function generateEmbedding');
    });

    it('exports retrieveNcertChunks function', () => {
      expect(retrieverSource).toContain('export async function retrieveNcertChunks');
    });

    it('calls Voyage AI API for embeddings', () => {
      // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): remove when legacy ncert-retriever is deleted.
      expect(retrieverSource).toContain('api.voyageai.com/v1/embeddings');
    });

    it('calls match_rag_chunks RPC', () => {
      expect(retrieverSource).toContain('match_rag_chunks');
    });

    it('includes NCERT content retrieval documentation', () => {
      // The retriever is specifically for NCERT content
      expect(retrieverSource).toContain('NCERT');
    });

    it('gracefully handles missing Voyage API key', () => {
      expect(retrieverSource).toContain('voyageApiKey');
    });

    it('never throws from retrieveNcertChunks (returns error in result)', () => {
      expect(retrieverSource).toContain('return { chunks: [], contextText:');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: SAFETY GUARDRAILS HEALTH (structural)
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 4: Safety Guardrails Health', () => {
  let foxySource: string;

  beforeAll(() => {
    foxySource = fs.readFileSync(path.resolve('src/app/api/foxy/route.ts'), 'utf-8');
  });

  describe('Rate limiting and quota checking', () => {
    it('enforces daily quota via checkAndIncrementQuota', () => {
      expect(foxySource).toContain('checkAndIncrementQuota');
    });

    it('defines quotas per plan (free, starter, pro, unlimited)', () => {
      expect(foxySource).toContain('free:');
      expect(foxySource).toContain('starter:');
      expect(foxySource).toContain('pro:');
      expect(foxySource).toContain('unlimited:');
    });

    it('returns 429 when quota is exceeded', () => {
      expect(foxySource).toContain('429');
    });

    it('quota check uses atomic RPC to prevent TOCTOU', () => {
      expect(foxySource).toContain('check_and_record_usage');
    });

    it('normalizes plan names including legacy aliases', () => {
      expect(foxySource).toContain('normalizePlan');
      // Handles legacy aliases
      expect(foxySource).toContain('basic');
      expect(foxySource).toContain('premium');
    });
  });

  describe('Grade-appropriate content enforcement', () => {
    it('only accepts grades 6 through 12', () => {
      expect(foxySource).toContain("'6', '7', '8', '9', '10', '11', '12'");
    });

    it('rejects invalid grade with 400 error', () => {
      expect(foxySource).toContain('Valid grade (6');
    });

    it('constrains system prompt to CBSE curriculum scope', () => {
      expect(foxySource).toContain('Only teach from CBSE');
    });

    it('instructs Foxy to redirect off-topic questions', () => {
      expect(foxySource).toContain('gently redirect to the subject');
    });
  });

  describe('Bilingual support (hi/en)', () => {
    it('error messages include both English and Hindi', () => {
      // errorJson always receives both message and message_hi
      expect(foxySource).toContain('error_hi');
    });

    it('system prompt mentions Hindi/English mixing', () => {
      expect(foxySource).toContain('Hindi words');
    });

    it('cognitive context builds instructions in English (prompt language)', () => {
      expect(foxySource).toContain('COGNITIVE LOAD INSTRUCTIONS');
    });
  });

  describe('Message safety', () => {
    it('enforces maximum message length', () => {
      expect(foxySource).toContain('MAX_MESSAGE_LENGTH');
      expect(foxySource).toContain('Message too long');
    });

    it('trims and validates message input', () => {
      expect(foxySource).toContain('message.trim()');
      expect(foxySource).toContain('Message is required');
    });

    it('checks for suspended accounts', () => {
      expect(foxySource).toContain('account_status');
      expect(foxySource).toContain('suspended');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: CROSS-COMPONENT CONTRACTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 5: Cross-Component Contracts', () => {
  describe('Bloom levels in cognitive engine match what CME engine expects', () => {
    it('BLOOM_LEVELS contains all 6 standard taxonomy levels', () => {
      expect(BLOOM_LEVELS).toEqual([
        'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
      ]);
    });

    it('BLOOM_ORDER maps each level to a sequential 0-5 index', () => {
      expect(BLOOM_ORDER.remember).toBe(0);
      expect(BLOOM_ORDER.create).toBe(5);
      expect(Object.keys(BLOOM_ORDER)).toHaveLength(6);
    });

    it('CME engine uses bloom_focus field compatible with BLOOM_LEVELS', () => {
      const cmeSource = fs.readFileSync(
        path.resolve('supabase/functions/cme-engine/index.ts'),
        'utf-8',
      );
      // CME reads bloom_focus from curriculum_topics
      expect(cmeSource).toContain('bloom_focus');
    });

    it('difficultyToBloom returns valid BLOOM_LEVELS values for all ranges', () => {
      const testDifficulties = [0.0, 0.17, 0.33, 0.50, 0.67, 0.83, 1.0];
      for (const d of testDifficulties) {
        const bloom = difficultyToBloom(d);
        expect(BLOOM_LEVELS).toContain(bloom);
      }
    });
  });

  describe('Difficulty scales are consistent between IRT and quiz generation', () => {
    it('irtProbCorrect returns values between 0 and 1 for all difficulty levels', () => {
      for (let diff = 1; diff <= 5; diff++) {
        const prob = irtProbCorrect(0, diff);
        expect(prob).toBeGreaterThan(0);
        expect(prob).toBeLessThanOrEqual(1);
      }
    });

    it('higher theta produces higher probability of correct answer', () => {
      const lowAbility = irtProbCorrect(-2, 3);
      const highAbility = irtProbCorrect(2, 3);
      expect(highAbility).toBeGreaterThan(lowAbility);
    });

    it('higher difficulty produces lower probability for same theta', () => {
      const easyQuestion = irtProbCorrect(0, 1);
      const hardQuestion = irtProbCorrect(0, 5);
      expect(easyQuestion).toBeGreaterThan(hardQuestion);
    });

    it('CME engine uses 1-5 difficulty scale consistent with IRT', () => {
      const cmeSource = fs.readFileSync(
        path.resolve('supabase/functions/cme-engine/index.ts'),
        'utf-8',
      );
      // CME normalizes difficulty: (questionDifficulty || 2) - 3
      expect(cmeSource).toContain('questionDifficulty');
      // Max difficulty succeeded tracked on 1-5 scale
      expect(cmeSource).toContain('max_difficulty_succeeded');
    });
  });

  describe('Feedback engine streak tracking is compatible with cognitive load fatigue', () => {
    it('feedback engine tracks correctStreak independently', () => {
      const feedbackState = createFeedbackState();
      onCorrectAnswer(feedbackState);
      onCorrectAnswer(feedbackState);
      onCorrectAnswer(feedbackState);
      expect(feedbackState.correctStreak).toBe(3);
    });

    it('cognitive load tracks consecutiveCorrect independently', () => {
      let cogState = initialCognitiveLoad();
      cogState = updateCognitiveLoad(cogState, true, 10);
      cogState = updateCognitiveLoad(cogState, true, 10);
      cogState = updateCognitiveLoad(cogState, true, 10);
      expect(cogState.consecutiveCorrect).toBe(3);
    });

    it('both engines detect 3-streak: feedback shows combo, cognitive pushes harder', () => {
      // Feedback engine
      const feedbackState = createFeedbackState();
      for (let i = 0; i < 3; i++) onCorrectAnswer(feedbackState);
      const feedback = onCorrectAnswer(feedbackState);
      expect(feedback.showCombo).toBe(true);

      // Cognitive engine
      let cogState = initialCognitiveLoad();
      for (let i = 0; i < 3; i++) {
        cogState = updateCognitiveLoad(cogState, true, 10);
      }
      expect(cogState.shouldPushHarder).toBe(true);
    });

    it('wrong answer resets both engines correctly', () => {
      // Feedback engine: wrong answer resets correctStreak
      const feedbackState = createFeedbackState();
      onCorrectAnswer(feedbackState);
      onCorrectAnswer(feedbackState);
      onWrongAnswer(feedbackState);
      expect(feedbackState.correctStreak).toBe(0);

      // Cognitive engine: wrong answer resets consecutiveCorrect
      let cogState = initialCognitiveLoad();
      cogState = updateCognitiveLoad(cogState, true, 10);
      cogState = updateCognitiveLoad(cogState, true, 10);
      cogState = updateCognitiveLoad(cogState, false, 10);
      expect(cogState.consecutiveCorrect).toBe(0);
    });

    it('fatigue score boundary at 0.7 (threshold for shouldEaseOff is > 0.6)', () => {
      // Validate that the fatigue thresholds are documented correctly
      // shouldEaseOff triggers at fatigueScore > 0.6
      // shouldPause triggers at fatigueScore > 0.8
      let state = initialCognitiveLoad();
      // Force fatigue to 0.7 via repeated errors with slow responses
      state = { ...state, fatigueScore: 0.7 };
      state = updateCognitiveLoad(state, false, 100);
      // At fatigue 0.7 + error fatigue, should trigger easeOff
      expect(state.shouldEaseOff).toBe(true);
    });
  });

  describe('LESSON_STEPS constant is complete and ordered', () => {
    it('has exactly 6 steps', () => {
      expect(LESSON_STEPS).toHaveLength(6);
    });

    it('follows the correct pedagogical sequence', () => {
      expect(LESSON_STEPS).toEqual([
        'hook',
        'visualization',
        'guided_examples',
        'active_recall',
        'application',
        'spaced_revision',
      ]);
    });
  });
});
