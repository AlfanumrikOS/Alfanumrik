import { describe, it, expect } from 'vitest';

/**
 * B2B Content Validation Tests — P5 (Grade Format) + P6 (Question Quality)
 *
 * These tests validate the question quality rules from the school admin content
 * route (src/app/api/school-admin/content/route.ts), extracted as a standalone
 * validation function matching the route's inline validateQuestion().
 *
 * P6 Quality Rules:
 *   1. question_text: non-empty, no {{ or [BLANK]
 *   2. options: array of exactly 4 non-empty strings, all distinct
 *   3. correct_answer_index: integer 0-3
 *   4. explanation: non-empty
 *   5. difficulty: must be easy/medium/hard
 *   6. bloom_level: must be remember/understand/apply/analyze/evaluate/create
 *   7. grade: string "6"-"12" (P5)
 *
 * Regression catalog entries covered:
 *   - reject_template_markers
 *   - reject_fewer_than_4_options
 *   - reject_duplicate_options
 *   - reject_missing_explanation
 */

// ── Constants matching the content route ──────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const VALID_BLOOM_LEVELS = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
] as const;

// ── Validation function matching content route's validateQuestion() ───────────

interface QuestionInput {
  subject?: string;
  grade?: string;
  topic?: string;
  question_text?: string;
  options?: unknown;
  correct_answer_index?: unknown;
  explanation?: string;
  difficulty?: string;
  bloom_level?: string;
}

interface ValidationError {
  index: number;
  field: string;
  message: string;
}

function validateQuestion(q: QuestionInput, index = 0): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. question_text: non-empty, no {{ or [BLANK] placeholders
  if (!q.question_text || typeof q.question_text !== 'string' || !q.question_text.trim()) {
    errors.push({ index, field: 'question_text', message: 'Question text is required and must be non-empty' });
  } else if (/\{\{/.test(q.question_text) || /\[BLANK\]/.test(q.question_text)) {
    errors.push({ index, field: 'question_text', message: 'Question text must not contain {{ or [BLANK] placeholders' });
  }

  // 2. options: array of exactly 4 non-empty strings, all distinct
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    errors.push({ index, field: 'options', message: 'Options must be an array of exactly 4 strings' });
  } else {
    const allStrings = q.options.every((o: unknown) => typeof o === 'string' && (o as string).trim().length > 0);
    if (!allStrings) {
      errors.push({ index, field: 'options', message: 'All 4 options must be non-empty strings' });
    } else {
      const trimmed = q.options.map((o: string) => o.trim().toLowerCase());
      const unique = new Set(trimmed);
      if (unique.size !== 4) {
        errors.push({ index, field: 'options', message: 'All 4 options must be distinct' });
      }
    }
  }

  // 3. correct_answer_index: 0-3
  const cai = Number(q.correct_answer_index);
  if (
    q.correct_answer_index === undefined ||
    q.correct_answer_index === null ||
    !Number.isInteger(cai) ||
    cai < 0 ||
    cai > 3
  ) {
    errors.push({ index, field: 'correct_answer_index', message: 'correct_answer_index must be an integer 0-3' });
  }

  // 4. explanation: non-empty
  if (!q.explanation || typeof q.explanation !== 'string' || !q.explanation.trim()) {
    errors.push({ index, field: 'explanation', message: 'Explanation is required and must be non-empty' });
  }

  // 5. difficulty
  if (!q.difficulty || !VALID_DIFFICULTIES.includes(q.difficulty as typeof VALID_DIFFICULTIES[number])) {
    errors.push({ index, field: 'difficulty', message: `Difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}` });
  }

  // 6. bloom_level
  if (!q.bloom_level || !VALID_BLOOM_LEVELS.includes(q.bloom_level as typeof VALID_BLOOM_LEVELS[number])) {
    errors.push({ index, field: 'bloom_level', message: `bloom_level must be one of: ${VALID_BLOOM_LEVELS.join(', ')}` });
  }

  // 7. grade: string "6"-"12" (P5)
  if (!q.grade || typeof q.grade !== 'string' || !VALID_GRADES.includes(q.grade)) {
    errors.push({ index, field: 'grade', message: 'Grade must be a string "6" through "12"' });
  }

  // subject: required non-empty
  if (!q.subject || typeof q.subject !== 'string' || !q.subject.trim()) {
    errors.push({ index, field: 'subject', message: 'Subject is required' });
  }

  return errors;
}

// ── Helper: valid baseline question ──────────────────────────────────────────

function validQ(): QuestionInput {
  return {
    subject: 'Mathematics',
    grade: '8',
    topic: 'Quadratic Equations',
    question_text: 'What is the value of x in the equation x^2 - 4 = 0?',
    options: ['2', '-2', '4', '0'],
    correct_answer_index: 0,
    explanation: 'The equation x^2 - 4 = 0 factors as (x+2)(x-2) = 0, giving x = 2 or x = -2.',
    difficulty: 'medium',
    bloom_level: 'apply',
  };
}

function hasFieldError(errors: ValidationError[], field: string): boolean {
  return errors.some(e => e.field === field);
}

// ═══════════════════════════════════════════════════════════════════════════════
// P6 — QUESTION TEXT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: question_text validation (P6)', () => {
  it('rejects empty question_text', () => {
    const q = validQ();
    q.question_text = '';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'question_text')).toBe(true);
  });

  it('rejects undefined question_text', () => {
    const q = validQ();
    delete q.question_text;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'question_text')).toBe(true);
  });

  it('rejects question_text containing {{', () => {
    const q = validQ();
    q.question_text = 'What is {{variable}} in the context of algebra?';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'question_text')).toBe(true);
    expect(errors.find(e => e.field === 'question_text')!.message).toContain('{{');
  });

  it('rejects question_text containing [BLANK]', () => {
    const q = validQ();
    q.question_text = 'Fill in the [BLANK] with the correct mathematical term.';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'question_text')).toBe(true);
    expect(errors.find(e => e.field === 'question_text')!.message).toContain('[BLANK]');
  });

  it('rejects whitespace-only question_text', () => {
    const q = validQ();
    q.question_text = '   \t  \n  ';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'question_text')).toBe(true);
  });

  it('accepts valid question_text without markers', () => {
    const errors = validateQuestion(validQ());
    expect(hasFieldError(errors, 'question_text')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P6 — OPTIONS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: options validation (P6)', () => {
  it('rejects options with fewer than 4 items', () => {
    const q = validQ();
    q.options = ['A', 'B', 'C'];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects options with more than 4 items', () => {
    const q = validQ();
    q.options = ['A', 'B', 'C', 'D', 'E'];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects empty array', () => {
    const q = validQ();
    q.options = [];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects undefined options', () => {
    const q = validQ();
    delete q.options;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects options with empty strings', () => {
    const q = validQ();
    q.options = ['A', '', 'C', 'D'];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects options with whitespace-only strings', () => {
    const q = validQ();
    q.options = ['A', '  ', 'C', 'D'];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects options with duplicate values (case-insensitive)', () => {
    const q = validQ();
    q.options = ['Apple', 'APPLE', 'Cherry', 'Date'];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects all identical options', () => {
    const q = validQ();
    q.options = ['Same', 'Same', 'Same', 'Same'];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('rejects non-string elements in options', () => {
    const q = validQ();
    q.options = ['A', 42, 'C', 'D'] as unknown[];
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'options')).toBe(true);
  });

  it('accepts exactly 4 distinct non-empty options', () => {
    const errors = validateQuestion(validQ());
    expect(hasFieldError(errors, 'options')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P6 — CORRECT ANSWER INDEX
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: correct_answer_index validation (P6)', () => {
  it('rejects correct_answer_index outside 0-3 (index 4)', () => {
    const q = validQ();
    q.correct_answer_index = 4;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'correct_answer_index')).toBe(true);
  });

  it('rejects negative correct_answer_index', () => {
    const q = validQ();
    q.correct_answer_index = -1;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'correct_answer_index')).toBe(true);
  });

  it('rejects undefined correct_answer_index', () => {
    const q = validQ();
    delete q.correct_answer_index;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'correct_answer_index')).toBe(true);
  });

  it('rejects null correct_answer_index', () => {
    const q = validQ();
    q.correct_answer_index = null;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'correct_answer_index')).toBe(true);
  });

  it('rejects non-integer correct_answer_index', () => {
    const q = validQ();
    q.correct_answer_index = 1.5;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'correct_answer_index')).toBe(true);
  });

  it('accepts index 0', () => {
    const q = validQ();
    q.correct_answer_index = 0;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'correct_answer_index')).toBe(false);
  });

  it('accepts index 3', () => {
    const q = validQ();
    q.correct_answer_index = 3;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'correct_answer_index')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P6 — EXPLANATION VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: explanation validation (P6)', () => {
  it('rejects empty explanation', () => {
    const q = validQ();
    q.explanation = '';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'explanation')).toBe(true);
  });

  it('rejects undefined explanation', () => {
    const q = validQ();
    delete q.explanation;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'explanation')).toBe(true);
  });

  it('rejects whitespace-only explanation', () => {
    const q = validQ();
    q.explanation = '   \t  ';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'explanation')).toBe(true);
  });

  it('accepts non-empty explanation', () => {
    const errors = validateQuestion(validQ());
    expect(hasFieldError(errors, 'explanation')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P6 — DIFFICULTY VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: difficulty validation (P6)', () => {
  it('rejects invalid difficulty', () => {
    const q = validQ();
    q.difficulty = 'super_hard';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'difficulty')).toBe(true);
  });

  it('rejects empty difficulty', () => {
    const q = validQ();
    q.difficulty = '';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'difficulty')).toBe(true);
  });

  it('rejects undefined difficulty', () => {
    const q = validQ();
    delete q.difficulty;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'difficulty')).toBe(true);
  });

  it('accepts "easy"', () => {
    const q = validQ();
    q.difficulty = 'easy';
    expect(hasFieldError(validateQuestion(q), 'difficulty')).toBe(false);
  });

  it('accepts "medium"', () => {
    const q = validQ();
    q.difficulty = 'medium';
    expect(hasFieldError(validateQuestion(q), 'difficulty')).toBe(false);
  });

  it('accepts "hard"', () => {
    const q = validQ();
    q.difficulty = 'hard';
    expect(hasFieldError(validateQuestion(q), 'difficulty')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P6 — BLOOM LEVEL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: bloom_level validation (P6)', () => {
  it('rejects invalid bloom_level', () => {
    const q = validQ();
    q.bloom_level = 'memorize'; // wrong: should be 'remember'
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'bloom_level')).toBe(true);
  });

  it('rejects empty bloom_level', () => {
    const q = validQ();
    q.bloom_level = '';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'bloom_level')).toBe(true);
  });

  it('accepts all valid bloom levels', () => {
    for (const level of VALID_BLOOM_LEVELS) {
      const q = validQ();
      q.bloom_level = level;
      expect(hasFieldError(validateQuestion(q), 'bloom_level')).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P5 — GRADE FORMAT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: grade validation (P5)', () => {
  it('rejects grade "5" (below range)', () => {
    const q = validQ();
    q.grade = '5';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'grade')).toBe(true);
  });

  it('rejects grade "13" (above range)', () => {
    const q = validQ();
    q.grade = '13';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'grade')).toBe(true);
  });

  it('rejects empty grade', () => {
    const q = validQ();
    q.grade = '';
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'grade')).toBe(true);
  });

  it('rejects undefined grade', () => {
    const q = validQ();
    delete q.grade;
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'grade')).toBe(true);
  });

  it('accepts all valid grades "6" through "12"', () => {
    for (const grade of VALID_GRADES) {
      const q = validQ();
      q.grade = grade;
      expect(hasFieldError(validateQuestion(q), 'grade')).toBe(false);
    }
  });

  it('grade must be a string, not a number', () => {
    const q = validQ();
    (q as Record<string, unknown>).grade = 8; // integer, not string
    const errors = validateQuestion(q);
    expect(hasFieldError(errors, 'grade')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FULL VALIDATION — HAPPY PATH
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2B Content: valid question passes all checks', () => {
  it('accepts a well-formed question with all required fields', () => {
    const errors = validateQuestion(validQ());
    expect(errors).toHaveLength(0);
  });

  it('accepts questions for each valid grade and difficulty combination', () => {
    for (const grade of VALID_GRADES) {
      for (const difficulty of VALID_DIFFICULTIES) {
        const q = validQ();
        q.grade = grade;
        q.difficulty = difficulty;
        const errors = validateQuestion(q);
        expect(errors).toHaveLength(0);
      }
    }
  });

  it('returns multiple errors for a completely invalid question', () => {
    const q: QuestionInput = {
      // All fields missing or invalid
    };
    const errors = validateQuestion(q);
    // Should have errors for: question_text, options, correct_answer_index,
    // explanation, difficulty, bloom_level, grade, subject
    expect(errors.length).toBeGreaterThanOrEqual(7);
  });

  it('error objects include index, field, and message', () => {
    const q = validQ();
    q.question_text = '';
    const errors = validateQuestion(q, 5);
    expect(errors[0]).toEqual(
      expect.objectContaining({
        index: 5,
        field: 'question_text',
        message: expect.any(String),
      })
    );
  });
});
