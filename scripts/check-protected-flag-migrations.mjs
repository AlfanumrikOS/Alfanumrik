#!/usr/bin/env node
// scripts/check-protected-flag-migrations.mjs
//
// Phase 0 flag-governance hardening (master action plan item 0.7).
//
// Guards against a migration that silently re-enables a protected feature
// flag (the SQL equivalent of the 2026-07-20 console bulk-enable incident,
// e.g. a "data repair" migration that ships
// `UPDATE feature_flags SET is_enabled = true WHERE flag_name = 'ff_school_pulse_v1'`
// without anyone noticing during review).
//
// For every scanned migration file:
//   1. Collect every protected flag name (from
//      packages/lib/src/flags/protected-flags.ts) mentioned anywhere in the
//      file.
//   2. If the file also contains an `is_enabled = true`-shaped assignment or
//      a `rollout_percentage` assignment to a nonzero literal (comments
//      stripped first), the file is making at least one flag MORE enabled.
//   3. For EVERY mentioned protected flag, require a matching in-file marker
//      comment: `-- CEO-APPROVED-FLAG-FLIP: <flag_name>` (exact name,
//      case-sensitive). Missing the marker for any mentioned flag → FAIL.
//
// This is a coarse, FILE-LEVEL heuristic (not a per-statement SQL parser) —
// intentionally conservative. A migration that merely READS or DISABLES a
// protected flag, or mentions its name in a comment/doc block without an
// enabling assignment nearby, is never blocked. A false positive (flagging
// something that isn't really an enable) just requires adding the marker
// comment; a false negative (missing a real enable) is the failure mode this
// script exists to prevent, so it errs toward over-flagging.
//
// Usage:
//   node scripts/check-protected-flag-migrations.mjs [file1.sql file2.sql ...]
//   node scripts/check-protected-flag-migrations.mjs --base <git-ref>
//   node scripts/check-protected-flag-migrations.mjs   (no args: diffs against
//     $GITHUB_BASE_SHA / $PUSH_BEFORE_SHA env vars if set, else scans every
//     migration file, fail-closed)
//
// Exit code 0: clean (including "nothing relevant to check").
// Exit code 1: one or more offending files (printed to stderr).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const PROTECTED_FLAGS_TS = path.join(REPO_ROOT, 'packages', 'lib', 'src', 'flags', 'protected-flags.ts');

const MARKER_RE = (flagName) => new RegExp(`--\\s*CEO-APPROVED-FLAG-FLIP:\\s*${escapeRegExp(flagName)}\\b`);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every flag-name-shaped token that could appear as a key in PROTECTED_FLAGS
 * or EXPECTED_OFF_FLAGS. Regex-derived (not a TS parse) so this script has no
 * build step / ts-node dependency — see the sibling parity test
 * (feature-flags-protected-guardrail.test.ts) for a stricter, structural
 * comparison against the parsed registry. */
function loadProtectedFlagNames() {
  const raw = fs.readFileSync(PROTECTED_FLAGS_TS, 'utf8');
  const nameRe = /\b(ff_[a-z0-9_]+|wave2_[a-z0-9_]+|wave3_[a-z0-9_]+|video_lessons|voice_tutor|group_sessions|improvement_[a-z0-9_]+|reconcile_stuck_subscriptions_enabled)\b/g;
  const names = new Set();
  let m;
  while ((m = nameRe.exec(raw))) names.add(m[1]);
  return names;
}

function stripSqlComments(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Does the (comment-stripped) SQL contain an "enable" or "rollout > 0" assignment? */
function hasEnablingAssignment(strippedSql) {
  const enabledTrue = /is_enabled\s*[=:]\s*true\b/i.test(strippedSql);
  // rollout_percentage set to any nonzero integer literal (handles both
  // `rollout_percentage = 100` and `rollout_percentage: 10` jsonb-arg shapes).
  const rolloutNonZero = /rollout_percentage\s*[=:]\s*'?([1-9][0-9]*)'?/i.test(strippedSql);
  return enabledTrue || rolloutNonZero;
}

function findChangedMigrationFiles(baseRef) {
  try {
    const args = ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`, '--', 'supabase/migrations/*.sql'];
    const out = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((f) => !f.includes('/_legacy/'));
  } catch {
    return null; // signal: diff failed, caller should fail closed
  }
}

function allMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.sql'))
    .map((d) => path.join('supabase', 'migrations', d.name));
}

function resolveTargetFiles() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length > 0) return positional;

  const baseFlagIdx = argv.indexOf('--base');
  const explicitBase = baseFlagIdx !== -1 ? argv[baseFlagIdx + 1] : undefined;
  const envBase = process.env.GITHUB_BASE_SHA || process.env.PUSH_BEFORE_SHA;
  const baseRef = explicitBase || envBase || 'origin/main';

  const changed = findChangedMigrationFiles(baseRef);
  if (changed === null) {
    console.warn(`[check-protected-flag-migrations] could not diff against "${baseRef}"; scanning ALL migrations fail-closed.`);
    return allMigrationFiles();
  }
  return changed;
}

function main() {
  const protectedNames = loadProtectedFlagNames();
  const targets = resolveTargetFiles();

  if (targets.length === 0) {
    console.log('[check-protected-flag-migrations] no migration files to check.');
    process.exit(0);
  }

  const offenders = [];

  for (const relOrAbsPath of targets) {
    const absPath = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.join(REPO_ROOT, relOrAbsPath);
    if (!fs.existsSync(absPath)) continue; // deleted file in the diff — nothing to check
    if (absPath.includes(`${path.sep}_legacy${path.sep}`)) continue;

    const raw = fs.readFileSync(absPath, 'utf8');
    const stripped = stripSqlComments(raw);

    const mentioned = [...protectedNames].filter((name) => stripped.includes(name));
    if (mentioned.length === 0) continue;

    if (!hasEnablingAssignment(stripped)) continue; // reads/disables only — not gated

    const missingMarkers = mentioned.filter((name) => !MARKER_RE(name).test(raw));
    if (missingMarkers.length > 0) {
      offenders.push({ file: path.relative(REPO_ROOT, absPath), missingMarkers });
    }
  }

  if (offenders.length > 0) {
    console.error('BLOCKED: migration(s) appear to enable a protected feature flag without a CEO-approval marker.\n');
    for (const o of offenders) {
      console.error(`  ${o.file}`);
      for (const name of o.missingMarkers) {
        console.error(`    - missing: -- CEO-APPROVED-FLAG-FLIP: ${name}`);
      }
    }
    console.error(
      '\nIf this flip IS CEO-approved, add a line comment for EACH protected flag name the ' +
      'migration enables, e.g.:\n\n  -- CEO-APPROVED-FLAG-FLIP: ff_school_pulse_v1\n\n' +
      'to the SAME migration file, then re-run this check.',
    );
    process.exit(1);
  }

  console.log(`[check-protected-flag-migrations] OK — ${targets.length} migration file(s) checked, no unmarked protected-flag enables.`);
  process.exit(0);
}

main();
