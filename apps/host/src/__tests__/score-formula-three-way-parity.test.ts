import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { calculateScorePercent } from '@alfanumrik/lib/scoring';

/**
 * SLC-3 (engineering-audit Cycle 3, Student Learning Core) — P1 three-way
 * score-formula parity guard.  TEST-ONLY: the audit verified the formula is
 * byte-identical at all three computing sites today; this guard makes future
 * DRIFT fail CI.
 *
 * THE INVARIANT (P1, Score Accuracy)
 * ==================================
 *     score_percent = Math.round((correct / total) * 100)
 * It must be IDENTICAL at:
 *   1. TS computer        — src/lib/scoring.ts  calculateScorePercent()
 *   2. SQL v1 RPC         — submit_quiz_results        (baseline pg_dump)
 *   3. SQL v2 RPC         — submit_quiz_results_v2      (latest redefinition)
 * …and QuizResults.tsx must CONSUME the server `score_percent`, never recompute it.
 *
 * Existing REG-45 / REG-51 / REG-52 cover outcomes (E2E score, server-shuffle
 * authority, a production canary) but NOT formula identity across TS and SQL.
 *
 * WHAT THIS GUARD ADDS
 * ====================
 *   (a) a property/parametric test proving the TS `Math.round` (half-up) and a
 *       PostgreSQL `ROUND` (half-away-from-zero) MODEL agree on every valid
 *       (correct, total) input — the equivalence the formula silently relies on,
 *   (b) a source-inspection pin that the canonical SQL expression
 *       `ROUND((v_correct::NUMERIC / v_total) * 100)` is present in the
 *       authoritative v1 + v2 bodies and the canonical TS expression is present
 *       in scoring.ts,
 *   (c) a structural assertion that QuizResults.tsx consumes `results.score_percent`
 *       and does NOT recompute the overall score with its own Math.round.
 *
 * SLC-10: targets the CURRENT authoritative SQL (latest v2 + baseline), not the
 * archived _legacy chain.
 *
 * REGRESSION CATALOG (proposed): see file footer.
 */

// ─── Filesystem helpers ───────────────────────────────────────────────────────

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*$/gm, '').replace(/\r/g, '');
}

const MIGRATIONS_DIR = 'supabase/migrations';
const V2_LATEST = `${MIGRATIONS_DIR}/20260623000500_reapply_submit_quiz_v2_column_fix.sql`;
const BASELINE = `${MIGRATIONS_DIR}/00000000000000_baseline_from_prod.sql`;
const QUIZ_RESULTS = 'src/components/quiz/QuizResults.tsx';
const SCORING_TS = 'src/lib/scoring.ts';

// Canonical SQL score expression: ROUND((v_correct::NUMERIC / v_total) * 100)
const RE_SQL_SCORE =
  /ROUND\(\s*\(\s*v_correct::NUMERIC\s*\/\s*v_total\s*\)\s*\*\s*100\s*\)/gi;

// ════════════════════════════════════════════════════════════════════════════
// 1. Property parity — TS Math.round vs a PostgreSQL ROUND model agree on every
//    valid quiz input (0 <= correct <= total, 1 <= total <= 50).
// ════════════════════════════════════════════════════════════════════════════

/**
 * PostgreSQL `ROUND(numeric)` rounds HALF AWAY FROM ZERO; JS `Math.round` rounds
 * HALF UP (toward +Infinity). They diverge only on negative half-integers. For
 * the quiz formula the operand (correct/total)*100 is always in [0, 100], so the
 * two are provably equal. This model encodes PG's rule so the equivalence is
 * tested, not assumed (and a future negative/pre-scaled intermediate would fail).
 */
function pgRound(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}
function sqlScoreModel(correct: number, total: number): number {
  return total > 0 ? pgRound((correct / total) * 100) : 0;
}

describe('SLC-3 / P1: TS calculateScorePercent agrees with the SQL ROUND model', () => {
  it('agrees for every (correct, total) with 1<=total<=50 and 0<=correct<=total', () => {
    const mismatches: Array<{ correct: number; total: number; ts: number; sql: number }> = [];
    for (let total = 1; total <= 50; total++) {
      for (let correct = 0; correct <= total; correct++) {
        const ts = calculateScorePercent(correct, total);
        const sql = sqlScoreModel(correct, total);
        if (ts !== sql) mismatches.push({ correct, total, ts, sql });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('pins the documented representative cases (basic / rounding / boundaries)', () => {
    expect(calculateScorePercent(7, 10)).toBe(70);   // basic
    expect(calculateScorePercent(0, 10)).toBe(0);    // zero
    expect(calculateScorePercent(10, 10)).toBe(100); // perfect
    expect(calculateScorePercent(1, 3)).toBe(33);    // 33.33 -> 33 (not 33.33)
    expect(calculateScorePercent(2, 3)).toBe(67);    // 66.66 -> 67 (half-up region)
    expect(calculateScorePercent(1, 8)).toBe(13);    // 12.5 -> 13 (half-away-from-zero == half-up here)
    expect(calculateScorePercent(0, 0)).toBe(0);     // div-by-zero guard
  });

  it('the SQL ROUND model and TS agree on the .5 boundary (12.5% -> 13)', () => {
    // 1/8 * 100 = 12.5 exactly. Both PG ROUND and Math.round give 13 for the
    // non-negative operand. This is the load-bearing equivalence the formula relies on.
    expect(sqlScoreModel(1, 8)).toBe(13);
    expect(calculateScorePercent(1, 8)).toBe(13);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Source-inspection parity — canonical expression present at SQL sites + TS.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-3 / P1: canonical score expression present at all computing sites', () => {
  it('TS scoring.ts uses Math.round((correct / total) * 100)', () => {
    const ts = read(SCORING_TS).replace(/\s+/g, ' ');
    expect(ts).toMatch(/Math\.round\(\s*\(\s*correct\s*\/\s*total\s*\)\s*\*\s*100\s*\)/);
  });

  it('latest submit_quiz_results_v2 uses ROUND((v_correct::NUMERIC / v_total) * 100)', () => {
    const sql = stripComments(read(V2_LATEST));
    const matches = [...sql.matchAll(RE_SQL_SCORE)];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('baseline holds the SAME expression for v1 + v2 (>=2 occurrences)', () => {
    const sql = stripComments(read(BASELINE));
    const matches = [...sql.matchAll(RE_SQL_SCORE)];
    // baseline carries v1 submit_quiz_results AND the v2 snapshot.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('no authoritative SQL body introduces a scale/precision variant (ROUND(x, N))', () => {
    // A future `ROUND((...)*100, 2)` would diverge from Math.round. Pin that the
    // quiz score ROUND in the v2 body carries NO second (precision) argument.
    const sql = stripComments(read(V2_LATEST));
    expect(sql).not.toMatch(/ROUND\(\s*\(\s*v_correct::NUMERIC\s*\/\s*v_total\s*\)\s*\*\s*100\s*,/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Structural — QuizResults.tsx CONSUMES server score_percent, never recomputes.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-3 / P1: QuizResults consumes server score_percent (no recompute)', () => {
  it('exists and reads the displayed score from results.score_percent', () => {
    const src = read(QUIZ_RESULTS);
    expect(src.length).toBeGreaterThan(0);
    // The displayed score variable is assigned straight from the server response.
    expect(src.replace(/\s+/g, ' ')).toMatch(/const\s+pct\s*=\s*results\.score_percent\s*;/);
  });

  it('does NOT recompute the overall score with its own Math.round', () => {
    const src = read(QUIZ_RESULTS).replace(/\s+/g, ' ');
    // The overall score (pct / score_percent) must never be re-derived locally.
    // NOTE: the component legitimately computes SEPARATE breakdown sub-scores
    // (mcqPct, writtenPct, per-Bloom %, answer-distribution %) which use distinct
    // variables — those are NOT the P1 score and are intentionally allowed.
    expect(src).not.toMatch(/\bpct\s*=\s*Math\.round/);
    expect(src).not.toMatch(/score_percent\s*[:=]\s*Math\.round/);
    // And it must not derive the overall score from a raw correct/total round.
    expect(src).not.toMatch(/Math\.round\(\s*\(\s*correct\s*\/\s*total\s*\)\s*\*\s*100\s*\)/);
  });
});

/**
 * PROPOSED REGRESSION CATALOG ROW (orchestrator assigns the REG id):
 *   REG-xxx: score_formula_three_way_parity
 *     asserts  | P1 score_percent = round((correct/total)*100) is identical at the
 *              | TS computer (scoring.ts), the SQL v1+v2 RPC bodies (canonical
 *              | ROUND expression present, no precision variant), and a property
 *              | test proves Math.round == PG-ROUND model for all valid inputs;
 *              | QuizResults.tsx consumes results.score_percent and never recomputes.
 *     location | src/__tests__/score-formula-three-way-parity.test.ts
 *     status   | exists (added engineering-audit Cycle 3, SLC-3)
 *     invariant| P1 (Score Accuracy)
 */
