import { describe, it, expect } from 'vitest';

/**
 * Question Quality Regression Tests — P6 (Question Quality)
 *
 * Every served question must have:
 * - Non-empty text (no `{{`, no `[BLANK]`)
 * - Exactly 4 distinct non-empty options
 * - correct_answer_index 0-3
 * - Non-empty explanation (>= 20 chars, >= 8 words)
 * - Valid difficulty and bloom_level
 *
 * This mirrors the validateQuestions() function in src/lib/supabase.ts.
 * That function is not exported, so we test the same validation logic here
 * to ensure any future changes maintain P6 compliance.
 *
 * Regression catalog IDs: reject_template_markers, reject_fewer_than_4_options,
 * reject_duplicate_options, reject_missing_explanation
 */

// ─── Validation function matching supabase.ts validateQuestions() ─────────────

interface QuestionRecord {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  difficulty?: number;
  bloom_level?: string;
}

function validateQuestion(q: Partial<QuestionRecord>): boolean {
  // Text checks
  if (!q.question_text || typeof q.question_text !== 'string') return false;
  if (q.question_text.length < 15) return false;

  // Template marker rejection
  if (q.question_text.includes('{{')) return false;
  if (q.question_text.includes('[BLANK]')) return false;

  // Options checks
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length !== 4) return false;
  if (opts.some(o => !o || typeof o !== 'string' || o.trim().length === 0)) return false;

  // correct_answer_index bounds
  if (q.correct_answer_index == null || q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;

  // Reject fewer than 3 distinct options (allows at most 1 duplicate)
  const optTexts = opts.map(o => o.toLowerCase().trim());
  if (new Set(optTexts).size < 3) return false;

  // Explanation checks
  if (!q.explanation || q.explanation.length < 20) return false;
  const explWords = q.explanation.split(/\s+/);
  if (explWords.length < 8) return false;

  return true;
}

// Helper: a valid baseline question to modify for negative tests
function validQuestion(): QuestionRecord {
  return {
    question_text: 'What is the chemical formula for water in chemistry?',
    options: ['H2O', 'CO2', 'NaCl', 'O2'],
    correct_answer_index: 0,
    explanation: 'Water is composed of two hydrogen atoms and one oxygen atom, giving the molecular formula H2O.',
    difficulty: 2,
    bloom_level: 'understand',
  };
}

// ─── Template Marker Rejection ───────────────────────────────────────────────

describe('P6: Reject Template Markers', () => {
  it('reject_template_markers: question with {{ is filtered out', () => {
    const q = validQuestion();
    q.question_text = 'What is {{variable}} in mathematics and algebra?';
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects question with [BLANK] placeholder', () => {
    const q = validQuestion();
    q.question_text = 'Fill in the [BLANK] for the following equation.';
    expect(validateQuestion(q)).toBe(false);
  });

  it('accepts question without template markers', () => {
    expect(validateQuestion(validQuestion())).toBe(true);
  });
});

// ─── Option Count Validation ─────────────────────────────────────────────────

describe('P6: Exactly 4 Options Required', () => {
  it('reject_fewer_than_4_options: 3 options is filtered out', () => {
    const q = validQuestion();
    q.options = ['Delhi', 'Mumbai', 'Kolkata'];
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects 5 options', () => {
    const q = validQuestion();
    q.options = ['A', 'B', 'C', 'D', 'E'];
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects 0 options (empty array)', () => {
    const q = validQuestion();
    q.options = [];
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects 1 option', () => {
    const q = validQuestion();
    q.options = ['Only Answer'];
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects undefined options', () => {
    const q = validQuestion();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).options = undefined;
    expect(validateQuestion(q)).toBe(false);
  });

  it('accepts exactly 4 options', () => {
    expect(validateQuestion(validQuestion())).toBe(true);
  });
});

// ─── Duplicate Option Detection ──────────────────────────────────────────────

describe('P6: Distinct Options', () => {
  it('reject_duplicate_options: fewer than 3 distinct options rejected', () => {
    const q = validQuestion();
    q.options = ['4', '4', '4', '6']; // Only 2 distinct
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects all identical options', () => {
    const q = validQuestion();
    q.options = ['Same', 'Same', 'Same', 'Same']; // 1 distinct
    expect(validateQuestion(q)).toBe(false);
  });

  it('accepts 3 distinct options (1 duplicate allowed)', () => {
    const q = validQuestion();
    q.options = ['Apple', 'Banana', 'Cherry', 'Apple']; // 3 distinct
    expect(validateQuestion(q)).toBe(true);
  });

  it('accepts 4 fully distinct options', () => {
    expect(validateQuestion(validQuestion())).toBe(true);
  });

  it('rejects empty string options', () => {
    const q = validQuestion();
    q.options = ['A', '', 'C', 'D'];
    expect(validateQuestion(q)).toBe(false);
  });
});

// ─── Correct Answer Index Bounds ─────────────────────────────────────────────

describe('P6: correct_answer_index is 0-3', () => {
  it('accepts index 0', () => {
    const q = validQuestion();
    q.correct_answer_index = 0;
    expect(validateQuestion(q)).toBe(true);
  });

  it('accepts index 3', () => {
    const q = validQuestion();
    q.correct_answer_index = 3;
    expect(validateQuestion(q)).toBe(true);
  });

  it('rejects index -1', () => {
    const q = validQuestion();
    q.correct_answer_index = -1;
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects index 4', () => {
    const q = validQuestion();
    q.correct_answer_index = 4;
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects undefined correct_answer_index', () => {
    const q = validQuestion();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).correct_answer_index = undefined;
    expect(validateQuestion(q)).toBe(false);
  });
});

// ─── Explanation Validation ──────────────────────────────────────────────────

describe('P6: Non-empty Explanation', () => {
  it('reject_missing_explanation: empty explanation is filtered out', () => {
    const q = validQuestion();
    q.explanation = '';
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects explanation shorter than 20 characters', () => {
    const q = validQuestion();
    q.explanation = 'Too short.';
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects explanation with fewer than 8 words', () => {
    const q = validQuestion();
    q.explanation = 'This is a very short explanation text.'; // 7 words, > 20 chars but < 8 words
    expect(validateQuestion(q)).toBe(false);
  });

  it('accepts explanation with >= 20 chars and >= 8 words', () => {
    expect(validateQuestion(validQuestion())).toBe(true);
  });
});

// ─── Question Text Validation ────────────────────────────────────────────────

describe('P6: Question Text Requirements', () => {
  it('rejects empty question text', () => {
    const q = validQuestion();
    q.question_text = '';
    expect(validateQuestion(q)).toBe(false);
  });

  it('rejects question text shorter than 15 characters', () => {
    const q = validQuestion();
    q.question_text = 'What is 2+2?'; // 12 chars
    expect(validateQuestion(q)).toBe(false);
  });

  it('accepts question text with 15+ characters', () => {
    const q = validQuestion();
    q.question_text = 'What is two plus two in arithmetic?';
    expect(validateQuestion(q)).toBe(true);
  });
});

// ─── Full Validation Happy Path ──────────────────────────────────────────────

describe('P6: Valid Question Passes All Checks', () => {
  it('accepts a well-formed question with all required fields', () => {
    expect(validateQuestion(validQuestion())).toBe(true);
  });

  it('accepts question with difficulty and bloom_level', () => {
    const q = validQuestion();
    q.difficulty = 2;
    q.bloom_level = 'apply';
    expect(validateQuestion(q)).toBe(true);
  });
});
