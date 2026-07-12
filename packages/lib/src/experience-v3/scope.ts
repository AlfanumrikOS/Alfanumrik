import type { ExperienceRole, RoleScope } from './types';

const ROLE_SCOPE_PARAMS: Readonly<Record<ExperienceRole, readonly string[]>> = {
  student: ['learnerId', 'curriculum', 'subjectId', 'planId'],
  teacher: ['schoolId', 'classId', 'termId', 'subjectId'],
  parent: ['childId'],
  'school-admin': ['schoolId'],
  'super-admin': ['institutionId', 'environment', 'range'],
};

/** Return a stable, role-specific subset of URL scope for request/cache keys. */
export function experienceV3ScopeQuery(role: ExperienceRole, rawSearch: string): string {
  const source = new URLSearchParams(rawSearch);
  const scoped = new URLSearchParams();
  for (const key of ROLE_SCOPE_PARAMS[role]) {
    // Teacher routes predate the typed V3 scope contract and use `class` in
    // their shareable URLs. Canonicalise that alias into `classId` so class
    // changes still invalidate the resolver/cache without creating two scope
    // dialects downstream.
    const value = role === 'teacher' && key === 'classId'
      ? (source.get('classId')?.trim() || source.get('class')?.trim())
      : source.get(key)?.trim();
    if (value) scoped.set(key, value);
  }
  return scoped.toString();
}

export function scopeSearchParams(scope: RoleScope): URLSearchParams {
  const params = new URLSearchParams();
  switch (scope.kind) {
    case 'student':
      params.set('learnerId', scope.learnerId);
      if (scope.curriculum) params.set('curriculum', scope.curriculum);
      if (scope.subjectId) params.set('subjectId', scope.subjectId);
      if (scope.activePlanId) params.set('planId', scope.activePlanId);
      break;
    case 'teacher':
      params.set('schoolId', scope.schoolId);
      if (scope.classId) params.set('classId', scope.classId);
      if (scope.termId) params.set('termId', scope.termId);
      if (scope.subjectId) params.set('subjectId', scope.subjectId);
      break;
    case 'parent': params.set('childId', scope.childId); break;
    case 'school-admin':
      params.set('schoolId', scope.schoolId);
      if (scope.academicYearId) params.set('academicYearId', scope.academicYearId);
      if (scope.campusId) params.set('campusId', scope.campusId);
      break;
    case 'super-admin':
      if (scope.institutionId) params.set('institutionId', scope.institutionId);
      params.set('environment', scope.environment);
      if (scope.range) params.set('range', scope.range);
      break;
  }
  return params;
}

export function scopeCacheKey(role: ExperienceRole, scope: RoleScope): readonly [string, string, string] {
  return ['experience-v3', role, scopeSearchParams(scope).toString()] as const;
}

export function withScope(href: string, scope: RoleScope): string {
  const url = new URL(href, 'https://alfanumrik.local');
  scopeSearchParams(scope).forEach((value, key) => url.searchParams.set(key, value));
  return `${url.pathname}${url.search}${url.hash}`;
}
