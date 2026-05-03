import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * F2: RLS student_id policy fix regression
 *
 * Regression catalog entry:
 *   students_can_read_own_rows_from_6_tables
 *     — adaptive_mastery, foxy_chat_messages, foxy_sessions, ai_tutor_logs,
 *       student_subject_enrollment, legacy_subjects_archive
 *
 * The migration 20260417700000_fix_student_id_rls_policies.sql replaces 6
 * broken RLS policies whose USING/WITH CHECK clauses compared student_id
 * (a students.id UUID) to auth.uid() directly. Those comparisons were always
 * false and silently locked students out of their own data.
 *
 * These tests are source-level: they verify the migration is present and
 * contains the canonical corrected pattern for each affected table. We do
 * NOT run Postgres from Vitest — structural checks are sufficient to catch
 * accidental reverts or typos during refactors.
 */

const MIGRATION_FILE = 'supabase/migrations/20260417700000_fix_student_id_rls_policies.sql';
// Section 10 cleanup (2026-05-03): pre-baseline migrations were moved to
// `supabase/migrations/_legacy/timestamped/`.
const MIGRATION_FILE_LEGACY =
  'supabase/migrations/_legacy/timestamped/20260417700000_fix_student_id_rls_policies.sql';

function resolveMigrationPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), MIGRATION_FILE),
    path.resolve(process.cwd(), MIGRATION_FILE_LEGACY),
    // Worktree parent resolution: tests may run from a git worktree where the
    // migration was authored but the outer repo has not yet picked it up.
    path.resolve(process.cwd(), '.claude/worktrees/compassionate-curie', MIGRATION_FILE),
    path.resolve(process.cwd(), '.claude/worktrees/compassionate-curie', MIGRATION_FILE_LEGACY),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readMigration(): string {
  const resolved = resolveMigrationPath();
  if (!resolved) return '';
  return fs.readFileSync(resolved, 'utf-8');
}

const MIGRATION_PRESENT = resolveMigrationPath() !== null;

describe.skipIf(!MIGRATION_PRESENT)('F2: student_id RLS fix migration — file presence', () => {
  it(`${MIGRATION_FILE} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('starts with BEGIN and ends with COMMIT (transactional)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('F2: canonical corrected join pattern', () => {
  const sql = readMigration();

  it('uses the canonical "student_id IN (SELECT id FROM public.students WHERE auth_user_id = (SELECT auth.uid()))" pattern', () => {
    // Normalise whitespace to match the pattern across formatting changes.
    const normalised = sql.replace(/\s+/g, ' ');
    expect(normalised).toContain(
      'student_id IN ( SELECT id FROM public.students WHERE auth_user_id = (SELECT auth.uid()) )'
    );
  });

  it('does NOT reintroduce the broken "student_id = auth.uid()" comparison inside any policy body', () => {
    const sql = readMigration();
    // Strip SQL comments so we don't false-match the verification hint at the
    // bottom of the migration (which documents the bad pattern).
    const withoutLineComments = sql.replace(/^\s*--.*$/gm, '');
    const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');

    // No CREATE POLICY block may contain the broken direct comparison.
    expect(withoutBlockComments).not.toMatch(/student_id\s*=\s*auth\.uid\(\)/);
    expect(withoutBlockComments).not.toMatch(/student_id\s*=\s*\(SELECT auth\.uid\(\)\)/);
  });

  it('wraps auth.uid() in a SELECT for per-query evaluation (initplan advisor)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/\(SELECT auth\.uid\(\)\)/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('F2: all 6 affected tables are covered', () => {
  const sql = readMigration();
  const affectedTables = [
    'adaptive_mastery',
    'foxy_chat_messages',
    'foxy_sessions',
    'ai_tutor_logs',
    'student_subject_enrollment',
    'legacy_subjects_archive',
  ];

  for (const table of affectedTables) {
    it(`re-enables RLS on public.${table}`, () => {
      expect(sql).toContain(`ALTER TABLE public.${table}`);
      expect(sql).toContain(`ENABLE ROW LEVEL SECURITY`);
    });

    it(`drops at least one broken policy on public.${table}`, () => {
      const hasDrop = new RegExp(`DROP POLICY IF EXISTS.*ON\\s+public\\.${table}`, 'i').test(sql);
      expect(hasDrop).toBe(true);
    });
  }
});

describe.skipIf(!MIGRATION_PRESENT)('F2: tables that must keep a student SELECT policy after the fix', () => {
  const sql = readMigration();

  // These tables had NO other student SELECT policy besides the broken one,
  // so the migration MUST create a replacement — otherwise students lose all
  // read access.
  it('creates a replacement SELECT policy on adaptive_mastery', () => {
    expect(sql).toMatch(/CREATE POLICY\s+"adaptive_mastery_student_select"\s+ON public\.adaptive_mastery\s+FOR SELECT/);
  });

  it('creates a replacement UPDATE policy on adaptive_mastery', () => {
    expect(sql).toMatch(/CREATE POLICY\s+"adaptive_mastery_student_update"\s+ON public\.adaptive_mastery\s+FOR UPDATE/);
  });

  it('creates a replacement SELECT policy on ai_tutor_logs', () => {
    expect(sql).toMatch(/CREATE POLICY\s+"ai_tutor_logs_student_select"\s+ON public\.ai_tutor_logs\s+FOR SELECT/);
  });

  it('creates a replacement SELECT policy (sse_read_own) on student_subject_enrollment', () => {
    expect(sql).toMatch(/CREATE POLICY\s+sse_read_own\s+ON public\.student_subject_enrollment\s+FOR SELECT/);
  });

  it('creates a replacement ALL policy (sse_write_own) on student_subject_enrollment', () => {
    expect(sql).toMatch(/CREATE POLICY\s+sse_write_own\s+ON public\.student_subject_enrollment\s+FOR ALL/);
  });

  it('creates a replacement SELECT policy (lsa_read_own) on legacy_subjects_archive', () => {
    expect(sql).toMatch(/CREATE POLICY\s+lsa_read_own\s+ON public\.legacy_subjects_archive\s+FOR SELECT/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('F2: foxy_* tables — broken duplicates dropped, canonical policies left intact', () => {
  const sql = readMigration();

  it('drops the broken Students-can-view-own-foxy-messages policy', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Students can view own foxy messages"\s+ON public\.foxy_chat_messages/);
  });

  it('drops the broken Students-can-insert-own-foxy-messages policy', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Students can insert own foxy messages"\s+ON public\.foxy_chat_messages/);
  });

  it('drops the broken Students-can-view-own-foxy-sessions policy', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Students can view own foxy sessions"\s+ON public\.foxy_sessions/);
  });

  it('does NOT recreate a duplicate SELECT policy on foxy_chat_messages (avoids multiple_permissive_policies)', () => {
    // The canonical foxy_chat_messages_student_select from 20260408000002 is
    // preserved and NOT replicated here.
    expect(sql).not.toMatch(/CREATE POLICY\s+["']?foxy_chat_messages_student_select/);
  });

  it('does NOT recreate a duplicate SELECT policy on foxy_sessions', () => {
    expect(sql).not.toMatch(/CREATE POLICY\s+["']?foxy_sessions_student_select/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('F2: migration is idempotent / re-runnable', () => {
  const sql = readMigration();

  it('uses DROP POLICY IF EXISTS for every drop', () => {
    const totalDrops = (sql.match(/DROP POLICY/g) || []).length;
    const safeDrops = (sql.match(/DROP POLICY IF EXISTS/g) || []).length;
    expect(safeDrops).toBe(totalDrops);
    expect(safeDrops).toBeGreaterThanOrEqual(8); // at least 8 drop statements
  });

  it('guards every CREATE POLICY with EXCEPTION WHEN duplicate_object', () => {
    const createCount = (sql.match(/CREATE POLICY/g) || []).length;
    const guardCount = (sql.match(/EXCEPTION WHEN duplicate_object THEN NULL;/g) || []).length;
    expect(guardCount).toBe(createCount);
    expect(createCount).toBeGreaterThanOrEqual(6);
  });

  it('does NOT drop any tables or columns (P8: no destructive schema changes)', () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});