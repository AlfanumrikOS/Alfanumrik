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
const ALLOW_QUOTA_MARKER = /--\s*lint:allow-quota-write\b/i;

// ── Quota-never-reset rule (testing-strategy Phase 1, gap 2) ────────────────
//
// Product rule (§8 / CLAUDE.md payments): "Never reset user quotas on deploy —
// quota defaults belong in application code, not in migration
// INSERT … ON CONFLICT DO UPDATE scripts." A migration that executes TOP-LEVEL
// DML against a quota/usage-state table silently rewrites live per-user
// counters on every environment the chain is applied to.
//
// Scope precision:
//   - Only TOP-LEVEL statements are flagged. DML inside dollar-quoted bodies
//     (`$$ … $$`, `$tag$ … $tag$` — i.e. CREATE FUNCTION / DO blocks) is
//     application-level logic executed at RUNTIME, not at deploy, and every
//     existing quota write in the chain lives there (verified 2026-07-13:
//     stem_lab_engagement_tier1, purchase_streak_freeze_rpc,
//     platform_security_layer, baseline — all inside function bodies).
//   - Opt-out for a deliberate, reviewed backfill: -- lint:allow-quota-write
const QUOTA_STATE_TABLES = [
  'student_daily_usage',
  'api_rate_limits',
  'api_rate_limits_v2',
  'rate_limits',
  'coin_balances',
  'security_request_usage_daily',
  'security_request_usage_monthly',
  'security_tenant_ai_usage_daily',
  'security_tenant_ai_usage_monthly',
  'security_tenant_ai_budgets',
];

const QUOTA_TABLE_ALTERNATION = QUOTA_STATE_TABLES.join('|');
// INSERT INTO / UPDATE / DELETE FROM / TRUNCATE on a quota-state table.
// Table may be schema-qualified (public.) and/or double-quoted.
const QUOTA_DML_RE = new RegExp(
  '\\b(?:' +
    `insert\\s+into\\s+(?:"?public"?\\s*\\.\\s*)?"?(${QUOTA_TABLE_ALTERNATION})"?\\b` +
    '|' +
    `update\\s+(?:only\\s+)?(?:"?public"?\\s*\\.\\s*)?"?(${QUOTA_TABLE_ALTERNATION})"?\\s+set\\b` +
    '|' +
    `delete\\s+from\\s+(?:only\\s+)?(?:"?public"?\\s*\\.\\s*)?"?(${QUOTA_TABLE_ALTERNATION})"?\\b` +
    '|' +
    `truncate\\s+(?:table\\s+)?(?:only\\s+)?(?:"?public"?\\s*\\.\\s*)?"?(${QUOTA_TABLE_ALTERNATION})"?\\b` +
    ')',
  'gi',
);

/**
 * Strip dollar-quoted bodies (`$$ … $$`, `$tag$ … $tag$`) so only TOP-LEVEL
 * (deploy-time) statements remain for the quota rule. Non-nested, matching
 * PostgreSQL's own tag semantics: a body opened with $tag$ closes only at the
 * next identical $tag$.
 */
function stripDollarQuotedBodies(sql) {
  return sql.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ');
}

/**
 * Returns the list of quota-state tables hit by top-level DML in `sql`
 * (already comment-stripped). Empty array = clean.
 */
function findTopLevelQuotaWrites(sql) {
  const topLevel = stripDollarQuotedBodies(sql);
  const tables = new Set();
  let m;
  while ((m = QUOTA_DML_RE.exec(topLevel)) !== null) {
    const table = m[1] || m[2] || m[3] || m[4];
    if (table) tables.add(table.toLowerCase());
  }
  QUOTA_DML_RE.lastIndex = 0;
  return [...tables].sort();
}

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

// ── UTF-8 BOM rule ─────────────────────────────────────────────────────────
//
// A leading UTF-8 BOM (EF BB BF) is invisible in every editor and survives
// `.gitattributes`' `*.sql text eol=lf` (that normalizes line endings only,
// not the byte-order mark). PostgreSQL does NOT skip it: `supabase db push`
// dies with
//
//   ERROR: syntax error at or near "<BOM>" (SQLSTATE 42601)  At statement: 0
//
// Incident (2026-08-09): a single BOM on
// 20260814000000_answer_key_oracle_closure_and_v1_gate.sql blocked the
// production deploy chain for two cycles — including a merged CRITICAL
// security fix (PR #1489) that could not go live. This is a raw BYTE check
// (not a decoded U+FEFF check) so it fires only on a true leading BOM and
// never on a U+FEFF that appears elsewhere in the file.
//
// No opt-out marker: there is no legitimate reason for a migration to carry a
// BOM. Fix is always "re-save as UTF-8 without BOM".
function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

// ── Design-artifact rule ───────────────────────────────────────────────────
//
// Incident (2026-08-23 18:11 UTC): a design-only artifact was committed to
// `supabase/migrations/`. Its header said, in capitals, that it had not been
// applied to any environment and must not be `supabase db push`-ed. The next
// `supabase db push --linked --include-all` applied it to PRODUCTION in
// version order anyway, silently narrowing schema-wide default privileges.
//
// THE ROOT CAUSE IS A CATEGORY ERROR, NOT A TYPO: a comment is advisory, but
// `supabase/migrations/` is an auto-applying directory. A file that declares
// "do not run me" while sitting somewhere everything is run is a contradiction
// the tooling cannot see. This rule makes the contradiction fail at PR time.
//
// The remedy is never "delete the marker" — it is to MOVE the file out of this
// directory. `docs/runbooks/` is where this repo keeps design artifacts and
// DOWN/rollback scripts (8 `docs/runbooks/*.DOWN.sql` precedents).
//
// Two independent detectors, because they fail differently:
//
//   (a) FILENAME — an uppercase shout-segment. Verified discriminating: across
//       all 617 top-level migrations, the 2026-08-23 offender is the ONLY file
//       whose name contains any uppercase character at all. The corpus
//       convention is lowercase snake_case, so an uppercase segment is always a
//       deliberate shout. NO OPT-OUT: a file named *_DESIGN_ONLY.sql has no
//       business in an auto-applying directory under any circumstance.
//
//   (b) CONTENT — narrow self-declaration phrases ("DO NOT ... db push",
//       "THIS FILE HAS NOT BEEN APPLIED", "NOT A MIGRATION", ...). These are
//       opt-out-able via `-- lint:allow-design-marker`, because an
//       incident-remediation migration legitimately needs to QUOTE the phrases
//       while explaining what happened. Quoting is not declaring.
//
// FALSE-POSITIVE CALIBRATION (measured against all 617 files before shipping):
// bare "DO NOT" matches 151 files and is unusable. "DO NOT APPLY" matches 8 and
// "DO NOT RUN" matches 9 — all ordinary prose ("...they do not apply to other
// migrations", "do NOT run more often"). Worse, 20260821070000 says "DO NOT
// APPLY IT WITH `apply_migration`", which means the OPPOSITE of this rule: that
// file MUST be applied, just via db push rather than the MCP tool. So neither
// phrase is in the set below. Every pattern here was confirmed to match the
// 2026-08-23 offender and nothing else.
const DESIGN_MARKER_ALLOW = /--\s*lint:allow-design-marker\b/i;

// Uppercase shout-segment in the filename, e.g. `..._DESIGN_ONLY.sql`.
// Case-SENSITIVE by design (see calibration note above).
const DESIGN_FILENAME_RE =
  /(?:^|_)(DESIGN_ONLY|DO_NOT_APPLY|DO_NOT_RUN|DO_NOT_DEPLOY|DO_NOT_MERGE|NOT_APPLIED|DRAFT|WIP|TODO|SCRATCH|TEMPLATE|EXAMPLE|SAMPLE)(?:_|\.)/;

const DESIGN_CONTENT_RES = [
  // "DO NOT `supabase db push` this". The imperative about the apply command
  // itself — the single clearest statement that a file must not auto-apply.
  {
    name: 'DO NOT ... db push',
    re: /\bDO\s+NOT\s+(?:EVER\s+)?[`'"]*(?:supabase\s+)?db[\s_-]?push\b/i,
  },
  // "DO NOT MOVE THIS FILE INTO supabase/migrations/" — said by DOWN scripts.
  // If it is saying this from INSIDE supabase/migrations/, it already lost.
  { name: 'DO NOT MOVE THIS FILE INTO', re: /\bDO\s+NOT\s+MOVE\s+THIS\s+FILE\s+INTO\b/i },
  // Anchored on "THIS FILE" so it cannot fire on ordinary cross-references
  // like "If M1 has not been applied, ..." (a real line in 20260814000019).
  { name: 'THIS FILE HAS NOT BEEN APPLIED', re: /\bTHIS\s+FILE\s+(?:HAS\s+)?NOT\s+BEEN\s+APPLIED\b/i },
  { name: 'NOT A MIGRATION', re: /\bNOT\s+A\s+MIGRATION\b/i },
  { name: 'DO NOT MERGE / DO NOT DEPLOY', re: /\bDO\s+NOT\s+(?:MERGE|DEPLOY)\b/i },
  // A DESIGN_ONLY / DESIGN ONLY body marker. The negative lookahead drops
  // `..._DESIGN_ONLY.sql` FILENAME CITATIONS, which are legitimate: both the
  // offender's own `-- Migration:` header line and every later file that
  // references it by name contain that exact string.
  { name: 'DESIGN ONLY body marker', re: /\bDESIGN[_\s-]ONLY\b(?!\.sql)/i },
];

/**
 * Returns human-readable descriptions of every do-not-apply marker on this
 * file, or [] if clean. `baseName` is the filename only, `raw` the decoded body.
 */
function findDesignArtifactMarkers(baseName, raw) {
  const hits = [];
  const fnMatch = DESIGN_FILENAME_RE.exec(baseName);
  // Filename rule is NOT opt-out-able.
  if (fnMatch) hits.push(`filename contains the marker segment "${fnMatch[1]}"`);
  if (!DESIGN_MARKER_ALLOW.test(raw)) {
    for (const { name, re } of DESIGN_CONTENT_RES) {
      if (re.test(raw)) hits.push(`body declares "${name}"`);
    }
  }
  return hits;
}

// Applied to production on 2026-08-23 18:11 UTC DESPITE its own do-not-apply
// header — that is the incident this rule exists to prevent. It is grandfathered
// because it now has a production ledger row: `supabase db push` and
// .github/scripts/verify-migration-ledger.sh both key off that row, so renaming
// or removing the file would make the ledger check report REMOTE_NOT_COMMITTED
// and abort the next deploy. The file is frozen, not endorsed.
//
// THIS LIST MUST NOT GROW. A second entry means a second design artifact reached
// production, which is the incident recurring, not a lint problem. A pinning
// test asserts the list has exactly this one entry.
const DESIGN_MARKER_GRANDFATHERED = [
  '20260823154500_db12_narrow_default_grants_and_money_table_write_revoke_DESIGN_ONLY.sql',
];

function lintFile(filePath) {
  const buf = fs.readFileSync(filePath);

  // ── BOM rule — checked first, and NOT opt-out-able. A BOM'd file cannot be
  // applied at all, so it outranks every body-content rule below. ──
  if (hasUtf8Bom(buf)) {
    return {
      status: 'fail',
      reason:
        'file starts with a UTF-8 BOM (EF BB BF) — Postgres rejects it with ' +
        'SQLSTATE 42601 "syntax error" at statement 0, blocking the whole ' +
        'migration chain',
      fix: 'Re-save the file as UTF-8 WITHOUT a BOM (strip the first 3 bytes).',
    };
  }

  const raw = buf.toString('utf8');

  // ── Design-artifact rule — runs before every body-content rule below. This
  // is a "you are in the wrong directory" rule, not a "your SQL is wrong" rule,
  // so it outranks them: there is no point reporting placeholder/quota findings
  // on a file that should not be in supabase/migrations/ at all. ──
  const baseName = path.basename(filePath);
  if (!DESIGN_MARKER_GRANDFATHERED.includes(baseName)) {
    const markers = findDesignArtifactMarkers(baseName, raw);
    if (markers.length > 0) {
      return {
        status: 'fail',
        reason:
          'file declares that it must not be applied (' +
          markers.join('; ') +
          ') but lives in supabase/migrations/, which `supabase db push ' +
          "--include-all` applies unconditionally in version order — this is the " +
          '2026-08-23 production incident',
        fix:
          'MOVE the file out of supabase/migrations/ ' +
          '(docs/runbooks/ is where this repo keeps design artifacts and *.DOWN.sql scripts). ' +
          'Do not just delete the marker text: that silences the guard and leaves an ' +
          'unreviewed artifact auto-applying, which is strictly worse. ' +
          'If this is a real migration that merely QUOTES those phrases while documenting an ' +
          'incident, annotate it with -- lint:allow-design-marker ' +
          '(that opt-out covers the body rules only; a FILENAME marker is never allowed).',
      };
    }
  }

  const stripped = stripComments(raw);

  // ── Quota-never-reset rule — runs even on allow-placeholder files (the two
  // markers are independent opt-outs for independent hazards). ──
  if (!ALLOW_QUOTA_MARKER.test(raw)) {
    const quotaHits = findTopLevelQuotaWrites(stripped);
    if (quotaHits.length > 0) {
      return {
        status: 'fail',
        reason: `top-level DML on quota-state table(s): ${quotaHits.join(', ')} — quota defaults belong in application code, not migrations`,
      };
    }
  }

  // The allow marker must appear in the original source (comments are where
  // it lives). Check before stripping.
  if (ALLOW_MARKER.test(raw)) {
    return { status: 'allowed' };
  }
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

// -- Duplicate-timestamp-version guard -------------------------------------
//
// Supabase's "schema_migrations" tracking table uses the migration's leading
// timestamp (everything before the first underscore in the filename, e.g.
// 20260720170000 in 20260720170000_some_migration.sql) as its PRIMARY KEY.
//
// This repo runs several parallel long-lived feature branches (each its own
// RCA/redesign workstream) that independently create migrations named after
// "now" at authoring time. Two branches authored the same day can and DO
// pick the identical timestamp. Each branch's own CI is green in isolation
// (its migrations dir has no self-collision) -- the collision only exists
// once BOTH branches' migrations are combined, e.g. after merging main into
// a feature branch, or once two PRs land back-to-back.
//
// Incident: PR #1363 (teacher-dashboard) and PR #1364 (parent-portal) both
// shipped a migration timestamped 20260720170000. #1364 merged first; when
// #1363 merged, "supabase db push" failed AFTER MERGE, IN THE PRODUCTION
// DEPLOY JOB, with a duplicate-key error on schema_migrations_pkey. All
// three of #1363's migrations were blocked from applying until a follow-up
// hotfix renamed the colliding files -- hours of production deploy failure
// that a 14-second PR-time check would have caught before merge.
//
// This function makes that check unconditional and PR-time: it runs against
// whatever supabase/migrations/*.sql looks like at PR-CI time, which (per
// GitHub Actions' default pull_request checkout behavior) is the PR branch
// merged into the current base -- i.e. it sees exactly the combined state
// that "supabase db push" would see, days before deploy.
function findDuplicateVersions(files) {
  const byVersion = new Map();
  for (const file of files) {
    const base = path.basename(file);
    const m = /^(\d{14})_/.exec(base);
    if (!m) continue; // not our naming convention (e.g. baseline file); skip
    const version = m[1];
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push(base);
  }
  const duplicates = [];
  for (const [version, names] of byVersion) {
    if (names.length > 1) duplicates.push({ version, files: names.sort() });
  }
  return duplicates.sort((a, b) => (a.version < b.version ? -1 : 1));
}

function main() {
  const files = listMigrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    console.log('lint-migrations: no migration files found under supabase/migrations/ — nothing to check.');
    process.exit(0);
  }
  const duplicateVersions = findDuplicateVersions(files);
    if (duplicateVersions.length > 0) {
      console.log('');
      console.log('FAIL: duplicate migration timestamp(s) detected in schema_migrations key space.');
      console.log('Applying BOTH of these to the same database will fail with a duplicate-key');
      console.log('error on schema_migrations_pkey (this exact incident has already happened');
      console.log('once - see the comment above findDuplicateVersions() in this file).');
      console.log('');
      for (const dup of duplicateVersions) {
        console.log('  version ' + dup.version + ' is used by ' + dup.files.length + ' files:');
        for (const name of dup.files) console.log('    - ' + name);
      }
      console.log('');
      console.log('Fix: rename all but one of the colliding files to a unique timestamp later');
      console.log('than every existing migration, and update any other file that references');
      console.log('the old filename by name.');
      process.exit(1);
    }
  
    const failures = [];
  let allowedCount = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const result = lintFile(file);
    if (result.status === 'fail') {
      failures.push({ file: rel, reason: result.reason, fix: result.fix });
    } else if (result.status === 'allowed') {
      allowedCount += 1;
    }
  }
  console.log(
    `lint-migrations: scanned ${files.length} file(s); ${allowedCount} allow-listed; ${failures.length} failure(s).`,
  );
  if (failures.length > 0) {
    console.log('');
    for (const { file, reason, fix } of failures) {
      // `fix` is set by rules whose remedy is NOT "add DDL / allow-list it"
      // (e.g. the BOM rule, which has no opt-out).
      console.log(
        `FAIL: ${file} — ${reason}. ${fix || 'Add real DDL or annotate with -- lint:allow-placeholder'}`,
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
  findDuplicateVersions,
  hasUtf8Bom,
  findDesignArtifactMarkers,
  DESIGN_MARKER_GRANDFATHERED,
  stripComments,
  normalizeBody,
  isPlaceholder,
  lintFile,
  stripDollarQuotedBodies,
  findTopLevelQuotaWrites,
};
