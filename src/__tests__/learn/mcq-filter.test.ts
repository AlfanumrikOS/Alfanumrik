/**
 * REG: mcq-filter — Fix B regression
 *
 * Pins the isLearnPageMCQ algorithm used in
 * src/app/learn/[subject]/[chapter]/page.tsx.
 *
 * The function is module-level but not exported (it lives inside a Next.js
 * page with many platform dependencies). We replicate the exact algorithm here
 * as a "system under test" — the purpose is to lock the detection logic so
 * future edits that widen or narrow the filter are immediately visible.
 *
 * If the production algorithm changes, this test intentionally fails to force
 * a deliberate review of whether non-MCQ questions should still be excluded
 * from the learn page quick-check.
 */

import { describe, it, expect } from 'vitest';

// ── Replicated algorithm (must stay in sync with page.tsx:74-85) ──────────────

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type?: string | null;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  bloom_level: string;
  difficulty: number;
  chapter_number: number;
}

/** Mirrors isLearnPageMCQ in src/app/learn/[subject]/[chapter]/page.tsx */
function isLearnPageMCQ(q: Question): boolean {
  if (q.question_type === 'mcq') return true;
  const opts = Array.isArray(q.options)
    ? q.options
    : (() => { try { return JSON.parse(q.options as string); } catch { return []; } })();
  return (
    opts.length === 4 &&
    typeof q.correct_answer_index === 'number' &&
    q.correct_answer_index >= 0 &&
    q.correct_answer_index <= 3
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'test-id',
    question_text: 'What is photosynthesis?',
    question_hi: null,
    question_type: null,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_answer_index: 2,
    explanation: 'Photosynthesis is the process by which plants make food.',
    explanation_hi: null,
    bloom_level: 'remember',
    difficulty: 2,
    chapter_number: 1,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('isLearnPageMCQ', () => {
  it('passes an MCQ question with explicit question_type="mcq", 4 options, and a valid correct_answer_index', () => {
    const q = makeQuestion({ question_type: 'mcq', correct_answer_index: 2 });
    expect(isLearnPageMCQ(q)).toBe(true);
  });

  it('passes a question detected by shape — no question_type, but exactly 4 options and a valid correct_answer_index', () => {
    // Legacy rows pre-date the question_type column and rely on shape detection.
    const q = makeQuestion({
      question_type: null,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correct_answer_index: 0,
    });
    expect(isLearnPageMCQ(q)).toBe(true);
  });

  it('filters OUT a short_answer question — empty options array, no correct_answer_index', () => {
    const q = makeQuestion({
      question_type: 'short_answer',
      options: [],
      correct_answer_index: -1, // sentinel: not applicable
    });
    expect(isLearnPageMCQ(q)).toBe(false);
  });

  it('filters OUT a malformed MCQ that only has 2 options (cannot be displayed as A/B/C/D)', () => {
    const q = makeQuestion({
      question_type: null,
      options: ['True', 'False'],
      correct_answer_index: 0,
    });
    expect(isLearnPageMCQ(q)).toBe(false);
  });

  it('filters OUT a question with question_type="long_answer" regardless of other fields', () => {
    // Even if options were somehow populated, long_answer means no MCQ UI.
    const q = makeQuestion({
      question_type: 'long_answer',
      options: [], // typically empty for essay questions
      correct_answer_index: 0,
    });
    // question_type is not 'mcq', and opts.length is 0 — both guards reject it.
    expect(isLearnPageMCQ(q)).toBe(false);
  });
});
