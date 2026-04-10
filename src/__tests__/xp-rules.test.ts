import { describe, it, expect } from 'vitest';
import {
  XP_RULES,
  XP_PER_LEVEL,
  calculateLevel,
  xpToNextLevel,
  getLevelName,
  LEVEL_NAMES,
  XP_REWARDS,
} from '@/lib/xp-rules';

/**
 * XP Rules Regression Tests — Product Invariant P2 (XP Economy)
 *
 * Directly tests constants and functions exported from src/lib/xp-rules.ts.
 * These are regression tests for the catalog entries:
 *   xp_basic, xp_high_score, xp_perfect, xp_daily_cap
 *
 * P2 formula:
 *   xp_earned = (correct * XP_RULES.quiz_per_correct)
 *             + (score_percent >= 80 ? XP_RULES.quiz_high_score_bonus : 0)
 *             + (score_percent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
 *
 * P1 score formula (used to derive score_percent):
 *   score_percent = Math.round((correct_answers / total_questions) * 100)
 */

// ---- Replicated formulas from submitQuizResults (src/lib/supabase.ts) ----

function scorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function quizXP(correct: number, total: number): number {
  const pct = scorePercent(correct, total);
  return (
    correct * XP_RULES.quiz_per_correct +
    (pct >= 80 ? XP_RULES.quiz_high_score_bonus : 0) +
    (pct === 100 ? XP_RULES.quiz_perfect_bonus : 0)
  );
}

function applyCap(earned: number, alreadyToday: number): number {
  const remaining = Math.max(0, XP_RULES.quiz_daily_cap - alreadyToday);
  return Math.min(earned, remaining);
}

// ---- P2 Constants ----

describe('P2: XP_RULES constants', () => {
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

// ---- P2: XP Earned per Quiz ----

describe('P2: XP earned per quiz', () => {
  it('0 correct out of 10 -> 0 XP (no base, no bonus)', () => {
    expect(quizXP(0, 10)).toBe(0);
  });

  it('5 correct out of 10 (50%) -> 5 * 10 = 50 XP only, no bonus', () => {
    const xp = quizXP(5, 10);
    expect(xp).toBe(5 * XP_RULES.quiz_per_correct);
    expect(xp).toBe(50);
  });

  it('8 correct out of 10 (80%) -> 8 * 10 + 20 = 100 XP (high score bonus)', () => {
    const pct = scorePercent(8, 10);
    expect(pct).toBe(80);
    const xp = quizXP(8, 10);
    expect(xp).toBe(8 * XP_RULES.quiz_per_correct + XP_RULES.quiz_high_score_bonus);
    expect(xp).toBe(100);
  });

  it('10 correct out of 10 (100%) -> 10 * 10 + 20 + 50 = 170 XP (both bonuses)', () => {
    const pct = scorePercent(10, 10);
    expect(pct).toBe(100);
    const xp = quizXP(10, 10);
    expect(xp).toBe(
      10 * XP_RULES.quiz_per_correct +
      XP_RULES.quiz_high_score_bonus +
      XP_RULES.quiz_perfect_bonus
    );
    expect(xp).toBe(170);
  });

  it('7 correct out of 10 (70%) -> 70 XP, no bonus (below 80% threshold)', () => {
    const xp = quizXP(7, 10);
    expect(xp).toBe(70);
  });

  it('9 correct out of 10 (90%) -> 90 + 20 = 110 XP (high score, no perfect)', () => {
    const xp = quizXP(9, 10);
    expect(xp).toBe(110);
  });

  it('79% does not trigger high score bonus', () => {
    // 11/14 = Math.round(78.57) = 79%
    const pct = scorePercent(11, 14);
    expect(pct).toBe(79);
    expect(quizXP(11, 14)).toBe(11 * 10); // 110, no bonus
  });

  it('exactly 80% triggers high score bonus', () => {
    // 4/5 = 80%
    const pct = scorePercent(4, 5);
    expect(pct).toBe(80);
    expect(quizXP(4, 5)).toBe(4 * 10 + 20); // 60
  });

  it('0 total questions does not crash (division by zero guard)', () => {
    expect(quizXP(0, 0)).toBe(0);
  });

  it('1-question quiz perfect: 1/1 = 100% -> 10 + 20 + 50 = 80 XP', () => {
    expect(quizXP(1, 1)).toBe(80);
  });

  it('1-question quiz zero: 0/1 = 0% -> 0 XP', () => {
    expect(quizXP(0, 1)).toBe(0);
  });
});

// ---- P2: Daily XP Cap ----

describe('P2: Daily quiz XP cap', () => {
  it('daily cap is 200 XP', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('allows full XP when nothing earned today', () => {
    expect(applyCap(170, 0)).toBe(170);
  });

  it('caps to remaining allowance when approaching limit', () => {
    // 199 earned + quiz worth 50 -> should award only 1 more
    expect(applyCap(50, 199)).toBe(1);
  });

  it('allows exactly 200 at boundary (off-by-one check)', () => {
    expect(applyCap(200, 0)).toBe(200);
    expect(applyCap(100, 100)).toBe(100); // 100 + 100 = 200, allowed
  });

  it('returns 0 when already at cap', () => {
    expect(applyCap(50, 200)).toBe(0);
  });

  it('returns 0 when already over cap', () => {
    expect(applyCap(50, 250)).toBe(0);
  });

  it('multiple quizzes accumulate correctly then cap', () => {
    let totalToday = 0;
    const quizResults = [
      { correct: 10, total: 10 }, // 170 XP (perfect)
      { correct: 10, total: 10 }, // 170 XP (would exceed)
      { correct: 5, total: 10 },  // 50 XP (would exceed)
    ];
    const awarded: number[] = [];

    for (const q of quizResults) {
      const raw = quizXP(q.correct, q.total);
      const capped = applyCap(raw, totalToday);
      awarded.push(capped);
      totalToday += capped;
    }

    expect(totalToday).toBe(200);
    expect(awarded[0]).toBe(170); // full first quiz
    expect(awarded[1]).toBe(30);  // partial second quiz (200 - 170 = 30)
    expect(awarded[2]).toBe(0);   // nothing left
  });
});

// ---- Level Calculation ----

describe('calculateLevel', () => {
  it('0 XP = level 1', () => {
    expect(calculateLevel(0)).toBe(1);
  });

  it('499 XP = level 1', () => {
    expect(calculateLevel(499)).toBe(1);
  });

  it('500 XP = level 2', () => {
    expect(calculateLevel(500)).toBe(2);
  });

  it('1000 XP = level 3', () => {
    expect(calculateLevel(1000)).toBe(3);
  });

  it('formula: floor(xp / 500) + 1', () => {
    for (const xp of [0, 1, 250, 499, 500, 501, 999, 1000, 2500, 4999, 5000]) {
      expect(calculateLevel(xp)).toBe(Math.floor(xp / 500) + 1);
    }
  });
});

// ---- xpToNextLevel ----

describe('xpToNextLevel', () => {
  it('0 XP: 0 progress', () => {
    const r = xpToNextLevel(0);
    expect(r.current).toBe(0);
    expect(r.needed).toBe(500);
    expect(r.progress).toBe(0);
  });

  it('250 XP: 50% progress', () => {
    const r = xpToNextLevel(250);
    expect(r.current).toBe(250);
    expect(r.progress).toBe(50);
  });

  it('500 XP: 0% progress (just leveled up)', () => {
    const r = xpToNextLevel(500);
    expect(r.current).toBe(0);
    expect(r.progress).toBe(0);
  });
});

// ---- Level Names ----

describe('getLevelName', () => {
  it('all 10 level names are defined and non-empty', () => {
    for (let i = 1; i <= 10; i++) {
      expect(LEVEL_NAMES[i]).toBeDefined();
      expect(LEVEL_NAMES[i].length).toBeGreaterThan(0);
    }
  });

  it('level 1 = Curious Cub', () => {
    expect(getLevelName(1)).toBe('Curious Cub');
  });

  it('level 10 = Grand Master', () => {
    expect(getLevelName(10)).toBe('Grand Master');
  });

  it('levels above 10 return Grand Master', () => {
    expect(getLevelName(15)).toBe('Grand Master');
    expect(getLevelName(100)).toBe('Grand Master');
  });
});

// ---- XP Rewards Catalog ----

describe('XP Rewards catalog', () => {
  it('all rewards have positive costs', () => {
    for (const reward of XP_REWARDS) {
      expect(reward.cost).toBeGreaterThan(0);
    }
  });

  it('all rewards have bilingual names', () => {
    for (const reward of XP_REWARDS) {
      expect(reward.name.length).toBeGreaterThan(0);
      expect(reward.nameHi.length).toBeGreaterThan(0);
    }
  });
});
