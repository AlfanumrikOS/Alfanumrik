/**
 * Tests for `scripts/reorder-baseline.mjs`.
 *
 * Mirrors the script's `--self-test` harness via Vitest so `npm test` in CI
 * catches regressions automatically. The workflow's own `--self-test`
 * invocation is the defense-in-depth check.
 *
 * The script is a pure stream transform: it rewrites `<table>%ROWTYPE`
 * declarations in PL/pgSQL functions to the generic `RECORD` type, and
 * leaves the rest of a sanitized pg_dump baseline byte-for-byte intact.
 * Earlier iterations bucketed every top-level statement to satisfy
 * dependency ordering; that approach broke pg_dump's careful within-class
 * ordering and required a new bucket-fix iteration for every prod-specific
 * dependency class. The new approach trusts pg_dump and fixes only the one
 * thing pg_dump's `--schema-only` output reliably gets wrong (`%ROWTYPE` at
 * function-parse time, before `check_function_bodies` is consulted).
 *
 * Owned by the architect agent (CI/baseline tooling).
 */
import { describe, it, expect } from 'vitest';
// Pure-JS ESM module — Vitest + tsc resolve it via Node ESM.
// `reorder` is kept as an alias of `rewriteRowtype` for backward compatibility
// (any in-flight import from earlier iterations keeps working). Tests below
// exercise both names.
import { rewriteRowtype, reorder } from '../../scripts/reorder-baseline.mjs';

describe('reorder-baseline.mjs — rewriteRowtype()', () => {
  it('rewrites schema-qualified bare-identifier %ROWTYPE → RECORD', () => {
    expect(rewriteRowtype('  v_rec public.adaptive_mastery%ROWTYPE;')).toBe(
      '  v_rec RECORD;',
    );
  });

  it('rewrites schema-qualified double-quoted %ROWTYPE → RECORD', () => {
    expect(
      rewriteRowtype('  v_rec "public"."adaptive_mastery"%ROWTYPE;'),
    ).toBe('  v_rec RECORD;');
  });

  it('rewrites unqualified bare-identifier %ROWTYPE → RECORD', () => {
    expect(rewriteRowtype('DECLARE v adaptive_mastery%ROWTYPE;')).toBe(
      'DECLARE v RECORD;',
    );
  });

  it('rewrites unqualified double-quoted %ROWTYPE → RECORD', () => {
    expect(rewriteRowtype('DECLARE v "adaptive_mastery"%ROWTYPE;')).toBe(
      'DECLARE v RECORD;',
    );
  });

  it('is case-insensitive on the ROWTYPE keyword', () => {
    expect(rewriteRowtype('v public.foo%RowType;')).toBe('v RECORD;');
    expect(rewriteRowtype('v public.foo%rowtype;')).toBe('v RECORD;');
  });

  it('handles identifiers with digits and leading underscores', () => {
    expect(rewriteRowtype('v t1_v2%ROWTYPE;')).toBe('v RECORD;');
    expect(rewriteRowtype('v _internal_state%ROWTYPE;')).toBe('v RECORD;');
  });

  it('rewrites multiple %ROWTYPE declarations on a single line', () => {
    expect(
      rewriteRowtype(
        'DECLARE a foo%ROWTYPE; b public.bar%ROWTYPE; c "baz"%ROWTYPE;',
      ),
    ).toBe('DECLARE a RECORD; b RECORD; c RECORD;');
  });

  it('rewrites %ROWTYPE inside a single-line $$ … $$ function body', () => {
    const sql =
      "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v public.foo%ROWTYPE; BEGIN RETURN; END; $$;";
    expect(rewriteRowtype(sql)).toBe(
      "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v RECORD; BEGIN RETURN; END; $$;",
    );
  });

  it('rewrites %ROWTYPE inside a multi-line $$ … $$ function body', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION public.bkt_update() RETURNS void LANGUAGE plpgsql AS $$',
      'DECLARE',
      '  v_rec public.adaptive_mastery%ROWTYPE;',
      'BEGIN',
      '  RETURN;',
      'END;',
      '$$;',
    ].join('\n');
    const out = rewriteRowtype(sql);
    expect(out).toContain('  v_rec RECORD;');
    expect(out).not.toContain('%ROWTYPE');
    // The function header / footer / body shape must survive unchanged.
    expect(out).toContain(
      'CREATE OR REPLACE FUNCTION public.bkt_update() RETURNS void LANGUAGE plpgsql AS $$',
    );
    expect(out).toContain('END;\n$$;');
  });

  it('is a no-op (byte-for-byte identical) when input has no %ROWTYPE', () => {
    const input = [
      'CREATE TABLE IF NOT EXISTS public.adaptive_mastery (id uuid PRIMARY KEY);',
      "CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      'CREATE INDEX idx_foo ON public.foo(id);',
      'ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;',
      "COMMENT ON SCHEMA public IS 'standard';",
      '',
    ].join('\n');
    expect(rewriteRowtype(input)).toBe(input);
  });

  it('preserves line count exactly (1:1 token swap)', () => {
    const input = [
      'CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$',
      'DECLARE',
      '  v_rec public.adaptive_mastery%ROWTYPE;',
      '  v_rec_b api_rate_limits%ROWTYPE;',
      'BEGIN',
      '  RETURN;',
      'END;',
      '$$;',
    ].join('\n');
    expect(rewriteRowtype(input).split('\n').length).toBe(
      input.split('\n').length,
    );
  });

  it('is idempotent: rewriteRowtype(rewriteRowtype(x)) === rewriteRowtype(x)', () => {
    const input = [
      'CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$',
      'DECLARE v_rec public.adaptive_mastery%ROWTYPE;',
      'BEGIN RETURN; END;',
      '$$;',
    ].join('\n');
    const once = rewriteRowtype(input);
    const twice = rewriteRowtype(once);
    expect(twice).toBe(once);
  });

  it('preserves pg_dump natural function-to-function ordering (no reordering)', () => {
    // Regression pin for CI run 25099665927: bucket-reordering split a SQL
    // function (`check_plan_limits`) from its caller (`check_foxy_quota`),
    // putting the caller before the callee and breaking parse-time resolution
    // for SQL-language functions. The new transform never reorders — it
    // emits statements in pg_dump's natural --schema-only order (which is
    // alphabetical-ish-by-class). Tests pin that pg_dump's output passes
    // through unchanged in shape.
    const input = [
      'CREATE OR REPLACE FUNCTION public.check_plan_limits(p_id uuid, p_kind text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object($1::text, $2) $$;',
      'CREATE OR REPLACE FUNCTION public.check_foxy_quota(p_student_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.check_plan_limits(p_student_id, \'foxy\') $$;',
    ].join('\n');
    const out = rewriteRowtype(input);
    expect(out).toBe(input);
    const planIdx = out.indexOf('check_plan_limits(p_id uuid');
    const foxyIdx = out.indexOf('check_foxy_quota(p_student_id');
    expect(planIdx).toBeGreaterThan(-1);
    expect(foxyIdx).toBeGreaterThan(planIdx);
  });

  it('does not touch lines without a preceding identifier (boundary check)', () => {
    // A literal "%ROWTYPE" string with no preceding SQL identifier is left
    // alone. The regex requires an identifier before the `%` — otherwise
    // there is nothing to rewrite TO.
    const comment = '-- this %ROWTYPE comment will not match (no preceding ident)';
    expect(rewriteRowtype(comment)).toBe(comment);
  });

  it('rewrites every %ROWTYPE in a long mixed input (no false negatives)', () => {
    const input = [
      'CREATE OR REPLACE FUNCTION public.f1() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v public.foo%ROWTYPE; BEGIN END; $$;',
      'CREATE OR REPLACE FUNCTION public.f2() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v "schema"."tbl"%ROWTYPE; BEGIN END; $$;',
      'CREATE OR REPLACE FUNCTION public.f3() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v unqualified%ROWTYPE; BEGIN END; $$;',
      'CREATE TABLE IF NOT EXISTS public.foo (id int);',
      "COMMENT ON FUNCTION public.f1() IS 'doc';",
    ].join('\n');
    const out = rewriteRowtype(input);
    expect(out).not.toContain('%ROWTYPE');
    // Three rewrites should have happened (one per function).
    expect((out.match(/DECLARE v RECORD;/g) ?? []).length).toBe(3);
    // Non-ROWTYPE content must survive byte-for-byte.
    expect(out).toContain('CREATE TABLE IF NOT EXISTS public.foo (id int);');
    expect(out).toContain("COMMENT ON FUNCTION public.f1() IS 'doc';");
  });
});

describe('reorder-baseline.mjs — backward-compatible reorder() alias', () => {
  it('reorder() is an alias of rewriteRowtype() (no shape change)', () => {
    const input = 'DECLARE v public.foo%ROWTYPE;';
    expect(reorder(input)).toBe(rewriteRowtype(input));
    expect(reorder(input)).toBe('DECLARE v RECORD;');
  });
});
