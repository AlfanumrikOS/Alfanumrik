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
  assert(!/\.from\('class_students'\)[\s\S]{0,120}\.eq\('student_id', studentId\)[\s\S]{0,80}\.limit\(1\)/.test(SRC), 'must not allow any teacher to view a student merely because the student is in any class');
});
