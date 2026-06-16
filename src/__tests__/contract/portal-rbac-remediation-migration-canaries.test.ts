/**
 * Static migration canaries — portal RBAC SaaS remediation FIX PASS (2026-06-16).
 *
 * Established pattern: REG-47 / auth-module-migration-canaries style. These tests
 * read the migration SQL from disk and pin the load-bearing strings so a later
 * edit (or a copy-forward `CREATE OR REPLACE`) cannot silently drop the fix. They
 * run in normal PR CI (this file lives under `contract/`, NOT under
 * `__tests__/migrations/` which the vitest config excludes from non-integration
 * runs). The live-DB behavioural proofs run in the integration lane; this lane
 * proves the migration SQL *contains* the contract.
 *
 * Three fixes, three files:
 *   - FIX A — 20260620000500: seed `school.manage_api_keys` + GRANT it to
 *     institution_admin (+ admin/super_admin). Closes the off:-arm 403 on the
 *     school-admin api-keys console (the drift-guard blind spot, REG below).
 *   - FIX B — 20260620000600: CREATE `parent_weekly_reports` with
 *     UNIQUE(student_id, guardian_id) + RLS enabled + guardian policies. Makes the
 *     parent weekly-report 24h cache real (was reading a non-existent table).
 *   - FIX C — 20260620000700: bidirectional backfill + AFTER INSERT triggers
 *     between class_students and class_enrollments, each ON CONFLICT DO NOTHING
 *     (recursion-safe). Resolves the enrollment split-brain.
 *
 * SAFETY CONTRACT pinned on all three: ADDITIVE — no DROP TABLE / DROP COLUMN /
 * DELETE / UPDATE / TRUNCATE of data; IDEMPOTENT — guarded inserts / IF NOT
 * EXISTS / ON CONFLICT.
 *
 * If a test here fails after someone edits a migration, the fix being dropped is
 * the bug — update the migration, not this test.
 *
 * Owner: testing. Catalog: REG-155 (FIX A), REG-157 (FIX B), REG-158 (FIX C).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function readMigration(filename: string): string {
  return readFileSync(resolve(REPO_ROOT, 'supabase', 'migrations', filename), 'utf8');
}

// Strip `-- line comments` so the additive-only scan inspects EXECUTABLE SQL
// only. Every one of these migrations documents its safety contract in the header
// narrative ("ADDITIVE ONLY. No DROP TABLE/COLUMN ... no DELETE/UPDATE/TRUNCATE"),
// which would otherwise be a false positive. We deliberately keep this simple
// (line comments only) — none of these files use `/* block */` comments around
// statements.
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

// A migration is "additive only" if its EXECUTABLE SQL contains no destructive
// DDL/DML against data. DROP TRIGGER / DROP FUNCTION / DROP POLICY IF EXISTS are
// allowed (idempotent re-create guards, immediately followed by a CREATE). DROP
// TABLE / DROP COLUMN / DELETE / UPDATE / TRUNCATE are NOT.
function assertAdditiveOnly(rawSql: string) {
  const sql = stripComments(rawSql);
  expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
  expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
  expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  // DELETE / UPDATE as standalone statements (allow ON DELETE CASCADE / DO
  // NOTHING). Match a statement-leading verb.
  expect(sql).not.toMatch(/(^|;)\s*DELETE\s+FROM\b/im);
  expect(sql).not.toMatch(/(^|;)\s*UPDATE\s+[a-z"]/im);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX A — 20260620000500: school.manage_api_keys seed + grant
// ─────────────────────────────────────────────────────────────────────────────
describe('20260620000500 — seed + grant school.manage_api_keys (FIX A)', () => {
  const sql = readMigration('20260620000500_portal_rbac_remediation_seed_school_manage_api_keys.sql');

  it('seeds the school.manage_api_keys permission code (idempotent)', () => {
    expect(sql).toContain("'school.manage_api_keys'");
    expect(sql).toMatch(/INSERT INTO permissions/i);
    expect(sql).toMatch(/ON CONFLICT \(code\) DO NOTHING/i);
  });

  it('GRANTS school.manage_api_keys to institution_admin', () => {
    // The grant is a roles×permissions join keyed on r.name / p.code.
    expect(sql).toMatch(/r\.name\s*=\s*'institution_admin'/);
    expect(sql).toContain("p.code = 'school.manage_api_keys'");
  });

  it('also grants it to admin + super_admin (defensive, explicit)', () => {
    expect(sql).toMatch(/r\.name\s+IN\s*\(\s*'admin'\s*,\s*'super_admin'\s*\)/i);
  });

  it('every role_permissions insert is idempotent (ON CONFLICT DO NOTHING)', () => {
    expect(sql).toMatch(/ON CONFLICT \(role_id, permission_id\) DO NOTHING/i);
  });

  it('resolves grants BY NAME/CODE, never by a hardcoded permission/role UUID', () => {
    // No bare uuid literal in a VALUES/role_id position — the seed must join.
    expect(sql).not.toMatch(/role_id\s*=\s*'[0-9a-f-]{36}'/i);
    expect(sql).not.toMatch(/permission_id\s*=\s*'[0-9a-f-]{36}'/i);
  });

  it('is additive only (no DROP TABLE/COLUMN, DELETE, UPDATE, TRUNCATE)', () => {
    assertAdditiveOnly(sql);
  });

  it('REGRESSION (drift-guard blind spot): the seeded code is the api-keys route off:-arm', () => {
    // The exact code that 403'd every school admin with ff_school_admin_rbac OFF
    // because it was granted to no role AND the drift-guard could not see it (it
    // lives only inside schoolAdminPermissionCode({ off: ... })). This seed +
    // the drift-guard's off:/on: extraction together shut the gap.
    const route = readFileSync(
      resolve(REPO_ROOT, 'src', 'app', 'api', 'school-admin', 'api-keys', 'route.ts'),
      'utf8',
    );
    expect(route).toContain("off: 'school.manage_api_keys'");
    expect(sql).toContain("'school.manage_api_keys'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX B — 20260620000600: parent_weekly_reports cache table
// ─────────────────────────────────────────────────────────────────────────────
describe('20260620000600 — create parent_weekly_reports (FIX B)', () => {
  const sql = readMigration('20260620000600_create_parent_weekly_reports.sql');

  it('creates the table idempotently (CREATE TABLE IF NOT EXISTS)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+"?public"?\."?parent_weekly_reports"?/i);
  });

  it('carries the columns the route reads/writes (student_id, guardian_id, report, language, generated_at)', () => {
    for (const col of ['student_id', 'guardian_id', 'report', 'language', 'generated_at']) {
      expect(sql).toContain(`"${col}"`);
    }
  });

  it('adds UNIQUE(student_id, guardian_id) so the route onConflict upsert resolves', () => {
    // Guarded ADD CONSTRAINT ... UNIQUE("student_id", "guardian_id").
    expect(sql).toMatch(/UNIQUE\s*\(\s*"?student_id"?\s*,\s*"?guardian_id"?\s*\)/i);
    // The unique constraint add is guarded so replay is a no-op.
    expect(sql).toMatch(/IF NOT EXISTS[\s\S]*pg_constraint/i);
  });

  it('ENABLES RLS in the SAME migration (P8)', () => {
    expect(sql).toMatch(
      /ALTER TABLE\s+"?public"?\."?parent_weekly_reports"?\s+ENABLE ROW LEVEL SECURITY/i,
    );
  });

  it('defines guardian SELECT/INSERT/UPDATE policies scoped via is_guardian_of(student_id)', () => {
    expect(sql).toMatch(/CREATE POLICY[\s\S]*FOR SELECT[\s\S]*is_guardian_of/i);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*FOR INSERT[\s\S]*is_guardian_of/i);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*FOR UPDATE[\s\S]*is_guardian_of/i);
    // Policies are idempotent (DROP POLICY IF EXISTS before CREATE).
    expect(sql).toMatch(/DROP POLICY IF EXISTS/i);
  });

  it('defines a service_role policy (the route reads/writes via supabaseAdmin)', () => {
    expect(sql).toMatch(/CREATE POLICY[\s\S]*TO\s+"?service_role"?/i);
  });

  it('FKs student_id → students and guardian_id → guardians with ON DELETE CASCADE', () => {
    expect(sql).toMatch(/student_id[\s\S]*REFERENCES[\s\S]*students[\s\S]*ON DELETE CASCADE/i);
    expect(sql).toMatch(/guardian_id[\s\S]*REFERENCES[\s\S]*guardians[\s\S]*ON DELETE CASCADE/i);
  });

  it('is additive only (no DROP TABLE/COLUMN, DELETE, UPDATE, TRUNCATE)', () => {
    assertAdditiveOnly(sql);
  });

  it('REGRESSION: the route still upserts onConflict student_id,guardian_id (constraint must match)', () => {
    const route = readFileSync(
      resolve(REPO_ROOT, 'src', 'app', 'api', 'parent', 'report', 'route.ts'),
      'utf8',
    );
    expect(route).toContain('parent_weekly_reports');
    expect(route).toMatch(/onConflict:\s*['"]student_id,guardian_id['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX C — 20260620000700: class_students ↔ class_enrollments sync
// ─────────────────────────────────────────────────────────────────────────────
describe('20260620000700 — class_students ↔ class_enrollments sync (FIX C)', () => {
  const sql = readMigration('20260620000700_sync_class_students_class_enrollments.sql');

  it('backfills BOTH directions, each ON CONFLICT DO NOTHING', () => {
    // class_students → class_enrollments
    expect(sql).toMatch(
      /INSERT INTO\s+"?public"?\."?class_enrollments"?[\s\S]*FROM\s+"?public"?\."?class_students"?[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/i,
    );
    // class_enrollments → class_students
    expect(sql).toMatch(
      /INSERT INTO\s+"?public"?\."?class_students"?[\s\S]*FROM\s+"?public"?\."?class_enrollments"?[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/i,
    );
  });

  it('defines an AFTER INSERT trigger in EACH direction', () => {
    expect(sql).toMatch(/CREATE TRIGGER[\s\S]*AFTER INSERT ON\s+"?public"?\."?class_students"?/i);
    expect(sql).toMatch(/CREATE TRIGGER[\s\S]*AFTER INSERT ON\s+"?public"?\."?class_enrollments"?/i);
  });

  it('each trigger function mirrors ON CONFLICT DO NOTHING (recursion-safe)', () => {
    // Both mirror functions guard their insert; a conflict-skipped (zero-row)
    // insert fires no row trigger, so the bounce terminates after one hop. The
    // backfills quote the columns (`"class_id", "student_id"`) while the trigger
    // bodies do not — tolerate both so the count is the real executable total.
    const conflictDoNothing =
      stripComments(sql).match(
        /ON CONFLICT\s*\(\s*"?class_id"?\s*,\s*"?student_id"?\s*\)\s*DO NOTHING/gi,
      ) || [];
    // 2 backfills + 2 trigger-function bodies = at least 4 occurrences.
    expect(conflictDoNothing.length).toBeGreaterThanOrEqual(4);
  });

  it('trigger functions are SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path = public/i);
  });

  it('re-creates triggers idempotently (DROP TRIGGER IF EXISTS before CREATE)', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS\s+"?trg_sync_class_students_to_enrollments"?/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS\s+"?trg_sync_class_enrollments_to_students"?/i);
    // Functions are CREATE OR REPLACE (replayable).
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/i);
  });

  it('creates NO new table (no new RLS posture) — operates on the two existing roster tables', () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });

  it('is additive only — the only DROPs are trigger/function re-create guards', () => {
    // No destructive data ops (executable SQL only — header narrative stripped).
    assertAdditiveOnly(sql);
    // The DROPs that DO appear in executable SQL are exclusively trigger/function
    // (or policy) re-create guards.
    const drops = stripComments(sql).match(/\bDROP\s+\w+/gi) || [];
    expect(drops.length).toBeGreaterThan(0); // sanity: the guards exist
    for (const d of drops) {
      expect(/DROP\s+(TRIGGER|FUNCTION|POLICY)/i.test(d)).toBe(true);
    }
  });
});
