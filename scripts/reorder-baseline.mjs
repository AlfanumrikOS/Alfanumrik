#!/usr/bin/env node
/**
 * reorder-baseline.mjs
 * --------------------
 * Reorder a sanitized pg_dump baseline so that table/sequence/type definitions
 * appear before the function/view/trigger/policy definitions that reference
 * them. Without this reordering, `%ROWTYPE` declarations inside CREATE FUNCTION
 * bodies fail to PARSE on a fresh Postgres because the referenced table type
 * does not yet exist.
 *
 * pg_dump emits its own internal order (alphabetical-ish by object class), and
 * relies on `SET check_function_bodies = false` so that the *body* of a
 * function isn't validated until after all tables are created. But `%ROWTYPE`
 * resolution happens at PARSE time of the function header / DECLARE block —
 * which is BEFORE check_function_bodies kicks in. Hence the failure mode
 *
 *     ERROR: relation "public.adaptive_mastery" does not exist
 *
 * even though check_function_bodies = false is set.
 *
 * This script splits the input file into top-level SQL statements (handling
 * dollar-quoting, single-quote strings, line/block comments) and routes each
 * statement into one of 10 ordered buckets:
 *
 *   1. setup     — SET, SELECT pg_catalog.set_config, comments-only chunks,
 *                  CREATE EXTENSION, CREATE SCHEMA, COMMENT ON SCHEMA
 *   2. types     — CREATE TYPE / CREATE DOMAIN (including the DO $$..$$
 *                  idempotency wrappers the sanitize step adds)
 *   3. sequences — CREATE SEQUENCE, ALTER SEQUENCE
 *   4. tables    — CREATE TABLE, ALTER TABLE
 *   5. indexes   — CREATE INDEX, CREATE UNIQUE INDEX
 *   6. functions — CREATE FUNCTION, CREATE OR REPLACE FUNCTION, CREATE PROCEDURE
 *   7. views     — CREATE VIEW, CREATE OR REPLACE VIEW, CREATE MATERIALIZED VIEW
 *   8. triggers  — CREATE TRIGGER, CREATE EVENT TRIGGER
 *   9. policies  — CREATE POLICY, DROP POLICY, ALTER TABLE … ENABLE RLS
 *  10. other     — anything that didn't match (kept at the end so we don't
 *                  accidentally drop a statement)
 *
 * Buckets are concatenated in order 1→10. The result is replayable on a fresh
 * Postgres where prior versions failed.
 *
 * The script is **idempotent**: running it on already-reordered input yields
 * the same output (each bucket is preserved in its existing relative order,
 * and the bucket-emit order is deterministic).
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
  'sequences',
  'tables',
  'indexes',
  'functions',
  'views',
  'triggers',
  'policies',
  'other',
];

const BUCKET = Object.freeze({
  SETUP: 0,
  TYPES: 1,
  SEQUENCES: 2,
  TABLES: 3,
  INDEXES: 4,
  FUNCTIONS: 5,
  VIEWS: 6,
  TRIGGERS: 7,
  POLICIES: 8,
  OTHER: 9,
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

/**
 * Classify a single statement (already split by `splitStatements`) into a
 * bucket index. Order of pattern checks matters for ambiguous statements like
 * `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (policies) vs `ALTER TABLE … ADD
 * COLUMN` (tables).
 */
export function classifyStatement(stmt) {
  const head = firstSqlLine(stmt);
  if (!head) return BUCKET.SETUP; // pure comment / whitespace block

  // Setup: SET, SELECT pg_catalog.set_config, COMMENT ON SCHEMA, CREATE EXTENSION, CREATE SCHEMA
  if (/^SET\s+/i.test(head)) return BUCKET.SETUP;
  if (/^SELECT\s+pg_catalog\.set_config/i.test(head)) return BUCKET.SETUP;
  if (/^CREATE\s+EXTENSION\b/i.test(head)) return BUCKET.SETUP;
  if (/^CREATE\s+SCHEMA\b/i.test(head)) return BUCKET.SETUP;
  if (/^COMMENT\s+ON\s+SCHEMA\b/i.test(head)) return BUCKET.SETUP;

  // RLS-style ALTER TABLE … ENABLE ROW LEVEL SECURITY → policies bucket so it
  // fires AFTER the table definition and the policy DROP/CREATE pair land
  // first. Also covers ALTER TABLE … FORCE ROW LEVEL SECURITY.
  if (/^ALTER\s+TABLE\b.*\bROW\s+LEVEL\s+SECURITY\b/i.test(stmt.replace(/\s+/g, ' '))) {
    return BUCKET.POLICIES;
  }

  // CREATE/DROP POLICY
  if (/^(CREATE|DROP)\s+POLICY\b/i.test(head)) return BUCKET.POLICIES;

  // Triggers (incl. event triggers). DROP TRIGGER lands here too.
  if (/^(CREATE|DROP)\s+(EVENT\s+)?TRIGGER\b/i.test(head)) return BUCKET.TRIGGERS;

  // Views (regular + materialized)
  if (/^CREATE\s+(OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\b/i.test(head)) {
    return BUCKET.VIEWS;
  }

  // Functions / procedures
  if (/^CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b/i.test(head)) {
    return BUCKET.FUNCTIONS;
  }

  // Sanitized CREATE TYPE wrapped in DO $$ BEGIN CREATE TYPE … END $$;
  // The first non-comment line is `DO $$ BEGIN` or similar, but the inner
  // CREATE TYPE is what we care about. Detect by scanning the statement body.
  if (/^\s*DO\s+\$/i.test(head)) {
    if (/CREATE\s+TYPE\b/i.test(stmt) || /CREATE\s+DOMAIN\b/i.test(stmt)) {
      return BUCKET.TYPES;
    }
    // Other DO blocks land in OTHER (rare in pg_dump output)
    return BUCKET.OTHER;
  }
  if (/^CREATE\s+(TYPE|DOMAIN)\b/i.test(head)) return BUCKET.TYPES;

  // Sequences
  if (/^(CREATE|ALTER)\s+SEQUENCE\b/i.test(head)) return BUCKET.SEQUENCES;

  // Indexes
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(head)) return BUCKET.INDEXES;

  // Tables (default for any remaining ALTER TABLE / CREATE TABLE — must come
  // after the policy / RLS-enable check above)
  if (/^CREATE\s+TABLE\b/i.test(head)) return BUCKET.TABLES;
  if (/^ALTER\s+TABLE\b/i.test(head)) return BUCKET.TABLES;

  return BUCKET.OTHER;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reorder driver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marker line written into the output so a second invocation can detect that
 * the file is already reordered and strip the previous markers before
 * re-bucketing. This makes reorder(reorder(x)) === reorder(x).
 */
const BUCKET_MARKER_RE = /^-- ── reorder-baseline\.mjs bucket \d+: [a-z]+ ──$/;

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
    parts.push(buckets[b].join(''));
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

  // Test 6: ALTER TABLE … ENABLE ROW LEVEL SECURITY routes to policies bucket
  // (so it lands AFTER the table is created, not interleaved before it).
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
