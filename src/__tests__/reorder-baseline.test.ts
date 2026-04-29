/**
 * Tests for `scripts/reorder-baseline.mjs`.
 *
 * The script also ships a `--self-test` harness that runs the same fixture
 * matrix without Vitest. Both must stay green. This Vitest version exists so
 * `npm test` in CI catches regressions automatically (the workflow's own
 * `--self-test` invocation is a defense-in-depth check).
 *
 * Bucket indices (from BUCKET in the script):
 *   0 setup, 1 types, 2 sequences-create, 3 tables, 4 table-attach,
 *   5 constraints, 6 indexes, 7 functions, 8 views, 9 triggers,
 *   10 rls-enable, 11 policies, 12 comments, 13 other
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
    ['CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN END; $$;', 7 /* functions */],
    ['CREATE FUNCTION f() RETURNS void AS $$ BEGIN END; $$;', 7 /* functions */],
    ['CREATE PROCEDURE p() AS $$ BEGIN END; $$;', 7 /* functions */],
    ['CREATE INDEX idx_foo ON foo(id);', 6 /* indexes */],
    ['CREATE UNIQUE INDEX idx_foo ON foo(id);', 6 /* indexes */],
    ['CREATE OR REPLACE VIEW v AS SELECT 1;', 8 /* views */],
    ['CREATE MATERIALIZED VIEW mv AS SELECT 1;', 8 /* views */],
    ['CREATE TRIGGER trg AFTER INSERT ON foo EXECUTE FUNCTION f();', 9 /* triggers */],
    ['CREATE EVENT TRIGGER etrg ON sql_drop EXECUTE FUNCTION f();', 9 /* triggers */],
    ['CREATE POLICY "p1" ON foo FOR SELECT USING (true);', 11 /* policies */],
    ['DROP POLICY IF EXISTS "p1" ON foo;', 11 /* policies */],
    ['ALTER TABLE foo ENABLE ROW LEVEL SECURITY;', 10 /* rls-enable */],
    ['ALTER TABLE foo FORCE ROW LEVEL SECURITY;', 10 /* rls-enable */],
    ["CREATE TYPE my_enum AS ENUM ('a', 'b');", 1 /* types */],
    ['CREATE DOMAIN d AS text;', 1 /* types */],
    ['CREATE SEQUENCE seq;', 2 /* sequences-create */],
    ['ALTER SEQUENCE seq RESTART WITH 100;', 2 /* sequences-create */],
    ['ALTER SEQUENCE seq OWNED BY foo.id;', 4 /* table-attach */],
    [
      'ALTER TABLE ONLY foo ALTER COLUMN id SET DEFAULT nextval(\'seq\'::regclass);',
      4 /* table-attach */,
    ],
    ['SET check_function_bodies = false;', 0 /* setup */],
    ["SELECT pg_catalog.set_config('search_path', '', false);", 0 /* setup */],
    ['CREATE EXTENSION IF NOT EXISTS pg_trgm;', 0 /* setup */],
    ['CREATE SCHEMA IF NOT EXISTS extensions;', 0 /* setup */],
    ["COMMENT ON SCHEMA public IS 'standard';", 0 /* setup */],
    ["COMMENT ON TABLE public.foo IS 'doc';", 12 /* comments */],
    ["COMMENT ON COLUMN public.foo.id IS 'pk';", 12 /* comments */],
    ["COMMENT ON FUNCTION public.f() IS 'doc';", 12 /* comments */],
    ["COMMENT ON TYPE public.my_enum IS 'doc';", 12 /* comments */],
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

  it('routes ALTER SEQUENCE … OWNED BY into table-attach bucket', () => {
    const stmt = 'ALTER SEQUENCE "public"."mass_gen_log_id_seq" OWNED BY "public"."mass_gen_log"."id";';
    expect(classifyStatement(stmt)).toBe(4 /* table-attach */);
  });

  it('routes ALTER TABLE ONLY … SET DEFAULT nextval(...) into table-attach bucket', () => {
    const stmt =
      'ALTER TABLE ONLY "public"."mass_gen_log" ALTER COLUMN "id" SET DEFAULT nextval(\'"public"."mass_gen_log_id_seq"\'::"regclass");';
    expect(classifyStatement(stmt)).toBe(4 /* table-attach */);
  });

  it('routes multi-line ALTER TABLE ONLY … ADD CONSTRAINT PRIMARY KEY into constraints bucket', () => {
    const stmt = [
      'ALTER TABLE ONLY "public"."achievements"',
      '    ADD CONSTRAINT "achievements_pkey" PRIMARY KEY ("id");',
    ].join('\n');
    expect(classifyStatement(stmt)).toBe(5 /* constraints */);
  });

  it('routes multi-line ADD CONSTRAINT FOREIGN KEY into constraints bucket', () => {
    const stmt = [
      'ALTER TABLE ONLY "public"."child"',
      '    ADD CONSTRAINT "child_parent_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."parent"("id");',
    ].join('\n');
    expect(classifyStatement(stmt)).toBe(5 /* constraints */);
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
      "COMMENT ON TABLE foo IS 'doc';",
      'ALTER SEQUENCE seq OWNED BY foo.id;',
      'CREATE SEQUENCE seq;',
      'ALTER TABLE ONLY foo ADD CONSTRAINT foo_pkey PRIMARY KEY (id);',
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

  it('emits buckets in canonical dependency order (the full chain)', () => {
    const input = [
      "COMMENT ON TABLE foo IS 'doc';",
      'CREATE POLICY "p1" ON foo FOR SELECT USING (true);',
      'ALTER TABLE foo ENABLE ROW LEVEL SECURITY;',
      'CREATE TRIGGER trg AFTER INSERT ON foo EXECUTE FUNCTION f();',
      'CREATE OR REPLACE VIEW v AS SELECT 1;',
      'CREATE INDEX idx_foo ON foo(id);',
      'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;',
      'ALTER TABLE ONLY foo ADD CONSTRAINT foo_pkey PRIMARY KEY (id);',
      'ALTER TABLE ONLY foo ALTER COLUMN id SET DEFAULT nextval(\'seq\'::regclass);',
      'ALTER SEQUENCE seq OWNED BY foo.id;',
      'CREATE TABLE IF NOT EXISTS foo (id int);',
      'CREATE SEQUENCE seq;',
      "CREATE TYPE my_enum AS ENUM ('a');",
      'SET check_function_bodies = false;',
    ].join('\n');
    const out = reorder(input);
    const positions = {
      set: out.indexOf('SET check_function_bodies'),
      type: out.indexOf('CREATE TYPE my_enum'),
      sequence: out.indexOf('CREATE SEQUENCE seq'),
      table: out.indexOf('CREATE TABLE IF NOT EXISTS foo'),
      attach: out.indexOf('SET DEFAULT nextval'),
      ownedBy: out.indexOf('ALTER SEQUENCE seq OWNED BY'),
      constraint: out.indexOf('ADD CONSTRAINT foo_pkey'),
      index: out.indexOf('CREATE INDEX idx_foo'),
      fn: out.indexOf('CREATE OR REPLACE FUNCTION f()'),
      view: out.indexOf('CREATE OR REPLACE VIEW v'),
      trigger: out.indexOf('CREATE TRIGGER trg'),
      rlsEnable: out.indexOf('ENABLE ROW LEVEL SECURITY'),
      policy: out.indexOf('CREATE POLICY "p1"'),
      comment: out.indexOf('COMMENT ON TABLE foo'),
    };
    // All present
    for (const [k, v] of Object.entries(positions)) {
      expect(v, `${k} must be present`).toBeGreaterThan(-1);
    }
    // Canonical dependency order:
    //   setup < type < sequence-create < table < table-attach < constraints
    //         < index < fn < view < trigger < rls-enable < policy < comment
    expect(positions.set).toBeLessThan(positions.type);
    expect(positions.type).toBeLessThan(positions.sequence);
    expect(positions.sequence).toBeLessThan(positions.table);
    expect(positions.table).toBeLessThan(positions.attach);
    expect(positions.table).toBeLessThan(positions.ownedBy);
    expect(positions.attach).toBeLessThan(positions.constraint);
    expect(positions.ownedBy).toBeLessThan(positions.constraint);
    expect(positions.constraint).toBeLessThan(positions.index);
    expect(positions.index).toBeLessThan(positions.fn);
    expect(positions.fn).toBeLessThan(positions.view);
    expect(positions.view).toBeLessThan(positions.trigger);
    expect(positions.trigger).toBeLessThan(positions.rlsEnable);
    expect(positions.rlsEnable).toBeLessThan(positions.policy);
    expect(positions.policy).toBeLessThan(positions.comment);
  });

  it('does not lose content when reordering (statement counts preserved)', () => {
    const input = [
      'CREATE TABLE foo (id int);',
      'CREATE TABLE bar (id int);',
      'CREATE OR REPLACE FUNCTION f1() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;',
      'CREATE OR REPLACE FUNCTION f2() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;',
      'CREATE INDEX idx1 ON foo(id);',
      'CREATE POLICY "p" ON foo FOR SELECT USING (true);',
      'ALTER TABLE ONLY foo ADD CONSTRAINT foo_pk PRIMARY KEY (id);',
      "COMMENT ON TABLE foo IS 'doc';",
    ].join('\n');
    const out = reorder(input);
    // Each input statement type must still appear exactly once.
    expect((out.match(/CREATE TABLE/g) ?? []).length).toBe(2);
    expect((out.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(2);
    expect((out.match(/CREATE INDEX/g) ?? []).length).toBe(1);
    expect((out.match(/CREATE POLICY/g) ?? []).length).toBe(1);
    expect((out.match(/ADD CONSTRAINT/g) ?? []).length).toBe(1);
    expect((out.match(/COMMENT ON TABLE/g) ?? []).length).toBe(1);
  });

  it('routes RLS-enable ALTER TABLE to rls-enable bucket (after CREATE TABLE, before CREATE POLICY)', () => {
    const input = [
      'CREATE POLICY "p1" ON public.foo FOR SELECT USING (true);',
      'ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;',
      'CREATE TABLE IF NOT EXISTS public.foo (id int);',
    ].join('\n');
    const out = reorder(input);
    const tblIdx = out.indexOf('CREATE TABLE IF NOT EXISTS public.foo');
    const rlsIdx = out.indexOf('ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY');
    const polIdx = out.indexOf('CREATE POLICY "p1"');
    expect(tblIdx).toBeLessThan(rlsIdx);
    expect(rlsIdx).toBeLessThan(polIdx);
  });

  it('routes ALTER SEQUENCE OWNED BY after CREATE TABLE (closes mass_gen_log regression)', () => {
    const input = [
      'ALTER SEQUENCE "public"."mass_gen_log_id_seq" OWNED BY "public"."mass_gen_log"."id";',
      'CREATE SEQUENCE "public"."mass_gen_log_id_seq";',
      'CREATE TABLE IF NOT EXISTS "public"."mass_gen_log" (id int);',
    ].join('\n');
    const out = reorder(input);
    const seqIdx = out.indexOf('CREATE SEQUENCE "public"."mass_gen_log_id_seq"');
    const tblIdx = out.indexOf('CREATE TABLE IF NOT EXISTS "public"."mass_gen_log"');
    const ownedIdx = out.indexOf('ALTER SEQUENCE "public"."mass_gen_log_id_seq" OWNED BY');
    expect(seqIdx).toBeGreaterThan(-1);
    expect(tblIdx).toBeGreaterThan(seqIdx);
    expect(ownedIdx).toBeGreaterThan(tblIdx);
  });

  it('routes FK ADD CONSTRAINT after ALL CREATE TABLE statements (FK needs referenced table)', () => {
    const input = [
      'ALTER TABLE ONLY "public"."child"',
      '    ADD CONSTRAINT "child_parent_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."parent"("id");',
      '',
      'CREATE TABLE IF NOT EXISTS "public"."child" (id int, parent_id int);',
      'CREATE TABLE IF NOT EXISTS "public"."parent" (id int);',
    ].join('\n');
    const out = reorder(input);
    const childIdx = out.indexOf('CREATE TABLE IF NOT EXISTS "public"."child"');
    const parentIdx = out.indexOf('CREATE TABLE IF NOT EXISTS "public"."parent"');
    const fkIdx = out.indexOf('FOREIGN KEY');
    expect(childIdx).toBeGreaterThan(-1);
    expect(parentIdx).toBeGreaterThan(-1);
    expect(fkIdx).toBeGreaterThan(childIdx);
    expect(fkIdx).toBeGreaterThan(parentIdx);
  });

  it('routes COMMENT ON TABLE after CREATE TABLE (object must exist before comment)', () => {
    const input = [
      "COMMENT ON TABLE \"public\".\"foo\" IS 'doc';",
      'CREATE TABLE IF NOT EXISTS "public"."foo" (id int);',
    ].join('\n');
    const out = reorder(input);
    const tblIdx = out.indexOf('CREATE TABLE IF NOT EXISTS "public"."foo"');
    const cmtIdx = out.indexOf('COMMENT ON TABLE');
    expect(tblIdx).toBeGreaterThan(-1);
    expect(cmtIdx).toBeGreaterThan(tblIdx);
  });

  it('keeps COMMENT ON SCHEMA in setup (no dependency to defer)', () => {
    const input = [
      "COMMENT ON SCHEMA \"public\" IS 'standard';",
      'CREATE TABLE IF NOT EXISTS "public"."foo" (id int);',
    ].join('\n');
    const out = reorder(input);
    const cmtIdx = out.indexOf('COMMENT ON SCHEMA');
    const tblIdx = out.indexOf('CREATE TABLE IF NOT EXISTS "public"."foo"');
    expect(cmtIdx).toBeGreaterThan(-1);
    expect(tblIdx).toBeGreaterThan(cmtIdx);
  });
});
