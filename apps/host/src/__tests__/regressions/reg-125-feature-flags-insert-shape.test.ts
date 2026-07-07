/**
 * REG-125 — feature_flags seed-shape conformance (root migrations).
 *
 * Incident (2026-06-12, staging wall): the original
 * `20260606000000_phase5_phase6_python_flags.sql` ran
 *
 *   INSERT INTO public.feature_flags (name, description, enabled, metadata) ...
 *   ON CONFLICT (name) DO UPDATE ...
 *
 * but the canonical feature_flags table (pg_dump prod baseline
 * `00000000000000_baseline_from_prod.sql` ~line 11212) has NO `name` or
 * `enabled` columns — the key column is `flag_name` (UNIQUE via
 * `feature_flags_flag_name_key`, baseline ~line 15364) with `is_enabled` +
 * `rollout_percentage` + `metadata`. The 42703 ("column does not exist")
 * failed the "Sync Migrations to Staging" pipeline at statement 0 across 6+
 * consecutive runs (GitHub run 27425591787 and predecessors) and blocked
 * EVERY later migration from reaching staging.
 *
 * This pin makes the failure mode a CI-time error instead of a
 * deploy-time wall:
 *
 *  1. Every `INSERT INTO feature_flags` in a ROOT migration (the only files
 *     `supabase db push` applies; `_legacy/` is skipped) must carry an
 *     explicit column list that includes the canonical `flag_name` column —
 *     UNLESS the file is schema-adaptive (information_schema column
 *     detection + to_regclass guard, the 20260606000000 rewrite pattern),
 *     in which case a guarded legacy-shape branch is permitted but a
 *     canonical `flag_name` branch must also exist in the same file.
 *  2. No feature_flags insert may resolve conflicts on the nonexistent
 *     `name` column (`ON CONFLICT (name)`) — statement-scoped, so
 *     legitimate `ON CONFLICT (name)` on OTHER tables (roles, guardians)
 *     is untouched.
 *  3. The rewritten 20260606000000 itself is pinned: to_regclass fresh-DB
 *     guard, flag_name/name column detection with canonical-branch
 *     priority, `ON CONFLICT (flag_name) DO NOTHING` (NO `DO UPDATE` — the
 *     original DO UPDATE would clobber an ops-bumped metadata.rollout_pct
 *     back to 0 on re-apply), default-OFF posture (no boolean `true`
 *     literal anywhere in executable SQL, every metadata rollout_pct is 0),
 *     all four Phase 5/6 flags seeded in BOTH branches, and a
 *     WHERE-NOT-EXISTS legacy branch that does not depend on a unique
 *     constraint over `name`.
 *
 * Analysis is done on comment-stripped, string-blanked "structural" SQL so
 * that (a) the rewrite's own header comment quoting the old broken
 * `ON CONFLICT (name) DO UPDATE` cannot trip the scanner, and (b) `;` or
 * `--` inside description string literals cannot truncate a statement.
 *
 * Deterministic, no DB. Catalogued as REG-125 in .claude/regression-catalog.md.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MIGRATIONS_ROOT = resolve(process.cwd(), 'supabase/migrations');
const REWRITTEN_FILE = '20260606000000_phase5_phase6_python_flags.sql';

const PHASE56_FLAGS = [
  'ff_python_ncert_solver_v1',
  'ff_python_cme_engine_v1',
  'ff_python_foxy_tutor_v1',
  'ff_python_quiz_generator_v1',
] as const;

// ---------------------------------------------------------------------------
// SQL text preprocessing
// ---------------------------------------------------------------------------

interface PreprocessedSql {
  /** Comments removed; string literals kept verbatim. */
  noComments: string;
  /** Comments removed AND single-quoted string CONTENTS blanked to spaces. */
  structural: string;
}

/**
 * Single-pass tokenizer over raw SQL.
 *
 *  - `--` line comments and non-nested block comments are dropped from both
 *    outputs (a newline / single space is emitted so offsets stay sane).
 *  - `'...'` literals (with `''` escaping) are kept in `noComments` but their
 *    contents are blanked in `structural`, so structural scans can never be
 *    fooled by SQL-looking text inside descriptions.
 *  - Dollar-quoted bodies (`DO $tag$ ... $tag$`) are deliberately treated as
 *    transparent code, NOT as string literals: the PL/pgSQL inside is exactly
 *    the SQL this pin needs to inspect, and `--` comments inside the body are
 *    real comments.
 */
function preprocess(raw: string): PreprocessedSql {
  let noComments = '';
  let structural = '';
  let state: 'code' | 'line' | 'block' | 'str' = 'code';
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    const d = i + 1 < n ? raw[i + 1] : '';
    if (state === 'code') {
      if (c === '-' && d === '-') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'str';
        noComments += c;
        structural += c;
        i += 1;
        continue;
      }
      noComments += c;
      structural += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        noComments += c;
        structural += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        noComments += ' ';
        structural += ' ';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // state === 'str'
    if (c === "'" && d === "'") {
      noComments += "''";
      structural += '  ';
      i += 2;
      continue;
    }
    if (c === "'") {
      state = 'code';
      noComments += c;
      structural += c;
      i += 1;
      continue;
    }
    noComments += c;
    structural += c === '\n' ? '\n' : ' ';
    i += 1;
  }
  return { noComments, structural };
}

// ---------------------------------------------------------------------------
// feature_flags INSERT analysis (on structural text)
// ---------------------------------------------------------------------------

interface FfInsert {
  /** Lower-cased, de-quoted column names from the explicit column list. */
  columns: string[];
  /** Statement text from the end of the column list to the terminating `;`. */
  tail: string;
}

/** Matches `INSERT INTO [public.]feature_flags (` — explicit column list. */
const FF_INSERT_WITH_COLUMNS_RE =
  /insert\s+into\s+(?:"?public"?\s*\.\s*)?"?feature_flags"?\s*\(/gi;

/** Matches ANY `INSERT INTO [public.]feature_flags` mention (word boundary). */
const FF_INSERT_ANY_RE =
  /insert\s+into\s+(?:"?public"?\s*\.\s*)?"?feature_flags"?\b/gi;

function parseFeatureFlagInserts(structural: string): FfInsert[] {
  const inserts: FfInsert[] = [];
  FF_INSERT_WITH_COLUMNS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FF_INSERT_WITH_COLUMNS_RE.exec(structural)) !== null) {
    const openIdx = m.index + m[0].length - 1; // the '('
    const closeIdx = structural.indexOf(')', openIdx);
    if (closeIdx === -1) break; // malformed — surfaced by the count check
    const columns = structural
      .slice(openIdx + 1, closeIdx)
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, '').toLowerCase())
      .filter(Boolean);
    let semi = structural.indexOf(';', closeIdx);
    if (semi === -1) semi = structural.length;
    const tail = structural.slice(closeIdx + 1, semi);
    inserts.push({ columns, tail });
  }
  return inserts;
}

function countAnyFeatureFlagInserts(structural: string): number {
  FF_INSERT_ANY_RE.lastIndex = 0;
  let count = 0;
  while (FF_INSERT_ANY_RE.exec(structural) !== null) count += 1;
  return count;
}

/**
 * A file may carry a guarded legacy-shape (`name`/`enabled`) branch ONLY if
 * its executable SQL detects the schema first: information_schema lookup of
 * the canonical `flag_name` column plus a to_regclass fresh-DB guard.
 * Detection runs on comment-stripped text so the guard cannot be faked from
 * a comment block.
 */
function isSchemaAdaptive(noComments: string): boolean {
  return (
    /information_schema\.columns/i.test(noComments) &&
    /column_name\s*=\s*'flag_name'/i.test(noComments) &&
    /to_regclass\s*\(\s*'public\.feature_flags'\s*\)/i.test(noComments)
  );
}

const ON_CONFLICT_NAME_RE = /on\s+conflict\s*\(\s*"?name"?\s*\)/i;

function listRootSqlFiles(): string[] {
  // Top-level only: `supabase db push` applies exactly these files;
  // `_legacy/` (and any other subdir) is never executed on deploy.
  return readdirSync(MIGRATIONS_ROOT)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => statSync(join(MIGRATIONS_ROOT, f)).isFile())
    .sort();
}

interface ScannedFile {
  file: string;
  raw: string;
  noComments: string;
  structural: string;
  inserts: FfInsert[];
  anyInsertCount: number;
}

function scanRootMigrations(): ScannedFile[] {
  return listRootSqlFiles().map((file) => {
    const raw = readFileSync(join(MIGRATIONS_ROOT, file), 'utf8');
    const { noComments, structural } = preprocess(raw);
    return {
      file,
      raw,
      noComments,
      structural,
      inserts: parseFeatureFlagInserts(structural),
      anyInsertCount: countAnyFeatureFlagInserts(structural),
    };
  });
}

// The exact shape that broke staging — used as a self-test fixture so the
// scanner is provably non-vacuous (it MUST flag the original bug).
const ORIGINAL_BROKEN_SQL = `
-- Migration: Add Python proxy feature flags (original, broken)
INSERT INTO public.feature_flags (
    name, description, enabled, metadata
) VALUES
(
    'ff_python_ncert_solver_v1',
    'Phase 5 Python cutover; default OFF -- see runbook',
    true,
    '{"rollout_pct": 0, "kill_switch": false}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    metadata = EXCLUDED.metadata;
`;

describe('REG-125 — feature_flags seed-shape conformance (root migrations)', () => {
  const scanned = scanRootMigrations();
  const withInserts = scanned.filter((s) => s.anyInsertCount > 0);

  it('scanner self-test: flags the original broken 20260606000000 shape', () => {
    const { noComments, structural } = preprocess(ORIGINAL_BROKEN_SQL);
    const inserts = parseFeatureFlagInserts(structural);
    expect(inserts).toHaveLength(1);
    // Wrong shape detected: legacy columns, no canonical key...
    expect(inserts[0].columns).toEqual(['name', 'description', 'enabled', 'metadata']);
    expect(inserts[0].columns).not.toContain('flag_name');
    // ...no adaptive guard to excuse it...
    expect(isSchemaAdaptive(noComments)).toBe(false);
    // ...and the broken conflict target is caught statement-scoped, even
    // though the description string contains a literal `--` (the tokenizer
    // must not treat string contents as a comment and eat the tail).
    expect(ON_CONFLICT_NAME_RE.test(inserts[0].tail)).toBe(true);
  });

  it('finds a meaningful population of feature_flags seeds at root (non-vacuous)', () => {
    const totalInserts = scanned.reduce((acc, s) => acc + s.inserts.length, 0);
    expect(totalInserts).toBeGreaterThanOrEqual(10);
    // The rewritten file contributes both branches.
    const rewritten = scanned.find((s) => s.file === REWRITTEN_FILE);
    expect(rewritten).toBeDefined();
    expect(rewritten!.inserts.length).toBe(2);
  });

  it('every root-migration INSERT INTO feature_flags carries an explicit column list', () => {
    const offenders = scanned
      .filter((s) => s.anyInsertCount !== s.inserts.length)
      .map((s) => `${s.file}: ${s.anyInsertCount} insert(s), ${s.inserts.length} with column list`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('every feature_flags insert targets flag_name, or is schema-adaptive with a canonical branch', () => {
    const violations: string[] = [];
    for (const s of withInserts) {
      const adaptive = isSchemaAdaptive(s.noComments);
      const hasCanonicalBranch = s.inserts.some((ins) => ins.columns.includes('flag_name'));
      for (const ins of s.inserts) {
        if (ins.columns.includes('flag_name')) continue; // canonical shape
        if (adaptive && hasCanonicalBranch) continue; // guarded legacy branch
        violations.push(
          `${s.file}: INSERT INTO feature_flags (${ins.columns.join(', ')}) — ` +
            `missing canonical flag_name column${adaptive ? ' (adaptive file lacks a canonical branch)' : ''}. ` +
            'The canonical table has flag_name/is_enabled, NOT name/enabled; the wrong shape ' +
            'walled the staging migration sync (REG-125, 2026-06-12).',
        );
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('no feature_flags insert resolves conflicts on the nonexistent name column', () => {
    const violations: string[] = [];
    for (const s of withInserts) {
      for (const ins of s.inserts) {
        if (ON_CONFLICT_NAME_RE.test(ins.tail)) {
          violations.push(
            `${s.file}: feature_flags insert uses ON CONFLICT (name) — no such column/constraint ` +
              'on the canonical table (the unique key is feature_flags_flag_name_key on flag_name).',
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  describe(`${REWRITTEN_FILE} rewrite pins`, () => {
    const path = join(MIGRATIONS_ROOT, REWRITTEN_FILE);

    it('exists at root', () => {
      expect(existsSync(path)).toBe(true);
    });

    const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const { noComments } = preprocess(raw);

    it('carries the fresh-DB guard and detects BOTH schema shapes, canonical first', () => {
      expect(noComments).toMatch(/to_regclass\s*\(\s*'public\.feature_flags'\s*\)/i);
      expect(noComments).toMatch(/column_name\s*=\s*'flag_name'/i);
      expect(noComments).toMatch(/column_name\s*=\s*'name'/i);
      // Canonical branch has priority over the legacy hypothesis.
      expect(noComments).toMatch(/if\s+v_has_flag_name\s+then[\s\S]*elsif\s+v_has_name\s+then/i);
    });

    it('canonical branch: ON CONFLICT (flag_name) DO NOTHING — and never DO UPDATE', () => {
      expect(noComments).toMatch(/on\s+conflict\s*\(\s*"?flag_name"?\s*\)\s*do\s+nothing/i);
      // The original DO UPDATE would clobber an ops-bumped
      // metadata.rollout_pct back to 0 on any environment that re-executes
      // the body. It was dropped deliberately; it must never come back.
      expect(noComments).not.toMatch(/do\s+update/i);
    });

    it('default-OFF posture: no boolean true literal anywhere in executable SQL', () => {
      // is_enabled=false, metadata.enabled=false, metadata.kill_switch=false,
      // rollout 0 — the strongest static pin is simply: the executable body
      // contains NO `true` token at all, and no nonzero rollout_pct.
      expect(noComments).not.toMatch(/\btrue\b/i);
      expect(noComments).not.toMatch(/'rollout_pct'\s*,\s*[1-9]/i);
      // Both kill-switch and enabled envelope keys are seeded false in the
      // canonical branch (4 rows) and the legacy branch (1 SELECT).
      expect((noComments.match(/'enabled'\s*,\s*false/gi) ?? []).length).toBeGreaterThanOrEqual(5);
      expect((noComments.match(/'kill_switch'\s*,\s*false/gi) ?? []).length).toBeGreaterThanOrEqual(5);
    });

    it('seeds all four Phase 5/6 flags in BOTH branches', () => {
      for (const flag of PHASE56_FLAGS) {
        const occurrences = (noComments.match(new RegExp(`'${flag}'`, 'g')) ?? []).length;
        expect(occurrences, `${flag} must appear in canonical AND legacy branch`).toBe(2);
      }
    });

    it('legacy branch is WHERE NOT EXISTS — no dependence on a unique constraint over name', () => {
      const { structural } = preprocess(raw);
      const inserts = parseFeatureFlagInserts(structural);
      const legacy = inserts.find((ins) => !ins.columns.includes('flag_name'));
      expect(legacy).toBeDefined();
      expect(legacy!.columns).toEqual(['name', 'description', 'enabled', 'metadata']);
      expect(legacy!.tail).toMatch(/where\s+not\s+exists/i);
      expect(legacy!.tail).not.toMatch(/on\s+conflict/i);
    });
  });
});
