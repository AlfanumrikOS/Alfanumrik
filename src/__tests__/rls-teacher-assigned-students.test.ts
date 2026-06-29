/**
 * TSB-2 (P8 defense-in-depth) regression — explicit teacher-assigned SELECT RLS
 * policy on public.students.
 *
 * Audit: engineering-audit Cycle 5 (Teacher / School-Admin B2B), 2026-06-29.
 * Migration under test: supabase/migrations/20260702010000_teacher_assigned_students_rls.sql
 *
 * ─── Lane note (why this is a migration-SHAPE test, not a live-DB test) ──────
 * The repo's RLS regression lane is source-level, NOT a live-Postgres lane. The
 * sibling `src/__tests__/rls-student-id-policies.test.ts` states this explicitly:
 * "We do NOT run Postgres from Vitest — structural checks are sufficient to catch
 * accidental reverts or typos during refactors." There is no live-DB RLS harness
 * in this repo to extend, so a meaningful behavioral SELECT-as-teacher /
 * SELECT-as-non-assigned-teacher / SELECT-as-inactive-enrollment-teacher test is
 * not feasible here without standing up Postgres. Per the testing brief, we
 * therefore pin the policy's PRESENCE and exact SHAPE — the predicate that
 * encodes the three required outcomes — rather than asserting a fake runtime
 * result.
 *
 * The shape we pin IS the behavior:
 *   - assigned teacher SELECTs the row  ⇐ id IN (roster join resolved from auth.uid())
 *   - non-assigned teacher gets 0 rows  ⇐ the join only yields students the teacher
 *                                          is actively assigned to (no grade/school
 *                                          fallback in this policy)
 *   - inactive-enrollment teacher 0 rows ⇐ cs.is_active = true AND ct.is_active = true
 * If/when a live-DB RLS lane is added, these become three executable cases; until
 * then this structural pin catches accidental reverts, weakened is_active guards,
 * or an over-broadened predicate.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_FILE =
  'supabase/migrations/20260702010000_teacher_assigned_students_rls.sql';

function resolveMigrationPath(): string | null {
  const c = path.resolve(process.cwd(), MIGRATION_FILE);
  return fs.existsSync(c) ? c : null;
}

const MIGRATION_PATH = resolveMigrationPath();
const MIGRATION_PRESENT = MIGRATION_PATH !== null;

function readMigration(): string {
  return MIGRATION_PATH ? fs.readFileSync(MIGRATION_PATH, 'utf-8') : '';
}

/** Migration source with `-- …` line comments stripped (executable SQL only). */
function executableSql(): string {
  return readMigration().replace(/^\s*--.*$/gm, '');
}

/** Whitespace-normalised executable body for predicate matching. */
function normalised(): string {
  return executableSql().replace(/\s+/g, ' ');
}

const POLICY_NAME = 'Teachers can view students in their classes';

describe('TSB-2: teacher-assigned students RLS migration — presence', () => {
  it(`${MIGRATION_FILE} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('is transactional (BEGIN … COMMIT)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('TSB-2: the named teacher-assigned SELECT policy on public.students', () => {
  it(`creates SELECT policy "${POLICY_NAME}" on public.students for authenticated`, () => {
    const sql = readMigration();
    expect(sql).toContain(`CREATE POLICY "${POLICY_NAME}"`);
    // FOR SELECT, scoped to authenticated role.
    expect(normalised()).toContain(
      `CREATE POLICY "${POLICY_NAME}" ON public.students FOR SELECT TO authenticated USING (`,
    );
  });

  it('predicate resolves the teacher from auth.uid() (not a request-supplied id)', () => {
    expect(normalised()).toContain('t.auth_user_id = auth.uid()');
  });

  it('predicate is the class_students ⋈ class_teachers ⋈ teachers roster join (assigned ⇒ visible)', () => {
    const n = normalised();
    // id IN ( SELECT cs.student_id FROM class_students JOIN class_teachers JOIN teachers … )
    expect(n).toMatch(/id IN \(\s*SELECT cs\.student_id/);
    expect(n).toContain('FROM public.class_students cs');
    expect(n).toContain('JOIN public.class_teachers ct ON ct.class_id = cs.class_id');
    expect(n).toContain('JOIN public.teachers t ON t.id = ct.teacher_id');
  });

  it('BOTH is_active guards are present (non-assigned AND left-class/inactive ⇒ 0 rows)', () => {
    // These two guards are exactly what makes a NON-assigned teacher and an
    // INACTIVE-enrollment teacher get zero rows. Dropping either over-grants.
    const n = normalised();
    expect(n).toContain('cs.is_active = true');
    expect(n).toContain('ct.is_active = true');
  });

  it('does NOT add a grade or school-wide fallback (assigned-students-only, no over-grant)', () => {
    // The policy must not broaden to a grade match or an unscoped school grant —
    // that is the separate "School admins can view school students" policy and
    // is intentionally untouched here.
    const n = normalised();
    // No grade-equality predicate inside this policy body.
    expect(n).not.toMatch(/\.grade\s*=\s*/);
    expect(n).not.toMatch(/grade\s*=\s*students\.grade/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('TSB-2: migration safety (idempotent, additive, non-destructive)', () => {
  it('drops only its OWN policy with IF EXISTS before create (re-runnable)', () => {
    const sql = readMigration();
    expect(sql).toContain(
      `DROP POLICY IF EXISTS "${POLICY_NAME}"`,
    );
    const drops = (sql.match(/DROP POLICY/g) || []).length;
    const safeDrops = (sql.match(/DROP POLICY IF EXISTS/g) || []).length;
    expect(safeDrops).toBe(drops);
  });

  it('does NOT drop tables/columns or disable RLS (P8: no destructive schema change)', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });

  it('introduces no SECURITY DEFINER and no CREATE FUNCTION (plain PERMISSIVE policy)', () => {
    // Strip comments AND single-quoted string literals first: the migration
    // legitimately references the pre-existing is_teacher_of SECURITY DEFINER
    // helper in its prose and in the COMMENT ON POLICY text. The actual
    // executable statements must define no function and use no SECURITY DEFINER.
    const sqlNoStrings = executableSql().replace(/'(?:[^']|'')*'/g, "''");
    expect(sqlNoStrings).not.toMatch(/SECURITY DEFINER/i);
    expect(sqlNoStrings).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });
});
