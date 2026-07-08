/**
 * Quiz Validator — validates AI-generated quiz questions against P6 rules.
 *
 * Every served question must have: non-empty text (no {{ or [BLANK]),
 * exactly 4 distinct non-empty options, correctAnswerIndex 0-3,
 * non-empty explanation, valid difficulty and bloomLevel.
 */

import type { QuizQuestion } from '../types';

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard']);

const VALID_BLOOM_LEVELS: ReadonlySet<string> = new Set([
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
]);

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function validateOne(q: unknown, index: number): { question: QuizQuestion | null; error: string | null } {
  if (!q || typeof q !== 'object') {
    return { question: null, error: `Q${index}: not an object` };
  }

  const obj = q as Record<string, unknown>;

  // 1. Text: non-empty, no placeholder markers
  if (!isNonEmptyString(obj.text)) {
    return { question: null, error: `Q${index}: text is empty or not a string` };
  }
  if (obj.text.includes('{{') || obj.text.includes('[BLANK]')) {
    return { question: null, error: `Q${index}: text contains placeholder markers` };
  }

  // 2. Options: exactly 4, all non-empty strings, all distinct
  if (!Array.isArray(obj.options) || obj.options.length !== 4) {
    return { question: null, error: `Q${index}: must have exactly 4 options` };
  }
  for (let i = 0; i < 4; i++) {
    if (!isNonEmptyString(obj.options[i])) {
      return { question: null, error: `Q${index}: option ${i} is empty or not a string` };
    }
  }
  const uniqueOptions = new Set(obj.options.map((o: string) => o.trim().toLowerCase()));
  if (uniqueOptions.size !== 4) {
    return { question: null, error: `Q${index}: options are not all distinct` };
  }

  // 3. correctAnswerIndex: 0-3
  if (typeof obj.correctAnswerIndex !== 'number' || ![0, 1, 2, 3].includes(obj.correctAnswerIndex)) {
    return { question: null, error: `Q${index}: correctAnswerIndex must be 0, 1, 2, or 3` };
  }

  // 4. Explanation: non-empty
  if (!isNonEmptyString(obj.explanation)) {
    return { question: null, error: `Q${index}: explanation is empty or not a string` };
  }

  // 5. Difficulty
  if (!isNonEmptyString(obj.difficulty) || !VALID_DIFFICULTIES.has(obj.difficulty)) {
    return { question: null, error: `Q${index}: difficulty must be easy, medium, or hard` };
  }

  // 6. Bloom's level
  if (!isNonEmptyString(obj.bloomLevel) || !VALID_BLOOM_LEVELS.has(obj.bloomLevel.toLowerCase())) {
    return { question: null, error: `Q${index}: invalid bloomLevel` };
  }

  return {
    question: {
      text: obj.text,
      options: obj.options as [string, string, string, string],
      correctAnswerIndex: obj.correctAnswerIndex as 0 | 1 | 2 | 3,
      explanation: obj.explanation as string,
      difficulty: obj.difficulty as 'easy' | 'medium' | 'hard',
      bloomLevel: (obj.bloomLevel as string).toLowerCase(),
      topic: isNonEmptyString(obj.topic) ? obj.topic : undefined,
      concept: isNonEmptyString(obj.concept) ? obj.concept : undefined,
    },
    error: null,
  };
}

export function validateQuizQuestions(
  questions: unknown[],
): { valid: QuizQuestion[]; errors: string[] } {
  const valid: QuizQuestion[] = [];
  const errors: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const result = validateOne(questions[i], i);
    if (result.question) {
      valid.push(result.question);
    }
    if (result.error) {
      errors.push(result.error);
    }
  }

  return { valid, errors };
}
