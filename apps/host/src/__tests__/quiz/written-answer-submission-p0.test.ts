import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { collectSessionQuestionIds } from '@alfanumrik/lib/quiz/session-contract';

/**
 * P0 — "any quiz containing a non-MCQ question CANNOT BE SUBMITTED AT ALL".
 *
 * Defect (pre-existing, found in the Phase 4 review):
 *   1. `quiz/page.tsx` handed `start_quiz_session` only the MCQ ids
 *      (`qs.filter(isQuestionMCQ)`), so `quiz_session_shuffles` had NO row for
 *      any written (SA/MA/LA/NCERT-exercise) question.
 *   2. `submit_quiz_results_v2`'s per-response loop RAISEd
 *      `session_not_started` (P0001) the moment a response had no snapshot row
 *      — BEFORE any anti-cheat check could run.
 *   3. The v1 fallback and client-side scoring were removed in the 2026-08-06
 *      audit, so the exception propagated all the way to the student as
 *      "Connection lost — your answers are saved. Please retry." — a false
 *      statement: nothing was saved, no `quiz_sessions` row was written, XP was
 *      0, and every retry re-raised.
 *   4. A PURE written quiz was worse: `mcqIds.length === 0` meant
 *      `startQuizSession` was never called, `serverSessionId` stayed null,
 *      `p_session_id` was NULL, and the same lookup missed for every response.
 *
 * Reachable from the live product: `quiz-assembler.ts` validates with
 * `allowNonMcq: true`, and QuizSetup exposes Mixed / Short Answer / Long
 * Answer / NCERT Exercise pickers that `startQuiz()` honours.
 *
 * Fix (two halves, both pinned here):
 *   CLIENT — every SERVED question id is snapshotted, not just the MCQ ones
 *            (`collectSessionQuestionIds`). `start_quiz_session` already
 *            handles non-MCQ rows (identity shuffle + empty options snapshot,
 *            migration 20260801100800), so a written question now has a
 *            "served, but not as an MCQ" server record.
 *   RPC    — `submit_quiz_results_v2` scores a response through the WRITTEN
 *            lane (AI-evaluated marks, same >= 50% rule the student was shown)
 *            when the server has no usable 4-option snapshot for it AND
 *            question_bank does not call it an MCQ, and persists the written
 *            answer. The `session_not_started` RAISE is PRESERVED for MCQ.
 *
 * Invariants: P1 score formula, P2 XP constants and P3 thresholds are all
 * unchanged — this restores intended behaviour, it does not redefine it.
 */

const PAGE = 'apps/host/src/app/(student)/quiz/page.tsx';
const RPC_FIX = 'supabase/migrations/20260814000022_submit_quiz_v2_written_answer_scoring.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
    path.resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Collapse whitespace + strip full-line `--` comments for layout-tolerant SQL matching. */
function normalisedSql(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}
/** Strip `//` line comments and `/* *\/` blocks so prose can't satisfy a code assertion. */
function codeOnly(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ─────────────────────────────────────────────────────────────────────────
// CLIENT HALF — every served question is snapshotted
// ─────────────────────────────────────────────────────────────────────────

describe('P0-1 client: collectSessionQuestionIds snapshots EVERY served question', () => {
  const mcq = (id: string) => ({ id, question_type: 'mcq', options: ['a', 'b', 'c', 'd'], correct_answer_index: 0 });
  const written = (id: string, t = 'short_answer') => ({ id, question_type: t, options: [], correct_answer_index: null });

  it('a MIXED quiz snapshots the written questions too (the whole defect)', () => {
    const served = [mcq('m1'), written('w1'), mcq('m2'), written('w2', 'long_answer')];
    expect(collectSessionQuestionIds(served)).toEqual(['m1', 'w1', 'm2', 'w2']);
  });

  it('a PURE WRITTEN quiz produces a NON-EMPTY id list, so a server session is created at all', () => {
    const served = [written('w1'), written('w2', 'long_answer'), written('w3', 'medium_answer')];
    const ids = collectSessionQuestionIds(served);
    // Pre-fix this was [] -> startQuizSession never called -> serverSessionId
    // null -> p_session_id NULL -> every snapshot lookup missed -> P0001.
    expect(ids.length).toBe(3);
    expect(ids).toEqual(['w1', 'w2', 'w3']);
  });

  it('served count equals snapshotted count, which is what P3 Check 3 compares', () => {
    const served = [mcq('m1'), written('w1'), written('w2'), mcq('m2'), mcq('m3')];
    expect(collectSessionQuestionIds(served).length).toBe(served.length);
  });

  it('drops non-string / empty ids and dedupes, without dropping written questions', () => {
    const served = [mcq('m1'), { id: 42 }, { id: '' }, written('w1'), mcq('m1'), {}];
    expect(collectSessionQuestionIds(served as never)).toEqual(['m1', 'w1']);
  });

  it('is total on empty / nullish input', () => {
    expect(collectSessionQuestionIds([])).toEqual([]);
    expect(collectSessionQuestionIds(null)).toEqual([]);
    expect(collectSessionQuestionIds(undefined)).toEqual([]);
  });
});

describe('P0-1 client: the quiz page feeds start_quiz_session the FULL served set', () => {
  const src = codeOnly(PAGE);

  it('the page imports collectSessionQuestionIds', () => {
    expect(src).toMatch(/collectSessionQuestionIds/);
    expect(read(PAGE)).toMatch(/@alfanumrik\/lib\/quiz\/session-contract/);
  });

  it('the session id list is built by collectSessionQuestionIds, not an isQuestionMCQ filter', () => {
    expect(src).toMatch(/const\s+sessionQuestionIds\s*=\s*collectSessionQuestionIds\(\s*qs\s*\)/);
  });

  it('startQuizSession is called with that full list', () => {
    expect(src).toMatch(/startQuizSession\(\s*student\.id\s*,\s*sessionQuestionIds\s*\)/);
  });

  it('the MCQ-only id filter that caused the defect is GONE from executable code', () => {
    // `qs.filter(q => isQuestionMCQ(q) && typeof q.id === 'string')` was the
    // single line that stopped written questions from ever being snapshotted.
    expect(src).not.toMatch(/isQuestionMCQ\(q\)\s*&&\s*typeof\s+q\.id\s*===\s*'string'/);
    expect(src).not.toMatch(/const\s+mcqIds\s*=/);
  });

  it('merging the server snapshot never rewrites a non-MCQ question\'s options', () => {
    // Written questions now come back from start_quiz_session with an EMPTY
    // options_displayed. Overwriting `options` with [] must not reach the
    // written-answer renderer, so the merge only applies to 4-option MCQs.
    expect(src).toMatch(/s\.options_displayed\.length\s*!==\s*4/);
  });

  it('the false "your answers are saved" submit-failure copy is gone (EN + HI)', () => {
    const raw = read(PAGE);
    expect(raw).not.toMatch(/your answers are saved/i);
    expect(raw).not.toMatch(/आपके उत्तर सुरक्षित हैं/);
    // P7: the replacement must still be bilingual.
    expect(raw).toMatch(/couldn't be saved/i);
    expect(raw).toMatch(/सहेजे नहीं जा सके/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// RPC HALF — submit_quiz_results_v2 tolerates + scores written answers
// ─────────────────────────────────────────────────────────────────────────

describe('P0-1 RPC: the written-answer scoring migration exists', () => {
  it('20260814000022_submit_quiz_v2_written_answer_scoring.sql is present', () => {
    expect(resolveRepo(RPC_FIX)).not.toBeNull();
  });

  it('is a single idempotent transaction that replaces the 11-param signature', () => {
    const sql = normalisedSql(RPC_FIX);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.submit_quiz_results_v2/i);
    // Parameter list unchanged -> no new overload, no ambiguity at call time.
    expect(sql).toMatch(/p_unhinted_xp INTEGER DEFAULT 2/i);
    expect(sql).toMatch(/p_unhinted_cap INTEGER DEFAULT 30/i);
  });
});

describe('P0-1 RPC: a missing snapshot no longer destroys the whole submission', () => {
  const sql = normalisedSql(RPC_FIX);

  it('the written lane is decided from the SERVER snapshot + question_bank type, never from a client flag', () => {
    expect(sql).toMatch(/v_is_written\s*:=/i);
    expect(sql).toMatch(/jsonb_array_length\(v_options_snapshot\)\s*<>\s*4/i);
    expect(sql).toMatch(/NOT IN \('mcq'/i);
  });

  it('the session_not_started RAISE is now CONDITIONAL on the response not being written', () => {
    expect(sql).toMatch(/IF NOT v_is_written AND v_correct_idx_snapshot IS NULL THEN RAISE EXCEPTION 'session_not_started/i);
  });

  it('an MCQ with no snapshot row still RAISEs P0001 (tamper guard preserved)', () => {
    expect(sql).toMatch(/USING ERRCODE = 'P0001'/i);
    // Both passes keep their guard.
    expect((sql.match(/session_not_started:/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('the OLD unconditional "IF v_correct_idx_snapshot IS NULL THEN RAISE" is gone', () => {
    expect(sql).not.toMatch(/IF v_correct_idx_snapshot IS NULL THEN RAISE EXCEPTION 'session_not_started/i);
  });
});

describe('P0-1 RPC: written answers are SCORED, not silently discarded', () => {
  const sql = normalisedSql(RPC_FIX);

  it('written correctness comes from the AI-evaluated marks, using the same >= 50% rule the student was shown', () => {
    expect(sql).toMatch(/v_marks_possible\s*>\s*0/i);
    expect(sql).toMatch(/v_marks_awarded\s*>=\s*v_marks_possible\s*\*\s*0\.5/i);
  });

  it('marks arrive through a regex guard so a malformed payload cannot abort the transaction (P4)', () => {
    expect(sql).toMatch(/marks_awarded'\)\s*~\s*'\^/i);
    expect(sql).toMatch(/marks_possible'\)\s*~\s*'\^/i);
  });

  it('marks_awarded is clamped into [0, marks_possible]', () => {
    expect(sql).toMatch(/LEAST\(GREATEST\(v_marks_awarded, 0\), v_marks_possible\)/i);
  });

  it('the written answer text + marks + rubric feedback are PERSISTED to quiz_responses', () => {
    expect(sql).toMatch(/student_answer_text/);
    expect(sql).toMatch(/marks_awarded/);
    expect(sql).toMatch(/rubric_feedback/);
  });

  it('MCQ responses keep marks = 1 (the column default), so nothing regresses for them', () => {
    expect(sql).toMatch(/COALESCE\(v_marks_possible, 1\)/i);
  });
});

describe('P0-1 RPC: P1 / P2 / P3 are untouched by the fix', () => {
  const sql = normalisedSql(RPC_FIX);

  it('P1 score formula is byte-identical', () => {
    expect(sql).toMatch(/v_score_percent := ROUND\(\(v_correct::NUMERIC \/ v_total\) \* 100\)/i);
  });

  it('P2 XP literals are byte-identical', () => {
    expect(sql).toMatch(/v_xp := v_correct \* 10;/i);
    expect(sql).toMatch(/IF v_score_percent >= 80 THEN v_xp := v_xp \+ 20; END IF;/i);
    expect(sql).toMatch(/IF v_score_percent = 100 THEN v_xp := v_xp \+ 50; END IF;/i);
  });

  it('P3 Check 1 threshold is still 3.0s/question', () => {
    expect(sql).toMatch(/IF v_avg_time < 3\.0 AND v_total > 0 THEN v_flagged := true;/i);
  });

  it('P3 Check 3 still compares the response count against SERVED rows', () => {
    expect(sql).toMatch(
      /SELECT COUNT\(\*\) INTO v_served_count FROM quiz_session_shuffles WHERE session_id = p_session_id/i,
    );
    expect(sql).toMatch(
      /IF v_served_count = 0 OR jsonb_array_length\(p_responses\) <> v_served_count THEN v_flagged := true/i,
    );
  });

  it('P4 idempotency contract (p_idempotency_key replay short-circuit) survives', () => {
    expect(sql).toMatch(/IF p_idempotency_key IS NOT NULL THEN/i);
    expect(sql).toMatch(/'idempotent_replay', true/i);
  });
});
