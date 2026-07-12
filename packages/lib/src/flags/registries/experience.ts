/** Sticky, role-specific rollout flags for Alfanumrik One Experience V3. */
export const EXPERIENCE_V3_FLAGS = {
  STUDENT: 'ff_ui_v3_student',
  TEACHER: 'ff_ui_v3_teacher',
  PARENT: 'ff_ui_v3_parent',
  SCHOOL_ADMIN: 'ff_ui_v3_school_admin',
  SUPER_ADMIN: 'ff_ui_v3_super_admin',
} as const;

export type ExperienceV3Flag = (typeof EXPERIENCE_V3_FLAGS)[keyof typeof EXPERIENCE_V3_FLAGS];
