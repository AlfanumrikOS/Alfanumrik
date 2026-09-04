// packages/lib/src/school-admin/question-validation.ts
//
// Gate-2 Phase E: extracted from a byte-for-byte duplicate that existed
// independently in apps/host/src/app/api/school-admin/content/route.ts and
// .../content/bulk/route.ts — the bulk route's own header comment already
// said "Mirrors the validator in the sibling route... so both entry points
// enforce identical P6 quality rules", making the intent to share explicit
// even though the code itself was still copy-pasted. Both routes now import
// from here instead.
//
// P5: grades are strings "6"-"12", never integers.
// P6: every served question — non-empty text (no {{/[BLANK]}} placeholders),
//     exactly 4 distinct non-empty options, correct_answer_index 0-3,
//     non-empty explanation, valid difficulty and bloom_level.

export const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
export const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const VALID_BLOOM_LEVELS = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
] as const;

export interface QuestionInput {
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

export interface ValidationError {
  index: number;
  field: string;
  message: string;
}

/**
 * Validates a single question against P6 quality rules and P5 grade format.
 * Returns an array of errors (empty = valid).
 */
export function validateQuestion(q: QuestionInput, index: number): ValidationError[] {
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
    const allStrings = q.options.every((o: unknown) => typeof o === 'string' && o.trim().length > 0);
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

  // 3. correct_answer_index: integer 0-3
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
    errors.push({
      index,
      field: 'difficulty',
      message: `Difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}`,
    });
  }

  // 6. bloom_level
  if (!q.bloom_level || !VALID_BLOOM_LEVELS.includes(q.bloom_level as typeof VALID_BLOOM_LEVELS[number])) {
    errors.push({
      index,
      field: 'bloom_level',
      message: `bloom_level must be one of: ${VALID_BLOOM_LEVELS.join(', ')}`,
    });
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
