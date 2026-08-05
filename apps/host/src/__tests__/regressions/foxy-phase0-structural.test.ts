/**
 * Foxy North-Star Phase 0 — structural pins (REG-346 / REG-347).
 *
 * Two independent contracts pinned against SOURCE TEXT (no live DB / no Deno
 * runtime in the Vitest lane — the same structural pattern as
 * board-score-edge-function-structural.test.ts):
 *
 * 1. F8 hint_level server contract (REG-346):
 *    - 20260805100100 adds quiz_responses.hint_level smallint with the
 *      CHECK (0..3), nullable, no backfill.
 *    - 20260805100200's submit_quiz_results_v2 regex-guards the per-response
 *      "hint_level" key ('^[0-3]$' → smallint, else NULL — a malformed client
 *      payload can never abort the submit transaction) and persists it in the
 *      quiz_responses INSERT. Telemetry only: v_hint_level must never feed
 *      is_correct / score / XP / anti-cheat logic (P1/P2/P3 untouched).
 *
 * 2. F1 IRT resurrect behavior-neutrality (REG-347):
 *    - quiz-generator's IRT branch is gated by isIRTSelectionEnabled() reading
 *      ff_irt_question_selection, requiring is_enabled === true AND
 *      rollout_percentage >= 100, FAIL-CLOSED (false) on any read error —
 *      flag-off (production posture: OFF/0%, protected tier staged_rollout)
 *      keeps the legacy mastery-driven flow byte-reachable and the IRT path
 *      dead.
 *    - selectQuestionsByIRT calls select_questions_by_irt_info with EXACTLY
 *      the baseline:6702 arg names (p_student_id, p_subject, p_grade,
 *      p_chapter_number, p_match_count, p_exclude_ids) and normalizes the
 *      RPC's `question_id` return column onto `id` (load-bearing downstream
 *      for dedup + question-history upsert).
 *    Known gap (recorded in the catalog entry): no Deno-lane test executes
 *    the flag-ON branch end-to-end; these are source pins + the flag-off
 *    posture, not a runtime IRT selection test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf-8');

const colMigration = read('supabase/migrations/20260805100100_quiz_responses_hint_level.sql');
const rpcMigration = read('supabase/migrations/20260805100200_submit_quiz_v2_persist_hint_level.sql');
const quizGen = read('supabase/functions/quiz-generator/index.ts');

// Strip SQL line comments so prose mentions can't satisfy executable pins.
const rpcSql = rpcMigration
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
// Strip TS line comments likewise.
const quizGenCode = quizGen
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, ''))
  .join('\n');

describe('REG-346 — F8 hint_level column migration (20260805100100)', () => {
  it('adds a NULLABLE smallint hint_level column idempotently (no backfill)', () => {
    expect(colMigration).toMatch(/ADD COLUMN IF NOT EXISTS hint_level smallint/i);
    expect(colMigration).not.toMatch(/NOT NULL/i);
    expect(colMigration).not.toMatch(/UPDATE\s+public\.quiz_responses/i);
  });

  it('pins the 0..3 CHECK constraint, duplicate_object-guarded', () => {
    expect(colMigration).toMatch(/quiz_responses_hint_level_check/);
    expect(colMigration).toMatch(/CHECK \(hint_level >= 0 AND hint_level <= 3\)/);
    expect(colMigration).toMatch(/duplicate_object/);
  });
});

describe('REG-346 — F8 submit_quiz_results_v2 persistence (20260805100200)', () => {
  it('declares v_hint_level SMALLINT and regex-guards the client value (^[0-3]$ → smallint, else NULL)', () => {
    expect(rpcSql).toMatch(/v_hint_level SMALLINT/);
    expect(rpcSql).toMatch(
      /v_hint_level := CASE\s+WHEN \(r->>'hint_level'\) ~ '\^\[0-3\]\$' THEN \(r->>'hint_level'\)::SMALLINT\s+ELSE NULL\s+END/,
    );
  });

  it('the quiz_responses INSERT carries the hint_level column and v_hint_level value', () => {
    const insertBlock = rpcSql.match(
      /INSERT INTO quiz_responses[\s\S]{0,1200}?VALUES[\s\S]{0,1200}?;/,
    );
    expect(insertBlock).not.toBeNull();
    expect(insertBlock![0]).toMatch(/\bhint_level\b/);
    expect(insertBlock![0]).toMatch(/\bv_hint_level\b/);
  });

  it('telemetry only: v_hint_level appears ONLY in declaration, normalization, and the INSERT — never in scoring/XP/anti-cheat logic', () => {
    // Every executable occurrence must be one of the three sanctioned sites.
    const lines = rpcSql.split('\n').filter((l) => /\bv_hint_level\b/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const sanctioned =
        /v_hint_level SMALLINT/.test(line) || // DECLARE
        /v_hint_level := CASE/.test(line) || // normalization
        // INSERT value-list line: bare comma-separated identifiers only
        // (e.g. "v_shuffle, v_error_type, v_hint_level") — no operators,
        // no function calls, so it cannot be a computation.
        /^\s*[A-Za-z_][\w]*(\s*,\s*[A-Za-z_][\w]*)*\s*\)?,?;?\s*$/.test(line);
      expect(sanctioned, `unsanctioned v_hint_level use: "${line.trim()}"`).toBe(true);
    }
    // And none of the scoring variables are computed FROM it.
    expect(rpcSql).not.toMatch(/(v_correct|v_score|v_xp|xp_earned|is_correct)[^\n]*v_hint_level/);
  });
});

describe('REG-347 — F1 IRT resurrect: flag gate + RPC contract (quiz-generator)', () => {
  it('the IRT branch is live code gated by isIRTSelectionEnabled (not the dead `useIRT = false` stub)', () => {
    expect(quizGenCode).toMatch(/const useIRT = await isIRTSelectionEnabled\(supabase\)/);
    expect(quizGenCode).not.toMatch(/const useIRT = false/);
    expect(quizGenCode).not.toMatch(/const irtQuestions: any\[\] = \[\]/);
  });

  it('the flag gate reads ff_irt_question_selection and requires is_enabled AND rollout >= 100', () => {
    expect(quizGenCode).toMatch(/eq\("flag_name", "ff_irt_question_selection"\)/);
    expect(quizGenCode).toMatch(
      /data\.is_enabled === true && \(data\.rollout_percentage \?\? 0\) >= 100/,
    );
  });

  it('the flag gate FAILS CLOSED — any read error caches and returns false', () => {
    const fnBody = quizGenCode.match(
      /async function isIRTSelectionEnabled[\s\S]*?\n}/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/catch[\s\S]*?value: false[\s\S]*?return false/);
  });

  it('selectQuestionsByIRT calls select_questions_by_irt_info with the exact baseline:6702 arg names', () => {
    const call = quizGenCode.match(
      /rpc\("select_questions_by_irt_info",\s*\{[\s\S]*?\}\)/,
    );
    expect(call).not.toBeNull();
    for (const arg of [
      'p_student_id',
      'p_subject',
      'p_grade',
      'p_chapter_number',
      'p_match_count',
      'p_exclude_ids',
    ]) {
      expect(call![0]).toContain(`${arg}:`);
    }
    // No extra p_* args beyond the baseline six.
    const argNames = [...call![0].matchAll(/(p_[a-z_]+):/g)].map((m) => m[1]);
    expect(new Set(argNames).size).toBe(6);
  });

  it('normalizes the RPC row: question_id is mapped onto id (load-bearing downstream)', () => {
    expect(quizGenCode).toMatch(/id:\s*r\.question_id/);
  });

  it('baseline signature cross-check: the six arg names exist verbatim on the baseline RPC', () => {
    const baseline = read('supabase/migrations/00000000000000_baseline_from_prod.sql');
    const sig = baseline.match(
      /CREATE OR REPLACE FUNCTION "public"\."select_questions_by_irt_info"\([^)]*\)/,
    );
    expect(sig).not.toBeNull();
    for (const arg of [
      'p_student_id',
      'p_subject',
      'p_grade',
      'p_chapter_number',
      'p_match_count',
      'p_exclude_ids',
    ]) {
      expect(sig![0]).toContain(`"${arg}"`);
    }
  });
});
