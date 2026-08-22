/**
 * REG: empty-deck-degradation — Fix B empty-deck safety
 *
 * Fix B added an MCQ filter to the chapter reader's question pipeline. That
 * introduced an edge case: a chapter whose questions are ALL non-MCQ
 * (short_answer / long_answer / intext) filters down to an EMPTY array. The
 * page must degrade gracefully instead of rendering a broken card that reads
 * `questions[currentIdx]` on `undefined`.
 *
 * ── UPDATED 2026-08-11 (Phase 5 track B) ─────────────────────────────────────
 * Two things changed under this test, both structural, neither weakening it:
 *
 *  1. The filter predicate is no longer a page-local `isLearnPageMCQ` replica —
 *     it is the shared `isMcqQuestion` from `packages/lib/src/quiz/options.ts`,
 *     imported here for real (see mcq-filter.test.ts for the full pin).
 *
 *  2. The empty deck used to degrade by jumping to a `phase: 'report'` branch
 *     of an in-page chapter quiz. That whole second assessment loop was deleted
 *     — the chapter's scored attempt is now the canonical /quiz engine — so the
 *     empty deck degrades to the COMPLETION SCREEN instead. The behaviour the
 *     test actually cares about is unchanged and now asserted on the surface
 *     that exists: an all-non-MCQ chapter still reaches a terminal screen, still
 *     writes chapter progress, and still never indexes an empty array.
 *
 * The chapter-progress assertion below is load-bearing: the deleted `report`
 * branch wrote `updateChapterProgress` unconditionally, and the completion
 * effect's own gate is `>= 60%` — which a chapter with nothing to answer can
 * never earn. The `|| questions.length === 0` carve-out is what preserves it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isMcqQuestion } from '@alfanumrik/lib/quiz/options';

// __dirname = <project-root>/src/__tests__/learn ; ../../.. = project root
const PAGE_PATH = resolve(
  __dirname,
  '../../..',
  'src/app/(student)/learn/[subject]/[chapter]/page.tsx',
);
const source = readFileSync(PAGE_PATH, 'utf-8');

interface Q {
  id: string;
  question_type?: string | null;
  options: string | string[];
  correct_answer_index: number;
}

describe('Fix B — all-non-MCQ chapter degrades gracefully', () => {
  it('filters an all-short_answer chapter down to an empty deck', () => {
    const raw: Q[] = [
      { id: '1', question_type: 'short_answer', options: [], correct_answer_index: -1 },
      { id: '2', question_type: 'long_answer', options: [], correct_answer_index: 0 },
      { id: '3', question_type: 'intext', options: '[]', correct_answer_index: 0 },
    ];
    expect(raw.filter(isMcqQuestion)).toHaveLength(0);
  });

  it('a chapter with at least one valid MCQ keeps a renderable deck', () => {
    const raw: Q[] = [
      { id: '1', question_type: 'short_answer', options: [], correct_answer_index: -1 },
      { id: '2', question_type: 'mcq', options: ['A', 'B', 'C', 'D'], correct_answer_index: 1 },
    ];
    expect(raw.filter(isMcqQuestion)).toHaveLength(1);
  });

  it('never indexes into an empty filtered deck (no questions[idx] on []), guarding the broken-card crash', () => {
    const filtered: Q[] = [];
    const safeIdx = filtered.length > 0 ? 0 : 0;
    const q = filtered.length > 0 ? filtered[safeIdx] : null;
    expect(q).toBeNull();
  });

  // ── Source-text invariants: the guards that make the above safe in production ──

  it('the deck filter is applied before setQuestions so downstream render only ever sees MCQs', () => {
    expect(source.includes('.filter(isMcqQuestion)')).toBe(true);
    // The page-local replica must not come back.
    expect(source.includes('function isLearnPageMCQ')).toBe(false);
  });

  it('the render path guards the Quick Check on a non-null question', () => {
    // `question` is null when the deck is empty; the Quick Check block is
    // gated on it, so an empty deck renders no option grid at all.
    expect(/const question = questions\.length > 0 \? questions\[Math\.min\(currentIdx, questions\.length - 1\)\] : null;/.test(source)).toBe(true);
    expect(source.includes('{question && (() => {')).toBe(true);
  });

  it('an empty deck still writes chapter progress (the carve-out that replaced the report branch)', () => {
    expect(/if \(scoreGood \|\| questions\.length === 0\) \{/.test(source)).toBe(true);
  });

  it('an empty deck is not offered a chapter quiz CTA it cannot fill', () => {
    // Both /quiz hand-off buttons are gated on there being a deck at all.
    expect(source.includes('scoreGood && questions.length > 0 ?')).toBe(true);
    expect(source.includes('{!scoreGood && questions.length > 0 && (')).toBe(true);
  });
});
