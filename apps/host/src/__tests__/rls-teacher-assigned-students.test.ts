/**
 * TSB-2 (P8 defense-in-depth) regression — the teacher-assigned SELECT RLS
 * boundary on public.students — RECONCILED to the FIXED post-incident end-state.
 *
 * Audit: engineering-audit Cycle 5 (Teacher / School-Admin B2B), 2026-06-29.
 *
 * ─── WHY THIS FILE WAS REWRITTEN (XC-3 Phase 0a, 2026-07-02) ─────────────────
 * This test ORIGINALLY pinned the SHAPE of migration
 * `20260702010000_teacher_assigned_students_rls.sql` (TSB-4) — specifically that
 * the "Teachers can view students in their classes" policy on public.students
 * INLINED the `class_students ⋈ class_teachers ⋈ teachers` roster join in its
 * USING clause. That inline form turned out to be the EXACT cause of a production
 * incident: the inline subquery reads public.class_students as SECURITY INVOKER,
 * so class_students' own policy "Students can view own enrollment" (which reads
 * public.students back) re-entered the RLS evaluator and Postgres raised
 * "infinite recursion detected in policy for relation students", breaking EVERY
 * authenticated read of students.
 *
 * The fix `20260702080000_fix_students_rls_infinite_recursion.sql` DROPped that
 * inline policy and recreated the SAME discoverably-named backstop NON-RECURSIVELY
 * as `USING ( public.is_teacher_of(id) )` — a SECURITY DEFINER helper whose inner
 * reads BYPASS RLS, so no cycle can form. The inline shape this file used to assert
 * is now exactly the shape we must NEVER ship again.
 *
 * So pinning the OLD inline shape is actively wrong: it would "pass" only while the
 * recursive form (which we deleted) was present. This file now pins the FIXED
 * reality:
 *   - `20260702080000` SUPERSEDES `20260702010000` (DROP + recreate same name);
 *   - the EFFECTIVE teacher boundary on public.students delegates to
 *     `public.is_teacher_of(id)` and inlines NO cross-table roster join;
 *   - the boundary SEMANTICS are unchanged (is_teacher_of is the identical roster
 *     join with the same is_active guards — see the fix migration's header), so the
 *     three TSB-2 outcomes (assigned ⇒ visible, non-assigned ⇒ 0 rows, inactive
 *     enrollment ⇒ 0 rows) still hold; they are now encoded inside the helper.
 *
 * The recursion-CLASS guard (no policy on ANY table may inline a cross-table
 * subquery) lives in the generalized sibling `rls-no-cross-table-recursion.test.ts`
 * (REG-212) and the students-only pin in `students-rls-no-recursion.test.ts`
 * (REG-210). This file is the focused end-state pin for the specific TSB-2 teacher
 * backstop.
 *
 * ─── Lane note (still a migration-SHAPE test, not a live-DB test) ────────────
 * The repo's RLS regression lane is source-level, NOT a live-Postgres lane
 * (`rls-student-id-policies.test.ts`: "We do NOT run Postgres from Vitest —
 * structural checks are sufficient to catch accidental reverts or typos during
 * refactors."). We therefore pin the effective policy's PRESENCE and exact SHAPE
 * across the reduced chain, not a runtime SELECT result.
 *
 * Owner: testing. Catalog: REG-209 (reconciled by REG-212).
 *
 * ─── HANDOFF (P2-5 phase 2 batch 10, 2026-09-04) ─────────────────────────────
 * The named backstop policy this file guards was later folded into a merged
 * policy by an UNRELATED RLS-performance cleanup (migration 20260904120000):
 * students had 3 separate {authenticated}-role SELECT policies (this
 * backstop, the school-admin boundary, and a school-staff boundary), each
 * evaluated on every SELECT, so they were OR-merged into one policy,
 * `students_authenticated_select_merged`, to remove the redundant per-row
 * evaluation. This is NOT a P8 boundary change — the is_teacher_of(id)
 * delegation this file exists to guard is byte-identical inside the merged
 * predicate. `HISTORICAL_POLICY_NAME` (the retired name) and `POLICY_NAME`
 * (the current live name) are now split below to keep that distinction
 * explicit: HISTORICAL_POLICY_NAME reads the FROZEN 20260702080000 fix
 * migration's own text (never changes), POLICY_NAME reads the live effective
 * chain (changed by batch 10). See that migration's header and the "boundary
 * was later folded into a merged policy" describe block below.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Historical name — pinned verbatim inside the FROZEN 20260702080000 fix
// migration's own text (see the "superseded TSB-4 inline shape is gone"
// describe block below); must NEVER change even though this name no longer
// exists as a live policy after P2-5 phase 2 batch 10 folded it into a merge.
const HISTORICAL_POLICY_NAME = 'Teachers can view students in their classes';
// Current live/effective policy carrying this boundary. P2-5 phase 2 batch 10
// (migration 20260904120000, 2026-09-04) OR-merged HISTORICAL_POLICY_NAME +
// "School admins can view school students" + "School staff can view own
// school students" -- the 3 {authenticated} SELECT policies on students --
// into one policy under this name. See that migration's header and the
// "boundary was later folded into a merged policy" describe block below.
const POLICY_NAME = 'students_authenticated_select_merged';
const TSB4_MIGRATION = '20260702010000_teacher_assigned_students_rls.sql';
const FIX_MIGRATION = '20260702080000_fix_students_rls_infinite_recursion.sql';

// ── repo / migrations resolution (cwd or one level up) ──────────────────────
function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const MIGRATIONS_ABS = resolveRepo('supabase/migrations');

function stripLineComments(sql: string): string {
  return sql
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * Walk the root chain in timestamp order and reduce every CREATE/DROP POLICY ON
 * public.students into the FINAL effective set. Returns Map<policyName, stmtText>.
 * (Same reduction the generalized guard performs, scoped to students here.)
 */
function effectiveStudentsPolicies(): Map<string, string> {
  const surviving = new Map<string, string>();
  if (!MIGRATIONS_ABS) return surviving;

  const ON_STUDENTS =
    '\\s+ON\\s+(?:"?public"?\\s*\\.\\s*)?(?:"students"|students)(?![\\w"])';
  const CREATE_RE = new RegExp(`^\\s*CREATE\\s+POLICY\\s+"([^"]+)"${ON_STUDENTS}`, 'i');
  const DROP_RE = new RegExp(
    `^\\s*DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?"([^"]+)"${ON_STUDENTS}`,
    'i',
  );

  const files = readdirSync(MIGRATIONS_ABS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const exec = stripLineComments(readFileSync(resolve(MIGRATIONS_ABS, file), 'utf8'));
    for (const stmtRaw of exec.split(';')) {
      const stmt = stmtRaw.replace(/\s+/g, ' ').trim();
      if (!stmt) continue;
      const c = CREATE_RE.exec(stmt);
      if (c) {
        surviving.set(c[1], stmt);
        continue;
      }
      const d = DROP_RE.exec(stmt);
      if (d) surviving.delete(d[1]);
    }
  }
  return surviving;
}

const POLICIES = effectiveStudentsPolicies();

/** Does `text` inline a FROM/JOIN over the class_students roster tables? */
const ROSTER_INLINE_RE =
  /\b(?:FROM|JOIN)\s+(?:"?public"?\s*\.\s*)?"?(class_students|class_teachers)"?\b/i;

describe('TSB-2 reconciled: both migrations exist and the fix supersedes TSB-4', () => {
  it('the migrations root and both migration files resolve', () => {
    expect(MIGRATIONS_ABS).not.toBeNull();
    expect(existsSync(resolve(MIGRATIONS_ABS!, TSB4_MIGRATION))).toBe(true);
    expect(existsSync(resolve(MIGRATIONS_ABS!, FIX_MIGRATION))).toBe(true);
  });

  it(`${FIX_MIGRATION} sorts AFTER ${TSB4_MIGRATION} (so it supersedes it on a fresh DB)`, () => {
    expect(FIX_MIGRATION > TSB4_MIGRATION).toBe(true);
  });

  it('the parser is non-vacuous (finds the known effective students policies)', () => {
    expect(POLICIES.size).toBeGreaterThanOrEqual(3);
    expect(POLICIES.has('students_select_merged')).toBe(true);
    expect(POLICIES.has(POLICY_NAME)).toBe(true);
  });
});

describe('TSB-2 reconciled: the EFFECTIVE teacher backstop delegates to is_teacher_of (non-recursive)', () => {
  it(`the surviving "${POLICY_NAME}" policy is the FIXED helper form, not the inline roster join`, () => {
    const stmt = POLICIES.get(POLICY_NAME)!;
    // FIXED reality: delegates to the SECURITY DEFINER helper…
    expect(stmt).toMatch(/public\.is_teacher_of\s*\(\s*id\s*\)/i);
    // …and inlines NO class_students/class_teachers roster join (the recursive form).
    expect(ROSTER_INLINE_RE.test(stmt)).toBe(false);
  });

  it('it is still a discoverable, authenticated SELECT policy on public.students', () => {
    const stmt = POLICIES.get(POLICY_NAME)!;
    expect(stmt).toMatch(
      new RegExp(
        `CREATE POLICY "${POLICY_NAME}" ON (?:"?public"?\\.)?"?students"?.*FOR SELECT.*authenticated`,
        'i',
      ),
    );
  });

  it('the boundary semantics survive: is_teacher_of carries the is_active-guarded roster join', () => {
    // The three TSB-2 outcomes (assigned ⇒ visible; non-assigned ⇒ 0 rows;
    // inactive enrollment ⇒ 0 rows) are now encoded inside the SECURITY DEFINER
    // helper public.is_teacher_of, whose definition is pinned in the baseline.
    const baseline = readFileSync(
      resolve(MIGRATIONS_ABS!, '00000000000000_baseline_from_prod.sql'),
      'utf8',
    );
    const fnIdx = baseline.indexOf('FUNCTION "public"."is_teacher_of"');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = baseline.slice(fnIdx, fnIdx + 800).replace(/\s+/g, ' ');
    expect(body).toContain('FROM class_students cs');
    expect(body).toContain('JOIN class_teachers ct ON ct.class_id = cs.class_id');
    expect(body).toContain('JOIN teachers t ON t.id = ct.teacher_id');
    expect(body).toContain('t.auth_user_id = auth.uid()');
    // BOTH is_active guards — the assigned-only / active-enrollment-only semantics.
    expect(body).toContain('cs.is_active = true');
    expect(body).toContain('ct.is_active = true');
  });
});

describe('TSB-2 reconciled: the superseded TSB-4 inline shape is gone from the end-state', () => {
  it('NO surviving students policy inlines a class_students/class_teachers roster join', () => {
    const offenders: string[] = [];
    for (const [name, stmt] of POLICIES) {
      if (ROSTER_INLINE_RE.test(stmt)) offenders.push(name);
    }
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Recursive inline roster join resurfaced on public.students policy(ies): ` +
            `${offenders.join(', ')}. This is the TSB-4 recursion that ` +
            `${FIX_MIGRATION} removed — express the teacher boundary via ` +
            `public.is_teacher_of(id) instead. See rls-no-cross-table-recursion.test.ts.`,
    ).toEqual([]);
  });

  it('the fix migration itself drops then recreates the policy via the helper', () => {
    // Uses HISTORICAL_POLICY_NAME deliberately -- this reads the FROZEN
    // 20260702080000 migration file's own text, which still says "Teachers
    // can view students in their classes" and always will, regardless of the
    // later batch-10 merge that folded that policy into POLICY_NAME.
    const fixSql = readFileSync(resolve(MIGRATIONS_ABS!, FIX_MIGRATION), 'utf8');
    expect(fixSql).toContain(`DROP POLICY IF EXISTS "${HISTORICAL_POLICY_NAME}"`);
    expect(fixSql.replace(/\s+/g, ' ')).toMatch(
      new RegExp(
        `CREATE POLICY "${HISTORICAL_POLICY_NAME}".*USING \\( public\\.is_teacher_of\\(id\\) \\)`,
        'i',
      ),
    );
  });
});

describe('TSB-2 reconciled: the boundary was later folded into a merged policy (2026-09-04)', () => {
  it('the historically-named policy no longer exists standalone; the boundary now lives in students_authenticated_select_merged', () => {
    // P2-5 phase 2 batch 10 (migration 20260904120000) OR-merged
    // HISTORICAL_POLICY_NAME together with "School admins can view school
    // students" and "School staff can view own school students" -- all 3
    // {authenticated}-role SELECT policies on students -- into POLICY_NAME.
    // This is an UNRELATED P2-5 RLS-performance cleanup, not a P8 boundary
    // change: the is_teacher_of(id) delegation this file exists to guard is
    // unchanged, just nested inside a merged predicate (proven by the
    // "EFFECTIVE teacher backstop" describe block above, which now resolves
    // POLICY_NAME to that merged predicate).
    expect(POLICIES.has(HISTORICAL_POLICY_NAME)).toBe(false);
    expect(POLICIES.has(POLICY_NAME)).toBe(true);
  });
});
