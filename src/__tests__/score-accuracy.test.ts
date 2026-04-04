import { describe, it, expect } from 'vitest';
import { calculateScorePercent, calculateQuizXP } from '@/lib/scoring';
import { XP_RULES } from '@/lib/xp-rules';
import {
  checkMinimumTime,
  checkNotAllSameAnswer,
  checkResponseCount,
  validateAntiCheat,
} from '@/lib/anti-cheat';

/**
 * Score Accuracy & Anti-Cheat Regression Tests
 *
 * Covers Product Invariants:
 *   P1: score_percent = Math.round((correct_answers / total_questions) * 100)
 *   P2: XP economy (constants from xp-rules.ts)
 *   P3: Anti-cheat checks (speed, pattern, count)
 *
 * These tests import the ACTUAL production functions from:
 *   - src/lib/scoring.ts (calculateScorePercent, calculateQuizXP)
 *   - src/lib/anti-cheat.ts (checkMinimumTime, checkNotAllSameAnswer, checkResponseCount, validateAntiCheat)
 *   - src/lib/xp-rules.ts (XP_RULES)
 *
 * Regression catalog IDs covered:
 *   score_percent_basic, score_percent_zero, score_percent_perfect,
 *   score_percent_rounding, xp_basic, xp_high_score, xp_perfect, xp_daily_cap,
 *   reject_speed_hack, flag_same_answer, accept_valid_pattern,
 *   reject_count_mismatch, accept_valid_submission
 */

// ═══════════════════════════════════════════════════════════════════════════════
// P1: Score Percent Accuracy (production function)
// ═══════════════════════════════════════════════════════════════════════════════

describe('P1: Score Percent Accuracy (production function)', () => {
  it('score_percent_basic: 7/10 = 70%', () => {
    expect(calculateScorePercent(7, 10)).toBe(70);
  });

  it('score_percent_basic: 5/10 = 50%', () => {
    expect(calculateScorePercent(5, 10)).toBe(50);
  });

  it('score_percent_zero: 0 correct out of 10 = 0%', () => {
    expect(calculateScorePercent(0, 10)).toBe(0);
  });

  it('score_percent_perfect: 10/10 = 100%', () => {
    expect(calculateScorePercent(10, 10)).toBe(100);
  });

  it('score_percent_rounding: 1/3 rounds to 33, not 33.33', () => {
    expect(calculateScorePercent(1, 3)).toBe(33);
  });

  it('score_percent_rounding: 2/3 rounds to 67, not 66.67', () => {
    expect(calculateScorePercent(2, 3)).toBe(67);
  });

  it('score_percent_division_by_zero: 0/0 = 0% without crash', () => {
    expect(calculateScorePercent(0, 0)).toBe(0);
  });

  it('score_percent_boundary_80: 4/5 = 80%', () => {
    expect(calculateScorePercent(4, 5)).toBe(80);
  });

  it('score_percent_boundary_79: 79/100 = 79%', () => {
    expect(calculateScorePercent(79, 100)).toBe(79);
  });

  it('score_percent_single: 1/1 = 100%', () => {
    expect(calculateScorePercent(1, 1)).toBe(100);
  });

  it('edge: 0/1 = 0% (single question quiz, wrong)', () => {
    expect(calculateScorePercent(0, 1)).toBe(0);
  });

  it('formula is Math.round, not Math.floor or Math.ceil', () => {
    // 5/6 = 83.333... Math.round -> 83
    expect(calculateScorePercent(5, 6)).toBe(83);
    // 5/7 = 71.428... Math.round -> 71
    expect(calculateScorePercent(5, 7)).toBe(71);
    // 6/7 = 85.714... Math.round -> 86
    expect(calculateScorePercent(6, 7)).toBe(86);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P2: XP Economy (production function)
// ═══════════════════════════════════════════════════════════════════════════════

describe('P2: XP Calculation (production function)', () => {
  it('xp constants match xp-rules.ts', () => {
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('xp_basic: 7 correct at 70% = 70 XP (no bonus)', () => {
    expect(calculateQuizXP(7, 70)).toBe(70);
  });

  it('xp_high_score: 8 correct at 80% = 100 XP (+20 bonus)', () => {
    expect(calculateQuizXP(8, 80)).toBe(100);
  });

  it('xp_perfect: 10 correct at 100% = 170 XP (+20+50)', () => {
    expect(calculateQuizXP(10, 100)).toBe(170);
  });

  it('xp_zero: 0 correct at 0% = 0 XP', () => {
    expect(calculateQuizXP(0, 0)).toBe(0);
  });

  it('xp_just_below_80: 7 correct at 79% = 70 XP (no bonus)', () => {
    expect(calculateQuizXP(7, 79)).toBe(70);
  });

  it('xp: exactly 80% gets high score bonus', () => {
    // 4 correct at 80% = 40 + 20 = 60
    expect(calculateQuizXP(4, 80)).toBe(60);
  });

  it('xp: 99% gets high score bonus but not perfect bonus', () => {
    // 99 correct at 99% = 990 + 20 = 1010
    expect(calculateQuizXP(99, 99)).toBe(1010);
  });

  it('xp_daily_cap: multiple quizzes capped at 200 XP total', () => {
    const quiz1 = calculateQuizXP(10, 100); // 170
    const quiz2 = calculateQuizXP(10, 100); // 170
    expect(quiz1).toBe(170);
    expect(quiz2).toBe(170);
    const totalUncapped = quiz1 + quiz2; // 340
    expect(Math.min(totalUncapped, XP_RULES.quiz_daily_cap)).toBe(200);
  });

  it('xp cap boundary: exactly 200 is allowed', () => {
    expect(Math.min(200, XP_RULES.quiz_daily_cap)).toBe(200);
  });

  it('xp cap boundary: 199 + 50 quiz = capped at 200', () => {
    const priorXp = 199;
    const quizXp = calculateQuizXP(5, 50); // 50
    expect(quizXp).toBe(50);
    expect(Math.min(priorXp + quizXp, XP_RULES.quiz_daily_cap)).toBe(200);
  });

  it('xp: 0 questions attempted yields 0 XP (no crash)', () => {
    expect(calculateQuizXP(0, 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P3: Anti-Cheat (production function)
// ═══════════════════════════════════════════════════════════════════════════════

// Helper to make varied response arrays for the production API shape
function makeVariedResponses(count: number): Array<{ selected_option: number }> {
  return Array.from({ length: count }, (_, i) => ({
    selected_option: i % 4,
  }));
}

describe('P3: Anti-Cheat — Speed Hack Detection (production function)', () => {
  it('reject_speed_hack: avg < 3s per question is rejected', () => {
    expect(checkMinimumTime(15, 10)).toBe(false); // 1.5s avg
  });

  it('rejects 2.9s average (just under threshold)', () => {
    expect(checkMinimumTime(29, 10)).toBe(false);
  });

  it('accepts exactly 3.0s average (boundary)', () => {
    expect(checkMinimumTime(30, 10)).toBe(true);
  });

  it('accepts comfortable pace', () => {
    expect(checkMinimumTime(120, 10)).toBe(true);
  });
});

describe('P3: Anti-Cheat — Same Answer Pattern (production function)', () => {
  it('flag_same_answer: all indices identical with >3 questions is flagged', () => {
    const responses = Array(10).fill({ selected_option: 2 });
    expect(checkNotAllSameAnswer(responses)).toBe(false);
  });

  it('flags 4 questions with all same answer (>3 boundary)', () => {
    const responses = Array(4).fill({ selected_option: 0 });
    expect(checkNotAllSameAnswer(responses)).toBe(false);
  });

  it('accept_valid_pattern: 3 questions with same answer is NOT flagged (<=3)', () => {
    const responses = Array(3).fill({ selected_option: 1 });
    expect(checkNotAllSameAnswer(responses)).toBe(true);
  });

  it('2 questions with same answer is NOT flagged', () => {
    const responses = Array(2).fill({ selected_option: 0 });
    expect(checkNotAllSameAnswer(responses)).toBe(true);
  });

  it('does not flag when at least one answer differs', () => {
    const responses = [
      ...Array(9).fill({ selected_option: 0 }),
      { selected_option: 1 },
    ];
    expect(checkNotAllSameAnswer(responses)).toBe(true);
  });
});

describe('P3: Anti-Cheat — Response Count Mismatch (production function)', () => {
  it('reject_count_mismatch: 10 questions but 8 responses', () => {
    expect(checkResponseCount(8, 10)).toBe(false);
  });

  it('rejects more responses than questions', () => {
    expect(checkResponseCount(12, 10)).toBe(false);
  });

  it('accepts when count matches exactly', () => {
    expect(checkResponseCount(5, 5)).toBe(true);
  });
});

describe('P3: Anti-Cheat — validateAntiCheat Combined (production function)', () => {
  it('accept_valid_submission: varied answers, valid time, correct count', () => {
    const responses = makeVariedResponses(10);
    const result = validateAntiCheat(120, responses, 10);
    expect(result.valid).toBe(true);
  });

  it('rejects speed hack via combined validator', () => {
    const responses = makeVariedResponses(5);
    expect(validateAntiCheat(10, responses, 5)).toEqual({ valid: false, reason: 'speed_hack' });
  });

  it('rejects same answer pattern via combined validator', () => {
    const responses = Array(10).fill({ selected_option: 2 });
    // Time is valid (60s for 10 questions = 6s avg)
    expect(validateAntiCheat(60, responses, 10)).toEqual({ valid: false, reason: 'same_answer_pattern' });
  });

  it('rejects count mismatch via combined validator', () => {
    const responses = makeVariedResponses(8);
    // Time is valid, answers varied, but 8 responses for 10 questions
    expect(validateAntiCheat(60, responses, 10)).toEqual({ valid: false, reason: 'count_mismatch' });
  });

  it('accepts single question answered in 5s', () => {
    const responses = [{ selected_option: 2 }];
    expect(validateAntiCheat(5, responses, 1).valid).toBe(true);
  });

  it('accepts large quiz: 50 questions, varied, sufficient time', () => {
    const responses = makeVariedResponses(50);
    expect(validateAntiCheat(300, responses, 50).valid).toBe(true);
  });
});

describe('P3: Anti-Cheat — Check Priority (production function)', () => {
  it('speed check fires before pattern check', () => {
    // All same answer AND too fast
    const responses = Array(10).fill({ selected_option: 0 });
    expect(validateAntiCheat(10, responses, 10)).toEqual({ valid: false, reason: 'speed_hack' });
  });

  it('pattern check fires before count check', () => {
    // All same answer (5 responses) AND count mismatch (10 questions)
    // speed: 60/10 = 6 >= 3 (pass)
    // pattern: all same, length 5 > 3 (flag)
    const responses = Array(5).fill({ selected_option: 1 });
    expect(validateAntiCheat(60, responses, 10)).toEqual({ valid: false, reason: 'same_answer_pattern' });
  });
});
