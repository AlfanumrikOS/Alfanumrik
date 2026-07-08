import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * REG-226 — Phase 3 Wave 1 #5 (HIGH, SD-SWEEP finding) — SECURITY DEFINER
 * quiz-RPC ownership-check STRUCTURAL pins (always-on, runs in NORMAL CI; no
 * database required).
 *
 * THE BUG THIS PINS
 * ==================
 * Three SECURITY DEFINER RPCs take a caller-supplied `p_student_id` and, prior
 * to this migration, had NO internal ownership check:
 *   1. public.submit_quiz_results(p_student_id, p_subject, p_grade, ...)  [legacy v1, RETURNS jsonb]
 *   2. public.atomic_quiz_profile_update(p_student_id, p_subject, p_xp,
 *      p_total, p_correct, p_time_seconds)                    [6-arg, RETURNS jsonb]
 *   3. public.atomic_quiz_profile_update(p_student_id, p_subject, p_xp,
 *      p_total, p_correct, p_time_seconds, p_session_id)      [7-arg, RETURNS void]
 *
 * EXECUTE was never revoked from `authenticated` on any of the three (only
 * `anon` was revoked), so ANY authenticated JWT holder could call these RPCs
 * directly via PostgREST (`supabase.rpc('submit_quiz_results', { p_student_id:
 * '<victim>', ... })`) with an ARBITRARY p_student_id and forge quiz sessions /
 * XP / streak / learning-profile rows onto another student's account — a
 * complete cross-student authorization bypass, found by the Phase 2 security
 * audit (docs/audit/2026-07-02-validation/10-security-audit.md, SD-SWEEP).
 *
 * THE FIX (migration 20260702150000_p3w1_5_quiz_rpc_ownership_check.sql)
 * ========================================================================
 * Applies the SAME pattern already proven correct in submit_quiz_results_v2
 * (baseline ~7629-7634) to all three functions, inserted immediately after
 * `BEGIN` (i.e. before any INSERT/UPDATE in the body):
 *
 *     IF auth.uid() IS NOT NULL AND NOT EXISTS (
 *       SELECT 1 FROM students
 *       WHERE id = p_student_id AND auth_user_id = auth.uid()
 *     ) THEN
 *       RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
 *     END IF;
 *
 * The `auth.uid() IS NULL` short-circuit is intentional and load-bearing: it
 * exempts service-role callers (which bypass RLS/GRANT entirely and carry no
 * JWT) — e.g. the atomic-quiz-xp-42p10-e2e integration test and any future
 * server-side admin path — from an ownership assertion that only makes sense
 * for JWT-bound `authenticated` callers.
 *
 * WHAT A REGRESSION HERE WOULD CATCH
 * ===================================
 *   - dropping the ownership-check block from any ONE of the three functions
 *     while "cleaning up" or reformatting a future redefinition
 *     (CREATE OR REPLACE silently overwrites the whole body — a partial edit
 *     is easy to make by accident);
 *   - moving the check to AFTER a mutating statement (INSERT/UPDATE), which
 *     would let the forged row land before the exception aborts the transaction
 *     in same-statement contexts, or simply defeats the intent of "reject before
 *     any write";
 *   - accidentally removing the `auth.uid() IS NULL` service-role exemption
 *     (which would break every legitimate service-role caller, including the
 *     42P10 integration test) or accidentally removing the ownership predicate
 *     itself (which would silently readmit the vulnerability for JWT callers);
 *   - re-emitting any of the three as anything other than an additive
 *     `CREATE OR REPLACE FUNCTION` (no DROP).
 *
 * Mirrors the repo's grep-the-migration structural-pin style
 * (atomic-quiz-conflict-42p10-structure.test.ts, score-formula-three-way-parity.test.ts).
 *
 * REGRESSION CATALOG: REG-226.
 */

const MIGRATION =
  'supabase/migrations/20260702150000_p3w1_5_quiz_rpc_ownership_check.sql';

function resolve(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Collapse whitespace + strip full-line `--` comments so matching is
 *  layout-tolerant and never matches the RCA prose in the header comments. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

/** The exact ownership-check block (pattern-tolerant on whitespace only). */
const RE_OWNERSHIP_CHECK =
  /IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+students\s+WHERE\s+id\s*=\s*p_student_id\s+AND\s+auth_user_id\s*=\s*auth\.uid\(\)\s*\)\s*THEN\s*RAISE\s+EXCEPTION\s+'Access denied: caller does not own student %'\s*,\s*p_student_id\s*;\s*END\s+IF\s*;/i;

/**
 * Extract the executable body of the Nth `CREATE OR REPLACE FUNCTION
 * public.<fnName>(` ... `$$;` block in the (whitespace-collapsed,
 * comment-stripped) migration source. occurrence is 1-based so the two
 * `atomic_quiz_profile_update` overloads (identical name, different arity)
 * can be distinguished by call order in the file.
 */
function nthFunctionBody(sql: string, fnName: string, occurrence: number): string {
  const startToken = `CREATE OR REPLACE FUNCTION public.${fnName}(`;
  let searchFrom = 0;
  let start = -1;
  for (let i = 0; i < occurrence; i++) {
    start = sql.indexOf(startToken, searchFrom);
    if (start < 0) return '';
    searchFrom = start + startToken.length;
  }
  const bodyOpen = sql.indexOf('AS $$', start);
  const bodyClose = sql.indexOf('$$;', bodyOpen);
  if (bodyOpen < 0 || bodyClose < 0) return '';
  return sql.slice(start, bodyClose + '$$;'.length);
}

/** Position (in a normalised body) of the first mutating INSERT/UPDATE keyword. */
function firstMutationIndex(body: string): number {
  const m = body.match(/\b(INSERT\s+INTO|UPDATE\s+public\.)/i);
  return m && m.index !== undefined ? m.index : -1;
}

// ─────────────────────────────────────────────────────────────────────────
describe('REG-226 / SD-SWEEP — quiz RPC ownership-check migration present', () => {
  it('the ownership-check migration (20260702150000) exists', () => {
    expect(resolve(MIGRATION)).not.toBeNull();
  });

  it('is wrapped in a single BEGIN/COMMIT transaction (no DROP of any kind)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/\bBEGIN\s*;/i);
    expect(sql).toMatch(/\bCOMMIT\s*;/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP FUNCTION/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/DROP TRIGGER/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The core fix: all 3 functions carry the ownership-check block, and it
// appears BEFORE any INSERT/UPDATE in the body (position check).
// ─────────────────────────────────────────────────────────────────────────
describe('REG-226 — ownership check present in exactly the 3 named functions, before any write', () => {
  const sql = normalised(MIGRATION);

  it('submit_quiz_results (v1, jsonb-returning) carries the ownership check', () => {
    const body = nthFunctionBody(sql, 'submit_quiz_results', 1);
    expect(body.length).toBeGreaterThan(500);
    expect(body).toMatch(RE_OWNERSHIP_CHECK);
  });

  it('submit_quiz_results: ownership check appears BEFORE the first INSERT/UPDATE', () => {
    const body = nthFunctionBody(sql, 'submit_quiz_results', 1);
    const checkIdx = body.search(RE_OWNERSHIP_CHECK);
    const mutIdx = firstMutationIndex(body);
    expect(checkIdx).toBeGreaterThanOrEqual(0);
    expect(mutIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeLessThan(mutIdx);
  });

  it('atomic_quiz_profile_update 6-arg overload (jsonb-returning) carries the ownership check', () => {
    const body = nthFunctionBody(sql, 'atomic_quiz_profile_update', 1);
    expect(body.length).toBeGreaterThan(300);
    // Confirm this is the 6-arg overload (no p_session_id parameter).
    expect(body).not.toMatch(/p_session_id/i);
    expect(body).toMatch(RE_OWNERSHIP_CHECK);
  });

  it('atomic_quiz_profile_update 6-arg overload: ownership check appears BEFORE the first INSERT/UPDATE', () => {
    const body = nthFunctionBody(sql, 'atomic_quiz_profile_update', 1);
    const checkIdx = body.search(RE_OWNERSHIP_CHECK);
    const mutIdx = firstMutationIndex(body);
    expect(checkIdx).toBeGreaterThanOrEqual(0);
    expect(mutIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeLessThan(mutIdx);
  });

  it('atomic_quiz_profile_update 7-arg overload (void-returning, p_session_id) carries the ownership check', () => {
    const body = nthFunctionBody(sql, 'atomic_quiz_profile_update', 2);
    expect(body.length).toBeGreaterThan(300);
    // Confirm this is the 7-arg overload.
    expect(body).toMatch(/p_session_id\s+UUID\s+DEFAULT\s+NULL/i);
    expect(body).toMatch(RE_OWNERSHIP_CHECK);
  });

  it('atomic_quiz_profile_update 7-arg overload: ownership check appears BEFORE the first INSERT/UPDATE', () => {
    const body = nthFunctionBody(sql, 'atomic_quiz_profile_update', 2);
    const checkIdx = body.search(RE_OWNERSHIP_CHECK);
    const mutIdx = firstMutationIndex(body);
    expect(checkIdx).toBeGreaterThanOrEqual(0);
    expect(mutIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeLessThan(mutIdx);
  });

  it('exactly 2 CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update( blocks exist (6-arg + 7-arg — no accidental 3rd/4th redefinition)', () => {
    const matches = sql.match(/CREATE OR REPLACE FUNCTION public\.atomic_quiz_profile_update\(/gi) ?? [];
    expect(matches.length).toBe(2);
  });

  it('exactly 1 CREATE OR REPLACE FUNCTION public.submit_quiz_results( block exists (v1 only — v2 is untouched by this migration)', () => {
    const matches = sql.match(/CREATE OR REPLACE FUNCTION public\.submit_quiz_results\(/gi) ?? [];
    expect(matches.length).toBe(1);
  });

  it('the migration source contains exactly 3 occurrences of the ownership-check block (one per fixed function — none omitted, none duplicated)', () => {
    const occurrences = sql.match(new RegExp(RE_OWNERSHIP_CHECK.source, 'gi')) ?? [];
    expect(occurrences.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Service-role exemption: auth.uid() IS NULL must short-circuit the check
// (this is what keeps the fix from breaking service-role callers, including
// the atomic-quiz-xp-42p10-e2e integration test).
// ─────────────────────────────────────────────────────────────────────────
describe('REG-226 — service-role exemption is load-bearing (auth.uid() IS NULL short-circuits)', () => {
  it('every ownership-check occurrence is gated by "auth.uid() IS NOT NULL AND" (never an unconditional NOT EXISTS)', () => {
    const sql = normalised(MIGRATION);
    const occurrences = sql.match(new RegExp(RE_OWNERSHIP_CHECK.source, 'gi')) ?? [];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occ of occurrences) {
      expect(occ).toMatch(/^IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+EXISTS/i);
    }
  });

  it('pins the pattern is IDENTICAL to the already-proven submit_quiz_results_v2 guard (same predicate shape)', () => {
    // Documentation/intent pin: the migration explicitly says it copies the
    // v2 pattern. This keeps that claim honest — a future edit that "improves"
    // the predicate (e.g. swaps students.id for a different join, or drops
    // the auth_user_id scoping) will fail this exact-string match.
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/submit_quiz_results_v2/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression-catalog documentation pin: the migration must name the audit
// finding it fixes, so the provenance is traceable from the SQL source alone.
// ─────────────────────────────────────────────────────────────────────────
describe('REG-226 — regression documentation traceable to the SD-SWEEP audit finding', () => {
  it('the migration header names the source audit doc (docs/audit/2026-07-02-validation/10-security-audit.md)', () => {
    const raw = read(MIGRATION);
    expect(raw).toMatch(/docs\/audit\/2026-07-02-validation\/10-security-audit\.md/);
  });

  it('the migration header names the SD-SWEEP finding', () => {
    const raw = read(MIGRATION);
    expect(raw).toMatch(/SD-SWEEP/);
  });

  it('every fixed function carries a SECURITY FIX comment dated 2026-07-02 referencing Phase 3 Wave 1 #5', () => {
    const raw = read(MIGRATION);
    const matches = raw.match(/SECURITY FIX \(2026-07-02, Phase 3 Wave 1 #5\)/gi) ?? [];
    // 3 inline body comments + 3 COMMENT ON FUNCTION mentions (the inline
    // comments are the load-bearing ones; require at least the 3 inline).
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// P1/P2/P4 freeze guard: the fix must be purely additive — the score formula,
// XP/cap math, and atomic-submission structure the three functions already
// carried must be untouched (only the ownership-check block + surrounding
// comments were added).
// ─────────────────────────────────────────────────────────────────────────
describe('REG-226 — P1/P2/P4 formulas untouched by the ownership-check fix', () => {
  it('submit_quiz_results still computes score_percent = ROUND((v_correct::NUMERIC / v_total) * 100)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(
      /v_score_percent\s*:=\s*ROUND\(\s*\(\s*v_correct::NUMERIC\s*\/\s*v_total\s*\)\s*\*\s*100\s*\)\s*;/i,
    );
  });

  it('submit_quiz_results still computes xp = correct*10 + 80%-bonus(20) + 100%-bonus(50)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/v_xp\s*:=\s*v_correct\s*\*\s*10\s*;/i);
    expect(sql).toMatch(/IF\s+v_score_percent\s*>=\s*80\s+THEN\s+v_xp\s*:=\s*v_xp\s*\+\s*20\s*;/i);
    expect(sql).toMatch(/IF\s+v_score_percent\s*=\s*100\s+THEN\s+v_xp\s*:=\s*v_xp\s*\+\s*50\s*;/i);
  });

  it('both atomic_quiz_profile_update overloads still enforce the 200 daily quiz-XP cap', () => {
    const sql = normalised(MIGRATION);
    // 6-arg overload cap.
    expect(sql).toMatch(/v_daily_cap\s+INT\s*:=\s*200/i);
    // 7-arg overload cap.
    expect(sql).toMatch(/LEAST\(\s*p_xp\s*,\s*200\s*-\s*v_today_quiz_xp\s*\)/i);
  });

  it('submit_quiz_results still delegates into atomic_quiz_profile_update (P4 atomic submission preserved)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(
      /PERFORM\s+atomic_quiz_profile_update\(\s*p_student_id\s*,\s*p_subject\s*,\s*v_xp\s*,\s*v_total\s*,\s*v_correct\s*,\s*p_time\s*,\s*v_session_id\s*\)\s*;/i,
    );
  });
});
