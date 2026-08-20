/**
 * `get_learning_source` RPC hardening — STATIC SOURCE CONTRACT canary
 * (`supabase/migrations/20260820000101_fix_get_learning_source_rpc_hardening.sql`,
 * P0-1, `docs/audits/2026-08-20-comprehensive-code-review.md`).
 *
 * ⚠️ SCOPE — READ THIS BEFORE TRUSTING IT ⚠️
 * ─────────────────────────────────────────────────────────────────────────────
 * The real behavioral proof — that all 7 valid grades are ACCEPTED, that a
 * representative set of invalid grades is REJECTED, and that a LEADING ".."
 * path segment is REJECTED — requires executing plpgsql and CANNOT run in
 * this unit lane (no DB). Those live assertions are in
 * `src/__tests__/migrations/get-learning-source-rpc-hardening.test.ts`, which
 * runs ONLY under `RUN_INTEGRATION_TESTS=1` with real `STAGING_SUPABASE_*`
 * secrets and skips cleanly otherwise. **On a normal PR those assertions do
 * not execute.** Same honest-coverage shape as REG-329/REG-330
 * (`get-plan-limit-school-coverage-structure.test.ts`).
 *
 * What THIS file does — and it is not nothing — is pin the migration's SOURCE
 * against a regression back to either of the two specific bugs this hotfix
 * fixed, both of which are subtle enough that a plausible-looking future edit
 * could reintroduce them without anyone noticing the SQL "looks wrong":
 *
 *   1. `p_grade <> ANY (array)` creeping back in place of
 *      `NOT (p_grade = ANY (array))` — the architect-agent-caught bug that
 *      would silently reject every grade, including valid ones.
 *   2. The old two-arm LIKE traversal check (`v_path LIKE '%/..%' OR v_path
 *      LIKE '%..%/'`) creeping back in place of the per-segment FOREACH scan
 *      — the original audit finding, which let a LEADING ".." segment through
 *      because the second LIKE arm only matches strings ENDING in '/'.
 *
 * This is the same static-source-contract pattern already used across this
 * suite (e.g. `get-plan-limit-school-coverage-structure.test.ts`,
 * `anti-cheat-server-parity`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../../../../supabase/migrations');
const RPC_SQL = resolve(MIGRATIONS, '20260820000101_fix_get_learning_source_rpc_hardening.sql');

function read(path: string): string {
  expect(existsSync(path), `missing migration: ${path}`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** Everything after the header comments — i.e. the statements that actually run. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

describe('20260820000101 — get_learning_source RPC hardening (source contract)', () => {
  const sql = read(RPC_SQL);
  const body = executable(sql);

  it('replaces get_learning_source with the corrected (text-grade) signature, same security posture', () => {
    expect(body).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."get_learning_source"\(/,
    );
    expect(body).toMatch(/p_grade text/);
    // The integer signature must be gone, not merely shadowed.
    expect(body).toMatch(
      /DROP FUNCTION IF EXISTS "public"\."get_learning_source"\(text, integer, text, text, text\)/,
    );
    expect(body).toMatch(/RETURNS json/);
    expect(body).toMatch(/LANGUAGE plpgsql/);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = ''/);
  });

  it('is idempotent (DROP-then-CREATE OR REPLACE) and wrapped in a single transaction', () => {
    expect(body).toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(body).not.toMatch(/\bCREATE FUNCTION\b(?!.*OR REPLACE)/);
    expect(body).toMatch(/BEGIN;/);
    expect(body).toMatch(/COMMIT;/);
  });

  it('REGRESSION GUARD — grade validation uses NOT (p_grade = ANY (...)), never the buggy `<> ANY` form', () => {
    // The correct, shipped form.
    expect(body).toMatch(
      /NOT \(p_grade = ANY \(ARRAY\['6','7','8','9','10','11','12'\]\)\)/,
    );
    // The exact bug an implementation agent introduced and architect caught
    // mid-review: `x <> ANY(array)` means "differs from AT LEAST ONE
    // element", which is true for nearly any x against a multi-element array
    // — it would reject every grade, including valid ones. Assert this form
    // is NOT present anywhere in the executable body.
    expect(body).not.toMatch(/p_grade\s*<>\s*ANY/);
  });

  it('validates all 7 CBSE grades as the exact allowed set — no silent narrowing or widening', () => {
    const match = body.match(/ARRAY\['6','7','8','9','10','11','12'\]/);
    expect(match, 'expected the exact 6..12 literal grade array').not.toBeNull();
  });

  it('P5: p_grade is typed `text`, never `integer` — the whole point of this hardening', () => {
    expect(body).toMatch(/p_grade text/);
    expect(body).not.toMatch(/p_grade integer/);
  });

  it('REGRESSION GUARD — the path-traversal guard is the per-segment FOREACH scan, never the old two-arm LIKE pair', () => {
    // The correct, shipped form: split on '/' and reject '..' or '' segments.
    expect(body).toMatch(/v_segments\s*:=\s*string_to_array\(v_path, '\/'\)/);
    expect(body).toMatch(/FOREACH v_segment IN ARRAY v_segments LOOP/);
    expect(body).toMatch(/IF v_segment = '\.\.' OR v_segment = '' THEN/);
    // The exact original bug: a second LIKE arm that only matches strings
    // ENDING in '/', so a LEADING ".." segment (e.g. '../secret/x') passes
    // straight through. Assert the old two-arm pattern is not present.
    expect(body).not.toMatch(/v_path LIKE '%\/\.\.%'/);
    expect(body).not.toMatch(/v_path LIKE '%\.\.%\/'/);
  });

  it('the traversal guard runs AFTER the path is built (it inspects the full assembled v_path, not the raw params)', () => {
    const pathBuildIdx = body.indexOf('v_path := format(');
    const guardIdx = body.indexOf('FOREACH v_segment IN ARRAY v_segments');
    expect(pathBuildIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(pathBuildIdx);
  });

  it('grants EXECUTE to service_role only — revoked from PUBLIC/anon/authenticated/postgres', () => {
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION "public"\."get_learning_source"\(text, text, text, text, text\) FROM PUBLIC/,
    );
    expect(body).toMatch(/FROM anon, authenticated/);
    expect(body).toMatch(/FROM postgres/);
    expect(body).toMatch(
      /GRANT EXECUTE ON FUNCTION "public"\."get_learning_source"\(text, text, text, text, text\) TO service_role/,
    );
  });
});
