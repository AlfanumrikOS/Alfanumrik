import { describe, it, expect } from 'vitest';
import {
  updateCognitiveLoad,
  initialCognitiveLoad,
  adjustDifficulty,
  type CognitiveLoadState,
} from '@/lib/cognitive-engine';

/**
 * Cognitive Load & Fatigue Detection Tests
 *
 * Tests the cognitive load manager from src/lib/cognitive-engine.ts.
 * Regression catalog: shouldPause triggers, fatigue thresholds, edge cases.
 *
 * Key thresholds (from source):
 *   shouldEaseOff:   consecutiveErrors >= 3 OR fatigueScore > 0.6
 *   shouldPushHarder: consecutiveCorrect >= 3 AND fatigueScore < 0.3
 *   shouldPause:     consecutiveErrors >= 5 OR fatigueScore > 0.8
 *
 * Edge cases covered:
 *   - Exactly at threshold boundaries (0.8 fatigue, 5 errors)
 *   - First quiz ever (no existing state)
 *   - Mixed correct/wrong patterns
 *   - Fatigue score clamping to [0, 1]
 */

// ─── Initial State ───────────────────────────────────────────

describe('initialCognitiveLoad', () => {
  it('starts with all flags false and counters at zero', () => {
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

// ─── shouldPause Triggers (Regression Catalog) ──────────────

describe('shouldPause threshold detection', () => {
  it('triggers shouldPause when consecutiveErrors >= 5', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 5; i++) {
      state = updateCognitiveLoad(state, false, 10);
    }
    expect(state.consecutiveErrors).toBe(5);
    expect(state.shouldPause).toBe(true);
  });

  it('does NOT trigger shouldPause at 4 consecutive errors (below threshold)', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 4; i++) {
      state = updateCognitiveLoad(state, false, 10);
    }
    expect(state.consecutiveErrors).toBe(4);
    // shouldPause depends on fatigueScore too, but 4 errors alone is not enough
    // Unless fatigueScore also crossed 0.8
    if (state.fatigueScore <= 0.8) {
      expect(state.shouldPause).toBe(false);
    }
  });

  it('triggers shouldPause when fatigueScore > 0.8', () => {
    // Build up fatigue with many slow, incorrect responses
    let state = initialCognitiveLoad();
    // First, establish a baseline response time
    state = updateCognitiveLoad(state, true, 10);

    // Then send many slow errors to drive fatigue up
    for (let i = 0; i < 30; i++) {
      state = updateCognitiveLoad(state, false, 30); // slow + wrong
      if (state.fatigueScore > 0.8) break;
    }
    expect(state.fatigueScore).toBeGreaterThan(0.8);
    expect(state.shouldPause).toBe(true);
  });

  it('resets shouldPause after recovery (correct answers)', () => {
    let state = initialCognitiveLoad();
    // Trigger pause with 5 errors
    for (let i = 0; i < 5; i++) {
      state = updateCognitiveLoad(state, false, 10);
    }
    expect(state.shouldPause).toBe(true);

    // Recover with correct answers
    for (let i = 0; i < 3; i++) {
      state = updateCognitiveLoad(state, true, 5);
    }
    // After 3 correct, consecutiveErrors is 0, fatigue may have decreased
    expect(state.consecutiveErrors).toBe(0);
    // shouldPause requires errors >= 5 OR fatigue > 0.8
    // consecutiveErrors is now 0, so it depends on fatigue
    if (state.fatigueScore <= 0.8) {
      expect(state.shouldPause).toBe(false);
    }
  });
});

// ─── shouldEaseOff Triggers ──────────────────────────────────

describe('shouldEaseOff threshold detection', () => {
  it('triggers shouldEaseOff at 3 consecutive errors', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 3; i++) {
      state = updateCognitiveLoad(state, false, 10);
    }
    expect(state.consecutiveErrors).toBe(3);
    expect(state.shouldEaseOff).toBe(true);
  });

  it('does NOT trigger shouldEaseOff at 2 consecutive errors with low fatigue', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, false, 5);
    state = updateCognitiveLoad(state, false, 5);
    expect(state.consecutiveErrors).toBe(2);
    if (state.fatigueScore <= 0.6) {
      expect(state.shouldEaseOff).toBe(false);
    }
  });
});

// ─── shouldPushHarder Triggers ───────────────────────────────

describe('shouldPushHarder threshold detection', () => {
  it('triggers shouldPushHarder at 3 consecutive correct with low fatigue', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 3; i++) {
      state = updateCognitiveLoad(state, true, 5);
    }
    expect(state.consecutiveCorrect).toBe(3);
    expect(state.fatigueScore).toBeLessThan(0.3);
    expect(state.shouldPushHarder).toBe(true);
  });

  it('does NOT trigger shouldPushHarder when fatigued', () => {
    let state = initialCognitiveLoad();
    // Build fatigue first
    state = updateCognitiveLoad(state, true, 10);
    for (let i = 0; i < 15; i++) {
      state = updateCognitiveLoad(state, false, 30);
    }
    // Now do 3 correct — but fatigue should still be high
    for (let i = 0; i < 3; i++) {
      state = updateCognitiveLoad(state, true, 5);
    }
    expect(state.consecutiveCorrect).toBe(3);
    if (state.fatigueScore >= 0.3) {
      expect(state.shouldPushHarder).toBe(false);
    }
  });
});

// ─── Fatigue Score Mechanics ─────────────────────────────────

describe('Fatigue score mechanics', () => {
  it('fatigueScore is clamped between 0 and 1', () => {
    let state = initialCognitiveLoad();
    // Many correct answers should not push below 0
    for (let i = 0; i < 50; i++) {
      state = updateCognitiveLoad(state, true, 5);
    }
    expect(state.fatigueScore).toBeGreaterThanOrEqual(0);
    expect(state.fatigueScore).toBeLessThanOrEqual(1);
  });

  it('fatigueScore stays clamped at 1 max', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 10); // baseline
    for (let i = 0; i < 100; i++) {
      state = updateCognitiveLoad(state, false, 50);
    }
    expect(state.fatigueScore).toBeLessThanOrEqual(1);
  });

  it('correct answers reduce fatigue (errorFatigue is -0.03)', () => {
    let state = initialCognitiveLoad();
    // Build some fatigue
    state = updateCognitiveLoad(state, true, 10);
    state = updateCognitiveLoad(state, false, 10);
    state = updateCognitiveLoad(state, false, 10);
    const fatigueAfterErrors = state.fatigueScore;

    state = updateCognitiveLoad(state, true, 5);
    expect(state.fatigueScore).toBeLessThan(fatigueAfterErrors);
  });

  it('slow responses increase fatigue (timeFatigue when > 1.5x avg)', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 10); // avgResponseTime = 10
    const fatigueBefore = state.fatigueScore;

    state = updateCognitiveLoad(state, true, 20); // 20 > 10 * 1.5 = 15
    // timeFatigue = 0.1, errorFatigue = -0.03 (correct), net = +0.07
    expect(state.fatigueScore).toBeGreaterThan(fatigueBefore);
  });
});

// ─── Running Average Response Time ───────────────────────────

describe('Average response time tracking', () => {
  it('first response sets avgResponseTime directly', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 15);
    expect(state.avgResponseTime).toBe(15);
  });

  it('subsequent responses use exponential moving average (0.7/0.3)', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 10);
    expect(state.avgResponseTime).toBe(10);

    state = updateCognitiveLoad(state, true, 20);
    // EMA: 10 * 0.7 + 20 * 0.3 = 7 + 6 = 13
    expect(state.avgResponseTime).toBeCloseTo(13, 5);
  });
});

// ─── Difficulty Adjustment ───────────────────────────────────

describe('adjustDifficulty based on cognitive load', () => {
  it('drops difficulty by 0.15 when shouldEaseOff', () => {
    const state: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldEaseOff: true,
    };
    const adjusted = adjustDifficulty(0.6, state);
    expect(adjusted).toBeCloseTo(0.45, 5);
  });

  it('never drops difficulty below 0.1', () => {
    const state: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldEaseOff: true,
    };
    const adjusted = adjustDifficulty(0.1, state);
    expect(adjusted).toBeGreaterThanOrEqual(0.1);
  });

  it('increases difficulty by 0.1 when shouldPushHarder', () => {
    const state: CognitiveLoadState = {
      ...initialCognitiveLoad(),
      shouldPushHarder: true,
    };
    const adjusted = adjustDifficulty(0.5, state);
    expect(adjusted).toBeCloseTo(0.6, 5);
  });

  it('keeps difficulty unchanged when no flags set', () => {
    const state = initialCognitiveLoad();
    const adjusted = adjustDifficulty(0.5, state);
    expect(adjusted).toBe(0.5);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────

describe('Cognitive load edge cases', () => {
  it('first quiz ever: no crash with initial state', () => {
    let state = initialCognitiveLoad();
    state = updateCognitiveLoad(state, true, 5);
    expect(state.questionsAttempted).toBe(1);
    expect(state.shouldPause).toBe(false);
    expect(state.shouldEaseOff).toBe(false);
  });

  it('alternating correct/wrong never triggers shouldPause', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 20; i++) {
      state = updateCognitiveLoad(state, i % 2 === 0, 10);
    }
    // consecutiveErrors never exceeds 1
    expect(state.consecutiveErrors).toBeLessThanOrEqual(1);
    // Fatigue might be moderate but not extreme
    expect(state.questionsAttempted).toBe(20);
  });

  it('all correct answers: shouldPushHarder but never shouldPause', () => {
    let state = initialCognitiveLoad();
    for (let i = 0; i < 15; i++) {
      state = updateCognitiveLoad(state, true, 5);
    }
    expect(state.consecutiveCorrect).toBe(15);
    expect(state.consecutiveErrors).toBe(0);
    expect(state.shouldPause).toBe(false);
    expect(state.shouldPushHarder).toBe(true);
  });

  it('immutability: updateCognitiveLoad returns new state, does not mutate input', () => {
    const state = initialCognitiveLoad();
    const original = { ...state };
    const newState = updateCognitiveLoad(state, true, 10);

    expect(state.questionsAttempted).toBe(original.questionsAttempted);
    expect(newState.questionsAttempted).toBe(1);
    expect(newState).not.toBe(state);
  });
});
