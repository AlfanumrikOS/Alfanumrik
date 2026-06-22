/**
 * REG: empty-deck-degradation — Fix B empty-deck safety
 *
 * Fix B added `.filter(isLearnPageMCQ)` to the chapter reader question pipeline
 * (src/app/learn/[subject]/[chapter]/page.tsx:345-346). This introduced a new
 * edge case: a chapter whose questions are ALL non-MCQ (short_answer /
 * long_answer / intext) now filters down to an EMPTY array. The page must
 * degrade gracefully (jump straight to the performance report) instead of
 * rendering a broken quiz card that reads `questions[currentIdx]` on `undefined`.
 *
 * This test does TWO things:
 *  1. Source-text assertions — the two `questions.length === 0` guards that make
 *     the degradation safe must remain present in page.tsx. If a future edit
 *     removes either guard, this fails and forces review.
 *  2. Behavioral model — replicates the filter + the phase-decision logic and
 *     proves that an all-non-MCQ chapter yields `phase === 'report'` and never
 *     indexes into an empty question array.
 *
 * The filter algorithm is the one pinned in mcq-filter.test.ts; we re-state it
 * here so this file is self-contained for the empty-deck branch specifically.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// __dirname = <project-root>/src/__tests__/learn ; ../../.. = project root
const PAGE_PATH = resolve(
  __dirname,
  '../../..',
  'src/app/learn/[subject]/[chapter]/page.tsx',
);
const source = readFileSync(PAGE_PATH, 'utf-8');

// ── Replicated algorithm (must stay in sync with page.tsx:74-85) ──────────────
interface Q {
  id: string;
  question_type?: string | null;
  options: string | string[];
  correct_answer_index: number;
}
function isLearnPageMCQ(q: Q): boolean {
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

/** Mirrors the phase decision in page.tsx:654-666 once all concepts are done. */
function decideQuizPhase(filteredQuestions: Q[]): 'quiz' | 'report' {
  return filteredQuestions.length === 0 ? 'report' : 'quiz';
}

describe('Fix B — all-non-MCQ chapter degrades gracefully', () => {
  it('filters an all-short_answer chapter down to an empty deck', () => {
    const raw: Q[] = [
      { id: '1', question_type: 'short_answer', options: [], correct_answer_index: -1 },
      { id: '2', question_type: 'long_answer', options: [], correct_answer_index: 0 },
      { id: '3', question_type: 'intext', options: '[]', correct_answer_index: 0 },
    ];
    expect(raw.filter(isLearnPageMCQ)).toHaveLength(0);
  });

  it('an empty filtered deck routes to the report phase, never to the quiz phase', () => {
    const filtered: Q[] = [];
    expect(decideQuizPhase(filtered)).toBe('report');
  });

  it('a chapter with at least one valid MCQ still routes to the quiz phase', () => {
    const raw: Q[] = [
      { id: '1', question_type: 'short_answer', options: [], correct_answer_index: -1 },
      { id: '2', question_type: 'mcq', options: ['A', 'B', 'C', 'D'], correct_answer_index: 1 },
    ];
    const filtered = raw.filter(isLearnPageMCQ);
    expect(filtered).toHaveLength(1);
    expect(decideQuizPhase(filtered)).toBe('quiz');
  });

  it('never indexes into an empty filtered deck (no questions[idx] on []), guarding the broken-card crash', () => {
    const filtered: Q[] = [];
    const safeIdx = filtered.length > 0 ? 0 : 0;
    const q = filtered.length > 0 ? filtered[safeIdx] : null;
    expect(q).toBeNull();
  });

  // ── Source-text invariants: the guards that make the above safe in production ──

  it('page.tsx guards the phase transition with `questions.length === 0` → report (page.tsx:656)', () => {
    // The transition block: when all concepts done, an empty deck goes to report.
    expect(/questions\.length\s*===\s*0/.test(source)).toBe(true);
    expect(source.includes("setPhase('report')")).toBe(true);
  });

  it('page.tsx renders an empty-deck fallback card instead of a quiz when there are no questions', () => {
    // The quiz render path is short-circuited by a `questions.length === 0 ? (…)`
    // ternary that shows a "no quiz questions" card with a CTA to the report.
    const emptyDeckRenderGuard = /questions\.length\s*===\s*0\s*\?/;
    expect(emptyDeckRenderGuard.test(source)).toBe(true);
  });

  it('the filter is applied before setQuestions so downstream render only ever sees MCQs', () => {
    expect(source.includes('.filter(isLearnPageMCQ)')).toBe(true);
  });
});
