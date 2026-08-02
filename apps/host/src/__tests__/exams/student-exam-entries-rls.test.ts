import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * RLS boundary regression for `student_exam_entries` /
 * `student_exam_entry_topics` (Wave B exam schedule, tier 3).
 *
 * What this proves (item 5 in the Wave B test brief — "a student cannot read
 * another student's student_exam_entries rows via GET /api/v2/exam-schedule"):
 *   - RLS is enabled on both tables.
 *   - Every policy scopes to `student_id = auth.uid()` — a DIRECT comparison,
 *     which is CORRECT here (unlike the historical
 *     `student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())`
 *     pattern fixed elsewhere in this repo — see
 *     rls-student-id-policies.test.ts): `student_exam_entries.student_id`
 *     is a direct FK to `auth.users(id)`, not to `students.id`, so the join
 *     form would be WRONG here, not a hardening. This test guards against
 *     "fixing" it to the join form by mistake.
 *   - There is NO parent/teacher SELECT policy on `student_exam_entries` —
 *     student-private by explicit product design (the migration's own
 *     header rationale).
 *   - `student_exam_entry_topics` inherits ownership from its parent entry
 *     via the SECURITY DEFINER helper `public.is_own_exam_entry(entry_id)`,
 *     not its own direct student_id column (it has none) — so it cannot be
 *     read by forging an arbitrary `entry_id`. (Architect review, 2026-08-02:
 *     the first-authored form of this policy inlined the EXISTS subquery
 *     directly; rls-no-cross-table-recursion.test.ts flagged the inline
 *     cross-table read and, per that test's own established precedent for
 *     brand-new policies — see the tp_threads_guardian_insert /
 *     get_my_guardian_id case it documents — it was rewritten to delegate to
 *     a helper rather than added to GRANDFATHERED_INLINE_POLICIES. Same
 *     boundary, same table, same predicate; see the migration's own comment
 *     block for the full reasoning.)
 *
 * Test strategy — SOURCE-LEVEL, mirrors rls-student-id-policies.test.ts and
 * teacher/remediation-rls-policies.test.ts: no live Postgres from Vitest.
 * Structural assertions against the migration SQL are sufficient to catch an
 * accidental revert, a relaxed predicate, or a dropped policy during a
 * refactor. Live cross-student-isolation behavior (an actual second
 * student's request returning none of the first student's rows) additionally
 * requires a real Supabase instance — flagged in the testing report as a gap
 * needing a live-DB / staging integration test; this suite is the
 * mechanically-enforced backstop available without one.
 */

const MIGRATION_FILE = 'supabase/migrations/20260802090100_create_student_exam_entries.sql';

function resolveMigrationPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), MIGRATION_FILE),
    path.resolve(process.cwd(), '..', MIGRATION_FILE),
    path.resolve(process.cwd(), '..', '..', MIGRATION_FILE),
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

/** SQL with comments stripped, so a prose doc comment never false-matches a
 *  policy-body assertion. */
function policyBodySql(): string {
  const sql = readMigration();
  const noLineComments = sql.replace(/^\s*--.*$/gm, '');
  return noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe.skipIf(!MIGRATION_PRESENT)('student_exam_entries RLS — file presence', () => {
  it(`${MIGRATION_FILE} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('is transactional (BEGIN...COMMIT)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('student_exam_entries RLS — enabled on both tables', () => {
  it('enables RLS on student_exam_entries', () => {
    const sql = readMigration();
    expect(sql).toMatch(/ALTER TABLE public\.student_exam_entries ENABLE ROW LEVEL SECURITY/);
  });

  it('enables RLS on student_exam_entry_topics', () => {
    const sql = readMigration();
    expect(sql).toMatch(/ALTER TABLE public\.student_exam_entry_topics ENABLE ROW LEVEL SECURITY/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('student_exam_entries RLS — direct student_id = auth.uid() comparison', () => {
  it('SELECT policy scopes to student_id = auth.uid() (direct FK to auth.users, not students.id)', () => {
    const sql = policyBodySql();
    const selectPolicy = sql.slice(
      sql.indexOf('"students_own_exam_entries_select"'),
      sql.indexOf('"students_own_exam_entries_insert"'),
    );
    expect(selectPolicy).toMatch(/USING \(student_id = auth\.uid\(\)\)/);
  });

  it('INSERT policy WITH CHECKs student_id = auth.uid()', () => {
    const sql = policyBodySql();
    const insertPolicy = sql.slice(
      sql.indexOf('"students_own_exam_entries_insert"'),
      sql.indexOf('"students_own_exam_entries_update"'),
    );
    expect(insertPolicy).toMatch(/WITH CHECK \(student_id = auth\.uid\(\)\)/);
  });

  it('UPDATE policy has both USING and WITH CHECK on student_id = auth.uid()', () => {
    const sql = policyBodySql();
    const updatePolicy = sql.slice(
      sql.indexOf('"students_own_exam_entries_update"'),
      sql.indexOf('"students_own_exam_entries_delete"'),
    );
    expect(updatePolicy).toMatch(/USING \(student_id = auth\.uid\(\)\)/);
    expect(updatePolicy).toMatch(/WITH CHECK \(student_id = auth\.uid\(\)\)/);
  });

  it('DELETE policy scopes to student_id = auth.uid()', () => {
    const sql = policyBodySql();
    const deletePolicy = sql.slice(
      sql.indexOf('"students_own_exam_entries_delete"'),
      sql.indexOf('"students_own_exam_entry_topics_all"'),
    );
    expect(deletePolicy).toMatch(/USING \(student_id = auth\.uid\(\)\)/);
  });

  it('does NOT use the students-table join form here (would be WRONG — this FK targets auth.users, not students)', () => {
    const sql = policyBodySql();
    expect(sql).not.toMatch(/SELECT id FROM public\.students WHERE auth_user_id/);
  });

  it('never widens a policy to USING (true) / WITH CHECK (true)', () => {
    const sql = policyBodySql();
    expect(sql).not.toMatch(/USING \(true\)/);
    expect(sql).not.toMatch(/WITH CHECK \(true\)/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('student_exam_entries RLS — no parent/teacher visibility (student-private by design)', () => {
  it('defines exactly 4 policies on student_exam_entries (select/insert/update/delete — no parent/teacher policy)', () => {
    const sql = policyBodySql();
    const policyNames = Array.from(
      sql.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.student_exam_entries\b/g),
    ).map((m) => m[1]);
    expect(policyNames.sort()).toEqual(
      [
        'students_own_exam_entries_select',
        'students_own_exam_entries_insert',
        'students_own_exam_entries_update',
        'students_own_exam_entries_delete',
      ].sort(),
    );
  });

  it('has no policy naming a parent/guardian or teacher role', () => {
    const sql = policyBodySql();
    expect(sql).not.toMatch(/guardian_student_links/);
    expect(sql).not.toMatch(/class_teachers/);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('student_exam_entry_topics RLS — ownership inherited from parent entry', () => {
  // Architect review (2026-08-02): the first-authored policy inlined the
  // EXISTS subquery directly in USING/WITH CHECK. That inline form was
  // structurally non-recursive (student_exam_entries' own 4 policies are
  // pure `student_id = auth.uid()` checks with no FROM/JOIN of their own —
  // no back edge exists), but rls-no-cross-table-recursion.test.ts still
  // flags any NEW inline cross-table read so an architect must explicitly
  // rule on it. Per that test's own documented precedent for brand-new
  // policies (tp_threads_guardian_insert / get_my_guardian_id, migration
  // 20260720170000 — "required no grandfathering"), it was rewritten here to
  // delegate to the SECURITY DEFINER helper public.is_own_exam_entry(uuid)
  // (defined in the same migration, modeled on is_school_admin_of_student)
  // instead of adding a debt-ledger entry. These assertions pin the
  // delegating form, not the inline form.

  // Anchored on the literal `CREATE POLICY "..."` prefix (not just the quoted
  // name) and cut at the FIRST semicolon after it. This deliberately excludes
  // both the preceding `DROP POLICY IF EXISTS "students_own_exam_entry_topics_all"`
  // line (which contains the same quoted name) and the trailing
  // `COMMENT ON POLICY ... IS '...'` statement (which, being a real SQL
  // statement rather than a `--` line comment, survives policyBodySql()'s
  // comment-stripping and itself quotes `public.is_own_exam_entry(entry_id)`
  // and the word EXISTS in its justification prose) — either would corrupt a
  // naive slice-to-end-of-file match or count.
  function topicsPolicyStatement(): string {
    const sql = policyBodySql();
    const start = sql.indexOf('CREATE POLICY "students_own_exam_entry_topics_all"');
    const end = sql.indexOf(';', start);
    return sql.slice(start, end + 1);
  }

  it('the topics policy delegates to public.is_own_exam_entry(entry_id), not an inline EXISTS', () => {
    const stmt = topicsPolicyStatement();
    expect(stmt).toMatch(/USING \(public\.is_own_exam_entry\(entry_id\)\)/);
    expect(stmt).toMatch(/WITH CHECK \(public\.is_own_exam_entry\(entry_id\)\)/);
  });

  it('applies the helper check to BOTH USING and WITH CHECK (read and write)', () => {
    const stmt = topicsPolicyStatement();
    const callCount = (stmt.match(/public\.is_own_exam_entry\(entry_id\)/g) ?? []).length;
    expect(callCount).toBe(2); // one for USING, one for WITH CHECK
  });

  it('does NOT inline a FROM/JOIN over student_exam_entries directly in the topics policy predicate', () => {
    // Guards against silently reverting to the inline form the recursion
    // guard flagged — the cross-table read must live ONLY inside the helper,
    // never inline in the policy statement itself.
    const stmt = topicsPolicyStatement();
    expect(stmt).not.toMatch(/EXISTS/);
    expect(stmt).not.toMatch(/\bFROM\b/i);
  });

  it('defines is_own_exam_entry as a STABLE SECURITY DEFINER function scoped by search_path', () => {
    const sql = readMigration();
    const fnBlock = sql.slice(
      sql.indexOf('FUNCTION public.is_own_exam_entry'),
      sql.indexOf('$$;', sql.indexOf('FUNCTION public.is_own_exam_entry')) + 3,
    );
    expect(fnBlock).toMatch(/STABLE/);
    expect(fnBlock).toMatch(/SECURITY DEFINER/);
    expect(fnBlock).toMatch(/SET search_path = public/);
  });

  it('is_own_exam_entry checks the SAME boundary the inline form expressed (id + student_id = auth.uid())', () => {
    const sql = readMigration();
    const fnBlock = sql.slice(
      sql.indexOf('FUNCTION public.is_own_exam_entry'),
      sql.indexOf('$$;', sql.indexOf('FUNCTION public.is_own_exam_entry')) + 3,
    );
    expect(fnBlock).toMatch(
      /EXISTS \(\s*SELECT 1 FROM public\.student_exam_entries e\s*WHERE e\.id = p_entry_id AND e\.student_id = auth\.uid\(\)\s*\)/,
    );
  });

  it('has a SQL comment justifying the SECURITY DEFINER usage (architect rule: no SECURITY DEFINER without one)', () => {
    const sql = readMigration();
    const fnDeclIdx = sql.indexOf('FUNCTION public.is_own_exam_entry');
    // The justification lives in the prose block directly above the function
    // AND in a COMMENT ON FUNCTION statement immediately after it — check both.
    const before = sql.slice(Math.max(0, fnDeclIdx - 4000), fnDeclIdx);
    expect(before).toMatch(/SECURITY DEFINER/);
    expect(before).toMatch(/recursion/i);
    const commentIdx = sql.indexOf('COMMENT ON FUNCTION public.is_own_exam_entry');
    expect(commentIdx).toBeGreaterThan(-1);
    const commentEnd = sql.indexOf(';', commentIdx);
    expect(sql.slice(commentIdx, commentEnd + 1)).toMatch(/bypasses RLS/i);
  });
});

describe.skipIf(!MIGRATION_PRESENT)('student_exam_entries schema — FK targets that make the direct comparison correct', () => {
  it('student_id references auth.users(id), confirming student_id = auth.uid() is the right comparison', () => {
    const sql = readMigration();
    expect(sql).toMatch(/student_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
  });

  it('topic_id in the junction table is a hard FK to curriculum_topics(id)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/topic_id uuid NOT NULL REFERENCES public\.curriculum_topics\(id\)/);
  });
});
