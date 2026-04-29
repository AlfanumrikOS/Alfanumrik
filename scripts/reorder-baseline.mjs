#!/usr/bin/env node
/**
 * reorder-baseline.mjs
 * --------------------
 * Reorder a sanitized pg_dump baseline so that every statement appears in an
 * order that respects all object dependencies. Without this reordering, fresh
 * Postgres replays of the dump fail in multiple ways:
 *
 *   1. `%ROWTYPE` declarations inside CREATE FUNCTION bodies fail to PARSE
 *      when the referenced table type does not yet exist (PARSE happens
 *      BEFORE check_function_bodies kicks in).
 *      ERROR: relation "public.adaptive_mastery" does not exist
 *
 *   2. `ALTER SEQUENCE … OWNED BY public.<table>.<col>` fails when the table
 *      hasn't been created yet.
 *      ERROR: relation "public.mass_gen_log" does not exist
 *
 *   3. `ALTER TABLE ONLY … ALTER COLUMN … SET DEFAULT nextval('seq')` requires
 *      both the table and the sequence to exist.
 *
 *   4. `ALTER TABLE ONLY … ADD CONSTRAINT … FOREIGN KEY` requires the
 *      REFERENCED table to exist — i.e. ALL tables must be created first.
 *
 *   5. `COMMENT ON TABLE/COLUMN/FUNCTION/…` requires the referenced object to
 *      exist.
 *
 * pg_dump emits its own internal order (alphabetical-ish by object class), and
 * relies on `SET check_function_bodies = false` so that the *body* of a
 * function isn't validated until after all tables are created. That covers
 * case (1) for function BODIES but not for headers/DECLAREs and not at all for
 * (2)-(5).
 *
 * This script splits the input file into top-level SQL statements (handling
 * dollar-quoting, single-quote strings, line/block comments) and routes each
 * statement into one of the dependency-ordered buckets below. Buckets are then
 * concatenated in canonical order. The result is replayable on a fresh
 * Postgres where prior versions failed.
 *
 * Bucket order (lower number emitted first):
 *
 *   1. setup            — SET, SELECT pg_catalog.set_config, CREATE EXTENSION,
 *                         CREATE SCHEMA, COMMENT ON SCHEMA
 *   2. types            — CREATE TYPE / CREATE DOMAIN (incl. DO $$..$$
 *                         idempotency wrappers added by sanitize step)
 *   3. sequences-create — CREATE SEQUENCE (NOT ALTER SEQUENCE … OWNED BY)
 *   4. tables           — CREATE TABLE (and bare ALTER TABLE … ADD COLUMN
 *                         that doesn't reference sequences/constraints)
 *   5. table-attach     — ALTER SEQUENCE … OWNED BY
 *                         ALTER TABLE ONLY … ALTER COLUMN … SET DEFAULT
 *                         nextval(…)
 *                         (depends on BOTH sequence + table)
 *   6. constraints      — ALTER TABLE ONLY … ADD CONSTRAINT
 *                         (PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY).
 *                         FK requires ALL tables to exist first.
 *   7. functions        — CREATE FUNCTION, CREATE PROCEDURE.
 *                         MUST come before indexes because functional indexes
 *                         (`CREATE INDEX … (some_function(col))`) depend on the
 *                         function existing. Functions don't structurally depend
 *                         on indexes, so this is the safe direction.
 *   8. views            — CREATE VIEW, CREATE MATERIALIZED VIEW
 *                         (may reference functions → after functions).
 *   9. indexes          — CREATE INDEX, CREATE UNIQUE INDEX
 *                         (functional indexes need their function emitted first).
 *  10. triggers         — CREATE TRIGGER, CREATE EVENT TRIGGER (need functions)
 *  11. rls-enable       — ALTER TABLE … ENABLE / FORCE ROW LEVEL SECURITY
 *                         (must run before CREATE POLICY so policies aren't
 *                         dormant after replay; keeps the user-visible
 *                         CREATE POLICY ordering predictable)
 *  12. policies         — CREATE POLICY, DROP POLICY
 *  13. comments         — COMMENT ON TABLE / COLUMN / FUNCTION / TYPE / …
 *                         (need the referenced object to exist)
 *  14. other            — anything that didn't match (kept last so we never
 *                         accidentally drop a statement). GRANT/REVOKE land
 *                         here naturally and run after everything else.
 *
 * The script is **idempotent**: running it on already-reordered input yields
 * the same output (each bucket is preserved in its existing relative order,
 * the bucket-emit order is deterministic, and reorder() strips its own marker
 * lines before reclassifying).
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

// ─────────────────────────────────────────────────────────────────────────────
// Statement splitter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a SQL string into top-level statements terminated by `;`.
 * Correctly preserves $tag$ … $tag$ dollar-quoted regions, '...' strings,
 * /* … *\/ block comments, and -- line comments.
 *
 * Each emitted chunk includes its trailing `;` plus any whitespace that
 * directly follows (so blank lines stay attached to the statement they
 * trail). The final chunk may be unterminated — we still emit it so that
 * comment-only tails are not lost.
 */
export function splitStatements(src) {
  const out = [];
  let i = 0;
  let buf = '';
  let inDollar = null; // current opening tag e.g. "$$" or "$tag$"
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  const len = src.length;
  while (i < len) {
    const c = src[i];

    if (inLineComment) {
      buf += c;
      if (c === '\n') inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      buf += c;
      if (c === '*' && i + 1 < len && src[i + 1] === '/') {
        buf += '/';
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      buf += c;
      // Postgres '' is an escaped quote; if next char is also ', skip it.
      if (c === "'") {
        if (i + 1 < len && src[i + 1] === "'") {
          buf += src[i + 1];
          i += 2;
          continue;
        }
        inString = false;
      }
      i += 1;
      continue;
    }
    if (inDollar !== null) {
      // look for closing tag
      if (c === '$') {
        // try to match the closing tag exactly
        const slice = src.slice(i, i + inDollar.length);
        if (slice === inDollar) {
          buf += slice;
          i += inDollar.length;
          inDollar = null;
          continue;
        }
      }
      buf += c;
      i += 1;
      continue;
    }

    // Not inside any quoting — check for state transitions
    if (c === '-' && i + 1 < len && src[i + 1] === '-') {
      buf += '--';
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === '/' && i + 1 < len && src[i + 1] === '*') {
      buf += '/*';
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      buf += c;
      inString = true;
      i += 1;
      continue;
    }
    if (c === '$') {
      // try to read a dollar-quote opening tag: $tag$ where tag is [A-Za-z0-9_]*
      let j = i + 1;
      while (j < len) {
        const cj = src[j];
        if (cj === '$') break;
        if (!/[A-Za-z0-9_]/.test(cj)) {
          j = -1;
          break;
        }
        j += 1;
      }
      if (j > 0 && j < len && src[j] === '$') {
        const tag = src.slice(i, j + 1);
        buf += tag;
        inDollar = tag;
        i = j + 1;
        continue;
      }
      // not a valid tag — treat as literal $
      buf += c;
      i += 1;
      continue;
    }
    if (c === ';') {
      buf += c;
      // consume trailing whitespace + newlines as part of this statement
      let k = i + 1;
      while (k < len && (src[k] === ' ' || src[k] === '\t' || src[k] === '\n' || src[k] === '\r')) {
        buf += src[k];
        k += 1;
      }
      out.push(buf);
      buf = '';
      i = k;
      continue;
    }

    buf += c;
    i += 1;
  }

  if (buf.length > 0) out.push(buf);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucket classifier
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_NAMES = [
  'setup',
  'types',
  'sequences-create',
  'tables',
  'table-attach',
  'constraints',
  'functions',
  'views',
  'indexes',
  'triggers',
  'rls-enable',
  'policies',
  'comments',
  'other',
];

const BUCKET = Object.freeze({
  SETUP: 0,
  TYPES: 1,
  SEQUENCES_CREATE: 2,
  TABLES: 3,
  TABLE_ATTACH: 4,
  CONSTRAINTS: 5,
  FUNCTIONS: 6,
  VIEWS: 7,
  INDEXES: 8,
  TRIGGERS: 9,
  RLS_ENABLE: 10,
  POLICIES: 11,
  COMMENTS: 12,
  OTHER: 13,
});

/** Strip leading whitespace + comment lines and return the first SQL keyword line. */
function firstSqlLine(stmt) {
  for (const rawLine of stmt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('--')) continue;
    return line;
  }
  return '';
}

/** Collapse whitespace in the statement body for multi-line pattern matching. */
function flatten(stmt) {
  return stmt.replace(/\s+/g, ' ');
}

/**
 * Classify a single statement (already split by `splitStatements`) into a
 * bucket index. Order of pattern checks matters for ambiguous statements like
 * `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (policies) vs `ALTER TABLE ONLY …
 * ADD CONSTRAINT …` (constraints) vs `ALTER TABLE ONLY … ALTER COLUMN … SET
 * DEFAULT nextval(…)` (table-attach).
 */
export function classifyStatement(stmt) {
  const head = firstSqlLine(stmt);
  if (!head) return BUCKET.SETUP; // pure comment / whitespace block

  // ── Setup: SET, SELECT pg_catalog.set_config, CREATE EXTENSION, CREATE
  //    SCHEMA, COMMENT ON SCHEMA. (COMMENT ON SCHEMA stays in setup because
  //    schemas are created in setup and there are no other dependencies.)
  if (/^SET\s+/i.test(head)) return BUCKET.SETUP;
  if (/^SELECT\s+pg_catalog\.set_config/i.test(head)) return BUCKET.SETUP;
  if (/^CREATE\s+EXTENSION\b/i.test(head)) return BUCKET.SETUP;
  if (/^CREATE\s+SCHEMA\b/i.test(head)) return BUCKET.SETUP;
  if (/^COMMENT\s+ON\s+SCHEMA\b/i.test(head)) return BUCKET.SETUP;

  // ── Comments on any other object class must run AFTER the object exists.
  //    Routed to the dedicated comments bucket which is emitted near the end.
  //    (COMMENT ON TABLE / COLUMN / FUNCTION / TYPE / DOMAIN / SEQUENCE / VIEW
  //    / TRIGGER / INDEX / POLICY / EXTENSION / CONSTRAINT.)
  if (/^COMMENT\s+ON\b/i.test(head)) return BUCKET.COMMENTS;

  // ── RLS-style ALTER TABLE … ENABLE/FORCE ROW LEVEL SECURITY → dedicated
  //    rls-enable bucket so it fires AFTER the table definition AND BEFORE
  //    CREATE POLICY (otherwise policies are dormant on a fresh replay).
  //    Check the FLATTENED statement because pg_dump may break the keyword
  //    across lines.
  const flat = flatten(stmt);
  if (/^ALTER\s+TABLE\b.*\bROW\s+LEVEL\s+SECURITY\b/i.test(flat)) {
    return BUCKET.RLS_ENABLE;
  }

  // ── CREATE/DROP POLICY
  if (/^(CREATE|DROP)\s+POLICY\b/i.test(head)) return BUCKET.POLICIES;

  // ── Triggers (incl. event triggers). DROP TRIGGER lands here too.
  if (/^(CREATE|DROP)\s+(EVENT\s+)?TRIGGER\b/i.test(head)) return BUCKET.TRIGGERS;

  // ── Views (regular + materialized). Views are emitted AFTER tables and
  //    constraints, so even FK-dependent views resolve.
  if (/^CREATE\s+(OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\b/i.test(head)) {
    return BUCKET.VIEWS;
  }

  // ── Functions / procedures. Bodies aren't checked due to
  //    `SET check_function_bodies = false`, but %ROWTYPE in DECLARE is
  //    parsed eagerly — so functions must come AFTER tables.
  if (/^CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b/i.test(head)) {
    return BUCKET.FUNCTIONS;
  }

  // ── Sanitized CREATE TYPE wrapped in DO $$ BEGIN CREATE TYPE … END $$;
  if (/^\s*DO\s+\$/i.test(head)) {
    if (/CREATE\s+TYPE\b/i.test(stmt) || /CREATE\s+DOMAIN\b/i.test(stmt)) {
      return BUCKET.TYPES;
    }
    // Other DO blocks land in OTHER (rare in pg_dump output)
    return BUCKET.OTHER;
  }
  if (/^CREATE\s+(TYPE|DOMAIN)\b/i.test(head)) return BUCKET.TYPES;

  // ── Sequences: split CREATE SEQUENCE (early, before tables) from
  //    ALTER SEQUENCE … OWNED BY (late, needs the table that owns it).
  if (/^CREATE\s+SEQUENCE\b/i.test(head)) return BUCKET.SEQUENCES_CREATE;
  if (/^ALTER\s+SEQUENCE\b.*\bOWNED\s+BY\b/i.test(flat)) return BUCKET.TABLE_ATTACH;
  if (/^ALTER\s+SEQUENCE\b/i.test(head)) {
    // Other ALTER SEQUENCE forms (RESTART, CACHE, MINVALUE, …) don't depend
    // on table existence — keep with create-sequence so they emit early.
    return BUCKET.SEQUENCES_CREATE;
  }

  // ── Indexes
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(head)) return BUCKET.INDEXES;

  // ── Tables and table-related ALTER TABLE statements. Order matters:
  //    1. CREATE TABLE → tables bucket.
  //    2. ALTER TABLE ONLY … ALTER COLUMN … SET DEFAULT nextval(…)
  //         → table-attach (needs sequence too).
  //    3. ALTER TABLE ONLY … ADD CONSTRAINT … (PK / UNIQUE / CHECK / FK)
  //         → constraints (FK needs all tables to exist).
  //    4. Anything else (ALTER TABLE … ADD COLUMN, RENAME, …) → tables.
  if (/^CREATE\s+TABLE\b/i.test(head)) return BUCKET.TABLES;

  if (/^ALTER\s+TABLE\b/i.test(head)) {
    // ADD CONSTRAINT can be PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY, or
    // EXCLUDE. All need the table to exist; FK needs the referenced table
    // too. Route them to the constraints bucket which runs after every
    // CREATE TABLE has emitted.
    if (/\bADD\s+CONSTRAINT\b/i.test(flat)) return BUCKET.CONSTRAINTS;

    // SET DEFAULT nextval(…) needs the sequence to exist. Route to
    // table-attach (emitted after both tables AND sequences).
    if (/\bALTER\s+COLUMN\b.*\bSET\s+DEFAULT\b.*\bnextval\b/i.test(flat)) {
      return BUCKET.TABLE_ATTACH;
    }

    // Any other ALTER TABLE (ADD COLUMN, RENAME, etc.) — keep in tables.
    return BUCKET.TABLES;
  }

  return BUCKET.OTHER;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reorder driver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marker line written into the output so a second invocation can detect that
 * the file is already reordered and strip the previous markers before
 * re-bucketing. This makes reorder(reorder(x)) === reorder(x).
 *
 * Matches both the legacy two-digit format (bucket 10) and the current
 * one-or-two digit format (bucket 1, 12, …) and any bucket name from the
 * BUCKET_NAMES list.
 */
const BUCKET_MARKER_RE = /^-- ── reorder-baseline\.mjs bucket \d+: [a-z-]+ ──$/;

export function reorder(src) {
  // Strip any previous bucket-header marker lines before reclassifying. This
  // is what makes the function idempotent: the markers are not real SQL, so
  // dropping them before the second pass yields the same statement set as
  // pass 1, and the bucket-classifier is deterministic.
  const cleaned = src
    .split(/\r?\n/)
    .filter((line) => !BUCKET_MARKER_RE.test(line))
    .join('\n');

  const statements = splitStatements(cleaned);
  const buckets = Array.from({ length: BUCKET_NAMES.length }, () => []);
  for (const stmt of statements) {
    const idx = classifyStatement(stmt);
    buckets[idx].push(stmt);
  }
  const parts = [];
  for (let b = 0; b < buckets.length; b += 1) {
    if (buckets[b].length === 0) continue;
    parts.push(`-- ── reorder-baseline.mjs bucket ${b + 1}: ${BUCKET_NAMES[b]} ──\n`);
    let body = buckets[b].join('');
    // Guarantee bucket body ends with a newline so the NEXT bucket-marker
    // line lands on its own line (matters for idempotency: the marker-line
    // regex requires a full-line match to strip on the second pass).
    if (body.length > 0 && !body.endsWith('\n')) body += '\n';
    parts.push(body);
  }
  return parts.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-tests (run with --self-test)
// ─────────────────────────────────────────────────────────────────────────────

function selfTest() {
  let passed = 0;
  let failed = 0;
  function expect(label, cond, detail) {
    if (cond) {
      passed += 1;
      process.stdout.write(`  PASS  ${label}\n`);
    } else {
      failed += 1;
      console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
  }

  // Test 1: function-before-table is reordered.
  const fixture1 = [
    "CREATE OR REPLACE FUNCTION public.bkt_update() RETURNS void LANGUAGE plpgsql AS $$",
    "DECLARE",
    "  v_rec public.adaptive_mastery%ROWTYPE;",
    "BEGIN",
    "  RETURN;",
    "END;",
    "$$;",
    "",
    "CREATE TABLE IF NOT EXISTS public.adaptive_mastery (id uuid PRIMARY KEY);",
    "",
  ].join('\n');
  const out1 = reorder(fixture1);
  const tbl1 = out1.indexOf('CREATE TABLE IF NOT EXISTS public.adaptive_mastery');
  const fn1 = out1.indexOf('CREATE OR REPLACE FUNCTION public.bkt_update');
  expect('function-before-table is reordered (table now precedes function)',
    tbl1 > -1 && fn1 > -1 && tbl1 < fn1,
    `tbl=${tbl1} fn=${fn1}`);
  expect('function body preserved through reorder',
    out1.includes('v_rec public.adaptive_mastery%ROWTYPE'),
    'ROWTYPE line missing');
  expect('CREATE TABLE statement preserved',
    out1.includes('CREATE TABLE IF NOT EXISTS public.adaptive_mastery (id uuid PRIMARY KEY);'));

  // Test 2: idempotency — running reorder() twice is stable.
  const out1Again = reorder(out1);
  expect('idempotent: reorder(reorder(x)) === reorder(x)', out1 === out1Again,
    'second pass differs');

  // Test 3: SET statements stay in setup bucket (first).
  const fixture3 = [
    "CREATE TABLE IF NOT EXISTS public.foo (id int);",
    "SET check_function_bodies = false;",
    "CREATE OR REPLACE FUNCTION public.bar() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;",
    "",
  ].join('\n');
  const out3 = reorder(fixture3);
  const set3 = out3.indexOf('SET check_function_bodies');
  const tbl3 = out3.indexOf('CREATE TABLE IF NOT EXISTS public.foo');
  const fn3 = out3.indexOf('CREATE OR REPLACE FUNCTION public.bar');
  expect('SET stays at top (before tables)', set3 > -1 && set3 < tbl3, `set=${set3} tbl=${tbl3}`);
  expect('table before function (test 3)', tbl3 > -1 && fn3 > -1 && tbl3 < fn3);

  // Test 4: dollar-quoted body containing a semicolon is not split early.
  const fixture4 = [
    "CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$",
    "BEGIN",
    "  PERFORM 1; PERFORM 2;",
    "  RETURN;",
    "END;",
    "$$;",
    "CREATE TABLE IF NOT EXISTS public.t (id int);",
  ].join('\n');
  const stmts4 = splitStatements(fixture4);
  const fnStmts = stmts4.filter((s) => /CREATE OR REPLACE FUNCTION/.test(s));
  expect('dollar-quoted body kept as a single statement', fnStmts.length === 1,
    `got ${fnStmts.length} function-statements`);
  expect('semicolons inside $$ … $$ preserved',
    fnStmts[0]?.includes('PERFORM 1; PERFORM 2;'));

  // Test 5: sanitized CREATE TYPE wrapped in DO $$ … $$; lands in TYPES bucket.
  const fixture5 = [
    "CREATE TABLE IF NOT EXISTS public.uses_enum (val public.my_enum);",
    "DO $$ BEGIN",
    "  CREATE TYPE public.my_enum AS ENUM ('a','b');",
    "EXCEPTION WHEN duplicate_object THEN NULL;",
    "END $$;",
  ].join('\n');
  const out5 = reorder(fixture5);
  const type5 = out5.indexOf("CREATE TYPE public.my_enum");
  const tbl5 = out5.indexOf('CREATE TABLE IF NOT EXISTS public.uses_enum');
  expect('DO-wrapped CREATE TYPE precedes the table that references it',
    type5 > -1 && tbl5 > -1 && type5 < tbl5,
    `type=${type5} tbl=${tbl5}`);

  // Test 6: ALTER TABLE … ENABLE ROW LEVEL SECURITY routes to policies bucket.
  const fixture6 = [
    "ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;",
    "CREATE TABLE IF NOT EXISTS public.foo (id int);",
  ].join('\n');
  const out6 = reorder(fixture6);
  const tbl6 = out6.indexOf('CREATE TABLE IF NOT EXISTS public.foo');
  const rls6 = out6.indexOf('ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY');
  expect('ALTER TABLE … ENABLE RLS lands after the table CREATE',
    tbl6 > -1 && rls6 > -1 && tbl6 < rls6,
    `tbl=${tbl6} rls=${rls6}`);

  // Test 7: CREATE POLICY lands after the table.
  const fixture7 = [
    'CREATE POLICY "p1" ON public.foo FOR SELECT USING (true);',
    'CREATE TABLE IF NOT EXISTS public.foo (id int);',
  ].join('\n');
  const out7 = reorder(fixture7);
  const tbl7 = out7.indexOf('CREATE TABLE IF NOT EXISTS public.foo');
  const pol7 = out7.indexOf('CREATE POLICY "p1" ON public.foo');
  expect('CREATE POLICY lands after the table CREATE', tbl7 < pol7);

  // Test 8: views appear after tables but before triggers.
  const fixture8 = [
    'CREATE TRIGGER trg AFTER INSERT ON public.foo EXECUTE FUNCTION public.f();',
    'CREATE OR REPLACE VIEW public.v AS SELECT 1;',
    'CREATE TABLE IF NOT EXISTS public.foo (id int);',
  ].join('\n');
  const out8 = reorder(fixture8);
  const t8 = out8.indexOf('CREATE TABLE');
  const v8 = out8.indexOf('CREATE OR REPLACE VIEW');
  const trg8 = out8.indexOf('CREATE TRIGGER trg');
  expect('order: tables → views → triggers', t8 < v8 && v8 < trg8,
    `t=${t8} v=${v8} trg=${trg8}`);

  // Test 9: ALTER SEQUENCE … OWNED BY lands AFTER the table CREATE.
  const fixture9 = [
    'ALTER SEQUENCE "public"."mass_gen_log_id_seq" OWNED BY "public"."mass_gen_log"."id";',
    'CREATE SEQUENCE "public"."mass_gen_log_id_seq";',
    'CREATE TABLE IF NOT EXISTS "public"."mass_gen_log" (id int);',
  ].join('\n');
  const out9 = reorder(fixture9);
  const seq9 = out9.indexOf('CREATE SEQUENCE "public"."mass_gen_log_id_seq"');
  const tbl9 = out9.indexOf('CREATE TABLE IF NOT EXISTS "public"."mass_gen_log"');
  const own9 = out9.indexOf('ALTER SEQUENCE "public"."mass_gen_log_id_seq" OWNED BY');
  expect('order: CREATE SEQUENCE → CREATE TABLE → ALTER SEQUENCE OWNED BY',
    seq9 > -1 && tbl9 > -1 && own9 > -1 && seq9 < tbl9 && tbl9 < own9,
    `seq=${seq9} tbl=${tbl9} own=${own9}`);

  // Test 10: ALTER TABLE ONLY … ALTER COLUMN … SET DEFAULT nextval(…) lands
  // AFTER both the table and the sequence.
  const fixture10 = [
    'ALTER TABLE ONLY "public"."mass_gen_log" ALTER COLUMN "id" SET DEFAULT nextval(\'"public"."mass_gen_log_id_seq"\'::"regclass");',
    'CREATE TABLE IF NOT EXISTS "public"."mass_gen_log" (id int);',
    'CREATE SEQUENCE "public"."mass_gen_log_id_seq";',
  ].join('\n');
  const out10 = reorder(fixture10);
  const seq10 = out10.indexOf('CREATE SEQUENCE "public"."mass_gen_log_id_seq"');
  const tbl10 = out10.indexOf('CREATE TABLE IF NOT EXISTS "public"."mass_gen_log"');
  const def10 = out10.indexOf('SET DEFAULT nextval');
  expect('SET DEFAULT nextval lands after BOTH sequence AND table',
    seq10 < def10 && tbl10 < def10,
    `seq=${seq10} tbl=${tbl10} def=${def10}`);

  // Test 11: ALTER TABLE ONLY … ADD CONSTRAINT … FOREIGN KEY lands AFTER
  // ALL CREATE TABLE statements (FK needs the referenced table too).
  const fixture11 = [
    'ALTER TABLE ONLY "public"."child" ADD CONSTRAINT "child_parent_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."parent"("id");',
    'CREATE TABLE IF NOT EXISTS "public"."child" (id int, parent_id int);',
    'CREATE TABLE IF NOT EXISTS "public"."parent" (id int);',
  ].join('\n');
  const out11 = reorder(fixture11);
  const child11 = out11.indexOf('CREATE TABLE IF NOT EXISTS "public"."child"');
  const parent11 = out11.indexOf('CREATE TABLE IF NOT EXISTS "public"."parent"');
  const fk11 = out11.indexOf('FOREIGN KEY');
  expect('FK ADD CONSTRAINT lands after both child AND parent table CREATEs',
    child11 < fk11 && parent11 < fk11,
    `child=${child11} parent=${parent11} fk=${fk11}`);

  // Test 12: ALTER TABLE ONLY … ADD CONSTRAINT … PRIMARY KEY (multi-line).
  const fixture12 = [
    'ALTER TABLE ONLY "public"."achievements"',
    '    ADD CONSTRAINT "achievements_pkey" PRIMARY KEY ("id");',
    'CREATE TABLE IF NOT EXISTS "public"."achievements" (id int);',
  ].join('\n');
  const out12 = reorder(fixture12);
  const tbl12 = out12.indexOf('CREATE TABLE IF NOT EXISTS "public"."achievements"');
  const pk12 = out12.indexOf('ADD CONSTRAINT "achievements_pkey"');
  expect('multi-line ADD CONSTRAINT PRIMARY KEY lands after table CREATE',
    tbl12 > -1 && pk12 > -1 && tbl12 < pk12,
    `tbl=${tbl12} pk=${pk12}`);

  // Test 13: COMMENT ON TABLE lands AFTER the table CREATE.
  const fixture13 = [
    "COMMENT ON TABLE \"public\".\"foo\" IS 'doc';",
    'CREATE TABLE IF NOT EXISTS "public"."foo" (id int);',
  ].join('\n');
  const out13 = reorder(fixture13);
  const tbl13 = out13.indexOf('CREATE TABLE IF NOT EXISTS "public"."foo"');
  const cmt13 = out13.indexOf('COMMENT ON TABLE');
  expect('COMMENT ON TABLE lands after CREATE TABLE',
    tbl13 > -1 && cmt13 > -1 && tbl13 < cmt13,
    `tbl=${tbl13} cmt=${cmt13}`);

  // Test 14: COMMENT ON SCHEMA stays in setup (no dependency to defer).
  const fixture14 = [
    "COMMENT ON SCHEMA \"public\" IS 'standard';",
    'CREATE TABLE IF NOT EXISTS "public"."foo" (id int);',
  ].join('\n');
  const out14 = reorder(fixture14);
  const cmt14 = out14.indexOf('COMMENT ON SCHEMA');
  const tbl14 = out14.indexOf('CREATE TABLE IF NOT EXISTS "public"."foo"');
  expect('COMMENT ON SCHEMA stays in setup (before tables)',
    cmt14 > -1 && tbl14 > -1 && cmt14 < tbl14,
    `cmt=${cmt14} tbl=${tbl14}`);

  // Test 14b: ENABLE ROW LEVEL SECURITY runs BEFORE CREATE POLICY (otherwise
  // policies are dormant on a fresh replay).
  const fixture14b = [
    'CREATE POLICY "p1" ON public.foo FOR SELECT USING (true);',
    'ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;',
    'CREATE TABLE IF NOT EXISTS public.foo (id int);',
  ].join('\n');
  const out14b = reorder(fixture14b);
  const tbl14b = out14b.indexOf('CREATE TABLE IF NOT EXISTS public.foo');
  const rls14b = out14b.indexOf('ENABLE ROW LEVEL SECURITY');
  const pol14b = out14b.indexOf('CREATE POLICY "p1"');
  expect('order: CREATE TABLE → ENABLE RLS → CREATE POLICY',
    tbl14b > -1 && rls14b > -1 && pol14b > -1 && tbl14b < rls14b && rls14b < pol14b,
    `tbl=${tbl14b} rls=${rls14b} pol=${pol14b}`);

  // Test 15: COMMENT ON FUNCTION lands AFTER the function CREATE.
  const fixture15 = [
    "COMMENT ON FUNCTION \"public\".\"f\"() IS 'doc';",
    'CREATE OR REPLACE FUNCTION "public"."f"() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;',
  ].join('\n');
  const out15 = reorder(fixture15);
  const fn15 = out15.indexOf('CREATE OR REPLACE FUNCTION "public"."f"');
  const cmt15 = out15.indexOf('COMMENT ON FUNCTION');
  expect('COMMENT ON FUNCTION lands after CREATE FUNCTION',
    fn15 > -1 && cmt15 > -1 && fn15 < cmt15,
    `fn=${fn15} cmt=${cmt15}`);

  process.stdout.write(`\nself-test: ${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entrypoint
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
  const output = reorder(input);
  if (outPath) {
    writeFileSync(outPath, output);
  } else {
    process.stdout.write(output);
  }
}

// Top-level: run main() unconditionally when invoked as a script. ESM modules
// imported via `import { reorder } from '...'` will set their argv[1] to the
// importer, so this guard would skip — but since reorder() / classifyStatement
// / splitStatements are pure exports, importing as a library never executes
// main() because consumers `await import()` and don't run argv. The simplest
// correct guard: check that argv[1] resolves to this file path.
import { fileURLToPath as _fileURLToPath } from 'node:url';
const _entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const _self = _fileURLToPath(import.meta.url).replace(/\\/g, '/');
if (_entry === _self) {
  await main();
}
