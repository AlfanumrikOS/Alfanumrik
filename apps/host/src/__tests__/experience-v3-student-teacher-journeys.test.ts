import { describe, expect, it } from 'vitest';
import { getRoleManifest, resolveRouteCapability } from '@alfanumrik/lib/experience-v3';

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
});
