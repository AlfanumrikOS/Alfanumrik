import { describe, it, expect } from 'vitest';
import { XP_RULES } from '@/lib/xp-rules';

/**
 * Quiz Submission Flow Tests
 *
 * Tests the complete quiz submission pipeline:
 * 1. Score percentage calculation (P1)
 * 2. XP calculation with bonuses (P2)
 * 3. Daily XP cap enforcement (P2)
 * 4. Anti-cheat validation (P3)
 * 5. Edge cases: empty quiz, single question, division by zero
 *
 * These replicate the exact logic from submitQuizResults() in src/lib/supabase.ts
 * to verify the scoring pipeline without requiring a Supabase connection.
 */

// ─── Replicated scoring logic from submitQuizResults ──────────────────────

interface QuizQuestion {
  id: string;
  correct_answer_index: number;
}

interface QuizResponse {
  questionId: string;
  selectedIndex: number;
}

function calculateScorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function calculateXPEarned(correct: number, scorePercent: number): number {
  return (
    correct * XP_RULES.quiz_per_correct +
    (scorePercent >= 80 ? XP_RULES.quiz_high_score_bonus : 0) +
    (scorePercent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
  );
}

function applyDailyCap(xpEarned: number, xpAlreadyToday: number): number {
  const remaining = Math.max(0, XP_RULES.quiz_daily_cap - xpAlreadyToday);
  return Math.min(xpEarned, remaining);
}

function gradeResponses(
  questions: QuizQuestion[],
  responses: QuizResponse[],
): { correct: number; scorePercent: number; xpEarned: number } {
  let correct = 0;
  for (const r of responses) {
    const q = questions.find((q) => q.id === r.questionId);
    if (q && r.selectedIndex === q.correct_answer_index) {
      correct++;
    }
  }
  const scorePercent = calculateScorePercent(correct, questions.length);
  const xpEarned = calculateXPEarned(correct, scorePercent);
  return { correct, scorePercent, xpEarned };
}

// Anti-cheat checks replicated from quiz page
function validateSubmission(
  responses: QuizResponse[],
  questionCount: number,
  totalTimeSeconds: number,
): { valid: boolean; reason?: string } {
  // P3 check 1: minimum 3s avg per question
  if (totalTimeSeconds / questionCount < 3) {
    return { valid: false, reason: 'speed_hack' };
  }
  // P3 check 2: not all same answer index if >3 questions
  const indices = responses.map((r) => r.selectedIndex);
  if (new Set(indices).size === 1 && indices.length > 3) {
    return { valid: false, reason: 'same_answer_pattern' };
  }
  // P3 check 3: response count equals question count
  if (responses.length !== questionCount) {
    return { valid: false, reason: 'count_mismatch' };
  }
  return { valid: true };
}

// ─── Test data: realistic CBSE Grade 9 Science quiz ───────────────────────

function createCBSEQuiz(count: number): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < count; i++) {
    questions.push({
      id: `q-${i + 1}`,
      correct_answer_index: i % 4, // cycles 0,1,2,3
    });
  }
  return questions;
}

function createResponses(
  questions: QuizQuestion[],
  correctCount: number,
): QuizResponse[] {
  return questions.map((q, i) => ({
    questionId: q.id,
    selectedIndex:
      i < correctCount ? q.correct_answer_index : (q.correct_answer_index + 1) % 4,
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Quiz Submission: Score Calculation (P1)', () => {
  it('score_percent_basic: 7/10 = 70%', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 7);
    const result = gradeResponses(questions, responses);
    expect(result.correct).toBe(7);
    expect(result.scorePercent).toBe(70);
  });

  it('score_percent_zero: 0 correct = 0%', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 0);
    const result = gradeResponses(questions, responses);
    expect(result.correct).toBe(0);
    expect(result.scorePercent).toBe(0);
  });

  it('score_percent_perfect: all correct = 100%', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 10);
    const result = gradeResponses(questions, responses);
    expect(result.correct).toBe(10);
    expect(result.scorePercent).toBe(100);
  });

  it('score_percent_rounding: 1/3 rounds to 33, not 33.33', () => {
    const questions = createCBSEQuiz(3);
    const responses = createResponses(questions, 1);
    const result = gradeResponses(questions, responses);
    expect(result.scorePercent).toBe(33);
  });

  it('handles 0 questions without division by zero', () => {
    const result = gradeResponses([], []);
    expect(result.scorePercent).toBe(0);
    expect(result.xpEarned).toBe(0);
  });

  it('single question quiz: 0% or 100% only', () => {
    const questions = createCBSEQuiz(1);
    const correct = gradeResponses(questions, createResponses(questions, 1));
    const wrong = gradeResponses(questions, createResponses(questions, 0));
    expect(correct.scorePercent).toBe(100);
    expect(wrong.scorePercent).toBe(0);
  });

  it('formula matches P1 invariant: Math.round((correct/total)*100)', () => {
    const testCases = [
      [7, 10, 70],
      [0, 10, 0],
      [10, 10, 100],
      [1, 3, 33],
      [2, 3, 67],
      [5, 7, 71],
      [3, 8, 38],
    ];
    for (const [correct, total, expected] of testCases) {
      expect(calculateScorePercent(correct, total)).toBe(expected);
    }
  });
});

describe('Quiz Submission: XP Calculation (P2)', () => {
  it('xp_basic: 7 correct, 70% -> 7*10 = 70 XP (no bonus)', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 7);
    const result = gradeResponses(questions, responses);
    expect(result.xpEarned).toBe(70);
  });

  it('xp_high_score: 8/10 = 80% -> 80 + 20 = 100 XP', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 8);
    const result = gradeResponses(questions, responses);
    expect(result.xpEarned).toBe(100);
  });

  it('xp_perfect: 10/10 = 100% -> 100 + 20 + 50 = 170 XP', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 10);
    const result = gradeResponses(questions, responses);
    expect(result.xpEarned).toBe(170);
  });

  it('XP uses constants from XP_RULES, not hardcoded values', () => {
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('no bonus at 79%: just below threshold', () => {
    // 11/14 = 78.57 -> rounds to 79%
    const questions = createCBSEQuiz(14);
    const responses = createResponses(questions, 11);
    const result = gradeResponses(questions, responses);
    expect(result.scorePercent).toBe(79);
    expect(result.xpEarned).toBe(110); // 11 * 10, no bonus
  });

  it('high score but not perfect at 90%', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 9);
    const result = gradeResponses(questions, responses);
    expect(result.xpEarned).toBe(110); // 90 + 20, no perfect bonus
  });
});

describe('Quiz Submission: Daily XP Cap (P2)', () => {
  it('xp_daily_cap: cap is 200', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('allows full XP when under cap', () => {
    expect(applyDailyCap(170, 0)).toBe(170);
  });

  it('caps at remaining allowance', () => {
    // 199 earned today + quiz worth 50 -> only 1 more allowed
    expect(applyDailyCap(50, 199)).toBe(1);
  });

  it('allows exactly 200 at boundary (off-by-one check)', () => {
    expect(applyDailyCap(100, 100)).toBe(100);
  });

  it('returns 0 when already at cap', () => {
    expect(applyDailyCap(170, 200)).toBe(0);
  });

  it('multiple quizzes capped correctly across a day', () => {
    let todayTotal = 0;
    const quizResults = [
      { correct: 10, total: 10 }, // 170 XP (perfect)
      { correct: 10, total: 10 }, // 170 XP (perfect) — should be capped
      { correct: 5, total: 10 },  // 50 XP — should get 0
    ];

    for (const q of quizResults) {
      const pct = calculateScorePercent(q.correct, q.total);
      const rawXP = calculateXPEarned(q.correct, pct);
      const cappedXP = applyDailyCap(rawXP, todayTotal);
      todayTotal += cappedXP;
    }

    expect(todayTotal).toBe(200);
  });
});

describe('Quiz Submission: Anti-Cheat Validation (P3)', () => {
  it('rejects speed hack: avg < 3s per question', () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      selectedIndex: i % 4,
    }));
    const result = validateSubmission(responses, 10, 20); // 2s avg
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('speed_hack');
  });

  it('rejects count mismatch: 10 questions, 8 responses', () => {
    const responses = Array.from({ length: 8 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      selectedIndex: i % 4,
    }));
    const result = validateSubmission(responses, 10, 60);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('count_mismatch');
  });

  it('flags same answer pattern: all same index + >3 questions', () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      selectedIndex: 2,
    }));
    const result = validateSubmission(responses, 10, 60);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('same_answer_pattern');
  });

  it('accepts valid submission: varied answers, valid time, correct count', () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      selectedIndex: i % 4,
    }));
    const result = validateSubmission(responses, 10, 120); // 12s avg
    expect(result.valid).toBe(true);
  });

  it('accepts same answer with 3 or fewer questions (not flagged)', () => {
    const responses = Array.from({ length: 3 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      selectedIndex: 1,
    }));
    const result = validateSubmission(responses, 3, 30);
    expect(result.valid).toBe(true);
  });

  it('accepts exactly 3s avg per question (boundary)', () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      selectedIndex: i % 4,
    }));
    const result = validateSubmission(responses, 10, 30); // exactly 3s avg
    expect(result.valid).toBe(true);
  });
});

describe('Quiz Submission: End-to-End Flow', () => {
  it('complete CBSE Grade 9 Science quiz produces correct score, XP, and passes anti-cheat', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 8); // 8/10 correct

    // Anti-cheat passes
    const validation = validateSubmission(
      responses.map((r) => ({ questionId: r.questionId, selectedIndex: r.selectedIndex })),
      10,
      120, // 12s per question avg
    );
    expect(validation.valid).toBe(true);

    // Score and XP
    const result = gradeResponses(questions, responses);
    expect(result.correct).toBe(8);
    expect(result.scorePercent).toBe(80);
    expect(result.xpEarned).toBe(100); // 80 base + 20 high score bonus

    // Daily cap
    const capped = applyDailyCap(result.xpEarned, 0);
    expect(capped).toBe(100);
  });

  it('perfect quiz with daily cap already partially used', () => {
    const questions = createCBSEQuiz(10);
    const responses = createResponses(questions, 10);

    const result = gradeResponses(questions, responses);
    expect(result.xpEarned).toBe(170);

    // Student already earned 100 XP today
    const capped = applyDailyCap(result.xpEarned, 100);
    expect(capped).toBe(100); // 200 - 100 = 100 remaining
  });
});
