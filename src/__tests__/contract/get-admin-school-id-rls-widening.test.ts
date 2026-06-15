/**
 * Static migration canary — portal RBAC remediation Phase 3 (2026-06-16).
 *
 * Pins migration
 *   20260620000300_portal_rbac_remediation_phase3_get_admin_school_id_recognizes_school_admins.sql
 *
 * What this migration does (architect, branch feat/portal-rbac-saas-remediation):
 *   - get_admin_school_id() previously resolved the caller's school ONLY from the
 *     `teachers` table. Pure institution_admins (a `school_admins` row, NO
 *     `teachers` row) resolved to NULL, so every `school_id = get_admin_school_id()`
 *     RLS policy denied them — zero read access to the school-admin read surface.
 *   - The fix WIDENS get_admin_school_id() to COALESCE(teachers-lookup,
 *     school_admins-lookup): the teacher arm is byte-identical to the baseline and
 *     resolves FIRST, so teacher access is preserved; the school_admins arm is a
 *     pure fallback that only ever fills a previously-NULL result.
 *   - 4 NAMED SELECT policies (school_announcements, school_exams, school_questions,
 *     class_enrollments) are recreated to `OLD_PREDICATE OR is_school_admin_of(...)`
 *     so MULTI-school institution_admins are fully covered. The OR only ADMITS rows.
 *
 * The whole point of pinning this statically: a later `CREATE OR REPLACE FUNCTION
 * get_admin_school_id()` (RPC bodies are routinely copied forward) could silently
 * drop the school_admins fallback and re-break institution_admin reads; and a
 * later policy recreate could drop the `OR is_school_admin_of(...)` arm. Either
 * regression fails here. If a test fails after someone redefines the function or a
 * policy, the dropped widening is the bug — fix the new migration, not this test.
 *
 * This file lives under `contract/` (NOT `__tests__/migrations/`, which is excluded
 * from the normal non-integration run), so it runs in normal PR CI.
 *
 * Owner: testing. Catalog: REG-153 (get_admin_school_id institution_admin RLS widening).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MIGRATION_FILE =
  '20260620000300_portal_rbac_remediation_phase3_get_admin_school_id_recognizes_school_admins.sql';

function readMigration(filename: string): string {
  return readFileSync(resolve(REPO_ROOT, 'supabase', 'migrations', filename), 'utf8');
}

/** Strip SQL line comments so DDL-shape assertions only see executable SQL. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

const sql = readMigration(MIGRATION_FILE);
const exec = stripSqlComments(sql);

describe('20260620000300 — get_admin_school_id() widening to recognize school_admins', () => {
  it('redefines get_admin_school_id() via CREATE OR REPLACE (idempotent, replayable)', () => {
    expect(exec).toMatch(
      /CREATE OR REPLACE FUNCTION\s+"?public"?\."?get_admin_school_id"?\s*\(\s*\)/i,
    );
  });

  it('keeps the teacher resolution arm (teachers.school_id WHERE auth_user_id = auth.uid())', () => {
    // The original baseline body. Preserving it byte-for-equivalent is what keeps
    // teacher access unchanged.
    expect(exec).toMatch(/SELECT\s+school_id\s+FROM\s+teachers/i);
    expect(exec).toMatch(/WHERE\s+auth_user_id\s*=\s*auth\.uid\(\)/i);
  });

  it('ADDS the school_admins fallback arm (the NEW institution_admin coverage)', () => {
    expect(exec).toMatch(/SELECT\s+school_id\s+FROM\s+school_admins/i);
    // Only active memberships resolve.
    expect(exec).toMatch(/is_active\s*=\s*true/i);
  });

  it('resolves teachers FIRST, then school_admins as a COALESCE fallback (teacher access preserved)', () => {
    // COALESCE(teacher-lookup, school_admins-lookup): the teacher arm must appear
    // BEFORE the school_admins arm so any user with a teachers.school_id keeps the
    // identical resolved value.
    expect(exec).toMatch(/COALESCE\s*\(/i);
    const teacherIdx = exec.search(/FROM\s+teachers/i);
    const adminIdx = exec.search(/FROM\s+school_admins/i);
    const coalesceIdx = exec.search(/COALESCE\s*\(/i);
    expect(teacherIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeGreaterThan(-1);
    expect(coalesceIdx).toBeGreaterThan(-1);
    expect(coalesceIdx).toBeLessThan(teacherIdx); // both arms inside COALESCE(...)
    expect(teacherIdx).toBeLessThan(adminIdx); // teacher arm is first
  });

  it('keeps the baseline STABLE + SET search_path = public posture on the redefined function', () => {
    expect(exec).toMatch(/\bSTABLE\b/i);
    expect(exec).toMatch(/SET\s+"?search_path"?\s+(TO|=)\s+'public'/i);
  });
});

describe('20260620000300 — the 4 named SELECT policies gain OR is_school_admin_of(school_id)', () => {
  // Each of the 4 widened policies must be recreated FOR SELECT with the membership
  // OR-arm. We assert per policy so a partial drop (one arm missing) is caught.
  const POLICIES: Array<{ table: string; policy: string; widenColumn: string }> = [
    { table: 'school_announcements', policy: 'announcements_school_admin_select', widenColumn: 'school_id' },
    { table: 'school_exams', policy: 'school_exams_school_admin_select', widenColumn: 'school_id' },
    { table: 'school_questions', policy: 'school_questions_school_admin_select', widenColumn: 'school_id' },
    // class_enrollments widens via the nested classes.school_id predicate.
    { table: 'class_enrollments', policy: 'class_enrollments_school_admin_select', widenColumn: 'school_id' },
  ];

  for (const { table, policy } of POLICIES) {
    it(`recreates ${policy} on ${table} idempotently (DROP POLICY IF EXISTS + CREATE POLICY FOR SELECT)`, () => {
      // Postgres has no CREATE OR REPLACE POLICY → DROP IF EXISTS then CREATE.
      const dropRe = new RegExp(
        `DROP POLICY IF EXISTS\\s+"?${policy}"?\\s+ON\\s+"?public"?\\."?${table}"?`,
        'i',
      );
      const createRe = new RegExp(
        `CREATE POLICY\\s+"?${policy}"?[\\s\\S]*?ON\\s+"?public"?\\."?${table}"?[\\s\\S]*?FOR SELECT`,
        'i',
      );
      expect(exec).toMatch(dropRe);
      expect(exec).toMatch(createRe);
    });
  }

  it('every widened policy references is_school_admin_of(...) (the membership OR-arm)', () => {
    // Exactly 4 widened named policies → at least 4 is_school_admin_of references.
    // Allow the optional closing identifier quote before the call paren
    // (the migration writes `"public"."is_school_admin_of"("school_id")`).
    const matches = exec.match(/is_school_admin_of"?\s*\(/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('preserves the original = get_admin_school_id() predicate on the 3 flat policies (OR only ADMITS)', () => {
    // The 3 flat-school_id policies keep `"school_id" = get_admin_school_id()` AND
    // add the OR membership arm → widening only, never narrowing.
    const flat: Array<[string, string]> = [
      ['announcements_school_admin_select', 'school_announcements'],
      ['school_exams_school_admin_select', 'school_exams'],
      ['school_questions_school_admin_select', 'school_questions'],
    ];
    for (const [policy] of flat) {
      const block = sliceCreatePolicyBlock(exec, policy);
      expect(block).toMatch(/"?school_id"?\s*=\s*"?public"?\."?get_admin_school_id"?\s*\(\s*\)/i);
      expect(block).toMatch(/OR\s+"?public"?\."?is_school_admin_of"?\s*\(\s*"?school_id"?\s*\)/i);
    }
  });

  it('class_enrollments widens via the nested classes.school_id (= get_admin_school_id() OR is_school_admin_of)', () => {
    const block = sliceCreatePolicyBlock(exec, 'class_enrollments_school_admin_select');
    // Nested subquery still selects classes whose school the caller owns OR administers.
    expect(block).toMatch(/FROM\s+"?public"?\."?classes"?/i);
    expect(block).toMatch(/"?classes"?\."?school_id"?\s*=\s*"?public"?\."?get_admin_school_id"?\s*\(\s*\)/i);
    expect(block).toMatch(/OR\s+"?public"?\."?is_school_admin_of"?\s*\(\s*"?classes"?\."?school_id"?\s*\)/i);
  });
});

describe('20260620000300 — additive / widening-only safety contract', () => {
  it('contains NO destructive DDL (no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE / data UPDATE)', () => {
    expect(exec).not.toMatch(/DROP\s+TABLE/i);
    expect(exec).not.toMatch(/DROP\s+COLUMN/i);
    expect(exec).not.toMatch(/TRUNCATE/i);
    expect(exec).not.toMatch(/\bDELETE\s+FROM\b/i);
    // No data-mutating UPDATE statement (UPDATE <table> SET ...). The widening is
    // purely function + policy DDL.
    expect(exec).not.toMatch(/\bUPDATE\s+"?[a-z_]/i);
  });

  it('the only DROP statements are DROP POLICY IF EXISTS (each paired with a recreate)', () => {
    const drops = exec.match(/DROP\s+\w+/gi) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(d).toMatch(/DROP\s+POLICY/i);
    }
    // Idempotency: every DROP POLICY is the IF EXISTS form.
    const dropPolicies = exec.match(/DROP POLICY[^\n;]*/gi) ?? [];
    for (const dp of dropPolicies) {
      expect(dp).toMatch(/IF EXISTS/i);
    }
  });

  it('creates NO new table and does NOT toggle ROW LEVEL SECURITY (no RLS-posture change)', () => {
    expect(exec).not.toMatch(/CREATE\s+TABLE/i);
    expect(exec).not.toMatch(/ENABLE\s+ROW LEVEL SECURITY/i);
    expect(exec).not.toMatch(/DISABLE\s+ROW LEVEL SECURITY/i);
  });

  it('does NOT redefine is_school_admin_of (reuses the existing baseline helper)', () => {
    // The widening must REUSE the baseline is_school_admin_of(uuid), never shadow
    // it with a new (possibly weaker) definition.
    expect(exec).not.toMatch(/CREATE OR REPLACE FUNCTION\s+"?public"?\."?is_school_admin_of"?/i);
    expect(exec).not.toMatch(/CREATE FUNCTION\s+"?public"?\."?is_school_admin_of"?/i);
  });

  it('does NOT touch feature_flags (no flag is flipped by this RLS migration)', () => {
    expect(exec).not.toMatch(/feature_flags/i);
    expect(exec).not.toMatch(/ff_school_self_service_billing_v1/i);
  });

  it('wraps the changes in a single BEGIN/COMMIT transaction', () => {
    expect(exec).toMatch(/\bBEGIN\b/i);
    expect(exec).toMatch(/\bCOMMIT\b/i);
  });
});

/**
 * Returns the CREATE POLICY "<policyName>" ... block (up to the next semicolon)
 * so per-policy predicate assertions don't bleed across policies. Anchored on the
 * policy NAME (not just `CREATE POLICY`) so the non-greedy span can't run across
 * adjacent policy blocks.
 */
function sliceCreatePolicyBlock(source: string, policyName: string): string {
  const re = new RegExp(`CREATE POLICY\\s+"?${policyName}"?[\\s\\S]*?;`, 'i');
  const m = source.match(re);
  return m ? m[0] : '';
}
