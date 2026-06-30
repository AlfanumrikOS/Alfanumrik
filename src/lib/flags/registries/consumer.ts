/**
 * Editorial Atlas redesign flags (2026-05-11).
 *
 *  ff_editorial_atlas_v1
 *    Master switch for the multi-role redesign documented in
 *    docs/design/MULTI_ROLE_REDESIGN.md. When ON, the student dashboard,
 *    parent portal, teacher classroom, and school-admin overview render
 *    the new Atlas surfaces (Fraunces editorial headline, unified shell,
 *    monoline iconography). When OFF, the legacy surfaces render
 *    unchanged. Default: false.
 *
 *    Per-role canaries (off until master is on):
 *      ff_editorial_atlas_student
 *      ff_editorial_atlas_parent
 *      ff_editorial_atlas_teacher
 *      ff_editorial_atlas_school
 *
 *    These give us a per-role flip even after the master is on, which
 *    we'll need for the 3-week phased rollout in the redesign plan.
 *
 * Seeded by 20260511180000_add_ff_editorial_atlas.sql. Tenant-scoped
 * canary: enable the master flag globally with target_institutions =
 * '{<tenant-uuid>}' to launch on one school first.
 */
export const EDITORIAL_ATLAS_FLAGS = {
  MASTER:  'ff_editorial_atlas_v1',
  STUDENT: 'ff_editorial_atlas_student',
  PARENT:  'ff_editorial_atlas_parent',
  TEACHER: 'ff_editorial_atlas_teacher',
  SCHOOL:  'ff_editorial_atlas_school',
} as const;

/**
 * Study Menu v2 flags (2026-05-20).
 *
 *  ff_study_menu_v2
 *    Master switch for the sidebar consolidation documented in
 *    docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md.
 *    When ON, the BottomNav sidebar renders the "Study" group with three
 *    items (Library / Refresh / Exam Sprint) and the old /review,
 *    /revise, /study-plan routes 301 to their new homes. When OFF, the
 *    legacy "Review" group with four items is rendered unchanged and the
 *    old routes are reachable. Default: false.
 *
 *    Seeded by migration 20260520120000_study_menu_v2_flag.sql.
 */
export const STUDY_MENU_FLAGS = {
  V2: 'ff_study_menu_v2',
} as const;

/**
 * Consumer Minimalism flags (Phase 1, 2026-06-06).
 *
 *  ff_today_home_v1         — adaptive "Today" home + 4-tab student nav (Wave A).
 *                             When OFF, /api/v2/today returns 404 and the legacy
 *                             /dashboard + 5-tab nav render unchanged.
 *  ff_unified_quiz_v1       — single parameterized quiz runtime (Wave B, not yet built).
 *  ff_parent_glance_v1      — push-first parent glance home (Wave C, not yet built).
 *  ff_parent_unified_auth_v1 — guardian-role parent auth, E2 closure (Wave D, not yet built).
 *  ff_parent_encourage_v1   — parent→child 'Encourage' cheer button on the glance home
 *                             (Wave D, D-encourage). When OFF, the Encourage button is hidden
 *                             and POST /api/v2/parent/encourage is not surfaced.
 *
 * All default false. Seeded by migration
 * 20260612000000_seed_phase1_consumer_minimalism_flags.sql.
 * See docs/superpowers/plans/2026-06-06-phase-1-consumer-minimalism.md.
 */
export const CONSUMER_MINIMALISM_FLAGS = {
  TODAY_HOME_V1:          'ff_today_home_v1',
  UNIFIED_QUIZ_V1:        'ff_unified_quiz_v1',
  PARENT_GLANCE_V1:       'ff_parent_glance_v1',
  PARENT_UNIFIED_AUTH_V1: 'ff_parent_unified_auth_v1',
  PARENT_ENCOURAGE_V1:    'ff_parent_encourage_v1',
} as const;

/**
 * Alfa OS flagship redesign flags (2026-06-11).
 *
 *  ff_student_os_v1
 *    Master switch for the "Alfa OS" flagship redesign of the STUDENT
 *    DASHBOARD and the FOXY AI WORKSPACE. This is a PRESENTATION-LAYER
 *    redesign over the unchanged learning engines — it re-presents the
 *    outputs of the existing scoring/XP/anti-cheat/quiz pipelines without
 *    touching them (P1/P2/P3/P4 untouched) and does not change the Foxy
 *    structured-render envelope, modes, daily limits, or scope-lock
 *    (P12/REG-55 untouched).
 *
 *    When ON:
 *      1. /dashboard renders <StudentOSDashboard> — a decision-first,
 *         mastery-centric layout (Today's Mission hero wrapping the existing
 *         DailyRhythmQueue, a Mastery Snapshot, a Revision Rail reusing
 *         ReviewsDueCard/useReviewCards, and per-subject Subject Roadmaps).
 *      2. /foxy renders a 3-pane workspace (Conversations rail | Conversation |
 *         Context panel with mastery-aware nudges) — the chat column, renderer,
 *         and 7 modes are byte-identical to today; the redesign only adds an
 *         aside ContextPanel whose suggestions route through the existing
 *         mode/prompt mechanisms (no new AI calls).
 *
 *    Rendered exclusively under Cosmic-LIGHT + HC (data-design="cosmic"
 *    data-theme="light" data-role="student"); dark mode is intentionally not
 *    requested.
 *
 *    When OFF, BOTH surfaces are BYTE-IDENTICAL to today: /dashboard renders
 *    AtlasDashboard (or the legacy dashboard) unchanged and /foxy renders its
 *    existing single-shell layout unchanged. Default: false. Read client-side
 *    via the existing client flag read path (getFeatureFlags).
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and both surfaces stay byte-identical-OFF).
 */
export const STUDENT_OS_FLAGS = {
  /** Alfa OS flagship redesign of the student dashboard + Foxy workspace. Default off. */
  V1: 'ff_student_os_v1',
} as const;

/**
 * SUBJECTS_OS_FLAGS — gates the "Alfa OS" Subjects experience (Tier 1,
 * presentation-only) inside /learn. When a subject is selected and the flag is
 * ON, the new per-subject SubjectsOSHub renders in place of the legacy chapter
 * list. Default OFF; OFF path is byte-identical to today.
 *
 * Not yet seeded by any migration; while absent from `feature_flags` the
 * client read path resolves it to OFF, so the legacy chapter list renders.
 */
export const SUBJECTS_OS_FLAGS = {
  /** Alfa OS per-subject hub inside /learn. Default off. */
  V1: 'ff_subjects_os_v1',
} as const;

/**
 * REVISION_OS_FLAGS — gates the "Alfa OS" Revision Center (Tier 1,
 * presentation-only) mounted at the NEW route /revision. When ON, /revision
 * renders the spaced-repetition Revision Center (overdue / due-today / upcoming
 * buckets, 7-day schedule, per-subject load) over the existing
 * GET /api/revision/overview endpoint. When OFF the route does not exist —
 * /revision calls notFound() (additive; no existing surface changes).
 *
 * Not yet seeded by any migration; while absent from `feature_flags` the
 * client read path resolves it to OFF, so /revision 404s exactly as today.
 */
export const REVISION_OS_FLAGS = {
  /** Alfa OS Revision Center at /revision. Default off. */
  V1: 'ff_revision_os_v1',
} as const;

/**
 * PRACTICE_OS_FLAGS — gates the "Alfa OS" Practice Center (Tier 1+,
 * presentation-only) mounted at the NEW route /practice. When ON, /practice
 * renders the Practice Center (streak + sessions-this-week header, a single
 * Quick-Start CTA into the EXISTING /quiz engine, weak-topic launchers, a
 * due-for-practice card, recent quiz-session history, and avg-score / error /
 * Bloom insights) over the existing GET /api/practice/history endpoint plus the
 * existing useMasteryOverview / useStudentSnapshot readers. When OFF the route
 * does not exist — /practice calls notFound() (additive; no existing surface
 * changes). No scoring/XP/anti-cheat/schema change — presentation only.
 *
 * Not yet seeded by any migration; while absent from `feature_flags` the
 * client read path resolves it to OFF, so /practice 404s exactly as today.
 */
export const PRACTICE_OS_FLAGS = {
  /** Alfa OS Practice Center at /practice. Default off. */
  V1: 'ff_practice_os_v1',
} as const;

/**
 * TEST_OS_FLAGS — gates the "Alfa OS" pre-test BRIEFING hub (Tier 1,
 * presentation-only) mounted at the NEW route /exam-briefing. When ON,
 * /exam-briefing renders the briefing hub (upcoming exams, per-exam readiness
 * briefing, a DISPLAY-ONLY predicted-score estimate over exam_chapters
 * weightage, weak-chapter focus, a time/pace estimate, and a Start CTA into the
 * EXISTING exam runtime) over the existing client read of exam_configs +
 * exam_chapters plus the existing subject/chapter readiness readers. When OFF
 * the route does not exist — /exam-briefing calls notFound() (additive; no
 * existing exam/quiz/results surface changes). No scoring/XP/anti-cheat/exam-
 * timing/schema change — presentation only.
 *
 * NOTE: distinct from the LIVE /exam-prep surface (Study Menu v2 "Exam Sprint",
 * REG-69) — this is a NEW, separate route and does not touch it.
 *
 * Not yet seeded by any migration; while absent from `feature_flags` the
 * client read path resolves it to OFF, so /exam-briefing 404s exactly as today.
 */
export const TEST_OS_FLAGS = {
  /** Alfa OS pre-test briefing hub at /exam-briefing. Default off. */
  V1: 'ff_test_os_v1',
} as const;
