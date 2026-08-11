/**
 * Phase 5 track B — the chapter's scored attempt reaches a PERSISTING engine.
 *
 * ── The hole this closes ─────────────────────────────────────────────────────
 * The learn chapter page used to end in an in-page "chapter quiz": an option
 * grid, a score, a percentage, confetti, and a strengths/gaps performance
 * report. It wrote NONE of it. No `quiz_sessions` row, no `quiz_responses`, no
 * server-owned `quiz_session_shuffles` snapshot, no P3 anti-cheat, no P2 XP.
 * A student could finish "the chapter quiz" and have the attempt not exist.
 *
 * ── Why it was deleted rather than wired to submitQuizResults ────────────────
 * That loop re-served the EXACT `questions` array the per-concept Quick Check
 * had already walked the student through with the explanation revealed. Making
 * that second pass scored would have awarded XP for pre-revealed answers and
 * fed the learner-state update a ~100%-by-construction signal — the
 * double-award breach `chapter-formative-boundary.test.ts` exists to forbid.
 *
 * So the surface that recorded nothing is gone, and the chapter's scored
 * attempt is an explicit hand-off to /quiz, which selects its own questions
 * server-side and runs the full canonical chain. This file proves the hand-off
 * lands on that chain, end to end:
 *
 *     learn completion CTA
 *        → /quiz?subject=&chapter=&mode=practice
 *        → startQuizSession()            (server shuffle snapshot, P1/P6)
 *        → submitQuizResults(sessionId)  (P4 single RPC)
 *        → submit_quiz_results_v2        (P1 score, P2 XP, P3 anti-cheat)
 *        → persisted quiz_sessions row + XP
 *
 * Source-canaries over real files, no DB. They fail loudly if any link in that
 * chain is cut.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const HOST_ROOT = resolve(__dirname, '../../..');
const REPO_ROOT = resolve(HOST_ROOT, '../..');

const learnSource = readFileSync(
  resolve(HOST_ROOT, 'src/app/(student)/learn/[subject]/[chapter]/page.tsx'),
  'utf-8',
);
const quizSource = readFileSync(
  resolve(HOST_ROOT, 'src/app/(student)/quiz/page.tsx'),
  'utf-8',
);
const supabaseSource = readFileSync(
  resolve(REPO_ROOT, 'packages/lib/src/supabase.ts'),
  'utf-8',
);

// ── Link 1: the learn page hands off, and keeps nothing scored of its own ────

describe('link 1 — the chapter page hands its scored attempt to /quiz', () => {
  it('routes the completion CTA to /quiz with subject + chapter pinned', () => {
    expect(
      learnSource.includes('/quiz?subject=${subject}&chapter=${chapterNum}&mode=practice'),
    ).toBe(true);
  });

  it('the destination is the live quiz orchestrator, not a second in-page engine', () => {
    // If either of these reappears, a scoring surface has been re-grafted here.
    expect(learnSource.includes("phase === 'quiz'")).toBe(false);
    expect(learnSource.includes("phase === 'report'")).toBe(false);
  });

  it('/quiz honours the ?chapter= and ?mode=practice params the CTA sends', () => {
    expect(/const chapterParam = params\.get\('chapter'\);/.test(quizSource)).toBe(true);
    expect(/setSelectedChapter\(ch\)/.test(quizSource)).toBe(true);
    expect(quizSource.includes("if (mode === 'practice')")).toBe(true);
  });
});

// ── Link 2: /quiz mints a server session before serving anything ─────────────

describe('link 2 — the destination engine starts a server-owned session', () => {
  it('/quiz calls startQuizSession', () => {
    expect(quizSource.includes('startQuizSession(')).toBe(true);
  });

  it('startQuizSession snapshots options + correct_answer_index server-side', () => {
    // The snapshot is what makes browser knowledge of question_bank's
    // correct_answer_index useless against a real attempt: the displayed order
    // is minted per session and the client never receives the answer index.
    expect(supabaseSource.includes("supabase.rpc('start_quiz_session'")).toBe(true);
    expect(supabaseSource.includes('quiz_session_shuffles')).toBe(true);
    expect(
      /returns the SHUFFLED options to the client[\s\S]{0,80}WITHOUT correct_answer_index/.test(
        supabaseSource,
      ),
    ).toBe(true);
  });

  it('every served question is snapshotted, not just the MCQs (Phase 4 P0-1)', () => {
    expect(quizSource.includes('collectSessionQuestionIds(')).toBe(true);
  });
});

// ── Link 3: submission persists through the canonical atomic chain ───────────

describe('link 3 — submission persists a session and awards XP atomically', () => {
  it('/quiz submits through submitQuizResults, carrying the server session id', () => {
    expect(quizSource.includes('submitQuizResults(')).toBe(true);
    expect(quizSource.includes('serverSessionId')).toBe(true);
  });

  it('submitQuizResults is a single call to the v2 RPC (P4 atomicity)', () => {
    expect(supabaseSource.includes("supabase.rpc('submit_quiz_results_v2'")).toBe(true);
    // One graded submission per server session, forever: the session id doubles
    // as the idempotency key, so a resumed tab cannot award XP twice.
    expect(/p_idempotency_key:\s*sessionId \?\? null/.test(supabaseSource)).toBe(true);
  });

  it('elapsed time is derived once, in every mode (Phase 4 P0-2 — feeds P3 check 1)', () => {
    expect(quizSource.includes('computeElapsedSeconds(')).toBe(true);
  });

  it('the RPC — not this page and not the learn page — owns score, XP and anti-cheat', () => {
    // P1/P2/P3 live server-side. Neither client re-derives them.
    expect(learnSource.includes('XP_RULES')).toBe(false);
    expect(learnSource.includes('submitQuizResults')).toBe(false);
  });
});

// ── Link 4: the chapter still gets marked, from exactly one place per surface ─

describe('link 4 — chapter progress is written on both sides of the hand-off', () => {
  it('/quiz updates chapter progress after a scored attempt', () => {
    expect(quizSource.includes('updateChapterProgress(')).toBe(true);
    expect(quizSource.includes('const chapterForProgress = selectedChapter ?? questions[0]?.chapter_number ?? null;')).toBe(true);
  });

  it('the learn page writes chapter progress exactly once (the duplicate producer is gone)', () => {
    const calls = learnSource.match(/updateChapterProgress\(/g) ?? [];
    expect(calls.length).toBe(1);
  });
});
