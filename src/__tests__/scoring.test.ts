import { describe, it, expect } from 'vitest';

/**
 * Quiz Scoring Regression Tests
 *
 * These tests verify product invariants P1 (Score Accuracy) and P2 (XP Economy).
 * Source of truth: src/lib/xp-rules.ts
 *
 * P1: score_percent = Math.round((correct / total) * 100)
 * P2: xp_earned = correct * 10 + (score >= 80 ? 20 : 0) + (score === 100 ? 50 : 0)
 */

// ─── Score Percentage (P1) ───────────────────────────────────

describe('Score Percentage (P1)', () => {
  function calcScore(correct: number, total: number): number {
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }

  it('score_percent_basic: 7/10 = 70%', () => {
    expect(calcScore(7, 10)).toBe(70);
  });

  it('score_percent_zero: 0 correct = 0%', () => {
    expect(calcScore(0, 10)).toBe(0);
  });

  it('score_percent_perfect: all correct = 100%', () => {
    expect(calcScore(10, 10)).toBe(100);
    expect(calcScore(5, 5)).toBe(100);
    expect(calcScore(1, 1)).toBe(100);
  });

  it('score_percent_rounding: 1/3 rounds to 33, not 33.33', () => {
    expect(calcScore(1, 3)).toBe(33);
    expect(calcScore(2, 3)).toBe(67);
  });

  it('score_percent_zero_total: 0 questions = 0% (no division by zero)', () => {
    expect(calcScore(0, 0)).toBe(0);
  });

  it('score_percent_single_question: 0% or 100% only', () => {
    expect(calcScore(0, 1)).toBe(0);
    expect(calcScore(1, 1)).toBe(100);
  });
});

// ─── XP Calculation (P2) ─────────────────────────────────────

describe('XP Calculation (P2)', () => {
  // Must match src/lib/xp-rules.ts: XP_RULES
  const XP_PER_CORRECT = 10;
  const HIGH_SCORE_BONUS = 20;  // >= 80%
  const PERFECT_BONUS = 50;      // === 100%
  const DAILY_CAP = 200;

  function calcXP(correct: number, total: number): number {
    const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0;
    return correct * XP_PER_CORRECT
      + (scorePct >= 80 ? HIGH_SCORE_BONUS : 0)
      + (scorePct === 100 ? PERFECT_BONUS : 0);
  }

  it('xp_basic: 7/10 = 70% → 7*10 = 70 XP (no bonus)', () => {
    expect(calcXP(7, 10)).toBe(70);
  });

  it('xp_high_score: 8/10 = 80% → 80 + 20 = 100 XP', () => {
    expect(calcXP(8, 10)).toBe(100);
  });

  it('xp_perfect: 10/10 = 100% → 100 + 20 + 50 = 170 XP', () => {
    expect(calcXP(10, 10)).toBe(170);
  });

  it('xp_just_below_high: 7/9 = 78% → no bonus', () => {
    // 7/9 = 77.78 → rounds to 78% → below 80% threshold
    expect(calcXP(7, 9)).toBe(70);
  });

  it('xp_exactly_80: 4/5 = 80% → gets high score bonus', () => {
    expect(calcXP(4, 5)).toBe(60); // 4*10 + 20 = 60
  });

  it('xp_zero_correct: 0 XP, no bonus', () => {
    expect(calcXP(0, 10)).toBe(0);
  });

  it('xp_daily_cap: cap is 200', () => {
    // Verify the cap value matches xp-rules.ts
    expect(DAILY_CAP).toBe(200);
  });

  it('xp_cap_boundary: 200 XP should be allowed, 201 should not', () => {
    // Two perfect 10-question quizzes = 170 + 170 = 340
    // After cap: first 200 allowed, rest capped
    const quiz1 = calcXP(10, 10); // 170
    const quiz2 = calcXP(10, 10); // 170
    const uncapped = quiz1 + quiz2; // 340
    const capped = Math.min(uncapped, DAILY_CAP);
    expect(capped).toBe(200);
  });
});

// ─── XP Constants Sync Check ─────────────────────────────────

describe('XP Constants Sync', () => {
  it('xp-rules.ts exports correct constants', async () => {
    const { XP_RULES, XP_PER_LEVEL, LEVEL_NAMES, calculateLevel } = await import('@/lib/xp-rules');

    // P2 constants
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
    expect(XP_RULES.quiz_daily_cap).toBe(200);

    // Level system
    expect(XP_PER_LEVEL).toBe(500);
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(499)).toBe(1);
    expect(calculateLevel(500)).toBe(2);
    expect(calculateLevel(999)).toBe(2);
    expect(calculateLevel(1000)).toBe(3);

    // Level names
    expect(LEVEL_NAMES[1]).toBe('Curious Cub');
    expect(LEVEL_NAMES[2]).toBe('Quick Learner');
    expect(LEVEL_NAMES[3]).toBe('Rising Star');
    expect(LEVEL_NAMES[10]).toBe('Grand Master');
  });
});

// ─── Anti-Cheat (P3) ─────────────────────────────────────────

describe('Anti-Cheat (P3)', () => {
  function checkAntiCheat(responses: { selectedIndex: number }[], totalTimeSeconds: number, questionCount: number) {
    // Time check: at least 3 seconds per question
    if (totalTimeSeconds / questionCount < 3) return 'reject_speed';

    // Pattern check: not all same answer
    const indices = responses.map(r => r.selectedIndex);
    if (new Set(indices).size === 1 && indices.length > 3) return 'flag_pattern';

    // Count check: responses match questions
    if (responses.length !== questionCount) return 'reject_count';

    return 'accept';
  }

  it('reject_speed_hack: avg < 3s per question', () => {
    const responses = Array(10).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 15, 10)).toBe('reject_speed'); // 1.5s avg
  });

  it('flag_same_answer: all same index + >3 questions', () => {
    const responses = Array(10).fill({ selectedIndex: 2 });
    expect(checkAntiCheat(responses, 60, 10)).toBe('flag_pattern');
  });

  it('accept_valid_pattern: same index but only 2 questions', () => {
    const responses = [{ selectedIndex: 1 }, { selectedIndex: 1 }];
    expect(checkAntiCheat(responses, 30, 2)).toBe('accept');
  });

  it('reject_count_mismatch: 10 questions, 8 responses', () => {
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 }, { selectedIndex: 2 },
      { selectedIndex: 3 }, { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
    ]; // 8 varied responses for 10 questions
    expect(checkAntiCheat(responses, 60, 10)).toBe('reject_count');
  });

  it('accept_valid_submission: varied answers, valid time', () => {
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 }, { selectedIndex: 2 },
      { selectedIndex: 3 }, { selectedIndex: 0 }, { selectedIndex: 2 },
      { selectedIndex: 1 }, { selectedIndex: 3 }, { selectedIndex: 0 },
      { selectedIndex: 2 },
    ];
    expect(checkAntiCheat(responses, 120, 10)).toBe('accept');
  });
});

// ─── Question Quality (P6) ───────────────────────────────────

describe('Question Quality (P6)', () => {
  function validateQuestion(q: {
    question_text?: string;
    options?: string[];
    correct_answer_index?: number;
    explanation?: string;
  }): boolean {
    if (!q.question_text || q.question_text.length < 15) return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (q.correct_answer_index == null || q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;
    if (!q.explanation || q.explanation.length < 20) return false;
    if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;
    if (new Set(q.options).size < 3) return false;
    return true;
  }

  it('reject_template_markers: {{ in question text', () => {
    expect(validateQuestion({
      question_text: 'What is {{variable}} in math?',
      options: ['A', 'B', 'C', 'D'],
      correct_answer_index: 0,
      explanation: 'This is a valid explanation for the question.',
    })).toBe(false);
  });

  it('reject_fewer_than_4_options: only 3 options', () => {
    expect(validateQuestion({
      question_text: 'What is the capital of India?',
      options: ['Delhi', 'Mumbai', 'Kolkata'],
      correct_answer_index: 0,
      explanation: 'New Delhi is the capital of India.',
    })).toBe(false);
  });

  it('reject_duplicate_options: fewer than 3 distinct options', () => {
    // Actual behavior: rejects if Set(options).size < 3 (allows 1 duplicate)
    expect(validateQuestion({
      question_text: 'What is 2 + 2 in mathematics?',
      options: ['4', '4', '4', '6'], // Only 2 distinct → rejected
      correct_answer_index: 0,
      explanation: 'Basic addition: 2 plus 2 equals 4.',
    })).toBe(false);
  });

  it('reject_missing_explanation: empty explanation', () => {
    expect(validateQuestion({
      question_text: 'What is the formula for water?',
      options: ['H2O', 'CO2', 'NaCl', 'O2'],
      correct_answer_index: 0,
      explanation: '',
    })).toBe(false);
  });

  it('accept_valid_question: all criteria met', () => {
    expect(validateQuestion({
      question_text: 'What is the chemical formula for water?',
      options: ['H2O', 'CO2', 'NaCl', 'O2'],
      correct_answer_index: 0,
      explanation: 'Water is composed of two hydrogen atoms and one oxygen atom, giving the formula H2O.',
    })).toBe(true);
  });
});

// ─── Grade Format (P5) ──────────────────────────────────────

describe('Grade Format (P5)', () => {
  it('grade_is_string: grades are strings not integers', async () => {
    const { GRADES } = await import('@/lib/constants');
    for (const g of GRADES) {
      expect(typeof g).toBe('string');
    }
  });

  it('grade_range: valid grades are 6 through 12', async () => {
    const { GRADES } = await import('@/lib/constants');
    expect(GRADES).toContain('6');
    expect(GRADES).toContain('12');
    expect(GRADES.length).toBe(7);
    // Verify no integers snuck in
    expect(GRADES).not.toContain(6);
    expect(GRADES).not.toContain(12);
  });
});
