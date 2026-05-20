import { STUDY_MENU_FLAGS } from '@/lib/feature-flags';

/**
 * Returns the correct destination URL depending on whether
 * ff_study_menu_v2 is enabled for this user.
 *
 * Used by every component that historically linked to /review,
 * /revise, or /study-plan so the soak period can flip without
 * breaking deep links.
 */
export function reviewRoute(flags: Record<string, boolean>): string {
  return flags[STUDY_MENU_FLAGS.V2] === true ? '/refresh' : '/review';
}
export function reviseRoute(flags: Record<string, boolean>): string {
  return flags[STUDY_MENU_FLAGS.V2] === true ? '/refresh?tab=chapters' : '/revise';
}
export function studyPlanRoute(flags: Record<string, boolean>): string {
  return flags[STUDY_MENU_FLAGS.V2] === true ? '/exam-prep' : '/study-plan';
}
