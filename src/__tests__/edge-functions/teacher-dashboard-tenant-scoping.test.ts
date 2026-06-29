/**
 * TSB-1 (CRITICAL, P8/P13) regression — teacher-dashboard Edge Function MUST
 * tenant-scope every grade-fallback `students` query by the AUTHENTICATED
 * teacher's own `school_id`, fail-closed on a null school.
 *
 * Audit: engineering-audit Cycle 5 (Teacher / School-Admin B2B), 2026-06-29.
 * File under test: supabase/functions/teacher-dashboard/index.ts
 *
 * ─── Why this is a STATIC source-shape test (Vitest lane) ────────────────────
 * The Edge Function runs in Deno-land (Deno.serve, https://esm.sh imports) and
 * cannot be imported/executed under Vitest. It is also not structured for
 * dependency injection of a mock Supabase client — every handler calls
 * `getServiceClient()` internally. So, exactly like the sibling
 * `teacher-dashboard-roster-join.test.ts` and the Deno-lane
 * `supabase/functions/export-report/__tests__/tenant-isolation.test.ts`
 * (which ALSO inspects source text rather than executing), we pin the security
 * property by parsing the source: every `.from('students')` query that filters
 * by `grade` MUST also filter by `school_id`, and each grade branch MUST be
 * fail-closed when the teacher has no school.
 *
 * The service-role client bypasses RLS, so this app-code scoping IS the tenant
 * boundary — losing it silently re-opens cross-school student PII reads/writes
 * with no test failure unless this guard exists. The TSB-2 RLS policy
 * (20260629000000) is complementary defense-in-depth, NOT a substitute (it does
 * not constrain the service-role reads here).
 *
 * Behavioral properties pinned (mapped to the audit's required assertions):
 *   1. Assigned teacher WITH a school → grade-fallback resolvers query
 *      students by BOTH grade AND school_id ⇒ only same-school students.
 *   2. Teacher with NO school_id → resolvers return EMPTY (fail-closed `if
 *      (schoolId)` / `if (!schoolId) return`) and `assertTeacherOwnsClass`
 *      returns false (403) for a `grade-<n>` class id.
 *   3. A school-X teacher cannot READ (resolveStudentsForTeacher / heatmap /
 *      alerts / resolveStudentsForClass) NOR WRITE (handleSetGradeBookCell) a
 *      school-Y same-grade student — every grade path carries `.eq('school_id',
 *      <auth-derived>)`.
 *   4. The teacher id used for school resolution is the JWT-bound one — the
 *      dispatcher overwrites `body.teacher_id` with `resolveTeacherFromJwt`'s
 *      Bearer-derived id BEFORE any handler runs; never request-supplied.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FN_PATH = resolve(
  process.cwd(),
  'supabase/functions/teacher-dashboard/index.ts',
);

const src = readFileSync(FN_PATH, 'utf8');

/**
 * Extract the supabase-js method chain beginning at each `.from('students')`
 * call so we can inspect ONLY that query's filters in isolation from sibling
 * queries (e.g. an adjacent `class_students` join) and from comment prose.
 *
 * Walks `.method( …balanced parens… )` segments: after `.from('students')`,
 * repeatedly skip whitespace, consume `.<identifier>`, then a balanced
 * `( … )` argument list. Stops at the first token that is not another
 * chained call (statement boundary / property access without a call).
 */
function extractStudentsChains(source: string): string[] {
  const chains: string[] = [];
  const fromRe = /\.from\(\s*['"]students['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const start = m.index;
    let i = start + m[0].length;
    // Consume chained `.method(...)` segments.
    for (;;) {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source[i] !== '.') break;
      i++; // consume '.'
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++; // method name
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source[i] !== '(') break; // property access without a call → stop
      let depth = 0;
      do {
        const ch = source[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      } while (i < source.length && depth > 0);
    }
    chains.push(source.slice(start, i));
  }
  return chains;
}

/** Column names of every `.eq(`/`.in(` (etc.) filter in a chain (lowercased). */
function filterColumns(chain: string): string[] {
  const cols: string[] = [];
  const re = /\.(?:eq|in|neq|gt|gte|lt|lte|like|ilike)\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chain)) !== null) cols.push(m[1]);
  return cols;
}

/**
 * Slice a top-level `function <name>` body up to the next top-level boundary
 * (the next `function` declaration OR the `Deno.serve(` dispatcher — important
 * for `resolveTeacherFromJwt`, the LAST function before the dispatcher, so the
 * slice does not bleed into the dispatcher body).
 */
function functionBody(source: string, signature: string): string {
  const idx = source.indexOf(signature);
  if (idx < 0) return '';
  const after = idx + signature.length;
  const ends = [
    source.indexOf('\nasync function ', after),
    source.indexOf('\nfunction ', after),
    source.indexOf('\nDeno.serve(', after),
  ].filter((n) => n > 0);
  const end = ends.length ? Math.min(...ends) : source.length;
  return source.slice(idx, end);
}

describe('teacher-dashboard TSB-1 — file shape (guard against a vacuously-green parse)', () => {
  it('exists at supabase/functions/teacher-dashboard/index.ts', () => {
    expect(existsSync(FN_PATH)).toBe(true);
  });

  it('defines the auth-derived school resolver resolveTeacherSchoolId', () => {
    expect(src).toMatch(/async function resolveTeacherSchoolId\s*\(/);
  });

  it('queries the students table (parse sanity)', () => {
    expect(extractStudentsChains(src).length).toBeGreaterThan(0);
  });
});

describe('teacher-dashboard TSB-1 — every grade-filtered students query is tenant-scoped (same-school only)', () => {
  const chains = extractStudentsChains(src);

  it('every .from(students) query that filters by grade ALSO filters by school_id', () => {
    expect(chains.length).toBeGreaterThan(0);
    const gradeChains = chains.filter((c) => filterColumns(c).includes('grade'));
    // There are multiple grade-fallback sites (heatmap, alerts,
    // resolveStudentsForTeacher, resolveStudentsForClass, attendance,
    // dashboard count). All must be present and all must be scoped.
    expect(
      gradeChains.length,
      'expected at least one grade-filtered students query (grade-fallback path)',
    ).toBeGreaterThan(0);
    for (const chain of gradeChains) {
      const cols = filterColumns(chain);
      expect(
        cols,
        `A .from('students') query filters by "grade" but NOT by "school_id". ` +
          `The grade fallback fans out across ALL schools' students unless ` +
          `tenant-scoped to the authenticated teacher's school (TSB-1, P8/P13). ` +
          `Chain:\n${chain}`,
      ).toContain('school_id');
    }
  });

  it('school_id is the SECOND predicate alongside grade (not a no-op .eq on null without a guard)', () => {
    // Defense: the scope must be an actual school_id column filter, present in
    // the same chain as the grade filter. (Fail-closed guards are asserted in
    // the next describe block.)
    const gradeChains = chains.filter((c) => filterColumns(c).includes('grade'));
    for (const chain of gradeChains) {
      expect(chain).toMatch(/\.eq\(\s*['"]school_id['"]/);
    }
  });
});

describe('teacher-dashboard TSB-1 — fail-closed on a school-less teacher (empty / 403, never all-schools)', () => {
  it('assertTeacherOwnsClass returns false for a grade-<n> class when teacher has no school_id', () => {
    const body = functionBody(src, 'async function assertTeacherOwnsClass');
    expect(body).toContain("classId.startsWith('grade-')");
    // The grade branch selects school_id and short-circuits to `return false`
    // when it is null — a school-less teacher cannot own a grade pseudo-class
    // (⇒ 403 before any student row is read).
    expect(body).toMatch(/\.select\(\s*['"]grades_taught,\s*school_id['"]/);
    expect(body).toMatch(
      /if\s*\(\s*!\(\s*teacher[^)]*school_id[^)]*\)\.school_id\s*\)\s*return false/,
    );
  });

  it('resolveStudentsForTeacher Path B is gated on a truthy schoolId (no school ⇒ no grade union)', () => {
    const body = functionBody(src, 'async function resolveStudentsForTeacher');
    expect(body).toMatch(/\.select\(\s*['"]grades_taught,\s*school_id['"]/);
    // The grade union only runs when schoolId is present.
    expect(body).toMatch(/if\s*\(\s*schoolId\s*&&\s*grades\.length\s*>\s*0\s*\)/);
    // …and when it runs, it is school-scoped.
    expect(body).toMatch(/\.eq\(\s*['"]school_id['"],\s*schoolId\s*\)/);
  });

  it('resolveStudentsForClass returns the empty set immediately for a school-less teacher', () => {
    const body = functionBody(src, 'async function resolveStudentsForClass');
    expect(body).toMatch(/const schoolId = await resolveTeacherSchoolId\(/);
    expect(body).toMatch(/if\s*\(\s*!schoolId\s*\)\s*return out/);
    expect(body).toMatch(/\.eq\(\s*['"]school_id['"],\s*schoolId\s*\)/);
  });

  it('handleGetHeatmap grade branch resolves school then guards on it (null ⇒ empty heatmap)', () => {
    const body = functionBody(src, 'async function handleGetHeatmap');
    expect(body).toMatch(/const schoolId = await resolveTeacherSchoolId\(/);
    expect(body).toMatch(/if\s*\(\s*schoolId\s*\)/);
    expect(body).toMatch(/\.eq\(\s*['"]school_id['"],\s*schoolId\s*\)/);
  });

  it('handleGetAlerts grade branch resolves school then guards on it (null ⇒ empty alerts)', () => {
    const body = functionBody(src, 'async function handleGetAlerts');
    expect(body).toMatch(/const schoolId = await resolveTeacherSchoolId\(/);
    expect(body).toMatch(/if\s*\(\s*schoolId\s*\)/);
    expect(body).toMatch(/\.eq\(\s*['"]school_id['"],\s*schoolId\s*\)/);
  });
});

describe('teacher-dashboard TSB-1 — cross-tenant WRITE blocked (handleSetGradeBookCell)', () => {
  const body = functionBody(src, 'async function handleSetGradeBookCell');

  it('grade-pseudo-class membership check is tenant-scoped by the student-side school_id', () => {
    expect(body).toContain("classId.startsWith('grade-')");
    // Resolve the teacher's school, then the membership lookup matches the
    // student ONLY within that school — a same-grade student at another school
    // returns null ⇒ studentInClass=false ⇒ 403.
    expect(body).toMatch(/const schoolId = await resolveTeacherSchoolId\(/);
    expect(body).toMatch(/\.eq\(\s*['"]id['"],\s*studentId\s*\)/);
    expect(body).toMatch(/\.eq\(\s*['"]school_id['"],\s*schoolId\s*\)/);
  });

  it('the membership check runs only when schoolId is set (fail-closed for school-less)', () => {
    // `if (schoolId) { ... }` wraps the lookup; otherwise studentInClass stays
    // false ⇒ the write is rejected.
    const gradeBranch = body.slice(body.indexOf("classId.startsWith('grade-')"));
    expect(gradeBranch).toMatch(/if\s*\(\s*schoolId\s*\)/);
  });
});

describe('teacher-dashboard TSB-1 — teacher id is JWT-bound, never request-supplied', () => {
  it('the dispatcher overwrites body.teacher_id with the Bearer-derived id before dispatch', () => {
    // resolveTeacherFromJwt derives the teacher id from the verified JWT
    // (auth_user_id), and the dispatcher binds it onto the body BEFORE the
    // action switch. So the school_id every handler resolves is the
    // authenticated teacher's own tenant.
    const authIdx = src.indexOf('const auth = await resolveTeacherFromJwt(');
    const bindIdx = src.indexOf('body.teacher_id = auth.teacherId');
    const switchIdx = src.indexOf('switch (action)');
    expect(authIdx).toBeGreaterThan(0);
    expect(bindIdx).toBeGreaterThan(authIdx);
    expect(switchIdx).toBeGreaterThan(bindIdx);
  });

  it('resolveTeacherFromJwt derives the teacher from the token user, not the body', () => {
    const body = functionBody(src, 'async function resolveTeacherFromJwt');
    expect(body).toMatch(/auth\.getUser\(token\)/);
    expect(body).toMatch(/\.eq\(\s*['"]auth_user_id['"],\s*user\.id\s*\)/);
    // It must NOT read teacher_id off the request body.
    expect(body).not.toMatch(/body\.teacher_id/);
  });

  it('resolveTeacherSchoolId resolves school strictly from the teacher id (teachers.id = teacherId)', () => {
    const body = functionBody(src, 'async function resolveTeacherSchoolId');
    expect(body).toMatch(/\.from\(\s*['"]teachers['"]\s*\)/);
    expect(body).toMatch(/\.select\(\s*['"]school_id['"]\s*\)/);
    expect(body).toMatch(/\.eq\(\s*['"]id['"],\s*teacherId\s*\)/);
    // Fail-closed: no teacher / no school ⇒ null.
    expect(body).toMatch(/return null/);
  });
});
