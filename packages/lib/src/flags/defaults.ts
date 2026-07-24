import { PAYMENT_FLAGS } from './registries/payment';
import { WELCOME_FLAGS, REALTIME_FLAGS, COSMIC_REDESIGN_FLAGS } from './registries/platform';
import {
  GOAL_ADAPTIVE_FLAGS,
  PEDAGOGY_V2_FLAGS,
  ADAPTIVE_REMEDIATION_FLAGS,
  ADAPTIVE_LOOPS_BC_FLAGS,
  ADAPTIVE_LIVE_SELECTION_FLAGS,
  DIGITAL_TWIN_FLAGS,
  QUIZ_TELEMETRY_FLAGS,
} from './registries/pedagogy';
import {
  EDITORIAL_ATLAS_FLAGS,
  CONSUMER_MINIMALISM_FLAGS,
  TUTOR_FLAGS,
  STUDENT_OS_FLAGS,
  SUBJECTS_OS_FLAGS,
  REVISION_OS_FLAGS,
  PRACTICE_OS_FLAGS,
  TEST_OS_FLAGS,
} from './registries/consumer';
import {
  TEACHER_COMMAND_CENTER_FLAGS,
  TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS,
  TEACHER_GRADEBOOK_DEPTH_FLAGS,
  TEACHER_PARENT_COMMS_FLAGS,
} from './registries/teacher';
import {
  SCHOOL_COMMAND_CENTER_FLAGS,
  SCHOOL_PROVISIONING_FLAGS,
  SCHOOL_ADMIN_RBAC_FLAGS,
  SCHOOL_REPORTS_DEPTH_FLAGS,
  EDUCATION_INTELLIGENCE_FLAGS,
  PRINCIPAL_AI_FLAGS,
  SCHOOL_PULSE_FLAGS,
  WHITE_LABEL_FLAGS,
} from './registries/school';
import {
  FOXY_OS_FLAGS,
  FOXY_LEARNING_ACTIONS_FLAGS,
  FOXY_MATH_PIPELINE_FLAGS,
  FOXY_MATH_FORMAT_FLAGS,
  FOXY_CURRICULUM_GUARD_FLAGS,
  FOXY_RESPONSE_CACHE_L2_FLAGS,
  MODEL_GATEWAY_FLAGS,
} from './registries/foxy';

/**
 * Default values for known flags. `isFeatureEnabled()` already returns false
 * for any flag not present in the DB, but this map is the documented source
 * of truth for SSR behavior before the first DB hit completes.
 *
 * Keep in sync with the migration that seeds each flag.
 */
export const FLAG_DEFAULTS: Readonly<Record<string, boolean>> = {
  [PAYMENT_FLAGS.GST_INVOICING_V1]: false, // seeded OFF by 20260507130003_add_ff_gst_invoicing_v1.sql
  [WELCOME_FLAGS.WELCOME_V2]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY]: true,              // enabled: 20260621000001_enable_core_student_flags.sql
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION]: true,         // enabled: 20260621000001_enable_core_student_flags.sql
  [GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_RAG]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN_REMINDER]: false,
  [PEDAGOGY_V2_FLAGS.PRODUCTIVE_FAILURE_V1]: false,
  [PEDAGOGY_V2_FLAGS.DISTRACTOR_MICRO_EXPLAINER_V1]: true,  // enabled: 20260621000001_enable_core_student_flags.sql
  [PEDAGOGY_V2_FLAGS.DAILY_RHYTHM]: true,                   // enabled: 20260621000001_enable_core_student_flags.sql
  [PEDAGOGY_V2_FLAGS.WEEKLY_DIVE]: false,
  [PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS]: false,
  [EDITORIAL_ATLAS_FLAGS.MASTER]:  false,
  [EDITORIAL_ATLAS_FLAGS.STUDENT]: false,
  [EDITORIAL_ATLAS_FLAGS.PARENT]:  false,
  [EDITORIAL_ATLAS_FLAGS.TEACHER]: false,
  [EDITORIAL_ATLAS_FLAGS.SCHOOL]:  false,
  [REALTIME_FLAGS.SUBSCRIPTIONS_V1]: false,
  [COSMIC_REDESIGN_FLAGS.V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1]: true,          // enabled: 20260621000001_enable_core_student_flags.sql
  [CONSUMER_MINIMALISM_FLAGS.UNIFIED_QUIZ_V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]: false,
  [TUTOR_FLAGS.V1]: false, // seeded OFF by 20260512075619_ff_tutor_v1.sql
  [TUTOR_FLAGS.BKT_V1]: false, // seeded OFF by 20260525100002_ff_tutor_bkt_v1.sql
  [TEACHER_COMMAND_CENTER_FLAGS.V1]: false,
  [TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS.V1]: false, // seeded OFF by 20260623010000_seed_unseeded_b2b_flags.sql
  [TEACHER_GRADEBOOK_DEPTH_FLAGS.V1]: false, // seeded OFF by 20260623010000_seed_unseeded_b2b_flags.sql
  [TEACHER_PARENT_COMMS_FLAGS.V1]: false, // seeded OFF by 20260623010000_seed_unseeded_b2b_flags.sql
  [SCHOOL_COMMAND_CENTER_FLAGS.V1]: false,
  [SCHOOL_PROVISIONING_FLAGS.V1]: false, // seeded OFF by 20260623010000_seed_unseeded_b2b_flags.sql
  [SCHOOL_ADMIN_RBAC_FLAGS.V1]: false, // seeded OFF by 20260611000100_seed_ff_school_admin_rbac_flag.sql
  [SCHOOL_REPORTS_DEPTH_FLAGS.V1]: false,

  [STUDENT_OS_FLAGS.V1]: false,
  [SUBJECTS_OS_FLAGS.V1]: false,
  [REVISION_OS_FLAGS.V1]: false,
  [PRACTICE_OS_FLAGS.V1]: false,
  [TEST_OS_FLAGS.V1]: false,
  [EDUCATION_INTELLIGENCE_FLAGS.V1]: false, // seeded OFF by 20260623010000_seed_unseeded_b2b_flags.sql
  [PRINCIPAL_AI_FLAGS.V1]: false, // seeded OFF by 20260623010000_seed_unseeded_b2b_flags.sql (ENABLEMENT gated on ai-engineer P12 + 20260616010000 apply)
  [FOXY_OS_FLAGS.V1]: false,
  [SCHOOL_PULSE_FLAGS.V1]: false, // seeded OFF by 20260619000100_seed_ff_school_pulse_v1.sql
  [ADAPTIVE_REMEDIATION_FLAGS.V1]: false, // seeded OFF by 20260619000300_seed_ff_adaptive_remediation_v1.sql
  [ADAPTIVE_LOOPS_BC_FLAGS.V1]: false, // seeded OFF by 20260619000600_seed_ff_adaptive_loops_bc_v1.sql
  [ADAPTIVE_LIVE_SELECTION_FLAGS.V1]: true, // enabled: 20260702210000_enable_ff_adaptive_live_selection_v1.sql (seeded OFF by 20260622090000)
  [DIGITAL_TWIN_FLAGS.V1]: false, // seeded OFF by 20260702000700_seed_ff_digital_twin_v1.sql
  [FOXY_LEARNING_ACTIONS_FLAGS.V1]: false, // seeded OFF by 20260619000700_seed_ff_foxy_learning_actions_v1.sql
  [FOXY_MATH_PIPELINE_FLAGS.V1]: false, // seeded OFF by 20260619000800_seed_ff_foxy_math_pipeline_v1.sql
  [FOXY_MATH_FORMAT_FLAGS.V2]: false, // seeded OFF by 20260716120000_seed_ff_foxy_math_format_v2.sql
  [FOXY_CURRICULUM_GUARD_FLAGS.V1]: false, // seeded OFF by 20260619001000_seed_ff_foxy_curriculum_guard_v1.sql
  [FOXY_RESPONSE_CACHE_L2_FLAGS.V1]: false, // seeded OFF by 20260705000000_seed_ff_foxy_response_cache_l2.sql
  [FOXY_RESPONSE_CACHE_L2_FLAGS.SHADOW_V1]: false, // seeded OFF by 20260705000000_seed_ff_foxy_response_cache_l2.sql
  [QUIZ_TELEMETRY_FLAGS.V1]: false, // seeded OFF in a follow-up migration (SPEC-1..5)
  [MODEL_GATEWAY_FLAGS.V1]: false, // GenAI Phase 1; OFF = legacy Anthropic-primary (true no-op). Seed migration owned by architect.
  [WHITE_LABEL_FLAGS.TENANT_TYPE_V1]: false,
  [WHITE_LABEL_FLAGS.TENANT_MODULE_REGISTRY_V1]: false,
  [WHITE_LABEL_FLAGS.TENANT_CONFIG_V2]: false,
  [WHITE_LABEL_FLAGS.EVENT_BUS_V1]: false,
  ff_institution_entitlements_v1: false, // seeded OFF by 20260615205753_seed_ff_institution_entitlements_v1.sql
} as const;

/**
 * Atlas convenience reader: resolve whether the Editorial Atlas
 * redesign should render for a given (role, flags) pair.
 *
 * Rule: master OR per-role flag enables the new surface. This lets us
 * (a) flip one role at a time during the staged rollout, or (b) flip
 * the master and have all four go together.
 *
 * Accepts the simple `Record<string, boolean>` shape that
 * `getFeatureFlagsSimple()` and the legacy `getFeatureFlags()` Supabase
 * RPC both return — no special context needed.
 */
export function isAtlasEnabled(
  role: 'student' | 'parent' | 'teacher' | 'school',
  flags: Record<string, boolean> | undefined | null,
): boolean {
  if (!flags) return false;
  if (flags[EDITORIAL_ATLAS_FLAGS.MASTER]) return true;
  const roleFlag: Record<typeof role, string> = {
    student: EDITORIAL_ATLAS_FLAGS.STUDENT,
    parent:  EDITORIAL_ATLAS_FLAGS.PARENT,
    teacher: EDITORIAL_ATLAS_FLAGS.TEACHER,
    school:  EDITORIAL_ATLAS_FLAGS.SCHOOL,
  };
  return Boolean(flags[roleFlag[role]]);
}
