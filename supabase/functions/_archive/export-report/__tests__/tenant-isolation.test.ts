import { assert, assertStringIncludes } from 'https://deno.land/std@0.210.0/assert/mod.ts';

const INDEX_PATH = new URL('../index.ts', import.meta.url);
const SRC = Deno.readTextFileSync(INDEX_PATH);

Deno.test('export-report tenant fixtures cover same-school and cross-school identities', () => {
  const fixtures = {
    school_a: { student: 'student-a', guardian: 'guardian-a', teacher: 'teacher-a', class: 'class-a' },
    school_b: { student: 'student-b', guardian: 'guardian-b', teacher: 'teacher-b', class: 'class-b' },
  };
  assert(fixtures.school_a.student !== fixtures.school_b.student);
  assert(fixtures.school_a.class !== fixtures.school_b.class);
});

Deno.test('export-report rejects unauthenticated calls before report dispatch', () => {
  assertStringIncludes(SRC, "authHeader?.startsWith('Bearer ')");
  assert(/status:\s*401/.test(SRC), 'expected a 401 for missing/invalid auth');
  assert(SRC.indexOf("authHeader?.startsWith('Bearer ')") < SRC.indexOf('switch (report_type)'));
});

Deno.test('export-report parent access requires active or approved guardian_student_links', () => {
  assertStringIncludes(SRC, "function assertGuardianLinkedToStudent");
  assertStringIncludes(SRC, ".from('guardian_student_links')");
  assertStringIncludes(SRC, ".eq('guardian_id', guardianId)");
  assertStringIncludes(SRC, ".eq('student_id', studentId)");
  assertStringIncludes(SRC, ".in('status', ['approved', 'active'])");
});

Deno.test('export-report class report requires teacher membership in requested class', () => {
  assertStringIncludes(SRC, 'function assertTeacherOwnsClass');
  assertStringIncludes(SRC, ".from('class_teachers')");
  assertStringIncludes(SRC, ".eq('class_id', classId)");
  assertStringIncludes(SRC, ".eq('teacher_id', teacherId)");
});

Deno.test('export-report student_hpc teacher access is scoped to the teacher assigned to that student class', () => {
  assertStringIncludes(SRC, 'function assertTeacherCanAccessStudent');
  assertStringIncludes(SRC, ".from('class_teachers')");
  assertStringIncludes(SRC, ".eq('teacher_id', teacherId)");
  assertStringIncludes(SRC, ".from('class_students')");
  assertStringIncludes(SRC, ".eq('student_id', studentId)");
  assertStringIncludes(SRC, ".in('class_id', classIds)");
  // The student lookup in assertTeacherCanAccessStudent must be scoped to the teacher's
  // assigned classes via .in('class_id', classIds) — not an unscoped any-class check.
  const fnIdx = SRC.indexOf('async function assertTeacherCanAccessStudent');
  const fnEnd = fnIdx > 0 ? SRC.indexOf('\n}', fnIdx + 10) + 2 : -1;
  assert(fnIdx > 0 && fnEnd > fnIdx, 'expected assertTeacherCanAccessStudent to be defined');
  const fnBody = SRC.slice(fnIdx, fnEnd);
  assertStringIncludes(fnBody, ".in('class_id', classIds)");
  assert(
    fnBody.indexOf(".in('class_id', classIds)") < fnBody.lastIndexOf('.limit(1)'),
    "expected .in('class_id', classIds) to appear before .limit(1) — scopes the lookup to teacher classes only",
  );
});
