import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const fixtures = {
  school_a: {
    id: '00000000-0000-4000-8000-0000000000a1',
    users: {
      student: { authUserId: 'auth-student-a', studentId: 'student-a', schoolId: 'school_a' },
      parent: { authUserId: 'auth-parent-a', guardianId: 'guardian-a', schoolId: 'school_a' },
      teacher: { authUserId: 'auth-teacher-a', teacherId: 'teacher-a', classId: 'class-a', schoolId: 'school_a' },
      school_admin: { authUserId: 'auth-admin-a', adminId: 'admin-a', schoolId: 'school_a' },
    },
  },
  school_b: {
    id: '00000000-0000-4000-8000-0000000000b1',
    users: {
      student: { authUserId: 'auth-student-b', studentId: 'student-b', schoolId: 'school_b' },
      parent: { authUserId: 'auth-parent-b', guardianId: 'guardian-b', schoolId: 'school_b' },
      teacher: { authUserId: 'auth-teacher-b', teacherId: 'teacher-b', classId: 'class-b', schoolId: 'school_b' },
      school_admin: { authUserId: 'auth-admin-b', adminId: 'admin-b', schoolId: 'school_b' },
    },
  },
  links: {
    sameSchoolParent: { guardianId: 'guardian-a', studentId: 'student-a', status: 'active' },
    inactiveParent: { guardianId: 'guardian-a', studentId: 'student-a', status: 'pending' },
    crossSchoolParent: { guardianId: 'guardian-a', studentId: 'student-b', status: 'active' },
    sameSchoolTeacher: { teacherId: 'teacher-a', classId: 'class-a', studentId: 'student-a', active: true },
    crossSchoolTeacher: { teacherId: 'teacher-a', classId: 'class-b', studentId: 'student-b', active: false },
  },
} as const;

describe('tenant isolation fixtures', () => {
  it('models two schools with student, parent, teacher and school_admin identities', () => {
    expect(fixtures.school_a.users.student.schoolId).toBe('school_a');
    expect(fixtures.school_b.users.student.schoolId).toBe('school_b');
    expect(Object.keys(fixtures.school_a.users)).toEqual(['student', 'parent', 'teacher', 'school_admin']);
    expect(Object.keys(fixtures.school_b.users)).toEqual(['student', 'parent', 'teacher', 'school_admin']);
  });
});

describe('parent route tenant isolation contracts', () => {
  it('requires an active/approved guardian_student_links relationship before reports are generated', () => {
    const route = read('src/app/api/parent/report/route.ts');
    expect(route).toContain("authorizeRequest(request, 'child.view_progress')");
    expect(route).toContain('getGuardianByAuthUserId(auth.userId!)');
    expect(route).toContain('isGuardianLinkedToStudent(guardian.id, student_id)');
    expect(route).toMatch(/status:\s*403/);
  });

  it('central RBAC only accepts active or approved guardian links for same-school child access', () => {
    const rbac = read('src/lib/rbac.ts');
    expect(rbac).toContain(".from('guardian_student_links')");
    expect(rbac).toContain(".eq('student_id', studentId)");
    expect(rbac).toContain(".in('status', ['active', 'approved'])");
    expect(rbac).toContain(".in('guardian_id', guardianIds)");
    expect(fixtures.links.inactiveParent.status).toBe('pending');
  });
});

describe('teacher route tenant isolation contracts', () => {
  it('requires active class membership before teacher class Pulse access succeeds', () => {
    const route = read('src/app/api/pulse/class/[classId]/route.ts');
    expect(route).toContain("authorizeRequest(request, 'class.view_analytics')");
    expect(route).toContain(".from('teachers')");
    expect(route).toContain(".eq('auth_user_id', callerId)");
    expect(route).toContain(".from('class_teachers')");
    expect(route).toContain(".eq('class_id', classId)");
    expect(route).toContain(".eq('teacher_id', teacher.id)");
    expect(route).toContain(".eq('is_active', true)");
    expect(route).toMatch(/status:\s*403/);
  });

  it('central RBAC grants teacher student access only through assigned active classes', () => {
    const rbac = read('src/lib/rbac.ts');
    expect(rbac).toContain(".from('teachers')");
    expect(rbac).toContain(".from('class_teachers')");
    expect(rbac).toContain(".from('class_students')");
    expect(rbac).toContain(".eq('student_id', studentId)");
    expect(rbac).toContain(".in('class_id', classIds)");
  });
});

describe('school-admin and Pulse tenant isolation contracts', () => {
  it('school-admin APIs use school_id resolved from auth instead of request body school_id', () => {
    const auth = read('src/lib/school-admin-auth.ts');
    const studentsRoute = read('src/app/api/school-admin/students/route.ts');
    const exportRoute = read('src/app/api/school-admin/reports/export/route.ts');
    expect(auth).toContain(".from('school_admins')");
    expect(auth).toContain(".eq('auth_user_id', userId)");
    expect(auth).toContain(".eq('is_active', true)");
    expect(studentsRoute).toContain('const schoolId = auth.schoolId!');
    expect(studentsRoute).toContain('school_id: schoolId');
    expect(exportRoute).toContain('const { supabase, schoolId } = resolved.ctx');
    expect(exportRoute).toContain('p_school_id: schoolId');
  });

  it('student Pulse combines relationship checks with role permission checks before data access', () => {
    const route = read('src/app/api/pulse/student/[id]/route.ts');
    expect(route).toContain('canAccessStudent(callerId, studentId)');
    expect(route).toContain('hasAnyPermission(callerId, VIEW_PERMISSIONS)');
    expect(route).toMatch(/status:\s*403/);
    expect(route.indexOf('const canAccess = await canAccessStudent(callerId, studentId)')).toBeLessThan(route.indexOf('pulse = await buildSingleStudentPulse'));
  });
});
