import { cacheFetch, CACHE_TTL } from './cache';

// Scoping precedence: environment → role → institution → global enabled.
// Empty scoping arrays = applies to all. Cached 5 minutes.

interface FeatureFlagRow {
  flag_name: string;
  is_enabled: boolean;
  target_roles: string[] | null;
  target_environments: string[] | null;
  target_institutions: string[] | null;
  rollout_percentage: number | null;
}

interface FlagContext {
  role?: string;           // 'student' | 'teacher' | 'parent' | etc.
  environment?: string;    // 'production' | 'staging' | 'development'
  institutionId?: string;  // school UUID
  userId?: string;         // user UUID for deterministic per-user rollout
}

/**
 * Deterministic hash for per-user feature flag rollout.
 * Given the same userId + flagName, always returns the same number 0-99.
 * Different userId values distribute roughly uniformly across 0-99.
 */
export function hashForRollout(userId: string, flagName: string): number {
  let hash = 0;
  const str = `${userId}:${flagName}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Registry of flag names that payment-integrity code references.
 * Defaults (when the flag is absent from the DB) are documented inline —
 * `isFeatureEnabled` already returns false for unknown flags, but this
 * registry keeps the source of truth close to the code that reads it.
 *
 * Seeded by migration 20260414120000_payment_subscribe_atomic_fix.sql.
 */
export const PAYMENT_FLAGS = {
  /** Enables the reconcile_stuck_subscriptions action in the payments Edge Function.
   *  Default: false (off). Flip via super-admin console after drift metrics confirmed. */
  RECONCILE_STUCK_SUBSCRIPTIONS_ENABLED: 'reconcile_stuck_subscriptions_enabled',
} as const;

let _flagCache: FeatureFlagRow[] | null = null;
let _flagCacheExpiry = 0;

/**
 * Invalidate the in-memory flag cache so that the next evaluation
 * re-fetches from Supabase. Call this after admin mutations to
 * feature_flags so toggles take effect immediately.
 */
export function invalidateFlagCache(): void {
  _flagCache = null;
  _flagCacheExpiry = 0;
}

/**
 * Load all flags from Supabase (server-side, uses service role).
 * Cached for 5 minutes.
 */
async function loadFlags(): Promise<FeatureFlagRow[]> {
  const now = Date.now();
  if (_flagCache && now < _flagCacheExpiry) return _flagCache;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return [];

    const res = await fetch(
      `${url}/rest/v1/feature_flags?select=flag_name,is_enabled,target_roles,target_environments,target_institutions,rollout_percentage`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );

    if (!res.ok) return _flagCache || [];
    // Coerce ANY non-array / malformed flags payload to a safe empty list so a
    // bad response can never make `_flagCache` a non-array (which would throw
    // out of the `.find()` / `for...of` consumers below). On a malformed body
    // every flag then falls back to its default (OFF for all ff_* flags).
    const parsed: unknown = await res.json();
    _flagCache = Array.isArray(parsed) ? (parsed as FeatureFlagRow[]) : [];
    _flagCacheExpiry = now + CACHE_TTL.STATIC; // 5 min
    return _flagCache;
  } catch {
    return _flagCache || [];
  }
}

/**
 * Evaluate a single feature flag with scoping.
 *
 * Returns true if the flag is enabled for the given context.
 * Returns false if disabled, scoped out, or not found.
 */
export async function isFeatureEnabled(
  flagName: string,
  context: FlagContext = {}
): Promise<boolean> {
  const flags = await loadFlags();
  // Defensive: never let a non-array flags payload throw out of this function.
  // A malformed/unexpected response must fall back to the flag's default
  // (OFF for all ff_* flags) rather than crash the caller.
  const flag = Array.isArray(flags) ? flags.find(f => f.flag_name === flagName) : undefined;

  if (!flag) return false; // Flag doesn't exist → disabled
  if (!flag.is_enabled) return false; // Globally disabled

  // Environment scoping
  if (flag.target_environments && flag.target_environments.length > 0) {
    const env = context.environment || process.env.VERCEL_ENV || process.env.NODE_ENV || 'production';
    if (!flag.target_environments.includes(env)) return false;
  }

  // Role scoping
  if (flag.target_roles && flag.target_roles.length > 0) {
    if (!context.role || !flag.target_roles.includes(context.role)) return false;
  }

  // Institution scoping
  if (flag.target_institutions && flag.target_institutions.length > 0) {
    if (!context.institutionId || !flag.target_institutions.includes(context.institutionId)) return false;
  }

  // Rollout percentage: deterministic per-user using consistent hashing.
  // 0% → always false. 100% or null → always true.
  // 1-99% with userId → hash(userId, flagName) determines inclusion.
  // 1-99% without userId → treated as enabled (backward compat).
  if (flag.rollout_percentage !== null && flag.rollout_percentage < 100) {
    if (flag.rollout_percentage <= 0) return false;
    if (context.userId) {
      return hashForRollout(context.userId, flagName) < flag.rollout_percentage;
    }
    // No userId provided: treat any percentage > 0 as enabled for backward compatibility
  }

  return true;
}

/**
 * Get all enabled flags for a context (e.g., for a student session).
 * Returns a Record<string, boolean> for all flags.
 */
export async function getEvaluatedFlags(
  context: FlagContext = {}
): Promise<Record<string, boolean>> {
  const flags = await loadFlags();
  const result: Record<string, boolean> = {};

  for (const flag of flags) {
    result[flag.flag_name] = await isFeatureEnabled(flag.flag_name, context);
  }

  return result;
}

/**
 * Client-side compatible: get all flags as simple key→boolean.
 * Does NOT evaluate scoping (client doesn't have context).
 * Use this only for initial page load; server should re-evaluate with context.
 */
export async function getFeatureFlagsSimple(): Promise<Record<string, boolean>> {
  const flags = await loadFlags();
  const result: Record<string, boolean> = {};
  for (const flag of flags) {
    result[flag.flag_name] = flag.is_enabled;
  }
  return result;
}

// ─── Flag Registries ──────────────────────────────────────────────────────────

/**
 * Maintenance banner flag. When enabled, a dismissible amber banner is shown
 * across all portals (student, parent, teacher, admin).
 *
 * Enable via super-admin console or direct DB:
 *   UPDATE feature_flags
 *   SET is_enabled = true,
 *       metadata = '{"message_en":"Scheduled maintenance 10-11 PM IST","message_hi":"रखरखाव 10-11 PM IST"}'
 *   WHERE flag_name = 'maintenance_banner';
 *
 * The MaintenanceBanner component reads `is_enabled` + `metadata.message_en/message_hi`
 * directly from the client Supabase instance (public read via RLS).
 */
export const MAINTENANCE_FLAGS = {
  MAINTENANCE_BANNER: 'maintenance_banner',
} as const;

/**
 * Marketing/landing-page flags.
 *
 * `ff_welcome_v2` gates the mobile-first editorial redesign of the `/welcome`
 * landing page (Indian Editorial Tutor aesthetic). Default OFF.
 *
 * Routing approach (recommended for the upcoming frontend port):
 *   The `/welcome` server component reads this flag and renders either
 *   <WelcomeV1 /> or <WelcomeV2 />. The URL stays `/welcome` — no SEO split,
 *   no link breakage, no marketing redirect. The `?v=2` query-string param
 *   should force v2 even when the flag is off (QA preview escape hatch);
 *   `?v=1` should force v1 when the flag is on (rollback escape hatch).
 *
 *   Pseudocode for src/app/welcome/page.tsx:
 *     const force = searchParams.v;
 *     const flagOn = await isFeatureEnabled('ff_welcome_v2', { userId, environment });
 *     const showV2 = force === '2' || (flagOn && force !== '1');
 *     return showV2 ? <WelcomeV2 /> : <WelcomeV1 />;
 *
 * Seeded by migration 20260426150000_add_ff_welcome_v2.sql.
 * Operator runbook for staged rollout / rollback lives in that migration's header.
 */
export const WELCOME_FLAGS = {
  /** Mobile-first editorial redesign of /welcome. Default: false (off).
   *  When true, /welcome renders WelcomeV2 instead of WelcomeV1. */
  WELCOME_V2: 'ff_welcome_v2',
} as const;

/**
 * Goal-Adaptive Learning Layers flags (Phase 0 + Phase 1 + Phase 2).
 *
 * `ff_goal_profiles` gates the super-admin Goal Profile Preview page that
 * lets admins inspect each of the 6 goal personas + their config tables.
 *
 * `ff_goal_aware_foxy` gates two user-visible behaviors that ship together:
 *   1. Foxy's system prompt swaps the legacy single-line goal sentence for
 *      a multi-paragraph persona tailored to (goal × mode).
 *   2. QuizResults renders a goal-aware scorecard sentence after every quiz.
 *
 * `ff_goal_aware_selection` (Phase 2) gates two backend behaviors:
 *   1. Quiz-generate workflow uses pickQuizParams + the additive
 *      get_adaptive_questions_v2 RPC instead of legacy constants + v1 RPC.
 *   2. Mastery display thresholds switch from the global 0.8 default to
 *      goal-specific thresholds (see src/lib/goals/mastery-display.ts).
 *
 * All three flags fall back to the legacy default when off, so disabling at
 * any time is an instant rollback.
 *
 * Seeded by migrations:
 *   - 20260503120000_add_ff_goal_adaptive_layers.sql       (Phase 0+1)
 *   - 20260503140000_add_phase2_goal_aware_selection.sql   (Phase 2)
 */
export const GOAL_ADAPTIVE_FLAGS = {
  GOAL_PROFILES: 'ff_goal_profiles',
  GOAL_AWARE_FOXY: 'ff_goal_aware_foxy',
  GOAL_AWARE_SELECTION: 'ff_goal_aware_selection',
  GOAL_DAILY_PLAN: 'ff_goal_daily_plan',  // Phase 3
  GOAL_AWARE_RAG: 'ff_goal_aware_rag',  // Phase 4
  GOAL_DAILY_PLAN_REMINDER: 'ff_goal_daily_plan_reminder',  // Phase 5
} as const;

/**
 * Pedagogy v2 — Wave 1 (Daily Rhythm) + Wave 2 (Weekly Curiosity Dive) flags.
 *
 *  ff_productive_failure_v1
 *    /learn/[subject]/[chapter] presents the ZPD problem BEFORE the tutorial.
 *    Default: false. When off, the legacy tutorial-first path is rendered.
 *    Persona-aware: even when the flag is on, `improve_basics` persona keeps
 *    worked-example-first via pedagogyContentRules — see
 *    src/lib/learn/pedagogy-content-rules.ts.
 *
 *  ff_distractor_micro_explainer_v1
 *    After a wrong MCQ pick, surface the curated remediation from
 *    wrong_answer_remediations and offer a one-click "Ask Foxy" CTA.
 *    Default: false.
 *
 *  ff_pedagogy_v2_daily_rhythm
 *    Dashboard renders <DailyRhythmQueue/> above the hero; /api/rhythm/today
 *    is callable. Default: false. When off, dashboard is unchanged.
 *
 *  ff_pedagogy_v2_weekly_dive
 *    /dive surface is reachable, /api/dive/* endpoints respond, and the
 *    dashboard's DailyRhythmQueue shows a "This week's dive" CTA when the
 *    week's dive is not yet completed. Default: false. When off, /dive
 *    returns 404 and the CTA is suppressed.
 *
 *  ff_pedagogy_v2_monthly_synthesis
 *    /synthesis surface is reachable, /api/synthesis/* endpoints respond,
 *    and the daily-cron triggers monthly-synthesis-builder for active
 *    flagged students. Default: false. When off, /synthesis returns 404,
 *    the WhatsApp parent-share path is suppressed, and the cron skips
 *    flagged-out students.
 *
 * Seeded by migrations:
 *   20260509120000_pedagogy_v2_wave_1_flags.sql
 *   20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql
 *   20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql
 */
export const PEDAGOGY_V2_FLAGS = {
  PRODUCTIVE_FAILURE_V1:        'ff_productive_failure_v1',
  DISTRACTOR_MICRO_EXPLAINER_V1: 'ff_distractor_micro_explainer_v1',
  DAILY_RHYTHM:                 'ff_pedagogy_v2_daily_rhythm',
  WEEKLY_DIVE:                  'ff_pedagogy_v2_weekly_dive',
  MONTHLY_SYNTHESIS:            'ff_pedagogy_v2_monthly_synthesis',
} as const;

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
 * Realtime subscriptions (Phase C.6).
 *
 *  ff_realtime_subscriptions_v1
 *    Gates Supabase Realtime postgres_changes subscriptions on:
 *      - teacher heatmap (student_learning_profiles UPDATE, throttled 2s)
 *      - teacher poll results (classroom_poll_responses INSERT, unthrottled)
 *      - parent child-progress (student_learning_profiles UPDATE, debounced 5s)
 *    When OFF, dashboards fall back to the existing focus/visibility fetch
 *    pattern. Default: false. Per-tenant opt-in via target_institutions.
 *
 *    PRECONDITION: the `supabase_realtime` Postgres publication must contain
 *    `student_learning_profiles` and `classroom_poll_responses` before this
 *    flag is flipped on. Verify with:
 *      SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
 *    See migration 20260527000002 header for the operator runbook.
 *
 * Seeded by 20260527000002_add_ff_realtime_subscriptions_v1.sql.
 */
export const REALTIME_FLAGS = {
  SUBSCRIPTIONS_V1: 'ff_realtime_subscriptions_v1',
} as const;

/**
 * Cosmic redesign flags (Phase 0 foundation, 2026-06-05).
 *
 *  ff_cosmic_redesign_v1
 *    Master switch for the "cosmic" dark-theme visual identity. Gates the
 *    new client-side CSS/theme layer. When ON, the cosmic theme tokens and
 *    surfaces render; when OFF, the existing visual identity renders
 *    unchanged. Default: false (off) so production is completely unaffected
 *    until explicitly enabled.
 *
 *    The redesign is gated client-side (CSS/theme), so read this flag from a
 *    client component via the existing client read path — see the
 *    "Client read API" note below.
 *
 *    Not yet seeded by any migration. While the flag is absent from the
 *    `feature_flags` table, both read paths resolve it to OFF
 *    (`isFeatureEnabled()` returns false for unknown flags;
 *    `getFeatureFlags()` omits absent rows so the lookup is undefined/falsy).
 *    A seeding migration with `is_enabled = false` would only be needed to
 *    make the flag visible/toggleable in the super-admin Flags console; it is
 *    NOT required for the default-OFF behavior.
 */
export const COSMIC_REDESIGN_FLAGS = {
  /** Cosmic dark redesign — new visual identity (Phase 0 foundation). Default off. */
  V1: 'ff_cosmic_redesign_v1',
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
 * Phase 3A — Teacher Command Center flags (2026-06-08).
 *
 *  ff_teacher_command_center  — master switch for the dense, desktop-first
 *    teacher home (the "Class Command Center"). Gates BOTH surfaces together:
 *      1. `/teacher` renders the Command Center (class switcher + roster mastery
 *         heatmap + at-risk alerts rail with one-tap "Assign remediation" +
 *         today summary + action bar) instead of the legacy tabbed dashboard.
 *      2. The teacher primary nav (TeacherShell) is slimmed to FIVE items
 *         (Command Center · Gradebook · Assignments · Messages · Reports);
 *         the remaining pages move to an account/overflow menu (routes stay
 *         reachable — no dead links).
 *    When OFF, BOTH surfaces are byte-identical to today: `/teacher` renders the
 *    existing dashboard and TeacherShell shows the existing full nav. Default:
 *    false. Read client-side via the existing client flag read path.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF.
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-teacher-command-center*
 */
export const TEACHER_COMMAND_CENTER_FLAGS = {
  /** Dense desktop-first teacher home + slimmed 5-item nav. Default off. */
  V1: 'ff_teacher_command_center',
} as const;

/**
 * Phase 3A — Wave B (Assignment lifecycle) flag (2026-06-08).
 *
 *  ff_teacher_assignment_lifecycle — ADDITIONAL gate, layered ON TOP of
 *    `ff_teacher_command_center`, for the cross-assignment GRADING QUEUE inside
 *    the Command Center. When ON (and the Command Center is already rendering):
 *      1. The Command Center fetches the `get_grading_queue` teacher-dashboard
 *         Edge action and surfaces its `count` as a badge on the today-summary
 *         "N awaiting grading" tile.
 *      2. The action-bar "Grading queue" button becomes ENABLED (it is a
 *         disabled placeholder otherwise). Clicking it opens the dense,
 *         oldest-first grading queue surface (lazy-loaded — P10).
 *      3. A queue row one-taps through to the EXISTING /teacher/submissions
 *         review flow (get_submission_detail + mark_submission_reviewed); no
 *         new grading/scoring UI is built (P1/P2 untouched).
 *    When OFF, BOTH the queue surface and the enabled button are suppressed:
 *    the "Grading queue" button stays the disabled placeholder and the today
 *    summary behaves exactly as in Wave A. Default: false.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and the queue is byte-identical-OFF).
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-wave-b-*
 */
export const TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS = {
  /** Cross-assignment grading queue surface inside the Command Center. Default off. */
  V1: 'ff_teacher_assignment_lifecycle',
} as const;

/**
 * Phase 3A — Wave C (Gradebook + reporting depth) flag (2026-06-08).
 *
 *  ff_teacher_gradebook_depth — ADDITIONAL gate for the MASTERY + BLOOM'S
 *    reporting depth layered onto two existing teacher surfaces. When ON:
 *      1. Command Center heatmap cells / student rows become a DRILL-THROUGH:
 *         clicking one opens a lazy-loaded Student Mastery Report panel
 *         (`get_student_mastery_report`) — mastery by concept, the 6 Bloom's
 *         levels with per-level accuracy (weakest highlighted), and recent
 *         performance. The panel offers a "Download report" action that calls
 *         `export_student_report` and saves the parent-ready CSV.
 *      2. `/teacher/grade-book` surfaces a class mastery/Bloom depth view
 *         (`get_class_mastery_bloom_summary`) — weakest concepts first + the
 *         class's weakest Bloom's level — above the existing score matrix.
 *    When OFF, BOTH surfaces are byte-identical to today: the heatmap cell is a
 *    plain navigate-to-student link (no panel), and the gradebook is the score
 *    matrix only (no depth view, no Bloom). Default: false. Read client-side via
 *    the existing client flag read path (getFeatureFlags).
 *
 *    Bloom's level names (remember→understand→apply→analyze→evaluate→create) are
 *    technical terms — NOT translated even when isHi (P7 exception).
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and both surfaces stay byte-identical-OFF).
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-wave-c-*
 */
export const TEACHER_GRADEBOOK_DEPTH_FLAGS = {
  /** Mastery + Bloom's reporting depth (drill-through + class summary + export). Default off. */
  V1: 'ff_teacher_gradebook_depth',
} as const;

/**
 * Phase 3A — Wave D (Parent comms) flag (2026-06-08).
 *
 *  ff_teacher_parent_comms — ADDITIONAL gate, layered ON TOP of
 *    `ff_teacher_command_center`, for the one-tap "Tell the parent" affordance.
 *    When ON (and the Command Center is already rendering):
 *      1. An at-risk alert whose `remediation_status === 'resolved'` gains a
 *         one-tap "Tell the parent 🎉" button → POST /api/teacher/parent-notify
 *         { student_id, context:'remediation_resolved', remediation_id?,
 *         include_report:true }. It find-or-creates the teacher↔parent thread and
 *         sends a templated good-news message with an inline progress summary.
 *      2. The Wave C Student Mastery Report panel gains a "Share with parent"
 *         button → POST /api/teacher/parent-notify { student_id, context:'general',
 *         include_report:true }.
 *    Outcomes (bilingual toasts): 200 → "Parent notified ✓"; 409 `no_guardian` →
 *    "No parent linked for this student" (informational, not an error); other →
 *    friendly error. The button optimistically disables + shows a spinner and
 *    stays disabled after success (idempotent-safe). P13: no PII in client logs.
 *
 *    When OFF, NO "Tell the parent" / "Share with parent" affordance is rendered
 *    anywhere and NO parent-notify fetch is ever issued — the Command Center and
 *    the report panel stay byte-identical to Waves A–C. Default: false. Read
 *    client-side via the existing client flag read path (getFeatureFlags).
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both read
 *    paths resolve it to OFF (and both surfaces stay byte-identical-OFF).
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-wave-d-*
 */
export const TEACHER_PARENT_COMMS_FLAGS = {
  /** One-tap "Tell the parent" / "Share with parent" affordance. Default off. */
  V1: 'ff_teacher_parent_comms',
} as const;

/**
 * Phase 3B — School Command Center flags (2026-06-08).
 *
 *  ff_school_command_center — master switch for the dense, read-only
 *    "School Command Center" home (the principal/admin overview). Gates BOTH
 *    surfaces together (mirrors Phase 3A's ff_teacher_command_center):
 *      1. `/school-admin` renders the Command Center (overview KPI strip with
 *         seat-utilization gauge + avg mastery, a classes-at-risk rail, and a
 *         teacher-engagement table — all read-only, fed by the three Wave A
 *         read-model RPCs via /api/school-admin/{overview,classes-at-risk,
 *         teacher-engagement}) instead of the legacy stat-tile dashboard.
 *      2. The school-admin primary nav (SchoolAdminShell) is consolidated from
 *         ~24 flat entries into FIVE grouped sections (Overview · People ·
 *         Academics · Billing · Settings); every existing route stays reachable
 *         (no dead links).
 *    When OFF, BOTH surfaces are byte-identical to today: `/school-admin` renders
 *    the existing dashboard (or AtlasSchoolAdmin when the Atlas flag is on) and
 *    SchoolAdminShell shows the existing flat nav. Default: false. Read
 *    client-side via the existing client flag read path (getFeatureFlags).
 *
 *    Seat-utilization is DISPLAY-ONLY in Wave A (enforcement is Wave B); the UI
 *    never implies any blocking.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and both surfaces stay byte-identical-OFF).
 *
 *  Spec/plan: docs/superpowers/plans/2026-06-08-phase-3b-school-professional-depth.md
 */
export const SCHOOL_COMMAND_CENTER_FLAGS = {
  /** Read-only School Command Center home + consolidated 5-section nav. Default off. */
  V1: 'ff_school_command_center',
} as const;

/**
 * Phase 3B — Wave B (Seat-aware provisioning ENFORCEMENT) flag (2026-06-08).
 *
 *  ff_school_provisioning — master switch for server-authoritative SEAT
 *    ENFORCEMENT on the school-admin provisioning surfaces. This is the
 *    PAYMENT-ADJACENT (P11) gate: every active student on a school roster is a
 *    billable seat, so the CEO-approved HYBRID SEAT POLICY is enforced through
 *    the race-safe SQL primitives in migration 20260614000001
 *    (evaluate_seat_policy / enroll_students_with_seat_check /
 *    refresh_school_seat_usage). When ON, the school-admin enroll/create,
 *    bulk-CSV import, deactivation, and invite-code issuance paths route through
 *    those RPCs and apply the policy:
 *      - within_plan  (N <= seats)            → allow
 *      - grace_warn   (seats < N <= floor(seats*1.10), 14-day window OPEN)
 *                                              → SOFT ALLOW + flag school admin
 *                                                + super-admin, surface
 *                                                grace_expires_at to the UI
 *      - grace_expired / over_ceiling          → HARD BLOCK (HTTP 409
 *                                                seat_cap_violation)
 *    When OFF, NONE of the enforcement runs and the provisioning routes behave
 *    BYTE-IDENTICALLY to today (the legacy `seats_purchased`-based soft checks
 *    that already exist on those routes are the unchanged fallback — Wave B does
 *    not invoke the Wave B RPCs at all while the flag is off). Default: false.
 *
 *    Master switch only — there is no per-school canary in Wave B; per-school
 *    rollout is achieved via the standard target_institutions scoping on the
 *    feature_flags row.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` the
 *    server read path (isFeatureEnabled) resolves it to OFF, so the provisioning
 *    routes stay byte-identical-OFF until the flag is explicitly seeded + enabled.
 *
 *  Spec/plan: docs/superpowers/plans/2026-06-08-phase-3b-school-professional-depth.md (Wave B)
 */
export const SCHOOL_PROVISIONING_FLAGS = {
  /** Seat-enforcement on school-admin provisioning (enroll/bulk/deactivate/invite). Default off. */
  V1: 'ff_school_provisioning',
} as const;

/**
 * Phase 3B — Wave C (School-admin RBAC depth) flag (2026-06-08).
 *
 *  ff_school_admin_rbac — master switch for ROLE-AWARE school-admin capability.
 *    The `school_admins.role` enum (principal / vice_principal /
 *    academic_coordinator / institution_admin) is decorative today: all four
 *    values resolve to the single `institution_admin` RBAC role, so every school
 *    admin currently gets identical access. When ON, authorizeSchoolAdmin()
 *    ALSO enforces the CEO-approved role→permission matrix
 *    (SCHOOL_ADMIN_ROLE_CAPABILITIES in src/lib/school-admin-auth.ts) AFTER the
 *    existing RBAC check + school_admins lookup: a caller whose
 *    `school_admins.role` does not grant the requested permission code gets 403.
 *    When OFF, authorizeSchoolAdmin() applies NO role-narrowing and behaves
 *    BYTE-IDENTICALLY to before Wave C — the matrix check is skipped entirely and
 *    the auth decision depends only on the RBAC check + active-school lookup.
 *    Default: false.
 *
 *    Server-only gate (read via isFeatureEnabled in school-admin-auth). Not yet
 *    seeded by any migration; while absent from `feature_flags` the server read
 *    path resolves it to OFF, so role-narrowing stays OFF until the flag is
 *    explicitly seeded + enabled.
 *
 *  Spec/plan: docs/superpowers/plans/2026-06-08-phase-3b-school-professional-depth.md (Wave C)
 */
export const SCHOOL_ADMIN_RBAC_FLAGS = {
  /** Role-aware school-admin capability (enforce the role→permission matrix). Default off. */
  V1: 'ff_school_admin_rbac',
} as const;

/**
 * Default values for known flags. `isFeatureEnabled()` already returns false
 * for any flag not present in the DB, but this map is the documented source
 * of truth for SSR behavior before the first DB hit completes.
 *
 * Keep in sync with the migration that seeds each flag.
 */
export const FLAG_DEFAULTS: Readonly<Record<string, boolean>> = {
  [WELCOME_FLAGS.WELCOME_V2]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_RAG]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN_REMINDER]: false,
  [PEDAGOGY_V2_FLAGS.PRODUCTIVE_FAILURE_V1]: false,
  [PEDAGOGY_V2_FLAGS.DISTRACTOR_MICRO_EXPLAINER_V1]: false,
  [PEDAGOGY_V2_FLAGS.DAILY_RHYTHM]: false,
  [PEDAGOGY_V2_FLAGS.WEEKLY_DIVE]: false,
  [PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS]: false,
  [EDITORIAL_ATLAS_FLAGS.MASTER]:  false,
  [EDITORIAL_ATLAS_FLAGS.STUDENT]: false,
  [EDITORIAL_ATLAS_FLAGS.PARENT]:  false,
  [EDITORIAL_ATLAS_FLAGS.TEACHER]: false,
  [EDITORIAL_ATLAS_FLAGS.SCHOOL]:  false,
  [REALTIME_FLAGS.SUBSCRIPTIONS_V1]: false,
  [COSMIC_REDESIGN_FLAGS.V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.UNIFIED_QUIZ_V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: false,
  [CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1]: false,
  [TEACHER_COMMAND_CENTER_FLAGS.V1]: false,
  [TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS.V1]: false,
  [TEACHER_GRADEBOOK_DEPTH_FLAGS.V1]: false,
  [TEACHER_PARENT_COMMS_FLAGS.V1]: false,
  [SCHOOL_COMMAND_CENTER_FLAGS.V1]: false,
  [SCHOOL_PROVISIONING_FLAGS.V1]: false,
  [SCHOOL_ADMIN_RBAC_FLAGS.V1]: false,
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
