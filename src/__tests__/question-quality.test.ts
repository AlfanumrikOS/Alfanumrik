import { describe, it, expect } from 'vitest';
import { validateQuestionForQuiz } from '@/lib/quiz-engine';

/**
 * Question Quality Regression Tests — P6 (Question Quality)
 *
 * Every served question must have:
 * - Non-empty text (no `{{`, no `[BLANK]`)
 * - Exactly 4 distinct non-empty options
 * - correct_answer_index 0-3
 * - Non-empty explanation (>= 20 chars)
 * - Valid difficulty and bloom_level
 *
 * Tests import the ACTUAL production function from:
 *   - src/lib/quiz-engine.ts (validateQuestionForQuiz)
 *
 * Regression catalog IDs: reject_template_markers, reject_fewer_than_4_options,
 * reject_duplicate_options, reject_missing_explanation
 */

// ─── Helper: baseline valid question matching QuizQuestion shape ────────────

function validQuestion() {
  return {
    id: 'q-test-1',
    question_text: 'What is the chemical formula for water in chemistry?',
    question_type: 'mcq',
    question_type_v2: 'mcq' as const,
    options: ['H2O', 'CO2', 'NaCl', 'O2'],
    correct_answer_index: 0,
    explanation: 'Water is composed of two hydrogen atoms and one oxygen atom, giving the molecular formula H2O.',
    difficulty: 2,
    bloom_level: 'understand',
  };
}

// ─── Template Marker Rejection ───────────────────────────────────────────────

describe('P6: Reject Template Markers (production function)', () => {
  it('reject_template_markers: question with {{ is filtered out', () => {
    const q = { ...validQuestion(), question_text: 'What is {{variable}} in mathematics and algebra?' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects question with [BLANK] placeholder', () => {
    const q = { ...validQuestion(), question_text: 'Fill in the [BLANK] for the following equation.' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('accepts question without template markers', () => {
    expect(validateQuestionForQuiz(validQuestion())).toBe(true);
  });
});

// ─── Option Count Validation ─────────────────────────────────────────────────

describe('P6: Exactly 4 Options Required (production function)', () => {
  it('reject_fewer_than_4_options: 3 options is filtered out', () => {
    const q = { ...validQuestion(), options: ['Delhi', 'Mumbai', 'Kolkata'] };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects 5 options', () => {
    const q = { ...validQuestion(), options: ['A', 'B', 'C', 'D', 'E'] };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects 0 options (empty array)', () => {
    const q = { ...validQuestion(), options: [] as string[] };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects 1 option', () => {
    const q = { ...validQuestion(), options: ['Only Answer'] };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects undefined options', () => {
    const q = { ...validQuestion(), options: undefined as any };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('accepts exactly 4 options', () => {
    expect(validateQuestionForQuiz(validQuestion())).toBe(true);
  });
});

// ─── Duplicate Option Detection ──────────────────────────────────────────────

describe('P6: Distinct Options (production function)', () => {
  it('reject_duplicate_options: fewer than 3 distinct options rejected', () => {
    const q = { ...validQuestion(), options: ['4', '4', '4', '6'] }; // Only 2 distinct
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects all identical options', () => {
    const q = { ...validQuestion(), options: ['Same', 'Same', 'Same', 'Same'] }; // 1 distinct
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('accepts 3 distinct options (1 duplicate allowed)', () => {
    const q = { ...validQuestion(), options: ['Apple', 'Banana', 'Cherry', 'Apple'] }; // 3 distinct
    expect(validateQuestionForQuiz(q)).toBe(true);
  });

  it('accepts 4 fully distinct options', () => {
    expect(validateQuestionForQuiz(validQuestion())).toBe(true);
  });
});

// ─── Correct Answer Index Bounds ─────────────────────────────────────────────

describe('P6: correct_answer_index is 0-3 (production function)', () => {
  it('accepts index 0', () => {
    const q = { ...validQuestion(), correct_answer_index: 0 };
    expect(validateQuestionForQuiz(q)).toBe(true);
  });

  it('accepts index 3', () => {
    const q = { ...validQuestion(), correct_answer_index: 3 };
    expect(validateQuestionForQuiz(q)).toBe(true);
  });

  it('rejects index -1', () => {
    const q = { ...validQuestion(), correct_answer_index: -1 };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects index 4', () => {
    const q = { ...validQuestion(), correct_answer_index: 4 };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('reject_invalid_answer_index: index 5 is filtered', () => {
    const q = { ...validQuestion(), correct_answer_index: 5 };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects undefined correct_answer_index', () => {
    const q = { ...validQuestion(), correct_answer_index: undefined as any };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });
});

// ─── Explanation Validation ──────────────────────────────────────────────────

describe('P6: Non-empty Explanation (production function)', () => {
  it('reject_missing_explanation: empty explanation is filtered out', () => {
    const q = { ...validQuestion(), explanation: '' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects explanation shorter than 20 characters', () => {
    const q = { ...validQuestion(), explanation: 'Too short.' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('accepts explanation with >= 20 characters', () => {
    expect(validateQuestionForQuiz(validQuestion())).toBe(true);
  });
});

// ─── Question Text Validation ────────────────────────────────────────────────

describe('P6: Question Text Requirements (production function)', () => {
  it('rejects empty question text', () => {
    const q = { ...validQuestion(), question_text: '' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects question text shorter than 15 characters', () => {
    const q = { ...validQuestion(), question_text: 'What is 2+2?' }; // 12 chars
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('reject_blank_marker: [BLANK] in text is filtered', () => {
    const q = { ...validQuestion(), question_text: 'Fill [BLANK] here for the following problem.' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('accepts question text with 15+ characters', () => {
    const q = { ...validQuestion(), question_text: 'What is two plus two in arithmetic?' };
    expect(validateQuestionForQuiz(q)).toBe(true);
  });
});

// ─── Full Validation Happy Path ──────────────────────────────────────────────

describe('P6: Valid Question Passes All Checks (production function)', () => {
  it('accepts a well-formed question with all required fields', () => {
    expect(validateQuestionForQuiz(validQuestion())).toBe(true);
  });

  it('accepts question with difficulty and bloom_level', () => {
    const q = { ...validQuestion(), difficulty: 2, bloom_level: 'apply' };
    expect(validateQuestionForQuiz(q)).toBe(true);
  });
});

// ─── Garbage Pattern Rejection (production-specific) ─────────────────────────

describe('P6: Garbage Pattern Rejection (production function)', () => {
  it('rejects meta-questions about studying a topic', () => {
    const q = { ...validQuestion(), question_text: 'What is the primary purpose of studying this chapter in class?' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects options referencing unrelated topics', () => {
    const q = { ...validQuestion(), options: ['Correct answer', 'Unrelated topic filler', 'Valid option', 'Another valid one'] };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });

  it('rejects explanations with error indicators', () => {
    const q = { ...validQuestion(), explanation: 'The answer does not match any option in the given choices so we pick closest.' };
    expect(validateQuestionForQuiz(q)).toBe(false);
  });
});
