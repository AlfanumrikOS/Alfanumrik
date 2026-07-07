import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * RLS-recursion static guard for public.students (P8).
 *
 * THE INCIDENT THIS PINS (2026-07-02)
 * ===================================
 * Migration `20260702010000_teacher_assigned_students_rls.sql` (TSB-2/TSB-4) added
 * the policy "Teachers can view students in their classes" ON public.students whose
 * USING clause INLINED a subquery over public.class_students:
 *
 *     id IN ( SELECT cs.student_id
 *             FROM public.class_students cs
 *             JOIN public.class_teachers ct ON ct.class_id = cs.class_id
 *             JOIN public.teachers       t  ON t.id        = ct.teacher_id
 *             WHERE t.auth_user_id = auth.uid() AND cs.is_active AND ct.is_active )
 *
 * Because that inline subquery reads public.class_students as SECURITY INVOKER,
 * class_students' OWN baseline policy "Students can view own enrollment" — which
 * reads public.students back — re-entered the RLS evaluator and Postgres raised
 * "infinite recursion detected in policy for relation students", breaking EVERY
 * authenticated client read of students (dashboard, get_mastery_overview,
 * StreamGate, profile reads).
 *
 * The fix `20260702080000_fix_students_rls_infinite_recursion.sql` DROPped the
 * recursive policy and recreated it as `USING ( public.is_teacher_of(id) )` —
 * is_teacher_of is a SECURITY DEFINER helper whose inner reads BYPASS RLS, so no
 * students → class_students → students cycle can form.
 *
 * THE INVARIANT (the rule that must hold forever)
 * ===============================================
 * No ACTIVE RLS policy on public.students may express a teacher/parent boundary by
 * INLINING a subquery over another RLS-protected, student-referencing table
 * (class_students, class_teachers, the guardian/parent link table,
 * teacher_remediation_assignments). Those boundaries MUST go through the
 * SECURITY DEFINER helpers public.is_teacher_of(id) / public.is_guardian_of(id)
 * (whose inner reads bypass RLS), or through auth.uid() comparisons — never an
 * inline join over a protected table.
 *
 * HOW THIS TEST WORKS (static SQL-text guard — no DB connection)
 * =============================================================
 * It parses the root migration chain (baseline + later root migrations, in
 * timestamp order — `_legacy/` is intentionally excluded because Supabase
 * `db push` only applies files at the immediate migrations root), tracks every
 * CREATE/DROP POLICY ON public.students, applies the DROPs so it evaluates the
 * FINAL effective policy set (in particular 20260702080000 must have superseded
 * 20260702010000's recursive version), and asserts no surviving policy inlines a
 * protected-table subquery.
 *
 * ─── Lane note (why this is at the `src/__tests__/` root, not in `migrations/`) ──
 * This repo's `src/__tests__/migrations/**` lane is the LIVE-DB integration lane
 * (gated behind RUN_INTEGRATION_TESTS=1; excluded from the normal per-PR `npm test`
 * gate — see vitest.config.ts:6-18). A pure SOURCE-TEXT guard placed there would
 * NOT run in PR CI. This file therefore lives in the normal lane at the
 * `src/__tests__/` root, matching the sibling RLS/migration SOURCE pins
 * (`tsb4-enrollments-rls-reconcile.test.ts`, `ao10b-grade-backfill.test.ts`). The
 * convention is SOURCE-LEVEL: assert the SHAPE of the migration text, because the
 * cycle is a property of the policy DEFINITION (provable statically) — the live-DB
 * proof ("an authenticated student reads their own row without a recursion error")
 * belongs in the integration lane and is complementary, not a substitute.
 *
 * Owner: testing. Catalog: REG-210.
 */

// ── repo / file resolution ──────────────────────────────────────────────────
function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const MIGRATIONS_DIR = 'supabase/migrations';
const MIGRATIONS_ABS = resolveRepo(MIGRATIONS_DIR);

/**
 * The RLS-protected, student-referencing tables that must NEVER appear in a
 * FROM/JOIN inside a students-policy predicate (any of these inlined re-enters
 * the RLS evaluator and risks the students→…→students cycle). The guardian link
 * table in this baseline is `guardian_student_links`; the historical
 * parent_student_links / parent_links names are included for forward-safety.
 */
const PROTECTED_TABLES = [
  'class_students',
  'class_teachers',
  'guardian_student_links',
  'parent_student_links',
  'parent_links',
  'teacher_remediation_assignments',
];

const PROTECTED_INLINE_RE = new RegExp(
  // FROM|JOIN  <optional "public".>  <table> ...as a relation source
  `\\b(?:FROM|JOIN)\\s+(?:"?public"?\\s*\\.\\s*)?"?(${PROTECTED_TABLES.join('|')})"?\\b`,
  'i',
);

/** True iff `text` inlines a FROM/JOIN over a protected student-referencing table. */
function containsInlineProtectedSubquery(text: string): { hit: boolean; table?: string } {
  const m = PROTECTED_INLINE_RE.exec(text);
  return m ? { hit: true, table: m[1] } : { hit: false };
}

/** Strip `-- …` line comments so we only inspect EXECUTABLE SQL. */
function stripLineComments(sql: string): string {
  return sql
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * Walk the root migration chain in timestamp (filename) order and reduce every
 * CREATE/DROP POLICY ON public.students into the FINAL surviving policy set.
 * Returns Map<policyName, fullStatementText>.
 */
function effectiveStudentsPolicies(): Map<string, string> {
  const surviving = new Map<string, string>();
  if (!MIGRATIONS_ABS) return surviving;

  // Root-only (.sql), sorted lexicographically. "00000000000000_…" sorts before
  // the "2026…" timestamps, matching apply order. readdirSync is non-recursive,
  // so `_legacy/` is naturally excluded.
  const files = readdirSync(MIGRATIONS_ABS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Match the students table after an `ON`, quoted ("public"."students" / "students")
  // or bare (public.students / students), not matching students_* sibling tables.
  const ON_STUDENTS = '\\s+ON\\s+(?:"?public"?\\s*\\.\\s*)?(?:"students"|students)(?![\\w"])';
  const CREATE_RE = new RegExp(`^\\s*CREATE\\s+POLICY\\s+"([^"]+)"${ON_STUDENTS}`, 'i');
  const DROP_RE = new RegExp(
    `^\\s*DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?"([^"]+)"${ON_STUDENTS}`,
    'i',
  );

  for (const file of files) {
    const raw = readFileSync(resolve(MIGRATIONS_ABS, file), 'utf8');
    const exec = stripLineComments(raw);
    // Statements are `;`-terminated. Function bodies contain `;` and get split into
    // fragments, but no fragment is a `CREATE/DROP POLICY … ON students` statement,
    // so they are harmlessly ignored. COMMENT ON POLICY statements are likewise not
    // CREATE/DROP and are ignored (their narrative text never enters the check).
    for (const stmtRaw of exec.split(';')) {
      const stmt = stmtRaw.replace(/\s+/g, ' ').trim();
      if (!stmt) continue;
      const c = CREATE_RE.exec(stmt);
      if (c) {
        surviving.set(c[1], stmt);
        continue;
      }
      const d = DROP_RE.exec(stmt);
      if (d) {
        surviving.delete(d[1]);
      }
    }
  }
  return surviving;
}

const POLICIES = effectiveStudentsPolicies();

// ════════════════════════════════════════════════════════════════════════════
// 0. The parser is wired up and non-vacuous — it must actually find the known
//    baseline students policies, or every "no recursion" assertion below is empty.
// ════════════════════════════════════════════════════════════════════════════
describe('students RLS guard: parser non-vacuity', () => {
  it('the migrations root resolves and contains the baseline', () => {
    expect(MIGRATIONS_ABS).not.toBeNull();
    expect(existsSync(resolve(MIGRATIONS_ABS!, '00000000000000_baseline_from_prod.sql'))).toBe(
      true,
    );
  });

  it('discovers the known effective students SELECT policies (parse is non-empty)', () => {
    expect(POLICIES.size).toBeGreaterThanOrEqual(3);
    // The consolidated SELECT policy that carries the teacher/parent boundary via
    // the SECURITY DEFINER helpers must be present in the final state.
    expect(POLICIES.has('students_select_merged')).toBe(true);
    // The discoverable teacher backstop must still exist after the fix.
    expect(POLICIES.has('Teachers can view students in their classes')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE INVARIANT — no surviving students policy inlines a protected-table
//    subquery in its USING / WITH CHECK predicate. This is the assertion that
//    FAILS against 20260702010000's recursive policy and PASSES once
//    20260702080000 has superseded it with `is_teacher_of(id)`.
// ════════════════════════════════════════════════════════════════════════════
describe('students RLS guard: no inline subquery over an RLS-protected table', () => {
  it('NO active policy on public.students inlines FROM/JOIN over a protected table', () => {
    const offenders: Array<{ policy: string; table: string }> = [];
    for (const [name, text] of POLICIES) {
      const r = containsInlineProtectedSubquery(text);
      if (r.hit) offenders.push({ policy: name, table: r.table! });
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `RLS INFINITE-RECURSION RISK (P8): policy(ies) on public.students inline a ` +
            `subquery over an RLS-protected, student-referencing table: ` +
            offenders.map((o) => `"${o.policy}" → ${o.table}`).join('; ') +
            `. This reproduces the 2026-07-02 incident where the inline ` +
            `class_students join re-entered class_students' own RLS and Postgres ` +
            `raised "infinite recursion detected in policy for relation students", ` +
            `breaking EVERY authenticated read of students. Express the ` +
            `teacher/parent boundary via the SECURITY DEFINER helpers ` +
            `public.is_teacher_of(id) / public.is_guardian_of(id) (their inner ` +
            `reads bypass RLS) instead. See ` +
            `supabase/migrations/20260702080000_fix_students_rls_infinite_recursion.sql.`,
    ).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. POSITIVE SHAPE — the surviving teacher boundary delegates to the helper,
//    and the dropped recursive form is gone. (Locks the *correct* pattern in,
//    not just the absence of the wrong one.)
// ════════════════════════════════════════════════════════════════════════════
describe('students RLS guard: teacher boundary goes through is_teacher_of (non-recursive)', () => {
  it('the surviving "Teachers can view students in their classes" policy calls is_teacher_of(id)', () => {
    const text = POLICIES.get('Teachers can view students in their classes')!;
    expect(text).toMatch(/public\.is_teacher_of\s*\(\s*id\s*\)/i);
    // And it must NOT inline the class_students roster join (the recursive form).
    expect(containsInlineProtectedSubquery(text).hit).toBe(false);
  });

  it('students_select_merged expresses teacher/parent boundaries via helpers only', () => {
    const text = POLICIES.get('students_select_merged')!;
    expect(text).toMatch(/is_teacher_of/i);
    expect(text).toMatch(/is_guardian_of/i);
    expect(containsInlineProtectedSubquery(text).hit).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. DETECTOR SELF-TEST — proves the guard is not vacuous: it MUST flag the old
//    recursive policy text and MUST clear the fixed helper-delegating text. This
//    is the "would it fail against the old policy?" proof, without reintroducing
//    the bad migration to disk.
// ════════════════════════════════════════════════════════════════════════════
describe('students RLS guard: detector self-test (would fail on the old recursive policy)', () => {
  const RECURSIVE_OLD = `CREATE POLICY "Teachers can view students in their classes"
    ON public.students FOR SELECT TO authenticated
    USING ( id IN ( SELECT cs.student_id
                    FROM public.class_students cs
                    JOIN public.class_teachers ct ON ct.class_id = cs.class_id
                    JOIN public.teachers t ON t.id = ct.teacher_id
                    WHERE t.auth_user_id = auth.uid()
                      AND cs.is_active = true AND ct.is_active = true ) )`;

  const FIXED_NEW = `CREATE POLICY "Teachers can view students in their classes"
    ON public.students FOR SELECT TO authenticated
    USING ( public.is_teacher_of(id) )`;

  it('FLAGS the old inline class_students/class_teachers policy as recursive', () => {
    const r = containsInlineProtectedSubquery(RECURSIVE_OLD);
    expect(r.hit).toBe(true);
    expect(r.table).toBe('class_students');
  });

  it('CLEARS the fixed is_teacher_of(id) policy', () => {
    expect(containsInlineProtectedSubquery(FIXED_NEW).hit).toBe(false);
  });

  it('also flags an inline guardian/parent link join', () => {
    const guardianInline = `CREATE POLICY "x" ON public.students FOR SELECT USING (
      id IN (SELECT gsl.student_id FROM public.guardian_student_links gsl
             WHERE gsl.guardian_auth_user_id = auth.uid()) )`;
    expect(containsInlineProtectedSubquery(guardianInline).hit).toBe(true);
  });
});
