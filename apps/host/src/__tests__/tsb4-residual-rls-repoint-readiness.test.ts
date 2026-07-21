import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * TSB-4 residual-RLS closure — verification that the LAST two RLS policy sets
 * still literally joining through the legacy `class_students` table (flagged
 * by the original RCA, not touched by the boundary-reader-repoint or
 * route-helper-repoint stages) have been repointed onto the canonical
 * `class_enrollments` table:
 *
 *   1. public.students teacher backstop policy
 *      "Teachers can view students in their classes"
 *   2. public.teacher_remediation_assignments teacher SELECT/INSERT/UPDATE
 *      policies
 *
 * THE CHANGE UNDER TEST
 * =====================
 * `supabase/migrations/20260720170000_tsb4_close_residual_class_students_rls_refs.sql`
 * repoints both policy sets' roster join from `class_students` to
 * `class_enrollments`, preserving predicate shape (roster join + is_active
 * guards) exactly. It does NOT touch the `class_students` table itself — that
 * remains gated behind the CEO-approved `legacy-table-retirement` stage in
 * `scripts/tsb4-canonical-membership-cutover.json`.
 *
 * ─── Lane note (source-shape pin, matching sibling TSB-4 convention) ────────
 * Mirrors `tsb4-enrollments-rls-reconcile.test.ts`: this is a migration-SHAPE
 * pin in the normal `npm test` lane, not a live-DB behavioral proof (that
 * belongs in the gated integration lane).
 *
 * Owner: architect.
 */

const MIGRATION_REL =
  'supabase/migrations/20260720170000_tsb4_close_residual_class_students_rls_refs.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function readRaw(rel: string): string {
  const p = resolveRepo(rel);
  return p ? readFileSync(p, 'utf8').replace(/\r/g, '') : '';
}

function executableSql(rel: string): string {
  return readRaw(rel)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const MIGRATION_PRESENT = resolveRepo(MIGRATION_REL) !== null;
const EXEC = executableSql(MIGRATION_REL);

describe('TSB-4 residual-RLS closure: presence + non-vacuity', () => {
  it(`${MIGRATION_REL} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('the comment-stripped active body is substantial and wraps a single transaction', () => {
    expect(EXEC.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(500);
    expect(EXEC).toMatch(/\bBEGIN\b/);
    expect(EXEC).toMatch(/\bCOMMIT\b/);
  });
});

describe('TSB-4 residual-RLS closure: students teacher backstop repointed', () => {
  it('recreates "Teachers can view students in their classes" on public.students', () => {
    expect(EXEC).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"Teachers can view students in their classes"\s+ON\s+public\.students/i,
    );
    expect(EXEC).toMatch(
      /CREATE\s+POLICY\s+"Teachers can view students in their classes"\s+ON\s+public\.students/i,
    );
  });

  it('the USING clause joins through class_enrollments, not class_students', () => {
    const policyBody = EXEC.slice(
      EXEC.indexOf('CREATE POLICY "Teachers can view students in their classes"'),
    );
    const usingBlock = policyBody.slice(0, policyBody.indexOf('COMMENT ON POLICY'));
    expect(usingBlock).toMatch(/class_enrollments/i);
    expect(usingBlock).not.toMatch(/class_students/i);
    expect(usingBlock).toMatch(/ce\.is_active\s*=\s*true/i);
    expect(usingBlock).toMatch(/ct\.is_active\s*=\s*true/i);
  });
});

describe('TSB-4 residual-RLS closure: teacher_remediation_assignments policies repointed', () => {
  for (const policy of [
    'teacher_remediation_assignments_teacher_select',
    'teacher_remediation_assignments_teacher_insert',
    'teacher_remediation_assignments_teacher_update',
  ]) {
    it(`${policy} is idempotently recreated`, () => {
      expect(EXEC).toMatch(
        new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+${policy}\\s+ON\\s+public\\.teacher_remediation_assignments`, 'i'),
      );
      expect(EXEC).toMatch(
        new RegExp(`CREATE\\s+POLICY\\s+${policy}\\s+ON\\s+public\\.teacher_remediation_assignments`, 'i'),
      );
    });
  }

  it('none of the three teacher policy bodies reference class_students', () => {
    const startIdx = EXEC.indexOf('CREATE POLICY teacher_remediation_assignments_teacher_select');
    const endIdx = EXEC.indexOf('-- teacher_remediation_assignments_service_all');
    const block = EXEC.slice(startIdx, endIdx === -1 ? undefined : endIdx);
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/class_students/i);
    expect(block).toMatch(/class_enrollments/gi);
  });
});

describe('TSB-4 residual-RLS closure: non-destructive, RLS untouched', () => {
  it('does not DROP any table/column and does not toggle RLS', () => {
    expect(EXEC).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(EXEC).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(EXEC).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(EXEC).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('the only DROPs in executable SQL are idempotent DROP POLICY IF EXISTS guards', () => {
    const drops = EXEC.match(/\bDROP\s+\w+/gi) || [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(d).toMatch(/DROP\s+POLICY/i);
    }
  });

  it('class_students table is never written or dropped by this migration', () => {
    expect(EXEC).not.toMatch(/INSERT\s+INTO\s+"?public"?\."?class_students"?/i);
    expect(EXEC).not.toMatch(/UPDATE\s+"?public"?\."?class_students"?/i);
    expect(EXEC).not.toMatch(/DELETE\s+FROM\s+"?public"?\."?class_students"?/i);
  });
});
