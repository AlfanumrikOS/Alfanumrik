/**
 * REG: mcq-filter — Fix B regression
 *
 * Pins the MCQ-detection algorithm that gates the learn chapter page's
 * question deck.
 *
 * ── UPDATED 2026-08-11 (Phase 5 track B) ─────────────────────────────────────
 * This file used to REPLICATE the algorithm, because `isLearnPageMCQ` was a
 * module-level, non-exported function inside a Next.js page. That is no longer
 * true: the predicate now lives in `packages/lib/src/quiz/options.ts` as
 * `isMcqQuestion`, shared by the learn chapter page and the /quiz engine, so
 * this file imports and tests the REAL implementation instead of a copy of it.
 * A replica that can silently drift from production is exactly the failure mode
 * the consolidation removed — see that module's header.
 *
 * The original intent is unchanged: lock the detection logic so future edits
 * that widen or narrow the filter are immediately visible and force a
 * deliberate review of whether non-MCQ questions should still be excluded from
 * the learn page Quick Check.
 */

import { describe, it, expect } from 'vitest';
import { isMcqQuestion } from '@alfanumrik/lib/quiz/options';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type?: string | null;
  cbse_type?: string | null;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  bloom_level: string;
  difficulty: number;
  chapter_number: number;
}

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

describe('isMcqQuestion (the shared predicate the learn deck filter uses)', () => {
  it('passes an MCQ question with explicit question_type="mcq", 4 options, and a valid correct_answer_index', () => {
    const q = makeQuestion({ question_type: 'mcq', correct_answer_index: 2 });
    expect(isMcqQuestion(q)).toBe(true);
  });

  it('passes a question detected by shape — no question_type, but exactly 4 options and a valid correct_answer_index', () => {
    // Legacy rows pre-date the question_type column and rely on shape detection.
    const q = makeQuestion({
      question_type: null,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correct_answer_index: 0,
    });
    expect(isMcqQuestion(q)).toBe(true);
  });

  it('filters OUT a short_answer question — empty options array, no correct_answer_index', () => {
    const q = makeQuestion({
      question_type: 'short_answer',
      options: [],
      correct_answer_index: -1, // sentinel: not applicable
    });
    expect(isMcqQuestion(q)).toBe(false);
  });

  it('filters OUT a malformed MCQ that only has 2 options (cannot be displayed as A/B/C/D)', () => {
    const q = makeQuestion({
      question_type: null,
      options: ['True', 'False'],
      correct_answer_index: 0,
    });
    expect(isMcqQuestion(q)).toBe(false);
  });

  it('filters OUT a question with question_type="long_answer" regardless of other fields', () => {
    // Even if options were somehow populated, long_answer means no MCQ UI.
    const q = makeQuestion({
      question_type: 'long_answer',
      options: [], // typically empty for essay questions
      correct_answer_index: 0,
    });
    // question_type is not 'mcq', and opts.length is 0 — both guards reject it.
    expect(isMcqQuestion(q)).toBe(false);
  });

  it('accepts a JSON-encoded 4-option string (the other shape the DB hands back)', () => {
    const q = makeQuestion({
      question_type: null,
      options: JSON.stringify(['Alpha', 'Beta', 'Gamma', 'Delta']),
      correct_answer_index: 3,
    });
    expect(isMcqQuestion(q)).toBe(true);
  });

  it('detects a keyless 4-option row by shape alone (R2 step B, 20260814000023)', () => {
    // REPLACES "rejects correct_answer_index outside 0..3 even with 4 options
    // (P6 range)". That assertion pinned a clause that has been removed —
    // renderability is about HAVING four options, not about which one is right,
    // and no serving path supplies the answer key any more. With the clause in
    // place, exactly the rows shape-detection exists for (question_type NULL)
    // would have been mis-rendered in a written-answer box, and so would any
    // `-1`-stamped resumed MCQ whose snapshot carried a NULL question_type.
    //
    // The "index 0-3" rule did not disappear; it moved somewhere a client
    // cannot skip it — public.question_bank_p6_valid, applied inside every
    // serving RPC and inside start_quiz_session — and the TS gate still
    // rejects a PRESENT-but-out-of-range index (see
    // src/__tests__/security/keyless-question-serving.test.ts).
    expect(isMcqQuestion(makeQuestion({ question_type: null, correct_answer_index: undefined }))).toBe(true);
    // The v2 server-shuffle sentinel is still an MCQ, not a written answer.
    expect(isMcqQuestion(makeQuestion({ question_type: null, correct_answer_index: -1 }))).toBe(true);
    // Option COUNT is still the whole test: three options is still not an MCQ.
    expect(isMcqQuestion(makeQuestion({
      question_type: null,
      options: ['A', 'B', 'C'],
      correct_answer_index: 0,
    }))).toBe(false);
  });

  it('is the SUPERSET the quiz page used: cbse_type="mcq" is an explicit-type match', () => {
    // The learn page's deleted copy lacked this branch. Adopting the superset
    // is unobservable on the learn surface — getChapterQuestions() does not
    // select a cbse_type column — but it must keep working for /quiz.
    const q = makeQuestion({ question_type: null, cbse_type: 'mcq', options: [], correct_answer_index: -1 });
    expect(isMcqQuestion(q)).toBe(true);
  });

  it('returns false rather than throwing on null/undefined options (the copies threw)', () => {
    // Both originals did `JSON.parse(opts)`, and JSON.parse(null) returns null
    // — `.length` on it is a TypeError at render time.
    expect(isMcqQuestion({ question_type: null, options: null, correct_answer_index: 0 })).toBe(false);
    expect(isMcqQuestion({ question_type: null, correct_answer_index: 0 })).toBe(false);
    expect(isMcqQuestion(null)).toBe(false);
    expect(isMcqQuestion(undefined)).toBe(false);
  });
});
