import { describe, it, expect } from 'vitest';

/**
 * Bulk Question Generator — isValidQuestion validator tests
 *
 * The isValidQuestion function lives in the Deno Edge Function
 * (supabase/functions/bulk-question-gen/index.ts) and cannot be imported
 * directly into Vitest. We extract and reproduce the identical logic here so
 * that the P6 validation contract is continuously exercised in the Node test
 * suite without requiring a Deno runtime.
 *
 * This test file MUST be kept in sync with the isValidQuestion implementation
 * in bulk-question-gen/index.ts.
 *
 * Product invariants tested:
 *   P6: Question Quality (non-empty text, no templates, 4 distinct options,
 *       valid correct_answer_index, non-empty explanation, non-empty hint,
 *       difficulty 1-5, valid bloom_level)
 */

// ─── Constants mirrored from bulk-question-gen/index.ts ──────────────────────

const VALID_BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
];

// ─── isValidQuestion: exact copy of production logic ─────────────────────────
// Keep this in sync with supabase/functions/bulk-question-gen/index.ts

interface GeneratedQuestion {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  hint: string;
  difficulty: number;
  bloom_level: string;
}

function isValidQuestion(q: unknown): q is GeneratedQuestion {
  if (!q || typeof q !== 'object') return false;
  const item = q as Record<string, unknown>;

  // question_text: non-empty, no template placeholders
  if (typeof item.question_text !== 'string') return false;
  const text = item.question_text.trim();
  if (!text || text.includes('{{') || text.includes('[BLANK]')) return false;

  // options: exactly 4 distinct non-empty strings
  if (!Array.isArray(item.options) || item.options.length !== 4) return false;
  const opts = item.options as unknown[];
  if (!opts.every((o) => typeof o === 'string' && (o as string).trim().length > 0)) return false;
  const uniqueOpts = new Set((opts as string[]).map((o) => o.trim().toLowerCase()));
  if (uniqueOpts.size !== 4) return false;

  // correct_answer_index: integer 0-3
  if (typeof item.correct_answer_index !== 'number') return false;
  const idx = item.correct_answer_index;
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return false;

  // explanation: non-empty string
  if (typeof item.explanation !== 'string' || !item.explanation.trim()) return false;

  // hint: non-empty string
  if (typeof item.hint !== 'string' || !item.hint.trim()) return false;

  // difficulty: 1-5
  if (typeof item.difficulty !== 'number') return false;
  const diff = item.difficulty;
  if (!Number.isInteger(diff) || diff < 1 || diff > 5) return false;

  // bloom_level: valid level
  if (typeof item.bloom_level !== 'string') return false;
  if (!VALID_BLOOM_LEVELS.includes(item.bloom_level.toLowerCase())) return false;

  return true;
}

// ─── Baseline valid question helper ─────────────────────────────────────────

function validQuestion(): GeneratedQuestion {
  return {
    question_text: 'What is the chemical formula for water?',
    options: ['H2O', 'CO2', 'NaCl', 'O2'],
    correct_answer_index: 0,
    explanation: 'Water is composed of two hydrogen atoms and one oxygen atom.',
    hint: 'Think about what you drink every day.',
    difficulty: 2,
    bloom_level: 'remember',
  };
}

// ─── P6: Valid question passes ───────────────────────────────────────────────

describe('isValidQuestion — valid question passes (P6)', () => {
  it('returns true for a fully valid question', () => {
    expect(isValidQuestion(validQuestion())).toBe(true);
  });

  it('returns true for each valid bloom_level', () => {
    for (const level of VALID_BLOOM_LEVELS) {
      expect(isValidQuestion({ ...validQuestion(), bloom_level: level })).toBe(true);
    }
  });

  it('returns true for each valid difficulty 1-5', () => {
    for (const d of [1, 2, 3, 4, 5]) {
      expect(isValidQuestion({ ...validQuestion(), difficulty: d })).toBe(true);
    }
  });

  it('returns true for each valid correct_answer_index 0-3', () => {
    for (const idx of [0, 1, 2, 3]) {
      expect(isValidQuestion({ ...validQuestion(), correct_answer_index: idx })).toBe(true);
    }
  });
});

// ─── P6: question_text validation ────────────────────────────────────────────

describe('isValidQuestion — question_text validation (P6)', () => {
  it('returns false when question_text is missing', () => {
    const { question_text: _omit, ...rest } = validQuestion();
    expect(isValidQuestion(rest)).toBe(false);
  });

  it('returns false when question_text is an empty string', () => {
    expect(isValidQuestion({ ...validQuestion(), question_text: '' })).toBe(false);
  });

  it('returns false when question_text is whitespace only', () => {
    expect(isValidQuestion({ ...validQuestion(), question_text: '   ' })).toBe(false);
  });

  it('returns false when question_text contains {{ template marker', () => {
    expect(
      isValidQuestion({ ...validQuestion(), question_text: 'What is {{variable}} in chemistry?' }),
    ).toBe(false);
  });

  it('returns false when question_text contains [BLANK] placeholder', () => {
    expect(
      isValidQuestion({ ...validQuestion(), question_text: 'The formula for water is [BLANK].' }),
    ).toBe(false);
  });

  it('returns false when question_text is a number', () => {
    expect(isValidQuestion({ ...validQuestion(), question_text: 42 as unknown as string })).toBe(false);
  });

  it('returns false when question_text is null', () => {
    expect(isValidQuestion({ ...validQuestion(), question_text: null as unknown as string })).toBe(false);
  });
});

// ─── P6: options validation ───────────────────────────────────────────────────

describe('isValidQuestion — options validation (P6)', () => {
  it('returns false when options has 3 elements', () => {
    expect(isValidQuestion({ ...validQuestion(), options: ['A', 'B', 'C'] })).toBe(false);
  });

  it('returns false when options has 5 elements', () => {
    expect(isValidQuestion({ ...validQuestion(), options: ['A', 'B', 'C', 'D', 'E'] })).toBe(false);
  });

  it('returns false when options is empty array', () => {
    expect(isValidQuestion({ ...validQuestion(), options: [] })).toBe(false);
  });

  it('returns false when options contains an empty string', () => {
    expect(isValidQuestion({ ...validQuestion(), options: ['H2O', '', 'NaCl', 'O2'] })).toBe(false);
  });

  it('returns false when options contains a whitespace-only string', () => {
    expect(isValidQuestion({ ...validQuestion(), options: ['H2O', '  ', 'NaCl', 'O2'] })).toBe(false);
  });

  it('returns false when options contains duplicate values (case-insensitive)', () => {
    expect(isValidQuestion({ ...validQuestion(), options: ['H2O', 'h2o', 'NaCl', 'O2'] })).toBe(false);
  });

  it('returns false when options contains duplicate values (exact match)', () => {
    expect(isValidQuestion({ ...validQuestion(), options: ['H2O', 'CO2', 'CO2', 'O2'] })).toBe(false);
  });

  it('returns false when options is not an array', () => {
    expect(isValidQuestion({ ...validQuestion(), options: 'H2O,CO2,NaCl,O2' as unknown as string[] })).toBe(false);
  });

  it('returns false when an option is a number instead of string', () => {
    expect(isValidQuestion({ ...validQuestion(), options: ['H2O', 42 as unknown as string, 'NaCl', 'O2'] })).toBe(false);
  });
});

// ─── P6: correct_answer_index validation ────────────────────────────────────

describe('isValidQuestion — correct_answer_index validation (P6)', () => {
  it('returns false when correct_answer_index is -1', () => {
    expect(isValidQuestion({ ...validQuestion(), correct_answer_index: -1 })).toBe(false);
  });

  it('returns false when correct_answer_index is 4', () => {
    expect(isValidQuestion({ ...validQuestion(), correct_answer_index: 4 })).toBe(false);
  });

  it('returns false when correct_answer_index is a float (1.5)', () => {
    expect(isValidQuestion({ ...validQuestion(), correct_answer_index: 1.5 })).toBe(false);
  });

  it('returns false when correct_answer_index is a string "0"', () => {
    expect(isValidQuestion({ ...validQuestion(), correct_answer_index: '0' as unknown as number })).toBe(false);
  });

  it('returns false when correct_answer_index is missing', () => {
    const { correct_answer_index: _omit, ...rest } = validQuestion();
    expect(isValidQuestion(rest)).toBe(false);
  });
});

// ─── P6: explanation validation ──────────────────────────────────────────────

describe('isValidQuestion — explanation validation (P6)', () => {
  it('returns false when explanation is missing', () => {
    const { explanation: _omit, ...rest } = validQuestion();
    expect(isValidQuestion(rest)).toBe(false);
  });

  it('returns false when explanation is an empty string', () => {
    expect(isValidQuestion({ ...validQuestion(), explanation: '' })).toBe(false);
  });

  it('returns false when explanation is whitespace only', () => {
    expect(isValidQuestion({ ...validQuestion(), explanation: '   ' })).toBe(false);
  });
});

// ─── P6: hint validation ─────────────────────────────────────────────────────

describe('isValidQuestion — hint validation (P6)', () => {
  it('returns false when hint is missing', () => {
    const { hint: _omit, ...rest } = validQuestion();
    expect(isValidQuestion(rest)).toBe(false);
  });

  it('returns false when hint is an empty string', () => {
    expect(isValidQuestion({ ...validQuestion(), hint: '' })).toBe(false);
  });

  it('returns false when hint is whitespace only', () => {
    expect(isValidQuestion({ ...validQuestion(), hint: '   ' })).toBe(false);
  });

  it('returns false when hint is null', () => {
    expect(isValidQuestion({ ...validQuestion(), hint: null as unknown as string })).toBe(false);
  });
});

// ─── P6: difficulty validation ───────────────────────────────────────────────

describe('isValidQuestion — difficulty validation (P6)', () => {
  it('returns false when difficulty is 0', () => {
    expect(isValidQuestion({ ...validQuestion(), difficulty: 0 })).toBe(false);
  });

  it('returns false when difficulty is 6', () => {
    expect(isValidQuestion({ ...validQuestion(), difficulty: 6 })).toBe(false);
  });

  it('returns false when difficulty is a float (2.5)', () => {
    expect(isValidQuestion({ ...validQuestion(), difficulty: 2.5 })).toBe(false);
  });

  it('returns false when difficulty is a string "3"', () => {
    expect(isValidQuestion({ ...validQuestion(), difficulty: '3' as unknown as number })).toBe(false);
  });

  it('returns false when difficulty is missing', () => {
    const { difficulty: _omit, ...rest } = validQuestion();
    expect(isValidQuestion(rest)).toBe(false);
  });
});

// ─── P6: bloom_level validation ──────────────────────────────────────────────

describe('isValidQuestion — bloom_level validation (P6)', () => {
  it('returns false when bloom_level is an invalid string', () => {
    expect(isValidQuestion({ ...validQuestion(), bloom_level: 'synthesis' })).toBe(false);
  });

  it('returns false when bloom_level is an empty string', () => {
    expect(isValidQuestion({ ...validQuestion(), bloom_level: '' })).toBe(false);
  });

  it('returns false when bloom_level is missing', () => {
    const { bloom_level: _omit, ...rest } = validQuestion();
    expect(isValidQuestion(rest)).toBe(false);
  });

  it('returns false when bloom_level is a number', () => {
    expect(isValidQuestion({ ...validQuestion(), bloom_level: 1 as unknown as string })).toBe(false);
  });
});

// ─── Guard: non-object inputs ────────────────────────────────────────────────

describe('isValidQuestion — non-object / null inputs', () => {
  it('returns false for null', () => {
    expect(isValidQuestion(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidQuestion(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isValidQuestion('question text')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isValidQuestion(42)).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isValidQuestion({})).toBe(false);
  });
});
