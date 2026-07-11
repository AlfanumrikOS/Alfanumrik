import { describe, expect, it } from 'vitest';
import { getRoleManifest, resolveRouteCapability } from '@alfanumrik/lib/experience-v3';
import { readFileSync } from 'node:fs';

function allowed(role: 'student' | 'teacher', path: string) {
  return resolveRouteCapability(getRoleManifest(role), path)?.allowed === true;
}

describe('One Experience V3 Student and Teacher journeys', () => {
  it('keeps the complete Student adaptive loop inside one governed capability shell', () => {
    [
      '/today',
      '/learn',
      '/learn/math/3',
      '/practice',
      '/quiz',
      '/quiz?mode=srs',
      '/progress',
      '/foxy',
      '/practice/exam',
      '/mock-exam',
    ].forEach((path) => expect(allowed('student', path), path).toBe(true));
  });

  it('keeps Teacher attention-to-intervention workflows inside the V3 shell', () => {
    [
      '/teacher/today',
      '/teacher/students',
      '/teacher/assign',
      '/teacher/assignments',
      '/teacher/grade',
      '/teacher/submissions',
      '/teacher/insights',
      '/teacher/messages',
      '/teacher/resources',
      '/teacher/worksheets',
      '/teacher/settings',
    ].forEach((path) => expect(allowed('teacher', path), path).toBe(true));
  });

  it('does not assign unrelated routes to either role manifest', () => {
    expect(resolveRouteCapability(getRoleManifest('student'), '/teacher/grade')).toBeNull();
    expect(resolveRouteCapability(getRoleManifest('teacher'), '/super-admin/command')).toBeNull();
  });

  it('implements Teacher evidence drill-down and targeted remediation against production contracts', () => {
    const source = readFileSync('src/app/teacher/_components/TeacherV3Pages.tsx', 'utf8');
    expect(source).toContain('useStudentMasteryReport(canAssignRemediation && selectedStudentId');
    expect(source).toContain('teacher-v3-student-focused-page');
    expect(source).toContain('<Drawer open={Boolean(selectedStudentId && desktopDetail)}');
    expect(source).toContain("fetch('/api/teacher/remediation'");
    expect(source).toContain('targetedRemediationPayload(selectedStudentId, resolvedTargetConceptId, selectedAlertId)');
    expect(source).toContain("next.delete('student')");
    expect(source).toContain('desktopDetail === null');
    expect(source).toContain('hasMasteryEvidence ? <StatusBadge');
    expect(source).toContain("'Assessed mastery: —'");
    expect(source).toContain("capabilities['teacher.assign.generic'] === true");
    expect(source).toContain("capabilities['teacher.assign.remediation'] === true");
    expect(source).toContain('if (!canAssignRemediation) return <DataState state="permission"');
    expect(source).toContain('if (!canAssignGeneric) return <DataState state="permission"');
    expect(source).toContain('<TeacherV3CapabilitiesContext.Provider value={capabilities}>');
  });
});
