import { describe, it, expect } from 'vitest';
import {
  XP_RULES,
  XP_PER_LEVEL,
  calculateLevel,
  xpToNextLevel,
  getLevelName,
  LEVEL_NAMES,
} from '@/lib/xp-rules';

/**
 * XP Calculation Tests (P2: XP Economy)
 *
 * Tests the XP rules from src/lib/xp-rules.ts and the XP calculation
 * formula used in submitQuizResults (src/lib/supabase.ts).
 */

// ─── Replicated XP calculation from submitQuizResults ───────────────────

function calculateQuizXP(correct: number, total: number): number {
  const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    correct * XP_RULES.quiz_per_correct +
    (scorePct >= 80 ? XP_RULES.quiz_high_score_bonus : 0) +
    (scorePct === 100 ? XP_RULES.quiz_perfect_bonus : 0)
  );
}

function applyDailyCap(xpEarned: number, xpAlreadyToday: number): number {
  const remaining = Math.max(0, XP_RULES.quiz_daily_cap - xpAlreadyToday);
  return Math.min(xpEarned, remaining);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('XP Rules Constants', () => {
  it('quiz_per_correct is 10', () => {
    expect(XP_RULES.quiz_per_correct).toBe(10);
  });

  it('quiz_high_score_bonus is 20', () => {
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
  });

  it('quiz_perfect_bonus is 50', () => {
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
  });

  it('quiz_daily_cap is 200', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('XP_PER_LEVEL is 500', () => {
    expect(XP_PER_LEVEL).toBe(500);
  });
});

describe('XP Calculation (P2)', () => {

  it('base XP: 7 correct = 70 XP, no bonus at 70% (xp_basic)', () => {
    const xp = calculateQuizXP(7, 10);
    expect(xp).toBe(7 * 10); // 70 XP, no bonus
    expect(xp).toBe(70);
  });

  it('high score bonus: 8/10 = 80% -> 80 + 20 = 100 XP (xp_high_score)', () => {
    const xp = calculateQuizXP(8, 10);
    expect(xp).toBe(8 * 10 + 20); // 80 base + 20 bonus
    expect(xp).toBe(100);
  });

  it('perfect bonus: 10/10 = 100% -> 100 + 20 + 50 = 170 XP (xp_perfect)', () => {
    const xp = calculateQuizXP(10, 10);
    expect(xp).toBe(10 * 10 + 20 + 50); // 100 base + 20 high score + 50 perfect
    expect(xp).toBe(170);
  });

  it('zero correct: 0/10 = 0 XP', () => {
    const xp = calculateQuizXP(0, 10);
    expect(xp).toBe(0);
  });

  it('no bonus at 79%: 79% < 80% threshold', () => {
    // 4/5 = 80%, 3/5 = 60% — use a case that rounds to 79
    // 11/14 = Math.round(78.57) = 79
    const xp = calculateQuizXP(11, 14);
    const scorePct = Math.round((11 / 14) * 100);
    expect(scorePct).toBe(79);
    expect(xp).toBe(11 * 10); // no bonus
    expect(xp).toBe(110);
  });

  it('bonus at exactly 80%: 8/10 = 80%', () => {
    const scorePct = Math.round((8 / 10) * 100);
    expect(scorePct).toBe(80);
    const xp = calculateQuizXP(8, 10);
    expect(xp).toBe(80 + 20); // base + high score bonus
  });

  it('high score bonus but not perfect: 9/10 = 90%', () => {
    const xp = calculateQuizXP(9, 10);
    expect(xp).toBe(9 * 10 + 20); // 90 + 20 = 110, no perfect bonus
    expect(xp).toBe(110);
  });

  it('zero total questions does not crash', () => {
    const xp = calculateQuizXP(0, 0);
    expect(xp).toBe(0);
  });

  it('1 question quiz: 1/1 = perfect', () => {
    const xp = calculateQuizXP(1, 1);
    expect(xp).toBe(1 * 10 + 20 + 50); // 10 + 20 + 50 = 80
    expect(xp).toBe(80);
  });

  it('1 question quiz: 0/1 = zero XP', () => {
    const xp = calculateQuizXP(0, 1);
    expect(xp).toBe(0);
  });

  it('XP formula matches P2 invariant exactly', () => {
    // P2: xp = (correct * 10) + (>=80% ? 20 : 0) + (100% ? 50 : 0)
    for (const [correct, total] of [[3, 10], [8, 10], [10, 10], [0, 5], [5, 5]]) {
      const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0;
      const expected =
        correct * 10 +
        (scorePct >= 80 ? 20 : 0) +
        (scorePct === 100 ? 50 : 0);
      expect(calculateQuizXP(correct, total)).toBe(expected);
    }
  });
});

describe('XP Daily Cap (xp_daily_cap)', () => {

  it('caps at 200 XP total per day', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('allows full XP when under cap', () => {
    const earned = applyDailyCap(170, 0);
    expect(earned).toBe(170);
  });

  it('caps XP when exceeding daily limit (xp_daily_cap regression)', () => {
    // 199 earned + quiz worth 50 -> should cap at 200 (allow only 1 more)
    const earned = applyDailyCap(50, 199);
    expect(earned).toBe(1);
  });

  it('allows exactly 200 at boundary (off-by-one check)', () => {
    const earned = applyDailyCap(100, 100);
    expect(earned).toBe(100); // 100 + 100 = 200, exactly at cap
  });

  it('returns 0 when already at cap', () => {
    const earned = applyDailyCap(170, 200);
    expect(earned).toBe(0);
  });

  it('returns 0 when already over cap', () => {
    const earned = applyDailyCap(50, 250);
    expect(earned).toBe(0);
  });

  it('multiple quizzes capped at 200 total', () => {
    let totalToday = 0;
    const quizXPs = [170, 100, 50]; // Total attempted: 320
    const actualEarned: number[] = [];

    for (const xp of quizXPs) {
      const earned = applyDailyCap(xp, totalToday);
      actualEarned.push(earned);
      totalToday += earned;
    }

    expect(totalToday).toBe(200);
    expect(actualEarned[0]).toBe(170); // first quiz: full
    expect(actualEarned[1]).toBe(30);  // second quiz: capped to remaining 30
    expect(actualEarned[2]).toBe(0);   // third quiz: nothing left
  });
});

describe('Level Calculation', () => {

  it('0 XP = level 1', () => {
    expect(calculateLevel(0)).toBe(1);
  });

  it('499 XP = level 1', () => {
    expect(calculateLevel(499)).toBe(1);
  });

  it('500 XP = level 2', () => {
    expect(calculateLevel(500)).toBe(2);
  });

  it('999 XP = level 2', () => {
    expect(calculateLevel(999)).toBe(2);
  });

  it('1000 XP = level 3', () => {
    expect(calculateLevel(1000)).toBe(3);
  });

  it('4500 XP = level 10', () => {
    expect(calculateLevel(4500)).toBe(10);
  });

  it('level = floor(xp/500) + 1', () => {
    expect(calculateLevel(1234)).toBe(Math.floor(1234 / 500) + 1);
  });
});

describe('XP to Next Level', () => {

  it('0 XP: 0/500 progress, 0%', () => {
    const result = xpToNextLevel(0);
    expect(result.current).toBe(0);
    expect(result.needed).toBe(500);
    expect(result.progress).toBe(0);
  });

  it('250 XP: 250/500 progress, 50%', () => {
    const result = xpToNextLevel(250);
    expect(result.current).toBe(250);
    expect(result.needed).toBe(500);
    expect(result.progress).toBe(50);
  });

  it('500 XP: 0/500 progress (just leveled up)', () => {
    const result = xpToNextLevel(500);
    expect(result.current).toBe(0);
    expect(result.progress).toBe(0);
  });

  it('750 XP: 250/500 progress', () => {
    const result = xpToNextLevel(750);
    expect(result.current).toBe(250);
    expect(result.progress).toBe(50);
  });
});

describe('Level Names', () => {

  it('level 1 = Curious Cub', () => {
    expect(getLevelName(1)).toBe('Curious Cub');
  });

  it('level 10 = Grand Master', () => {
    expect(getLevelName(10)).toBe('Grand Master');
  });

  it('level > 10 returns Grand Master', () => {
    expect(getLevelName(15)).toBe('Grand Master');
    expect(getLevelName(100)).toBe('Grand Master');
  });

  it('all 10 level names exist', () => {
    for (let i = 1; i <= 10; i++) {
      expect(LEVEL_NAMES[i]).toBeDefined();
      expect(typeof LEVEL_NAMES[i]).toBe('string');
    }
  });
});
