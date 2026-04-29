#!/usr/bin/env node
/**
 * reorder-baseline.mjs
 * --------------------
 * Minimal stream transform that rewrites PL/pgSQL `<table>%ROWTYPE`
 * declarations to the generic `RECORD` type, leaving the rest of a sanitized
 * pg_dump baseline byte-for-byte intact.
 *
 * Why this exists
 * ---------------
 * pg_dump emits objects in dependency-aware topological order and relies on
 * `SET check_function_bodies = false` so a function body is not validated
 * against missing referenced objects on first parse. That covers function
 * BODIES.
 *
 * The single documented exception is `%ROWTYPE` declarations in PL/pgSQL
 * `DECLARE` blocks. `%ROWTYPE` is resolved at PARSE time of the function
 * (before `check_function_bodies` kicks in), so a `CREATE FUNCTION` whose
 * DECLARE references a not-yet-created table fails on a fresh replay even
 * with the `check_function_bodies` toggle off.
 *
 * Earlier iterations of this script tried to bucket-reorder every statement
 * in pg_dump's output to satisfy that one constraint. That broke pg_dump's
 * own carefully-computed within-class ordering (e.g. SQL function A calling
 * SQL function B) and required a new bucket-fix for every prod-specific
 * dependency class we tripped on (function-to-function calls, view-on-view,
 * functional indexes, partial-index predicates, etc.). PRs #464, #466, #467,
 * #469 each shipped one of those fixes; this PR replaces the whole approach.
 *
 * The fix
 * -------
 * Rewrite `<schema>.<table>%ROWTYPE` and `<table>%ROWTYPE` to `RECORD`. PL/pgSQL
 * `RECORD` is a generic row type that PostgreSQL resolves at runtime via the
 * `SELECT INTO` (or `RETURNING ... INTO`) that populates it. Field access
 * `v_rec.column_name` works identically. The function body does not change.
 *
 * This preserves pg_dump's natural --schema-only ordering and removes every
 * other class of replay failure that bucket-reordering had to chase.
 *
 * Idempotent: running the script on its own output is a no-op (after the
 * first pass, no `%ROWTYPE` strings remain to rewrite).
 *
 * Usage:
 *   node scripts/reorder-baseline.mjs < input.sql > output.sql
 *   node scripts/reorder-baseline.mjs --input input.sql --output output.sql
 *
 * Self-tests:
 *   node scripts/reorder-baseline.mjs --self-test
 *
 * Owned by the architect agent (CI/baseline tooling).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath as _fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Core transform
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite `<schema>.<table>%ROWTYPE` and `<table>%ROWTYPE` (with or without
 * double-quoted identifiers, case-insensitive on the literal `ROWTYPE` keyword)
 * to `RECORD`.
 *
 * Identifier shapes accepted (matching pg_dump output):
 *   - public.adaptive_mastery%ROWTYPE
 *   - "public"."adaptive_mastery"%ROWTYPE
 *   - adaptive_mastery%ROWTYPE
 *   - "adaptive_mastery"%ROWTYPE
 *   - adaptive_mastery%RowType   (case-insensitive)
 *
 * The regex consumes the full `<ident>(.<ident>)?%ROWTYPE` token and replaces
 * it with `RECORD`. Whitespace is preserved (the substitution is exact).
 *
 * Identifier subpattern: an unquoted SQL identifier ([A-Za-z_][A-Za-z0-9_]*)
 * OR a double-quoted identifier ("..." with no embedded quotes — pg_dump
 * doesn't emit "" escapes inside table names).
 */
const ROWTYPE_RE =
  /(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))?%ROWTYPE/gi;

export function rewriteRowtype(src) {
  return src.replace(ROWTYPE_RE, 'RECORD');
}

// Kept exported under the old name so any external caller (workflow, runbook
// snippet) that referenced `reorder()` keeps working without an interface
// break. The whole point of this PR is that there is no longer any reordering
// — the function is a pure %ROWTYPE → RECORD rewrite.
export const reorder = rewriteRowtype;

// ─────────────────────────────────────────────────────────────────────────────
// Self-tests (run with --self-test)
// ─────────────────────────────────────────────────────────────────────────────

function selfTest() {
  let passed = 0;
  let failed = 0;
  const expect = (label, cond, detail) => {
    if (cond) {
      passed += 1;
      process.stdout.write(`  PASS  ${label}\n`);
    } else {
      failed += 1;
      console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
  };

  // 1. Schema-qualified bare-identifier form.
  expect(
    'rewrites public.adaptive_mastery%ROWTYPE → RECORD',
    rewriteRowtype('  v_rec public.adaptive_mastery%ROWTYPE;') ===
      '  v_rec RECORD;',
  );

  // 2. Schema-qualified quoted form.
  expect(
    'rewrites "public"."adaptive_mastery"%ROWTYPE → RECORD',
    rewriteRowtype('  v_rec "public"."adaptive_mastery"%ROWTYPE;') ===
      '  v_rec RECORD;',
  );

  // 3. Unqualified bare form.
  expect(
    'rewrites adaptive_mastery%ROWTYPE → RECORD',
    rewriteRowtype('DECLARE v adaptive_mastery%ROWTYPE;') ===
      'DECLARE v RECORD;',
  );

  // 4. Unqualified quoted form.
  expect(
    'rewrites "adaptive_mastery"%ROWTYPE → RECORD',
    rewriteRowtype('DECLARE v "adaptive_mastery"%ROWTYPE;') ===
      'DECLARE v RECORD;',
  );

  // 5. Case-insensitive on the ROWTYPE keyword.
  expect(
    'case-insensitive: %RowType also rewrites',
    rewriteRowtype('v public.foo%RowType;') === 'v RECORD;',
  );

  // 6. Inside a CREATE FUNCTION dollar-quoted body (single line).
  const sqlSingle =
    "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v public.foo%ROWTYPE; BEGIN RETURN; END; $$;";
  const expSingle =
    "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v RECORD; BEGIN RETURN; END; $$;";
  expect('rewrites %ROWTYPE inside single-line $$ … $$ body', rewriteRowtype(sqlSingle) === expSingle);

  // 7. Inside a CREATE FUNCTION dollar-quoted body (multi-line).
  const sqlMulti = [
    'CREATE OR REPLACE FUNCTION public.bkt_update() RETURNS void LANGUAGE plpgsql AS $$',
    'DECLARE',
    '  v_rec public.adaptive_mastery%ROWTYPE;',
    'BEGIN',
    '  RETURN;',
    'END;',
    '$$;',
  ].join('\n');
  const out7 = rewriteRowtype(sqlMulti);
  expect('rewrites %ROWTYPE inside multi-line $$ … $$ body',
    out7.includes('  v_rec RECORD;') && !out7.includes('%ROWTYPE'));

  // 8. Multiple ROWTYPEs in one chunk.
  const sqlMany =
    'DECLARE a foo%ROWTYPE; b public.bar%ROWTYPE; c "baz"%ROWTYPE;';
  expect('rewrites multiple %ROWTYPE on one line',
    rewriteRowtype(sqlMany) === 'DECLARE a RECORD; b RECORD; c RECORD;');

  // 9. No %ROWTYPE → no-op (byte-for-byte identical).
  const noop = [
    'CREATE TABLE IF NOT EXISTS public.adaptive_mastery (id uuid PRIMARY KEY);',
    "CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
    'CREATE INDEX idx_foo ON public.foo(id);',
    'ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;',
    "COMMENT ON SCHEMA public IS 'standard';",
    '',
  ].join('\n');
  expect('no-op when input has no %ROWTYPE (byte-stable)', rewriteRowtype(noop) === noop);

  // 10. Idempotency: running twice produces identical output.
  const idem = sqlMulti;
  const once = rewriteRowtype(idem);
  const twice = rewriteRowtype(once);
  expect('idempotent: rewrite(rewrite(x)) === rewrite(x)', once === twice);

  // 11. Preserves CREATE FUNCTION emit order — pg_dump's natural function-
  //     to-function call dependency (the regression in CI run 25099665927).
  const fnChain = [
    'CREATE OR REPLACE FUNCTION public.check_plan_limits(p_id uuid, p_kind text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object($1::text, $2) $$;',
    'CREATE OR REPLACE FUNCTION public.check_foxy_quota(p_student_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.check_plan_limits(p_student_id, \'foxy\') $$;',
  ].join('\n');
  const outChain = rewriteRowtype(fnChain);
  const planIdx = outChain.indexOf('check_plan_limits(p_id uuid');
  const foxyIdx = outChain.indexOf('check_foxy_quota(p_student_id');
  expect('preserves pg_dump natural function-to-function ordering',
    planIdx > -1 && foxyIdx > -1 && planIdx < foxyIdx,
    `plan=${planIdx} foxy=${foxyIdx}`);

  // 12. Line count is unchanged (RECORD rewrite is a 1:1 token swap).
  const lines = sqlMulti.split('\n').length;
  const linesAfter = rewriteRowtype(sqlMulti).split('\n').length;
  expect('line count unchanged after rewrite',
    lines === linesAfter, `before=${lines} after=${linesAfter}`);

  // 13. Boundary: %ROWTYPE-like substring inside a comment is still rewritten
  //     (we don't try to skip comments — there are no false positives in
  //     pg_dump output and the surface stays simple). This test pins behavior.
  const comment = '-- this %ROWTYPE comment will not match (no preceding ident)';
  expect('comment without preceding identifier is left alone',
    rewriteRowtype(comment) === comment);

  // 14. Identifier with digits in it.
  expect('identifier with digits handled',
    rewriteRowtype('v t1_v2%ROWTYPE;') === 'v RECORD;');

  // 15. Underscore-leading identifier.
  expect('underscore-leading identifier handled',
    rewriteRowtype('v _internal_state%ROWTYPE;') === 'v RECORD;');

  process.stdout.write(`\nself-test: ${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exit(selfTest());
  }

  let inPath = null;
  let outPath = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--input' || args[i] === '-i') inPath = args[i + 1];
    if (args[i] === '--output' || args[i] === '-o') outPath = args[i + 1];
    if (args[i] === '--help' || args[i] === '-h') {
      console.error('usage: node scripts/reorder-baseline.mjs [--input X] [--output Y] [--self-test]');
      console.error('       (defaults to stdin / stdout if --input / --output omitted)');
      process.exit(0);
    }
  }

  const input = inPath
    ? readFileSync(inPath, 'utf8')
    : readFileSync(0, 'utf8'); // fd 0 = stdin
  const output = rewriteRowtype(input);
  if (outPath) {
    writeFileSync(outPath, output);
  } else {
    process.stdout.write(output);
  }
}

const _entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const _self = _fileURLToPath(import.meta.url).replace(/\\/g, '/');
if (_entry === _self) {
  await main();
}
