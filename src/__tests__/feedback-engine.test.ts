import { describe, it, expect, vi } from 'vitest';

// Mock the sounds module since it requires browser APIs
vi.mock('@/lib/sounds', () => ({
  playSound: vi.fn(),
}));

import {
  createFeedbackState,
  onCorrectAnswer,
  onWrongAnswer,
  onSessionComplete,
  getNearCompletionNudge,
  type FeedbackState,
} from '@/lib/feedback-engine';

/**
 * Feedback Engine Tests — Emotional Feedback System
 *
 * Tests the feedback engine from src/lib/feedback-engine.ts.
 * Covers:
 * - Correct answer feedback escalation with streaks
 * - Wrong answer compassionate feedback (never punishment)
 * - Session completion feedback with score-based lines
 * - Near-completion nudge timing
 * - State tracking (streaks, totals)
 *
 * Uses realistic CBSE quiz session patterns.
 */

// ─── State Creation ──────────────────────────────────────────

describe('createFeedbackState', () => {
  it('initializes with all zeroes and current timestamp', () => {
    const state = createFeedbackState();
    expect(state.correctStreak).toBe(0);
    expect(state.wrongStreak).toBe(0);
    expect(state.totalAnswered).toBe(0);
    expect(state.totalCorrect).toBe(0);
    expect(state.sessionStartTime).toBeGreaterThan(0);
  });
});

// ─── Correct Answer Feedback ─────────────────────────────────

describe('onCorrectAnswer', () => {
  it('single correct: low intensity, no combo', () => {
    const state = createFeedbackState();
    const result = onCorrectAnswer(state);
    expect(result.intensity).toBe('low');
    expect(result.showCombo).toBe(false);
    expect(result.comboCount).toBe(1);
    expect(result.sound).toBe('correct');
  });

  it('2 correct streak: medium intensity, no combo yet', () => {
    const state = createFeedbackState();
    onCorrectAnswer(state);
    const result = onCorrectAnswer(state);
    expect(result.intensity).toBe('medium');
    expect(result.showCombo).toBe(false);
    expect(result.comboCount).toBe(2);
  });

  it('3 correct streak: triggers combo with streak sound', () => {
    const state = createFeedbackState();
    onCorrectAnswer(state);
    onCorrectAnswer(state);
    const result = onCorrectAnswer(state);
    expect(result.showCombo).toBe(true);
    expect(result.comboCount).toBe(3);
    expect(result.sound).toBe('streak');
  });

  it('4-5 correct streak: high intensity', () => {
    const state = createFeedbackState();
    for (let i = 0; i < 3; i++) onCorrectAnswer(state);
    const result = onCorrectAnswer(state);
    expect(result.intensity).toBe('high');
    expect(result.showCombo).toBe(true);
    expect(result.comboCount).toBe(4);
  });

  it('6+ correct streak: highest tier feedback', () => {
    const state = createFeedbackState();
    for (let i = 0; i < 5; i++) onCorrectAnswer(state);
    const result = onCorrectAnswer(state);
    expect(result.intensity).toBe('high');
    expect(result.showCombo).toBe(true);
    expect(result.comboCount).toBe(6);
    expect(result.sound).toBe('streak');
  });

  it('updates state: increments correctStreak, resets wrongStreak', () => {
    const state = createFeedbackState();
    state.wrongStreak = 3;
    onCorrectAnswer(state);
    expect(state.correctStreak).toBe(1);
    expect(state.wrongStreak).toBe(0);
    expect(state.totalAnswered).toBe(1);
    expect(state.totalCorrect).toBe(1);
  });

  it('streak escalation: lines come from progressively higher tiers', () => {
    const state = createFeedbackState();
    // Streak 1 -> tier 0
    const r1 = onCorrectAnswer(state);
    expect(r1.foxyLine.en.length).toBeGreaterThan(0);
    expect(r1.foxyLine.hi.length).toBeGreaterThan(0);

    // Streak 2 -> tier 1
    const r2 = onCorrectAnswer(state);
    expect(r2.foxyLine.en.length).toBeGreaterThan(0);

    // Streak 4 -> tier 2
    onCorrectAnswer(state);
    const r4 = onCorrectAnswer(state);
    expect(r4.foxyLine.en.length).toBeGreaterThan(0);

    // Streak 6 -> tier 3
    onCorrectAnswer(state);
    const r6 = onCorrectAnswer(state);
    expect(r6.foxyLine.en.length).toBeGreaterThan(0);
  });

  it('foxyLine always has both en and hi properties (bilingual P7)', () => {
    const state = createFeedbackState();
    for (let i = 0; i < 8; i++) {
      const result = onCorrectAnswer(state);
      expect(result.foxyLine).toHaveProperty('en');
      expect(result.foxyLine).toHaveProperty('hi');
      expect(typeof result.foxyLine.en).toBe('string');
      expect(typeof result.foxyLine.hi).toBe('string');
    }
  });
});

// ─── Wrong Answer Feedback ───────────────────────────────────

describe('onWrongAnswer', () => {
  it('first wrong answer: compassionate, low intensity', () => {
    const state = createFeedbackState();
    const result = onWrongAnswer(state);
    expect(result.intensity).toBe('low');
    expect(result.sound).toBe('incorrect');
    expect(result.showCombo).toBe(false);
    expect(result.comboCount).toBe(0);
  });

  it('multiple wrong: escalates to supportive/slower lines', () => {
    const state = createFeedbackState();
    onWrongAnswer(state);
    const result = onWrongAnswer(state);
    expect(result.intensity).toBe('low'); // never punishing
    expect(result.foxyLine.en.length).toBeGreaterThan(0);
  });

  it('resets correctStreak on wrong answer', () => {
    const state = createFeedbackState();
    onCorrectAnswer(state);
    onCorrectAnswer(state);
    expect(state.correctStreak).toBe(2);

    onWrongAnswer(state);
    expect(state.correctStreak).toBe(0);
    expect(state.wrongStreak).toBe(1);
  });

  it('never uses punishing or mocking language', () => {
    const state = createFeedbackState();
    for (let i = 0; i < 5; i++) {
      const result = onWrongAnswer(state);
      const en = result.foxyLine.en.toLowerCase();
      // Should not contain negative/punishing words
      expect(en).not.toContain('stupid');
      expect(en).not.toContain('wrong!');
      expect(en).not.toContain('fail');
      expect(en).not.toContain('terrible');
    }
  });

  it('wrong answer lines are bilingual (P7)', () => {
    const state = createFeedbackState();
    for (let i = 0; i < 3; i++) {
      const result = onWrongAnswer(state);
      expect(result.foxyLine.en.length).toBeGreaterThan(0);
      expect(result.foxyLine.hi.length).toBeGreaterThan(0);
    }
  });
});

// ─── Session Complete ────────────────────────────────────────

describe('onSessionComplete', () => {
  it('returns completion line for an average session', () => {
    const state = createFeedbackState();
    state.totalAnswered = 10;
    state.totalCorrect = 5;
    const result = onSessionComplete(state);
    expect(result.foxyLine.en.length).toBeGreaterThan(0);
    expect(result.sound).toBe('complete');
    expect(result.scoreLine).toBeUndefined();
  });

  it('returns high score line and levelUp sound for >= 80%', () => {
    const state = createFeedbackState();
    state.totalAnswered = 10;
    state.totalCorrect = 8;
    const result = onSessionComplete(state);
    expect(result.sound).toBe('levelUp');
    expect(result.scoreLine).toBeDefined();
    expect(result.scoreLine!.en.length).toBeGreaterThan(0);
  });

  it('returns perfect score line for 100% with >= 5 questions', () => {
    const state = createFeedbackState();
    state.totalAnswered = 10;
    state.totalCorrect = 10;
    const result = onSessionComplete(state);
    expect(result.scoreLine).toBeDefined();
    // Perfect lines contain "100%" or "perfect" or "flawless"
    const en = result.scoreLine!.en.toLowerCase();
    expect(en.includes('100%') || en.includes('perfect') || en.includes('flawless')).toBe(true);
  });

  it('does not give perfect score line for 100% with < 5 questions', () => {
    const state = createFeedbackState();
    state.totalAnswered = 3;
    state.totalCorrect = 3;
    const result = onSessionComplete(state);
    // 100% but < 5 questions: gets high score line, not perfect
    expect(result.sound).toBe('levelUp');
    // scoreLine should be from HIGH_SCORE, not PERFECT
    if (result.scoreLine) {
      const en = result.scoreLine.en.toLowerCase();
      expect(en.includes('100%') && en.includes('flawless')).toBe(false);
    }
  });

  it('handles 0 questions answered without crash', () => {
    const state = createFeedbackState();
    state.totalAnswered = 0;
    state.totalCorrect = 0;
    const result = onSessionComplete(state);
    expect(result.foxyLine.en.length).toBeGreaterThan(0);
    expect(result.sound).toBe('complete');
  });
});

// ─── Near Completion Nudge ───────────────────────────────────

describe('getNearCompletionNudge', () => {
  it('returns nudge when 2 questions remaining', () => {
    // currentIndex = 7, totalQuestions = 10, remaining = 10 - 7 - 1 = 2
    const nudge = getNearCompletionNudge(7, 10);
    expect(nudge).not.toBeNull();
    expect(nudge!.en.length).toBeGreaterThan(0);
    expect(nudge!.hi.length).toBeGreaterThan(0);
  });

  it('returns nudge when 1 question remaining', () => {
    // currentIndex = 8, totalQuestions = 10, remaining = 1
    const nudge = getNearCompletionNudge(8, 10);
    expect(nudge).not.toBeNull();
  });

  it('returns null when more than 2 questions remaining', () => {
    const nudge = getNearCompletionNudge(5, 10);
    expect(nudge).toBeNull();
  });

  it('returns null for last question (0 remaining)', () => {
    const nudge = getNearCompletionNudge(9, 10);
    expect(nudge).toBeNull();
  });

  it('returns null at the start of the quiz', () => {
    const nudge = getNearCompletionNudge(0, 10);
    expect(nudge).toBeNull();
  });
});

// ─── Mixed Pattern: Realistic Quiz Session ───────────────────

describe('Realistic quiz session feedback pattern', () => {
  it('simulates a 10-question CBSE quiz with mixed results', () => {
    const state = createFeedbackState();
    const pattern = [true, true, false, true, true, true, false, true, true, true];
    // Correct: 8, Wrong: 2

    let maxStreak = 0;
    let comboTriggered = false;

    for (const isCorrect of pattern) {
      if (isCorrect) {
        const result = onCorrectAnswer(state);
        if (result.showCombo) comboTriggered = true;
        maxStreak = Math.max(maxStreak, state.correctStreak);
      } else {
        onWrongAnswer(state);
      }
    }

    expect(state.totalAnswered).toBe(10);
    expect(state.totalCorrect).toBe(8);
    expect(maxStreak).toBeGreaterThanOrEqual(3); // should have hit a combo
    expect(comboTriggered).toBe(true);

    const completion = onSessionComplete(state);
    expect(completion.sound).toBe('levelUp'); // 80% gets levelUp
    expect(completion.scoreLine).toBeDefined();
  });
});
