import { describe, it, expect } from 'vitest';
import { XP_RULES } from '@/lib/xp-rules';

/**
 * Score Accuracy & Anti-Cheat Regression Tests
 *
 * Covers Product Invariants:
 *   P1: score_percent = Math.round((correct_answers / total_questions) * 100)
 *   P2: XP economy (constants from xp-rules.ts)
 *   P3: Anti-cheat checks (speed, pattern, count)
 *
 * These functions mirror the exact logic in submitQuizResults() (src/lib/supabase.ts)
 * and the anti-cheat block in src/app/quiz/page.tsx. They are reimplemented here
 * because the originals are not exported as standalone functions.
 *
 * Regression catalog IDs covered:
 *   score_percent_basic, score_percent_zero, score_percent_perfect,
 *   score_percent_rounding, xp_basic, xp_high_score, xp_perfect, xp_daily_cap,
 *   reject_speed_hack, flag_same_answer, accept_valid_pattern,
 *   reject_count_mismatch, accept_valid_submission
 */

// ─── P1: Score formula (mirrors submitQuizResults fallback in supabase.ts) ───

function calculateScorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

// ─── P2: XP formula (mirrors submitQuizResults fallback in supabase.ts) ──────

function calculateXP(correct: number, total: number): number {
  const scorePct = calculateScorePercent(correct, total);
  return (
    correct * XP_RULES.quiz_per_correct +
    (scorePct >= 80 ? XP_RULES.quiz_high_score_bonus : 0) +
    (scorePct === 100 ? XP_RULES.quiz_perfect_bonus : 0)
  );
}

function applyDailyCap(totalXpToday: number): number {
  return Math.min(totalXpToday, XP_RULES.quiz_daily_cap);
}

// ─── P3: Anti-cheat checks (mirrors quiz/page.tsx inline logic) ──────────────

type AntiCheatVerdict = 'accept' | 'reject_speed' | 'flag_pattern' | 'reject_count';

function checkAntiCheat(
  responses: { selectedIndex: number }[],
  totalTimeSeconds: number,
  questionCount: number
): AntiCheatVerdict {
  // Check 1: Minimum 3s average per question
  if (totalTimeSeconds / questionCount < 3) {
    return 'reject_speed';
  }

  // Check 2: Not all same answer index if >3 questions
  const indices = responses.map((r) => r.selectedIndex);
  if (new Set(indices).size === 1 && indices.length > 3) {
    return 'flag_pattern';
  }

  // Check 3: Response count equals question count
  if (responses.length !== questionCount) {
    return 'reject_count';
  }

  return 'accept';
}

// ═══════════════════════════════════════════════════════════════════════════════
// P1: Score Percent Accuracy
// ═══════════════════════════════════════════════════════════════════════════════

describe('P1: Score Percent Accuracy', () => {
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

  it('edge: 0 questions = 0% without division by zero crash', () => {
    expect(calculateScorePercent(0, 0)).toBe(0);
  });

  it('edge: 1/1 = 100% (single question quiz)', () => {
    expect(calculateScorePercent(1, 1)).toBe(100);
  });

  it('edge: 0/1 = 0% (single question quiz, wrong)', () => {
    expect(calculateScorePercent(0, 1)).toBe(0);
  });

  it('formula is Math.round, not Math.floor or Math.ceil', () => {
    // 5/6 = 83.333... Math.round -> 83, Math.ceil -> 84, Math.floor -> 83
    expect(calculateScorePercent(5, 6)).toBe(83);
    // 5/7 = 71.428... Math.round -> 71, Math.ceil -> 72, Math.floor -> 71
    expect(calculateScorePercent(5, 7)).toBe(71);
    // 6/7 = 85.714... Math.round -> 86, Math.ceil -> 86, Math.floor -> 85
    expect(calculateScorePercent(6, 7)).toBe(86);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P2: XP Economy
// ═══════════════════════════════════════════════════════════════════════════════

describe('P2: XP Calculation', () => {
  it('xp constants match xp-rules.ts', () => {
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('xp_basic: 7/10 = 70% -> 7 * 10 = 70 XP (no bonus)', () => {
    expect(calculateXP(7, 10)).toBe(70);
  });

  it('xp_high_score: 8/10 = 80% -> 80 + 20 = 100 XP', () => {
    expect(calculateXP(8, 10)).toBe(100);
  });

  it('xp_perfect: 10/10 = 100% -> 100 + 20 + 50 = 170 XP', () => {
    expect(calculateXP(10, 10)).toBe(170);
  });

  it('xp: 0 correct = 0 XP, no bonus', () => {
    expect(calculateXP(0, 10)).toBe(0);
  });

  it('xp: just below high score threshold (79%) gets no bonus', () => {
    // 7/9 = 77.78% -> rounds to 78% -> no bonus
    expect(calculateXP(7, 9)).toBe(70);
  });

  it('xp: exactly 80% gets high score bonus', () => {
    // 4/5 = 80% -> 40 + 20 = 60
    expect(calculateXP(4, 5)).toBe(60);
  });

  it('xp: 99% gets high score bonus but not perfect bonus', () => {
    // 99/100 = 99% -> 990 + 20 = 1010
    expect(calculateXP(99, 100)).toBe(1010);
  });

  it('xp_daily_cap: multiple quizzes capped at 200 XP total', () => {
    const quiz1 = calculateXP(10, 10); // 170
    const quiz2 = calculateXP(10, 10); // 170
    expect(quiz1).toBe(170);
    expect(quiz2).toBe(170);
    const totalUncapped = quiz1 + quiz2; // 340
    expect(applyDailyCap(totalUncapped)).toBe(200);
  });

  it('xp cap boundary: exactly 200 is allowed', () => {
    expect(applyDailyCap(200)).toBe(200);
  });

  it('xp cap boundary: 199 + 50 quiz = capped at 200', () => {
    const priorXp = 199;
    const quizXp = calculateXP(5, 10); // 50
    expect(quizXp).toBe(50);
    expect(applyDailyCap(priorXp + quizXp)).toBe(200);
  });

  it('xp: 0 questions attempted yields 0 XP (no crash)', () => {
    expect(calculateXP(0, 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P3: Anti-Cheat
// ═══════════════════════════════════════════════════════════════════════════════

describe('P3: Anti-Cheat — Speed Hack Detection', () => {
  it('reject_speed_hack: avg < 3s per question is rejected', () => {
    const responses = Array(10).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 15, 10)).toBe('reject_speed'); // 1.5s avg
  });

  it('rejects 2.9s average (just under threshold)', () => {
    const responses = Array(10).fill({ selectedIndex: 1 });
    expect(checkAntiCheat(responses, 29, 10)).toBe('reject_speed');
  });

  it('accepts exactly 3.0s average (boundary)', () => {
    const responses = makeVariedResponses(10);
    expect(checkAntiCheat(responses, 30, 10)).toBe('accept');
  });

  it('accepts comfortable pace', () => {
    const responses = makeVariedResponses(10);
    expect(checkAntiCheat(responses, 120, 10)).toBe('accept');
  });
});

describe('P3: Anti-Cheat — Same Answer Pattern', () => {
  it('flag_same_answer: all indices identical with >3 questions is flagged', () => {
    const responses = Array(10).fill({ selectedIndex: 2 });
    expect(checkAntiCheat(responses, 60, 10)).toBe('flag_pattern');
  });

  it('flags 4 questions with all same answer (>3 boundary)', () => {
    const responses = Array(4).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 30, 4)).toBe('flag_pattern');
  });

  it('accept_valid_pattern: 3 questions with same answer is NOT flagged (<=3)', () => {
    const responses = Array(3).fill({ selectedIndex: 1 });
    expect(checkAntiCheat(responses, 30, 3)).toBe('accept');
  });

  it('2 questions with same answer is NOT flagged', () => {
    const responses = Array(2).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 30, 2)).toBe('accept');
  });

  it('does not flag when at least one answer differs', () => {
    const responses = [
      ...Array(9).fill({ selectedIndex: 0 }),
      { selectedIndex: 1 },
    ];
    expect(checkAntiCheat(responses, 60, 10)).toBe('accept');
  });
});

describe('P3: Anti-Cheat — Response Count Mismatch', () => {
  it('reject_count_mismatch: 10 questions but 8 responses', () => {
    const responses = makeVariedResponses(8);
    expect(checkAntiCheat(responses, 60, 10)).toBe('reject_count');
  });

  it('rejects more responses than questions', () => {
    const responses = makeVariedResponses(12);
    expect(checkAntiCheat(responses, 60, 10)).toBe('reject_count');
  });

  it('accepts when count matches exactly', () => {
    const responses = makeVariedResponses(5);
    expect(checkAntiCheat(responses, 30, 5)).toBe('accept');
  });
});

describe('P3: Anti-Cheat — Valid Submission', () => {
  it('accept_valid_submission: varied answers, valid time, correct count', () => {
    const responses = makeVariedResponses(10);
    expect(checkAntiCheat(responses, 120, 10)).toBe('accept');
  });

  it('accepts single question answered in 5s', () => {
    const responses = [{ selectedIndex: 2 }];
    expect(checkAntiCheat(responses, 5, 1)).toBe('accept');
  });

  it('accepts large quiz: 50 questions, varied, sufficient time', () => {
    const responses = makeVariedResponses(50);
    expect(checkAntiCheat(responses, 300, 50)).toBe('accept');
  });
});

describe('P3: Anti-Cheat — Check Priority', () => {
  it('speed check fires before pattern check', () => {
    // All same answer AND too fast
    const responses = Array(10).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 10, 10)).toBe('reject_speed');
  });

  it('pattern check fires before count check', () => {
    // All same answer (5 responses) AND count mismatch (10 questions)
    // speed: 60/10 = 6 >= 3 (pass)
    // pattern: Set size 1, length 5 > 3 (flag)
    const responses = Array(5).fill({ selectedIndex: 1 });
    expect(checkAntiCheat(responses, 60, 10)).toBe('flag_pattern');
  });

  it('0 responses for 0 questions does not crash', () => {
    // NaN < 3 is false, Set of [] has size 0 (not 1), 0 === 0
    expect(checkAntiCheat([], 0, 0)).toBe('accept');
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVariedResponses(count: number): { selectedIndex: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    selectedIndex: i % 4,
  }));
}
