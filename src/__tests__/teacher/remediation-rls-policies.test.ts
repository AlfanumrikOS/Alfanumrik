import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 3A Wave A / A5 — RLS boundary regression for
 * `teacher_remediation_assignments` (the security-critical P8 gap).
 *
 * Regression catalog entry: REG-92 (teacher detect→act→verify loop), property
 * (a) — the P8 RLS roster boundary.
 *
 * What this proves:
 *   - A TEACHER can SELECT/INSERT/UPDATE a remediation row ONLY for a student
 *     genuinely on their roster (class_students × class_teachers) AND only when
 *     they are the row's own teacher_id. A forged student_id for a student NOT
 *     on the roster fails the WITH CHECK / USING clause.
 *   - A STUDENT can SELECT ONLY their own rows (student_id resolves through
 *     public.students WHERE auth_user_id = auth.uid()); they can never read
 *     another student's row, and have NO insert/update policy at all.
 *   - The service role (Today-resolver join, server writes) keeps full access.
 *   - The table is idempotent + transactional + non-destructive.
 *
 * Test strategy — SOURCE-LEVEL, mirrors `rls-student-id-policies.test.ts`:
 * we do NOT spin up Postgres from Vitest. The repo's established RLS-test
 * pattern is structural assertions against the migration SQL — sufficient to
 * catch an accidental revert, a relaxed predicate, or a dropped clause during
 * a refactor. The canonical roster join is asserted clause-by-clause, and a
 * NEGATIVE assertion guards against the "all authenticated can read" footgun
 * (USING (true) / WITH CHECK (true) on the teacher/student policies).
 *
 * The live end-to-end behavior (an actual cross-roster INSERT returning 403)
 * is additionally covered at the ROUTE layer in
 * `src/__tests__/api/teacher/remediation/route.test.ts` (A2) — the route
 * enforces the SAME roster join in application code before the DB write, so
 * the boundary is defended twice (defense in depth).
 */

const MIGRATION_FILE =
  'supabase/migrations/20260613000004_teacher_remediation_assignments.sql';

function resolveMigrationPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), MIGRATION_FILE),
    // Worktree parent resolution (some CI checkouts run from the outer repo).
    path.resolve(process.cwd(), '..', MIGRATION_FILE),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const MIGRATION_PATH = resolveMigrationPath();
const MIGRATION_PRESENT = MIGRATION_PATH !== null;

function readMigration(): string {
  if (!MIGRATION_PATH) return '';
  return fs.readFileSync(MIGRATION_PATH, 'utf-8');
}

/** SQL with line + block comments stripped — so doc comments never false-match
 *  a policy-body assertion (the migration documents the roster join in prose). */
function policyBodySql(): string {
  const sql = readMigration();
  const noLineComments = sql.replace(/^\s*--.*$/gm, '');
  return noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract the body of a single named CREATE POLICY block (up to the next
 *  semicolon), whitespace-normalised. Returns '' if not found. */
function policyBody(name: string): string {
  const body = policyBodySql();
  const re = new RegExp(
    `CREATE POLICY\\s+${name}\\b[\\s\\S]*?;`,
    'i',
  );
  const m = body.match(re);
  return m ? m[0].replace(/\s+/g, ' ') : '';
}

// The canonical roster join (normalised), mirrored verbatim from the prod
// guardian_student_links policy. A teacher "owns" a student iff the student
// shares a class with the teacher via class_students × class_teachers.
const ROSTER_JOIN_NORMALISED =
  "student_id IN ( SELECT cs.student_id FROM public.class_students cs " +
  "JOIN public.class_teachers ct ON ct.class_id = cs.class_id " +
  "JOIN public.teachers t ON t.id = ct.teacher_id " +
  "WHERE t.auth_user_id = auth.uid() )";

// The teacher-ownership predicate: the row's teacher_id must be the caller's
// internal teachers.id (NOT auth.uid()).
const TEACHER_OWNERSHIP_NORMALISED =
  "teacher_id IN ( SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid() )";

// The student-self predicate: student_id resolves through students.auth_user_id.
const STUDENT_SELF_NORMALISED =
  "student_id IN ( SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid() )";

describe.skipIf(!MIGRATION_PRESENT)(
  'REG-92 / A5 — teacher_remediation_assignments migration presence',
  () => {
    it(`${MIGRATION_FILE} exists`, () => {
      expect(MIGRATION_PRESENT).toBe(true);
    });

    it('is transactional (BEGIN … COMMIT)', () => {
      const sql = readMigration();
      expect(sql).toMatch(/BEGIN;/);
      expect(sql).toMatch(/COMMIT;/);
    });

    it('enables RLS on the table', () => {
      const sql = readMigration();
      expect(sql).toMatch(
        /ALTER TABLE public\.teacher_remediation_assignments\s+ENABLE ROW LEVEL SECURITY/,
      );
    });

    it('does NOT drop any tables or columns (P8: non-destructive)', () => {
      const sql = readMigration();
      expect(sql).not.toMatch(/DROP TABLE/i);
      expect(sql).not.toMatch(/DROP COLUMN/i);
    });
  },
);

describe.skipIf(!MIGRATION_PRESENT)(
  'REG-92 / A5 — P8: teacher can only read/write rows for students on their roster',
  () => {
    it('teacher SELECT policy gates on teacher-ownership AND the roster join', () => {
      const body = policyBody('teacher_remediation_assignments_teacher_select');
      expect(body).not.toBe('');
      expect(body).toContain('FOR SELECT');
      expect(body).toContain(TEACHER_OWNERSHIP_NORMALISED);
      expect(body).toContain(ROSTER_JOIN_NORMALISED);
    });

    it('teacher INSERT policy WITH CHECK gates on ownership + roster + class-taught', () => {
      const body = policyBody('teacher_remediation_assignments_teacher_insert');
      expect(body).not.toBe('');
      expect(body).toContain('FOR INSERT');
      expect(body).toContain('WITH CHECK');
      // A teacher cannot forge a student_id outside their roster — the roster
      // join is in the WITH CHECK, so the post-insert row must pass it.
      expect(body).toContain(TEACHER_OWNERSHIP_NORMALISED);
      expect(body).toContain(ROSTER_JOIN_NORMALISED);
      // class_id must be one the caller actually teaches.
      expect(body).toContain(
        'class_id IN ( SELECT ct.class_id FROM public.class_teachers ct ' +
          'JOIN public.teachers t ON t.id = ct.teacher_id ' +
          'WHERE t.auth_user_id = auth.uid() )',
      );
    });

    it('teacher UPDATE policy gates BOTH the existing (USING) and post-update (WITH CHECK) row', () => {
      const body = policyBody('teacher_remediation_assignments_teacher_update');
      expect(body).not.toBe('');
      expect(body).toContain('FOR UPDATE');
      expect(body).toContain('USING');
      expect(body).toContain('WITH CHECK');
      // The roster join must appear on BOTH sides so a teacher cannot re-point
      // an owned row at a student outside their roster.
      const occurrences = body.split(ROSTER_JOIN_NORMALISED).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
      const ownershipOccurrences =
        body.split(TEACHER_OWNERSHIP_NORMALISED).length - 1;
      expect(ownershipOccurrences).toBeGreaterThanOrEqual(2);
    });

    it('NO teacher policy uses an open predicate (USING (true) / WITH CHECK (true))', () => {
      // Guard against the "any authenticated teacher reads everything" footgun.
      for (const name of [
        'teacher_remediation_assignments_teacher_select',
        'teacher_remediation_assignments_teacher_insert',
        'teacher_remediation_assignments_teacher_update',
      ]) {
        const body = policyBody(name);
        expect(body).not.toMatch(/USING\s*\(\s*true\s*\)/i);
        expect(body).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
      }
    });
  },
);

describe.skipIf(!MIGRATION_PRESENT)(
  'REG-92 / A5 — P8: a student can only read their OWN rows (never another student\'s)',
  () => {
    it('student SELECT policy scopes to student_id via students.auth_user_id', () => {
      const body = policyBody('teacher_remediation_assignments_student_select');
      expect(body).not.toBe('');
      expect(body).toContain('FOR SELECT');
      expect(body).toContain(STUDENT_SELF_NORMALISED);
      // No open predicate — a student must NOT read peers' rows.
      expect(body).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    });

    it('grants the student NO insert/update/delete policy (read-only surface)', () => {
      const body = policyBodySql();
      // The only student-scoped policy is the SELECT one. There must be no
      // student INSERT/UPDATE/DELETE policy (students never mutate assignments;
      // the lifecycle flip runs through the service-role resolve route).
      expect(body).not.toMatch(
        /CREATE POLICY\s+teacher_remediation_assignments_student_(insert|update|delete)/i,
      );
    });

    it('does NOT reuse the teacher roster join for the student policy (self-scope only)', () => {
      const body = policyBody('teacher_remediation_assignments_student_select');
      // The student policy must NOT key off class_teachers — that would leak a
      // whole class to one student. It keys off students.auth_user_id only.
      expect(body).not.toContain('class_teachers');
      expect(body).not.toContain('teacher_id IN');
    });
  },
);

describe.skipIf(!MIGRATION_PRESENT)(
  'REG-92 / A5 — service role keeps full access (Today-resolver join + server writes)',
  () => {
    it('service-role policy is FOR ALL gated on auth.role() = service_role', () => {
      const body = policyBody('teacher_remediation_assignments_service_all');
      expect(body).not.toBe('');
      expect(body).toContain('FOR ALL');
      expect(body).toContain("auth.role() = 'service_role'");
    });
  },
);

describe.skipIf(!MIGRATION_PRESENT)(
  'REG-92 / A5 — migration is idempotent / re-runnable',
  () => {
    it('uses DROP POLICY IF EXISTS for every policy drop', () => {
      const sql = readMigration();
      const totalDrops = (sql.match(/DROP POLICY/g) || []).length;
      const safeDrops = (sql.match(/DROP POLICY IF EXISTS/g) || []).length;
      expect(safeDrops).toBe(totalDrops);
      // service + teacher(select/insert/update) + student(select) = 5.
      expect(safeDrops).toBeGreaterThanOrEqual(5);
    });

    it('creates the table and indexes with IF NOT EXISTS', () => {
      const sql = readMigration();
      expect(sql).toMatch(
        /CREATE TABLE IF NOT EXISTS public\.teacher_remediation_assignments/,
      );
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
    });

    it('seeds the class.assign_remediation permission idempotently (ON CONFLICT DO NOTHING)', () => {
      const sql = readMigration();
      expect(sql).toContain("'class.assign_remediation'");
      // Both the permission row and the role_permissions grant use ON CONFLICT.
      const onConflictCount = (sql.match(/ON CONFLICT/g) || []).length;
      expect(onConflictCount).toBeGreaterThanOrEqual(2);
    });
  },
);

describe.skipIf(!MIGRATION_PRESENT)(
  'REG-92 / A5 — status lifecycle column is constrained (assigned→in_progress→resolved)',
  () => {
    it('status CHECK constraint allows exactly the four lifecycle states', () => {
      const sql = readMigration();
      // assigned (mint) → in_progress (surfaced) → resolved (completed);
      // dismissed is the teacher-side close. No other value is valid.
      expect(sql).toMatch(
        /status\s+text\s+NOT NULL\s+DEFAULT\s+'assigned'/,
      );
      expect(sql).toMatch(
        /CHECK\s*\(\s*status\s+IN\s*\(\s*'assigned',\s*'in_progress',\s*'resolved',\s*'dismissed'\s*\)\s*\)/,
      );
    });
  },
);

// If the migration ever disappears from the expected path the skipIf above
// would silently green the whole file — this one always-on guard fails loudly
// so a path/rename regression is caught.
describe('REG-92 / A5 — migration must be locatable', () => {
  it('teacher_remediation_assignments migration is present at the expected path', () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });
});
