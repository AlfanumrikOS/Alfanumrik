/**
 * Tests for `scripts/reorder-baseline.mjs`.
 *
 * The script also ships a `--self-test` harness that runs the same fixture
 * matrix without Vitest. Both must stay green. This Vitest version exists so
 * `npm test` in CI catches regressions automatically (the workflow's own
 * `--self-test` invocation is a defense-in-depth check).
 *
 * The script is owned by the architect agent (CI/baseline tooling).
 */
import { describe, it, expect } from 'vitest';
// Pure-JS ESM module — Vitest + tsc resolve it via Node ESM.
import { splitStatements, classifyStatement, reorder } from '../../scripts/reorder-baseline.mjs';

describe('reorder-baseline.mjs — splitStatements', () => {
  it('splits simple statements on `;`', () => {
    const stmts = splitStatements('SELECT 1;\nSELECT 2;\n');
    expect(stmts).toHaveLength(2);
    expect(stmts[0].trimEnd()).toBe('SELECT 1;');
    expect(stmts[1].trimEnd()).toBe('SELECT 2;');
  });

  it('does NOT split inside dollar-quoted function bodies', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$',
      'BEGIN',
      '  PERFORM 1; PERFORM 2;',
      '  RETURN;',
      'END;',
      '$$;',
      'SELECT 1;',
    ].join('\n');
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('PERFORM 1; PERFORM 2;');
    expect(stmts[0]).toContain('END;');
  });

  it('handles tagged dollar quotes ($_$, $func$)', () => {
    const sql = [
      'CREATE FUNCTION g() RETURNS text LANGUAGE sql AS $func$',
      "  SELECT ';';",
      '$func$;',
      'SELECT 1;',
    ].join('\n');
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("SELECT ';';");
  });

  it('preserves single-quoted strings containing semicolons', () => {
    const sql = "INSERT INTO t (msg) VALUES ('hello; world');\nSELECT 1;\n";
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("'hello; world'");
  });

  it("handles escaped quotes ('') inside strings", () => {
    const sql = "INSERT INTO t (msg) VALUES ('it''s fine; really');\nSELECT 1;\n";
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("'it''s fine; really'");
  });

  it('handles line and block comments containing semicolons', () => {
    const sql = [
      '-- this is a comment with a ; semicolon',
      '/* block ; comment */',
      'SELECT 1;',
    ].join('\n');
    const stmts = splitStatements(sql);
    // Comments-only chunks are kept attached to the next statement, so we
    // expect 1 emitted chunk.
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('SELECT 1;');
  });
});

describe('reorder-baseline.mjs — classifyStatement', () => {
  it.each([
    ['CREATE TABLE foo (id int);', 3 /* tables */],
    ['CREATE TABLE IF NOT EXISTS foo (id int);', 3 /* tables */],
    ['ALTER TABLE foo ADD COLUMN x int;', 3 /* tables */],
    ['CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN END; $$;', 5 /* functions */],
    ['CREATE FUNCTION f() RETURNS void AS $$ BEGIN END; $$;', 5 /* functions */],
    ['CREATE PROCEDURE p() AS $$ BEGIN END; $$;', 5 /* functions */],
    ['CREATE INDEX idx_foo ON foo(id);', 4 /* indexes */],
    ['CREATE UNIQUE INDEX idx_foo ON foo(id);', 4 /* indexes */],
    ['CREATE OR REPLACE VIEW v AS SELECT 1;', 6 /* views */],
    ['CREATE MATERIALIZED VIEW mv AS SELECT 1;', 6 /* views */],
    ['CREATE TRIGGER trg AFTER INSERT ON foo EXECUTE FUNCTION f();', 7 /* triggers */],
    ['CREATE EVENT TRIGGER etrg ON sql_drop EXECUTE FUNCTION f();', 7 /* triggers */],
    ['CREATE POLICY "p1" ON foo FOR SELECT USING (true);', 8 /* policies */],
    ['DROP POLICY IF EXISTS "p1" ON foo;', 8 /* policies */],
    ['ALTER TABLE foo ENABLE ROW LEVEL SECURITY;', 8 /* policies */],
    ['ALTER TABLE foo FORCE ROW LEVEL SECURITY;', 8 /* policies */],
    ["CREATE TYPE my_enum AS ENUM ('a', 'b');", 1 /* types */],
    ['CREATE DOMAIN d AS text;', 1 /* types */],
    ['CREATE SEQUENCE seq;', 2 /* sequences */],
    ['ALTER SEQUENCE seq OWNED BY foo.id;', 2 /* sequences */],
    ['SET check_function_bodies = false;', 0 /* setup */],
    ["SELECT pg_catalog.set_config('search_path', '', false);", 0 /* setup */],
    ['CREATE EXTENSION IF NOT EXISTS pg_trgm;', 0 /* setup */],
    ['CREATE SCHEMA IF NOT EXISTS extensions;', 0 /* setup */],
    ["COMMENT ON SCHEMA public IS 'standard';", 0 /* setup */],
  ])('classifies %s → bucket %i', (stmt, expectedBucket) => {
    expect(classifyStatement(stmt)).toBe(expectedBucket);
  });

  it('routes DO $$ wrapping CREATE TYPE into types bucket', () => {
    const stmt = [
      'DO $$ BEGIN',
      "  CREATE TYPE my_enum AS ENUM ('a', 'b');",
      'EXCEPTION WHEN duplicate_object THEN NULL;',
      'END $$;',
    ].join('\n');
    expect(classifyStatement(stmt)).toBe(1 /* types */);
  });

  it('routes COMMENT ON FUNCTION into other bucket (lands at end)', () => {
    const stmt = "COMMENT ON FUNCTION f() IS 'doc';";
    expect(classifyStatement(stmt)).toBe(9 /* other */);
  });
});

describe('reorder-baseline.mjs — reorder()', () => {
  it('puts tables before functions that %ROWTYPE-reference them', () => {
    const input = [
      'CREATE OR REPLACE FUNCTION public.bkt_update() RETURNS void LANGUAGE plpgsql AS $$',
      'DECLARE v_rec public.adaptive_mastery%ROWTYPE;',
      'BEGIN RETURN; END;',
      '$$;',
      '',
      'CREATE TABLE IF NOT EXISTS public.adaptive_mastery (id uuid PRIMARY KEY);',
    ].join('\n');
    const out = reorder(input);
    const tblIdx = out.indexOf('CREATE TABLE IF NOT EXISTS public.adaptive_mastery');
    const fnIdx = out.indexOf('CREATE OR REPLACE FUNCTION public.bkt_update');
    expect(tblIdx).toBeGreaterThan(-1);
    expect(fnIdx).toBeGreaterThan(-1);
    expect(tblIdx).toBeLessThan(fnIdx);
    // The %ROWTYPE line must still be present in the function body (no content loss).
    expect(out).toContain('v_rec public.adaptive_mastery%ROWTYPE');
  });

  it('is idempotent: reorder(reorder(x)) === reorder(x)', () => {
    const input = [
      'SET check_function_bodies = false;',
      'CREATE TABLE IF NOT EXISTS foo (id int);',
      'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$',
      'DECLARE v_rec foo%ROWTYPE;',
      'BEGIN RETURN; END;',
      '$$;',
      'CREATE INDEX idx_foo ON foo(id);',
      'CREATE POLICY "p1" ON foo FOR SELECT USING (true);',
      'ALTER TABLE foo ENABLE ROW LEVEL SECURITY;',
    ].join('\n');
    const once = reorder(input);
    const twice = reorder(once);
    expect(twice).toBe(once);
  });

  it('preserves SET statements in the setup bucket (top of file)', () => {
    const input = [
      'CREATE TABLE IF NOT EXISTS foo (id int);',
      'SET check_function_bodies = false;',
      'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;',
    ].join('\n');
    const out = reorder(input);
    const setIdx = out.indexOf('SET check_function_bodies');
    const tblIdx = out.indexOf('CREATE TABLE IF NOT EXISTS foo');
    expect(setIdx).toBeLessThan(tblIdx);
  });

  it('emits buckets in canonical order (1..10)', () => {
    const input = [
      'CREATE TRIGGER trg AFTER INSERT ON foo EXECUTE FUNCTION f();',
      'CREATE OR REPLACE VIEW v AS SELECT 1;',
      'CREATE INDEX idx_foo ON foo(id);',
      'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;',
      'CREATE TABLE IF NOT EXISTS foo (id int);',
      "CREATE TYPE my_enum AS ENUM ('a');",
      'SET check_function_bodies = false;',
    ].join('\n');
    const out = reorder(input);
    const positions = {
      set: out.indexOf('SET check_function_bodies'),
      type: out.indexOf('CREATE TYPE my_enum'),
      table: out.indexOf('CREATE TABLE IF NOT EXISTS foo'),
      index: out.indexOf('CREATE INDEX idx_foo'),
      fn: out.indexOf('CREATE OR REPLACE FUNCTION f()'),
      view: out.indexOf('CREATE OR REPLACE VIEW v'),
      trigger: out.indexOf('CREATE TRIGGER trg'),
    };
    // All present
    for (const [k, v] of Object.entries(positions)) {
      expect(v, `${k} must be present`).toBeGreaterThan(-1);
    }
    // Canonical order: setup < type < table < index < fn < view < trigger
    expect(positions.set).toBeLessThan(positions.type);
    expect(positions.type).toBeLessThan(positions.table);
    expect(positions.table).toBeLessThan(positions.index);
    expect(positions.index).toBeLessThan(positions.fn);
    expect(positions.fn).toBeLessThan(positions.view);
    expect(positions.view).toBeLessThan(positions.trigger);
  });

  it('does not lose content when reordering (statement counts preserved)', () => {
    const input = [
      'CREATE TABLE foo (id int);',
      'CREATE TABLE bar (id int);',
      'CREATE OR REPLACE FUNCTION f1() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;',
      'CREATE OR REPLACE FUNCTION f2() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;',
      'CREATE INDEX idx1 ON foo(id);',
      'CREATE POLICY "p" ON foo FOR SELECT USING (true);',
    ].join('\n');
    const out = reorder(input);
    // Each input statement type must still appear exactly once.
    expect((out.match(/CREATE TABLE/g) ?? []).length).toBe(2);
    expect((out.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(2);
    expect((out.match(/CREATE INDEX/g) ?? []).length).toBe(1);
    expect((out.match(/CREATE POLICY/g) ?? []).length).toBe(1);
  });

  it('routes RLS-enable ALTER TABLE to policies bucket (after table CREATE)', () => {
    const input = [
      'ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;',
      'CREATE TABLE IF NOT EXISTS public.foo (id int);',
    ].join('\n');
    const out = reorder(input);
    const tblIdx = out.indexOf('CREATE TABLE IF NOT EXISTS public.foo');
    const rlsIdx = out.indexOf('ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY');
    expect(tblIdx).toBeLessThan(rlsIdx);
  });
});
