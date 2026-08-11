/**
 * Boundary lock — the learn chapter page is a FORMATIVE self-check, and the
 * chapter's SCORED attempt lives on the canonical /quiz engine.
 *
 * The learn chapter page (`src/app/(student)/learn/[subject]/[chapter]/page.tsx`)
 * renders a per-concept Quick Check. That is *formative*: it must NEVER award
 * XP, write a quiz_session, or otherwise flow through the scored submission
 * pipeline. The single authoritative scored path lives at `/quiz`
 * (`startQuizSession()` server-shuffle snapshot → `submitQuizResults()` →
 * `submit_quiz_results_v2` → `atomic_quiz_profile_update()` RPC).
 *
 * Assessment (Phase 5c-1 condition) asked for a test that locks the
 * formative-vs-scored boundary so a future edit to the chapter page cannot
 * silently graft the scored path onto the self-check (double-award / P2 economy
 * breach) or split a quiz_session write outside submitQuizResults (P4
 * atomicity). Those three canaries are unchanged below and still pass.
 *
 * ── UPDATED 2026-08-11 (Phase 5 track B) ─────────────────────────────────────
 * The page used to ALSO run a second, end-of-chapter assessment loop — a
 * `phase: 'quiz' | 'report'` state machine with its own option grid, its own
 * client-side scoring (`quizAnswers`) and its own performance report. It
 * recorded nothing: no quiz_sessions row, no quiz_responses, no server shuffle
 * snapshot, no P3 anti-cheat, no P2 XP.
 *
 * It could NOT be promoted onto the scored path, because it re-served the exact
 * same `questions` array the Quick Check had already walked the student through
 * with explanations revealed — scoring that second pass is precisely the
 * double-award this file exists to forbid. So it was DELETED, and the chapter's
 * scored attempt is now an explicit hand-off to /quiz, which selects its own
 * questions server-side.
 *
 * The old report-surface pins (`phase === 'report'`, the report's
 * `calculateScorePercent(correctQ, totalQ)` → ProgressBar chain) described that
 * deleted surface and are replaced below by pins on what took its place:
 *   1. the in-page scoring loop is gone and stays gone,
 *   2. the completion screen hands off to the canonical engine,
 *   3. `learn_chapter_completed` still fires, with an unchanged shape,
 *   4. the surviving score display is still the canonical
 *      `calculateScorePercent` value fed straight through.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// __dirname = <project-root>/src/__tests__/learn ; ../../.. = project root
const PAGE_PATH = resolve(
  __dirname,
  '../../..',
  'src/app/(student)/learn/[subject]/[chapter]/page.tsx',
);
const source = readFileSync(PAGE_PATH, 'utf-8');

describe('chapter self-check stays off the scored submission path (P2/P4 boundary)', () => {
  it('never calls submitQuizResults (the scored entrypoint lives at /quiz)', () => {
    expect(source.includes('submitQuizResults')).toBe(false);
  });

  it('never invokes the atomic_quiz_profile_update RPC directly', () => {
    expect(source.includes('atomic_quiz_profile_update')).toBe(false);
  });

  it('never writes a quiz_sessions row (no INSERT path outside submitQuizResults)', () => {
    expect(/from\(\s*['"]quiz_sessions['"]\s*\)/.test(source)).toBe(false);
    expect(source.includes('quiz_sessions')).toBe(false);
  });

  it('never starts a server quiz session (that is the /quiz engine\'s job)', () => {
    // startQuizSession is what mints the quiz_session_shuffles snapshot. If it
    // ever appears here, this page has begun running a graded attempt.
    expect(source.includes('startQuizSession')).toBe(false);
    expect(source.includes('checkQuizAnswer')).toBe(false);
  });
});

describe('the second in-page assessment loop is gone and stays gone (Phase 5 track B)', () => {
  it('has no quiz/report phase state machine', () => {
    expect(source.includes("phase === 'quiz'")).toBe(false);
    expect(source.includes("phase === 'report'")).toBe(false);
    expect(source.includes("setPhase(")).toBe(false);
    expect(/useState<'explaining'/.test(source)).toBe(false);
  });

  it('has no second answer store or cursor for an in-page chapter quiz', () => {
    // Comments still name these (they explain the deletion); the pins are on
    // live code, so look for the declarations and the state writers.
    expect(/const\s+\[quizAnswers\s*,/.test(source)).toBe(false);
    expect(/const\s+\[quizCurrentIdx\s*,/.test(source)).toBe(false);
    expect(/const\s+\[quizSelectedOption\s*,/.test(source)).toBe(false);
    expect(source.includes('setQuizAnswers(')).toBe(false);
    expect(source.includes('setQuizSelectedOption(')).toBe(false);
  });

  it('mentions correct_answer_index in exactly 3 places — the type, and the 2 formative Quick Check reads', () => {
    // The deleted loop carried two more browser-side correctness reads over
    // the SAME deck: the grader (`quizSelectedOption === q.correct_answer_index`)
    // and the answer-reveal highlight (`idx === q.correct_answer_index`). What
    // survives is the `Question` interface field plus the Quick Check's own
    // two (submitAnswer's grade + its option highlight). A 4th occurrence means
    // a new client-scored surface has appeared on this page.
    const mentions = source.match(/correct_answer_index/g) ?? [];
    expect(mentions.length).toBe(3);
    // Pin the two survivors so the count can't be satisfied by different reads.
    expect(source.includes('state.selectedOption === q.correct_answer_index')).toBe(true);
    expect(source.includes('idx === question.correct_answer_index')).toBe(true);
  });
});

describe('the chapter hands its SCORED attempt to the canonical /quiz engine', () => {
  it('the completion screen links to /quiz with this chapter pinned', () => {
    expect(/\/quiz\?subject=\$\{subject\}&chapter=\$\{chapterNum\}/.test(source)).toBe(true);
  });

  it('still emits learn_take_quiz_clicked on the hand-off', () => {
    expect(source.includes("track('learn_take_quiz_clicked'")).toBe(true);
  });
});

describe('learn_chapter_completed telemetry shape is unchanged (single producer)', () => {
  it('fires exactly once in the source — the duplicate producer is gone', () => {
    const producers = source.match(/track\('learn_chapter_completed'/g) ?? [];
    expect(producers.length).toBe(1);
  });

  it('carries the same four properties on top of telemetryBase', () => {
    const block = source.match(
      /track\('learn_chapter_completed',\s*\{[\s\S]*?\}\);/,
    );
    expect(block).not.toBeNull();
    const payload = block![0];
    expect(payload).toContain('...telemetryBase');
    expect(payload).toMatch(/score_pct:\s*pct/);
    expect(payload).toMatch(/total_answered:\s*totalAnswered/);
    expect(payload).toMatch(/correct_count:\s*correctCount/);
    expect(payload).toMatch(/passed_threshold:\s*scoreGood/);
  });

  it('still writes chapter progress through updateChapterProgress', () => {
    expect(source.includes('updateChapterProgress(subject, student.grade, chapterNum)')).toBe(true);
  });
});

describe('score display is the canonical calculateScorePercent value (P1 / Invariant 7)', () => {
  it('the completion surface derives its percentage via calculateScorePercent', () => {
    expect(/const\s+pct\s*=\s*calculateScorePercent\(\s*correctCount\s*,\s*totalAnswered\s*\)/.test(source)).toBe(true);
  });

  it('feeds that derived pct straight into ProgressBar (no recomputed value at the bar)', () => {
    expect(/<ProgressBar[\s\S]{0,200}?value=\{pct\}/.test(source)).toBe(true);
    expect(/<ProgressBar[\s\S]{0,200}?value=\{\s*Math\.round/.test(source)).toBe(false);
  });
});
