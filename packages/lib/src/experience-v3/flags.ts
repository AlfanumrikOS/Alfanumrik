import { isFeatureEnabled } from '../feature-flags';
import { EXPERIENCE_V3_FLAGS } from '../flags/registries/experience';
export { EXPERIENCE_V3_FLAGS } from '../flags/registries/experience';
import type { AuthRole, ExperienceRole } from './types';

const ROLE_FLAGS: Record<ExperienceRole, string> = {
  student: EXPERIENCE_V3_FLAGS.STUDENT,
  teacher: EXPERIENCE_V3_FLAGS.TEACHER,
  parent: EXPERIENCE_V3_FLAGS.PARENT,
  'school-admin': EXPERIENCE_V3_FLAGS.SCHOOL_ADMIN,
  'super-admin': EXPERIENCE_V3_FLAGS.SUPER_ADMIN,
};

const EXPERIENCE_TO_AUTH_ROLE: Record<ExperienceRole, AuthRole> = {
  student: 'student',
  teacher: 'teacher',
  parent: 'guardian',
  'school-admin': 'institution_admin',
  'super-admin': 'super_admin',
};

export function roleToExperienceRole(role: AuthRole | string | null | undefined): ExperienceRole | null {
  switch (role) {
    case 'student': return 'student';
    case 'teacher': return 'teacher';
    case 'guardian':
    case 'parent': return 'parent';
    case 'institution_admin':
    case 'school_admin':
    case 'school-admin': return 'school-admin';
    case 'super_admin':
    case 'super-admin': return 'super-admin';
    default: return null;
  }
}

export interface ExperienceV3ResolutionInput {
  role: ExperienceRole;
  userId?: string;
  institutionId?: string;
  environment?: string;
}

/** Server-authoritative, sticky and fail-closed role rollout resolution. */
export async function resolveExperienceV3({ role, userId, institutionId, environment }: ExperienceV3ResolutionInput): Promise<boolean> {
  try {
    return await isFeatureEnabled(ROLE_FLAGS[role], {
      role: EXPERIENCE_TO_AUTH_ROLE[role],
      userId,
      institutionId,
      environment,
    });
  } catch {
    return false;
  }
}

export function getExperienceV3Flag(role: ExperienceRole): string { return ROLE_FLAGS[role]; }
