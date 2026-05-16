#!/usr/bin/env node
/**
 * lint-migrations.js — Phase E.2 CI guard.
 *
 * Scans `supabase/migrations/*.sql` (top-level only; `_legacy/` is excluded)
 * and rejects files whose entire body — after stripping comments and
 * whitespace — is a no-op `SELECT 1` placeholder.
 *
 * Why: Phase B.3 audit found ~10 SELECT-1 placeholders that landed because
 * the Supabase CLI happily applies them (the SELECT is valid SQL — it just
 * does nothing). A dev unfamiliar with the convention can easily introduce
 * another one. This linter is the gate.
 *
 * Opt-out: a file can be intentionally marked no-op by including the marker
 *
 *   -- lint:allow-placeholder
 *
 * anywhere in its top-of-file comment block (case-insensitive). The 10
 * audit-flagged placeholders carry this marker.
 *
 * Exit codes:
 *   0 — clean (no unannotated placeholders found)
 *   1 — one or more files fail; offenders printed to stdout
 *
 * No external deps: uses node:fs + node:path only.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

const ALLOW_MARKER = /--\s*lint:allow-placeholder\b/i;

// Body patterns we treat as "no-op placeholder" once comments + whitespace
// are stripped. Each pattern is matched against the fully-normalized body
// (lower-cased, single-spaced, trailing semicolon trimmed).
//
// NOTE: we deliberately accept `WHERE false`, `WHERE 1=1`, and `WHERE
// 1 = 0` flavors because all 10 existing audit-flagged placeholders use
// variants of these. The point of the linter is to surface ANY file whose
// real effect is a no-op — these are all no-ops.
const PLACEHOLDER_PATTERNS = [
  /^select\s+1\s*$/,
  /^select\s+1\s*::\s*(?:int|integer|bigint)\s*$/,
  /^select\s+1\s+where\s+(?:false|true|1\s*=\s*0|1\s*=\s*1)\s*$/,
  /^select\s+1\s*::\s*(?:int|integer|bigint)\s+where\s+(?:false|true|1\s*=\s*0|1\s*=\s*1)\s*$/,
  // BEGIN; SELECT 1 WHERE FALSE; COMMIT; flavor — `BEGIN`/`COMMIT` are
  // transaction control and on their own don't do schema work.
  /^begin\s*;\s*select\s+1(?:\s*::\s*(?:int|integer|bigint))?(?:\s+where\s+(?:false|true|1\s*=\s*0|1\s*=\s*1))?\s*;\s*commit\s*$/,
];

/**
 * Strip SQL comments from a string.
 *
 *  - line comments: `--` to end of line
 *  - block comments: `/* ... *​/`  (non-nested)
 *
 * Returns the comment-free source.
 */
function stripComments(sql) {
  // Remove /* ... */ blocks (non-greedy, multi-line).
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove -- to end-of-line.
  out = out.replace(/--[^\n\r]*/g, '');
  return out;
}

/**
 * Normalize SQL body for pattern matching:
 *   - lowercase
 *   - collapse all whitespace runs to single space
 *   - trim
 *   - drop a single trailing semicolon (kept inside the BEGIN…COMMIT flavor)
 */
function normalizeBody(sql) {
  let body = sql.toLowerCase();
  body = body.replace(/\s+/g, ' ').trim();
  // Drop a single trailing semicolon so `SELECT 1;` and `SELECT 1` both
  // collapse to the same canonical form. Multi-statement bodies (which
  // include internal semicolons) are handled by the explicit BEGIN…COMMIT
  // pattern above.
  if (body.endsWith(';')) {
    body = body.slice(0, -1).trim();
  }
  return body;
}

function isPlaceholder(normalized) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(normalized));
}

function listMigrationFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  // Top-level *.sql only. `_legacy/` and any other subdir are skipped —
  // legacy migrations pre-date the convention and the placeholder rule
  // doesn't apply to historical artifacts.
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function lintFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // The allow marker must appear in the original source (comments are where
  // it lives). Check before stripping.
  if (ALLOW_MARKER.test(raw)) {
    return { status: 'allowed' };
  }
  const stripped = stripComments(raw);
  const normalized = normalizeBody(stripped);
  if (normalized === '') {
    // File is comment-only / empty. That's arguably also a problem
    // (a migration with no body at all) but we treat it the same as a
    // SELECT-1 placeholder: it needs to be either annotated or written.
    return { status: 'fail', reason: 'empty body (only comments)' };
  }
  if (isPlaceholder(normalized)) {
    return { status: 'fail', reason: 'body is SELECT-1 placeholder' };
  }
  return { status: 'ok' };
}

function main() {
  const files = listMigrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    console.log('lint-migrations: no migration files found under supabase/migrations/ — nothing to check.');
    process.exit(0);
  }
  const failures = [];
  let allowedCount = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const result = lintFile(file);
    if (result.status === 'fail') {
      failures.push({ file: rel, reason: result.reason });
    } else if (result.status === 'allowed') {
      allowedCount += 1;
    }
  }
  console.log(
    `lint-migrations: scanned ${files.length} file(s); ${allowedCount} allow-listed; ${failures.length} failure(s).`,
  );
  if (failures.length > 0) {
    console.log('');
    for (const { file, reason } of failures) {
      console.log(
        `FAIL: ${file} — ${reason}. Add real DDL or annotate with -- lint:allow-placeholder`,
      );
    }
    console.log('');
    console.log(
      'See docs/runbooks/migration-placeholders-audit.md for why placeholders exist and when to allow-list one.',
    );
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  stripComments,
  normalizeBody,
  isPlaceholder,
  lintFile,
};
