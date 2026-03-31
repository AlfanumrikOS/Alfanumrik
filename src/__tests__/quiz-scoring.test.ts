import { describe, it, expect } from 'vitest';
import {
  XP_RULES,
  XP_PER_LEVEL,
  LEVEL_NAMES,
  calculateLevel,
  xpToNextLevel,
  getLevelName,
} from '@/lib/xp-rules';

/**
 * Quiz Scoring Regression Tests — P1 (Score Accuracy) & P2 (XP Economy)
 *
 * These tests import actual constants and functions from src/lib/xp-rules.ts
 * and verify the scoring formulas match the product invariants defined in CLAUDE.md.
 *
 * P1: score_percent = Math.round((correct_answers / total_questions) * 100)
 * P2: xp_earned = (correct * XP_RULES.quiz_per_correct)
 *              + (score_percent >= 80 ? XP_RULES.quiz_high_score_bonus : 0)
 *              + (score_percent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
 *
 * Regression catalog IDs: score_percent_basic, score_percent_zero,
 * score_percent_perfect, score_percent_rounding, xp_basic, xp_high_score,
 * xp_perfect, xp_daily_cap
 */

// ─── Helper: P1 score formula (must match submitQuizResults in supabase.ts) ──

function calcScorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

// ─── Helper: P2 XP formula using actual XP_RULES constants ──────────────────

function calcXP(correct: number, total: number): number {
  const scorePct = calcScorePercent(correct, total);
  return (correct * XP_RULES.quiz_per_correct)
    + (scorePct >= 80 ? XP_RULES.quiz_high_score_bonus : 0)
    + (scorePct === 100 ? XP_RULES.quiz_perfect_bonus : 0);
}

function applyDailyCap(totalXpEarned: number): number {
  return Math.min(totalXpEarned, XP_RULES.quiz_daily_cap);
}

// ─── P1: Score Percentage ────────────────────────────────────────────────────

describe('P1: Score Percentage Calculation', () => {
  it('score_percent_basic: 7/10 = 70%', () => {
    expect(calcScorePercent(7, 10)).toBe(70);
  });

  it('score_percent_zero: 0 correct out of 10 = 0%', () => {
    expect(calcScorePercent(0, 10)).toBe(0);
  });

  it('score_percent_perfect: all correct = 100%', () => {
    expect(calcScorePercent(10, 10)).toBe(100);
    expect(calcScorePercent(5, 5)).toBe(100);
    expect(calcScorePercent(1, 1)).toBe(100);
    expect(calcScorePercent(20, 20)).toBe(100);
  });

  it('score_percent_rounding: 1/3 rounds to 33, not 33.33', () => {
    expect(calcScorePercent(1, 3)).toBe(33);
    // 2/3 = 66.67 -> rounds to 67
    expect(calcScorePercent(2, 3)).toBe(67);
  });

  it('handles 0 total questions without division by zero', () => {
    expect(calcScorePercent(0, 0)).toBe(0);
  });

  it('handles single question quiz (boundary: 0% or 100% only)', () => {
    expect(calcScorePercent(0, 1)).toBe(0);
    expect(calcScorePercent(1, 1)).toBe(100);
  });

  it('handles odd fractions: 3/7 = 43%', () => {
    // 3/7 = 0.42857 -> Math.round(42.857) = 43
    expect(calcScorePercent(3, 7)).toBe(43);
  });

  it('handles 5/10 = 50%', () => {
    expect(calcScorePercent(5, 10)).toBe(50);
  });

  it('handles large quiz: 47/50 = 94%', () => {
    expect(calcScorePercent(47, 50)).toBe(94);
  });

  it('result is always an integer (no decimals)', () => {
    for (let total = 1; total <= 20; total++) {
      for (let correct = 0; correct <= total; correct++) {
        const score = calcScorePercent(correct, total);
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });
});

// ─── P2: XP Calculation ─────────────────────────────────────────────────────

describe('P2: XP Calculation', () => {
  it('verifies XP_RULES constants match product invariants', () => {
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('xp_basic: 7/10 = 70% -> 7*10 = 70 XP (no bonus)', () => {
    expect(calcXP(7, 10)).toBe(70);
  });

  it('xp_high_score: 8/10 = 80% -> 80 + 20 = 100 XP', () => {
    expect(calcXP(8, 10)).toBe(100);
  });

  it('xp_perfect: 10/10 = 100% -> 100 + 20 + 50 = 170 XP', () => {
    expect(calcXP(10, 10)).toBe(170);
  });

  it('xp_zero: 0 correct = 0 XP, no bonuses', () => {
    expect(calcXP(0, 10)).toBe(0);
  });

  it('79% does not trigger high score bonus', () => {
    // Need to find correct/total that gives exactly 79%
    // 79/100 = 79% but that is large; let us check boundary
    // With rounding: 7/9 = 77.78 -> 78%, 8/10 = 80%
    // Direct: calcScorePercent must be < 80
    const xp79 = calcXP(79, 100);
    expect(xp79).toBe(79 * 10); // 790, no bonus
  });

  it('exactly 80% triggers high score bonus', () => {
    // 4/5 = 80%
    expect(calcScorePercent(4, 5)).toBe(80);
    expect(calcXP(4, 5)).toBe(4 * 10 + 20); // 60
  });

  it('99% gets high score bonus but not perfect bonus', () => {
    // 99/100 = 99%
    expect(calcXP(99, 100)).toBe(99 * 10 + 20); // 1010
  });

  it('perfect score on small quiz: 1/1 = 100% -> 10 + 20 + 50 = 80 XP', () => {
    expect(calcXP(1, 1)).toBe(80);
  });

  it('perfect score on 5 questions: 5/5 = 100% -> 50 + 20 + 50 = 120 XP', () => {
    expect(calcXP(5, 5)).toBe(120);
  });

  it('xp_daily_cap: total capped at 200', () => {
    const quiz1 = calcXP(10, 10); // 170
    const quiz2 = calcXP(10, 10); // 170
    const totalUncapped = quiz1 + quiz2; // 340
    expect(totalUncapped).toBe(340);
    expect(applyDailyCap(totalUncapped)).toBe(200);
  });

  it('exactly 200 XP earned is allowed (not rejected)', () => {
    expect(applyDailyCap(200)).toBe(200);
  });

  it('199 earned + quiz worth 50 -> capped at 200, not rejected', () => {
    const previouslyEarned = 199;
    const newQuizXP = 50;
    const total = previouslyEarned + newQuizXP; // 249
    // Cap means partial award: student gets 200 total, not 0
    expect(applyDailyCap(total)).toBe(200);
  });

  it('XP is never negative', () => {
    expect(calcXP(0, 0)).toBe(0);
    expect(calcXP(0, 1)).toBe(0);
    expect(calcXP(0, 100)).toBe(0);
  });
});

// ─── Level System (from xp-rules.ts) ────────────────────────────────────────

describe('Level System', () => {
  it('XP_PER_LEVEL is 500', () => {
    expect(XP_PER_LEVEL).toBe(500);
  });

  it('calculateLevel returns correct levels', () => {
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(499)).toBe(1);
    expect(calculateLevel(500)).toBe(2);
    expect(calculateLevel(999)).toBe(2);
    expect(calculateLevel(1000)).toBe(3);
    expect(calculateLevel(4999)).toBe(10);
    expect(calculateLevel(5000)).toBe(11);
  });

  it('xpToNextLevel returns correct progress', () => {
    const progress = xpToNextLevel(250);
    expect(progress.current).toBe(250);
    expect(progress.needed).toBe(500);
    expect(progress.progress).toBe(50);
  });

  it('xpToNextLevel at level boundary', () => {
    const progress = xpToNextLevel(500);
    expect(progress.current).toBe(0);
    expect(progress.needed).toBe(500);
    expect(progress.progress).toBe(0);
  });

  it('getLevelName returns correct names', () => {
    expect(getLevelName(1)).toBe('Curious Cub');
    expect(getLevelName(5)).toBe('Smart Fox');
    expect(getLevelName(10)).toBe('Grand Master');
  });

  it('getLevelName returns Grand Master for levels >= 10', () => {
    expect(getLevelName(10)).toBe('Grand Master');
    expect(getLevelName(15)).toBe('Grand Master');
    expect(getLevelName(100)).toBe('Grand Master');
  });

  it('LEVEL_NAMES has entries for levels 1-10', () => {
    for (let i = 1; i <= 10; i++) {
      expect(LEVEL_NAMES[i]).toBeDefined();
      expect(typeof LEVEL_NAMES[i]).toBe('string');
      expect(LEVEL_NAMES[i].length).toBeGreaterThan(0);
    }
  });
});
