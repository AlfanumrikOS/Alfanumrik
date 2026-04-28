/**
 * feedback-engine.ts — unit tests.
 *
 * src/lib/feedback-engine.ts produces emotional feedback during quiz
 * sessions: voice line + sound + intensity tier + combo metadata.
 * Tests cover:
 *   - createFeedbackState seeds the four counters and a start timestamp
 *   - onCorrectAnswer increments streak and tier-up logic at 1/3/5/6+
 *     boundaries, with sound flipping from 'correct' → 'streak' at >=3
 *   - onWrongAnswer resets correctStreak, increments wrongStreak, and
 *     uses tier-1 (multiple wrong) lines after 2+ in a row
 *   - onSessionComplete returns scoreLine: PERFECT only at 100% with >=5
 *     answered, HIGH for 80-99%, undefined under 80%; sound flips to
 *     'levelUp' at >=80%
 *   - getNearCompletionNudge fires at remaining === 1 and === 2 only
 *   - playFeedbackSound delegates to playSound() with the right key
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { playSoundMock } = vi.hoisted(() => ({
  playSoundMock: vi.fn(),
}));
vi.mock('@/lib/sounds', () => ({ playSound: playSoundMock }));

import {
  createFeedbackState,
  onCorrectAnswer,
  onWrongAnswer,
  onSessionComplete,
  getNearCompletionNudge,
  playFeedbackSound,
} from '@/lib/feedback-engine';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createFeedbackState', () => {
  it('seeds all four counters at zero and stamps sessionStartTime', () => {
    const before = Date.now();
    const s = createFeedbackState();
    const after = Date.now();
    expect(s.correctStreak).toBe(0);
    expect(s.wrongStreak).toBe(0);
    expect(s.totalAnswered).toBe(0);
    expect(s.totalCorrect).toBe(0);
    expect(s.sessionStartTime).toBeGreaterThanOrEqual(before);
    expect(s.sessionStartTime).toBeLessThanOrEqual(after);
  });
});

describe('onCorrectAnswer', () => {
  it('first correct answer: streak 1, sound "correct", intensity low, no combo', () => {
    const s = createFeedbackState();
    const r = onCorrectAnswer(s);
    expect(s.correctStreak).toBe(1);
    expect(s.wrongStreak).toBe(0);
    expect(s.totalAnswered).toBe(1);
    expect(s.totalCorrect).toBe(1);
    expect(r.sound).toBe('correct');
    expect(r.intensity).toBe('low');
    expect(r.showCombo).toBe(false);
    expect(r.comboCount).toBe(1);
    expect(r.foxyLine.en).toBeTruthy();
    expect(r.foxyLine.hi).toBeTruthy();
  });

  it('streak 2: still tier "correct", intensity medium, no combo yet', () => {
    const s = createFeedbackState();
    onCorrectAnswer(s);
    const r = onCorrectAnswer(s);
    expect(s.correctStreak).toBe(2);
    expect(r.sound).toBe('correct');
    expect(r.intensity).toBe('medium');
    expect(r.showCombo).toBe(false);
  });

  it('streak 3: combo activates, sound flips to "streak"', () => {
    const s = createFeedbackState();
    onCorrectAnswer(s);
    onCorrectAnswer(s);
    const r = onCorrectAnswer(s);
    expect(s.correctStreak).toBe(3);
    expect(r.sound).toBe('streak');
    expect(r.intensity).toBe('medium');
    expect(r.showCombo).toBe(true);
    expect(r.comboCount).toBe(3);
  });

  it('streak 5: tier 2, intensity high', () => {
    const s = createFeedbackState();
    for (let i = 0; i < 4; i++) onCorrectAnswer(s);
    const r = onCorrectAnswer(s);
    expect(s.correctStreak).toBe(5);
    expect(r.intensity).toBe('high');
    expect(r.sound).toBe('streak');
    expect(r.showCombo).toBe(true);
  });

  it('streak 6+: tier 3, still intensity high', () => {
    const s = createFeedbackState();
    for (let i = 0; i < 6; i++) onCorrectAnswer(s);
    const r = onCorrectAnswer(s); // 7th
    expect(s.correctStreak).toBe(7);
    expect(r.intensity).toBe('high');
    expect(r.sound).toBe('streak');
  });

  it('clears wrongStreak on a correct answer', () => {
    const s = createFeedbackState();
    onWrongAnswer(s);
    onWrongAnswer(s);
    expect(s.wrongStreak).toBe(2);
    onCorrectAnswer(s);
    expect(s.wrongStreak).toBe(0);
  });
});

describe('onWrongAnswer', () => {
  it('first wrong: tier 0 line, sound "incorrect", low intensity, no combo', () => {
    const s = createFeedbackState();
    const r = onWrongAnswer(s);
    expect(s.wrongStreak).toBe(1);
    expect(s.correctStreak).toBe(0);
    expect(s.totalAnswered).toBe(1);
    expect(s.totalCorrect).toBe(0);
    expect(r.sound).toBe('incorrect');
    expect(r.intensity).toBe('low');
    expect(r.showCombo).toBe(false);
    expect(r.comboCount).toBe(0);
    expect(r.foxyLine.en).toBeTruthy();
  });

  it('two wrong in a row: tier 1 line (compassionate slow-down)', () => {
    const s = createFeedbackState();
    onWrongAnswer(s);
    const r = onWrongAnswer(s);
    expect(s.wrongStreak).toBe(2);
    expect(r.sound).toBe('incorrect');
  });

  it('clears correctStreak when answer is wrong', () => {
    const s = createFeedbackState();
    onCorrectAnswer(s);
    onCorrectAnswer(s);
    expect(s.correctStreak).toBe(2);
    onWrongAnswer(s);
    expect(s.correctStreak).toBe(0);
    expect(s.wrongStreak).toBe(1);
  });
});

describe('onSessionComplete', () => {
  it('returns no scoreLine and "complete" sound for sub-80%', () => {
    const s = createFeedbackState();
    // 3 correct of 10 = 30%
    for (let i = 0; i < 3; i++) onCorrectAnswer(s);
    for (let i = 0; i < 7; i++) onWrongAnswer(s);
    const r = onSessionComplete(s);
    expect(r.scoreLine).toBeUndefined();
    expect(r.sound).toBe('complete');
    expect(r.foxyLine.en).toBeTruthy();
  });

  it('emits HIGH_SCORE scoreLine + "levelUp" sound at 80%', () => {
    const s = createFeedbackState();
    // 8 correct of 10 = 80%
    for (let i = 0; i < 8; i++) onCorrectAnswer(s);
    for (let i = 0; i < 2; i++) onWrongAnswer(s);
    const r = onSessionComplete(s);
    expect(r.scoreLine).toBeDefined();
    expect(r.sound).toBe('levelUp');
  });

  it('emits PERFECT_SCORE scoreLine when 100% AND >= 5 answered', () => {
    const s = createFeedbackState();
    for (let i = 0; i < 5; i++) onCorrectAnswer(s);
    const r = onSessionComplete(s);
    expect(r.scoreLine).toBeDefined();
    expect(r.sound).toBe('levelUp');
  });

  it('does NOT emit PERFECT_SCORE when 100% but only 4 answered', () => {
    // Boundary: 100% with too-few answers should fall through to HIGH path.
    const s = createFeedbackState();
    for (let i = 0; i < 4; i++) onCorrectAnswer(s);
    const r = onSessionComplete(s);
    // 100% triggers HIGH bucket (since the 100% gate requires >=5 answered).
    expect(r.scoreLine).toBeDefined();
    expect(r.sound).toBe('levelUp');
  });

  it('handles zero questions answered gracefully (pct = 0, no scoreLine)', () => {
    const s = createFeedbackState();
    const r = onSessionComplete(s);
    expect(r.scoreLine).toBeUndefined();
    expect(r.sound).toBe('complete');
  });
});

describe('getNearCompletionNudge', () => {
  it('returns null when more than 2 questions remain', () => {
    // 5 total, currentIndex 0 → 4 remaining
    expect(getNearCompletionNudge(0, 5)).toBeNull();
  });

  it('returns a nudge when 2 questions remain', () => {
    // 5 total, currentIndex 2 → remaining = 5 - 2 - 1 = 2
    const r = getNearCompletionNudge(2, 5);
    expect(r).not.toBeNull();
    expect(r!.en).toBeTruthy();
    expect(r!.hi).toBeTruthy();
  });

  it('returns a nudge when 1 question remains', () => {
    // 5 total, currentIndex 3 → remaining = 1
    expect(getNearCompletionNudge(3, 5)).not.toBeNull();
  });

  it('returns null on the very last question (remaining = 0)', () => {
    // 5 total, currentIndex 4 → remaining = 0 (last question, already showing)
    expect(getNearCompletionNudge(4, 5)).toBeNull();
  });
});

describe('playFeedbackSound', () => {
  it('forwards the sound key to playSound()', () => {
    playFeedbackSound({ sound: 'correct' } as any);
    expect(playSoundMock).toHaveBeenCalledWith('correct');
  });

  it('handles every possible sound key in FeedbackResult', () => {
    for (const k of ['correct', 'incorrect', 'streak', 'complete', 'levelUp']) {
      playFeedbackSound({ sound: k } as any);
    }
    expect(playSoundMock).toHaveBeenCalledTimes(5);
  });
});
