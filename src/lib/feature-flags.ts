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
 * `ff_welcome_v2` — the mobile-first editorial redesign of `/welcome` is now
 * the permanent unconditional render. WelcomeV2 is always returned from
 * src/app/welcome/page.tsx; WelcomeV1 and the flag-routing logic have been
 * removed (2026-06-10). This flag constant is kept for reference / DB hygiene
 * but is no longer evaluated at runtime.
 *
 * Seeded by migration 20260426150000_add_ff_welcome_v2.sql.
 */
export const WELCOME_FLAGS = {
  /** Mobile-first editorial redesign of /welcome. Permanently ON — no longer
   *  evaluated at runtime (WelcomeV2 is the unconditional default). */
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
 *    Server-only gate (read via isFeatureEnabled in school-admin-auth). Seeded
 *    OFF (is_enabled=false, rollout=0) by migration
 *    20260611000100_seed_ff_school_admin_rbac_flag.sql so the row is auditable
 *    and flippable from the super-admin console; role-narrowing stays OFF until
 *    an operator explicitly enables the flag (production enablement held pending
 *    comms).
 *
 *  Spec/plan: docs/superpowers/plans/2026-06-08-phase-3b-school-professional-depth.md (Wave C)
 */
export const SCHOOL_ADMIN_RBAC_FLAGS = {
  /** Role-aware school-admin capability (enforce the role→permission matrix). Default off. */
  V1: 'ff_school_admin_rbac',
} as const;

/**
 * Phase 3B — Wave D (School-wide academic reporting DEPTH) flag (2026-06-08).
 *
 *  ff_school_reports_depth — master switch for the read-only school-wide academic
 *    REPORTING surfaces (board/parent-ready mastery + Bloom's reports + export).
 *    Gates BOTH the UI and the three NEW read routes together:
 *      1. GET /api/school-admin/reports/mastery  (get_school_mastery_rollup)
 *      2. GET /api/school-admin/reports/bloom     (get_school_bloom_summary)
 *      3. GET /api/school-admin/reports/export    (export_school_report; json|csv)
 *    These are NEW endpoints — no route exists at these subpaths today. When OFF,
 *    all three return 404 BEFORE auth (behave as not-present) so the flag-OFF
 *    portal is byte-identical to today. When ON, they authorize via
 *    authorizeSchoolAdmin(institution.view_analytics) — a stable, already-granted
 *    read code so the routes work regardless of the independent
 *    ff_school_admin_rbac flag — call the SECURITY DEFINER read models through the
 *    user-context client (so auth.uid() resolves), and return PII-safe aggregates.
 *    Default: false.
 *
 *    Read server-side via isFeatureEnabled. While absent from `feature_flags` the
 *    server read path resolves it to OFF, so the routes stay 404 (byte-identical)
 *    until the flag is explicitly seeded + enabled.
 *
 *  Spec/plan: docs/superpowers/plans/2026-06-08-phase-3b-school-professional-depth.md (Wave D)
 */
export const SCHOOL_REPORTS_DEPTH_FLAGS = {
  /** Read-only school-wide academic reporting depth (mastery + Bloom's + export). Default off. */
  V1: 'ff_school_reports_depth',
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

/**
 * Education Intelligence Cloud (EIC) flag (2026-06-16).
 *
 *  ff_education_intelligence
 *    Master switch for the super-admin "Education Intelligence" dashboards
 *    (Overview, Schools, Revenue, Geography + per-school drilldown). Gates
 *    BOTH the sidebar nav group and the page render. When OFF, the nav group
 *    is hidden and the pages render a not-found surface; the read API
 *    (/api/super-admin/intelligence/*) stays behind super-admin auth
 *    regardless. Default: false. Read client-side via the existing client
 *    flag read path (getFeatureFlags).
 *
 *    The dashboards consume the EIC rollup tables (mrr_snapshots,
 *    school_health_daily, school_churn_signals, school_mrr_daily,
 *    geographic_metrics). Those tables degrade to empty (HTTP 200) until the
 *    EIC migrations are applied + the nightly rollup job runs, so the pages
 *    render NoDataState until data lands.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` the
 *    client read path resolves it to OFF, so the nav group stays hidden and
 *    the pages stay not-found.
 */
export const EDUCATION_INTELLIGENCE_FLAGS = {
  /** Super-admin Education Intelligence Cloud dashboards. Default off. */
  V1: 'ff_education_intelligence',
} as const;

/**
 * Track 2 — Principal AI Assistant flag (2026-06-16).
 *
 *  ff_principal_ai_v1 — master switch for the school-scoped natural-language
 *    assistant for school leadership (POST /api/school-admin/ai-assistant chat +
 *    GET history). Principal-only capability ('institution.use_principal_ai',
 *    CEO-approved 2026-06-11). When OFF, the POST/GET routes return 404 (behave
 *    as not-present) BEFORE doing any work — byte-identical to the flag-absent
 *    portal — so neither the assistant nor its persistence tables are exercised.
 *    The backing migration (20260616010000_principal_ai_assistant_v1.sql) is
 *    DRAFTED-not-applied; the route degrades gracefully to a clean abstain when
 *    the context RPC / tables are missing, so flipping the flag ON before the
 *    migration applies never 500s.
 *    Default: false.
 */
export const PRINCIPAL_AI_FLAGS = {
  /** Principal AI Assistant v1 (school-scoped leadership assistant). Default off. */
  V1: 'ff_principal_ai_v1',
} as const;

/**
 * Foxy AI Tutor mobile redesign flags (2026-06-11).
 *
 *  ff_foxy_os_v1
 *    Master switch for the "Foxy OS" mobile-first redesign of the /foxy AI
 *    tutor workspace (compact top bar + Study bottom sheet on phones, <lg
 *    only). PRESENTATION-LAYER only over the unchanged Foxy engines — it
 *    re-presents the existing modes/subjects/chapters without touching the
 *    structured-render envelope, /api/foxy, scope-lock, or daily limits
 *    (P12/REG-55 untouched). When OFF, /foxy is BYTE-IDENTICAL to today on
 *    every viewport; when ON, only the <lg surface changes (>=lg unchanged).
 *    Default: false. Read client-side via use-foxy-os-flag.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and the surface stays byte-identical-OFF).
 */
export const FOXY_OS_FLAGS = {
  /** Foxy OS mobile redesign (compact top bar + Study sheet, <lg only). Default off. */
  V1: 'ff_foxy_os_v1',
} as const;

/**
 * School Pulse panel flag (2026-06-12, CEO-approved F3).
 *
 *  ff_school_pulse_v1 — master switch for the School Pulse panel on the
 *    school-admin Command Center (Slice B monitoring). When OFF, the Command
 *    Center renders byte-identically to today — the Pulse panel does not mount
 *    and no Pulse data paths are exercised. When ON, the panel renders inside
 *    the (independently gated) ff_school_command_center surface; both flags
 *    must resolve ON for the panel to be visible. Frontend wires the gate
 *    against this exact flag name (CommandCenter.tsx — owned by frontend).
 *    Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000100_seed_ff_school_pulse_v1.sql — mirrors the
 *    ff_school_admin_rbac seed precedent — so the row is auditable and
 *    flippable from the super-admin console. The server/client read paths
 *    (isFeatureEnabled) return false for both is_enabled=false AND
 *    rollout_percentage<=0, so the panel stays OFF until an operator
 *    explicitly enables the flag.
 */
export const SCHOOL_PULSE_FLAGS = {
  /** School Pulse panel (school-admin command center, Slice B monitoring). Default off. */
  V1: 'ff_school_pulse_v1',
} as const;

/**
 * Phase A Loop A adaptive remediation flag (2026-06-12, CEO-approved TIERED
 * authority model 3).
 *
 *  ff_adaptive_remediation_v1 — master switch for the adaptive closed loop
 *    (mastery-cliff -> auto-inject targeted remediation -> verify recovery ->
 *    escalate on failure). When OFF, no new interventions are injected and the
 *    /api/rhythm/today remediation lane renders empty; the verify cron step is
 *    deliberately gated on the existence of active rows, NOT this flag, so
 *    mid-flight interventions drain to terminal state (kill switch drains,
 *    does not freeze — spec Section 9). Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000300_seed_ff_adaptive_remediation_v1.sql — mirrors the
 *    ff_school_pulse_v1 seed precedent. Data layer: adaptive_interventions
 *    (20260619000200). Spec:
 *    docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md
 */
export const ADAPTIVE_REMEDIATION_FLAGS = {
  /** Phase A Loop A adaptive closed loop (cliff -> inject -> verify -> escalate). Default off. */
  V1: 'ff_adaptive_remediation_v1',
} as const;

/**
 * Phase A Loops B & C adaptive closed loops (2026-06-13). ONE flag for BOTH
 * loops on the Loop A substrate (NOT a reuse of ff_adaptive_remediation_v1 —
 * spec Decision X1; the two ramp independently).
 *
 *  ff_adaptive_loops_bc_v1 — master switch for the inactivity (Loop B) and
 *    at-risk-concentration (Loop C) inject branches of the daily-cron adaptive
 *    worker. When OFF, no new B/C interventions are opened (the inactivity +
 *    at_risk_concentration inject branches short-circuit; the mastery_cliff
 *    branch still respects its own ff_adaptive_remediation_v1 flag — per-signal
 *    inject gating, Decision X2); when ON, Loop B opens a re-engagement nudge on
 *    a 'broken' inactivity verdict and Loop C opens an IMMEDIATE teacher/parent
 *    escalation on a 'high'-band subject. The verify phase is deliberately gated
 *    on the existence of active rows, NOT this flag, so mid-flight B/C
 *    interventions drain to terminal state (kill switch drains, does not freeze —
 *    spec Section 9). Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000600_seed_ff_adaptive_loops_bc_v1.sql — mirrors the
 *    ff_adaptive_remediation_v1 seed precedent. Substrate: adaptive_interventions
 *    (20260619000200) with the CHECK extension (20260619000500). Spec:
 *    docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md
 */
export const ADAPTIVE_LOOPS_BC_FLAGS = {
  /** Phase A Loops B (inactivity nudge) & C (concentration escalation). Default off. */
  V1: 'ff_adaptive_loops_bc_v1',
} as const;

/**
 * Foxy Post-Answer Learning Actions flag (2026-06-14, Phase 1).
 *
 *  ff_foxy_learning_actions_v1 — master switch for the redesigned Foxy
 *    post-answer action bar. When OFF, the ChatBubble renders BYTE-IDENTICALLY
 *    to today (the legacy QA-tester bar: thumbs + dual report + vague "Save").
 *    When ON, the action bar renders the learning-action row (Got it / Explain
 *    simpler / Show example / Quiz me on this) + a single-path overflow menu
 *    (Save to notebook / Read aloud / Report an issue). Got it -> is_up=true and
 *    Explain simpler -> is_up=false reuse the existing record_message_feedback
 *    RPC; Save to notebook reuses student_bookmarks; a new learner.learning_action
 *    event (IDs + enums only) is published. Self-reports do NOT mutate BKT
 *    mastery_mean (P2); only real "Quiz me" answers feed mastery via the existing
 *    concept-check path. This is the FRONT-BAR redesign gate ONLY — the four
 *    continuity/memory flags (ff_foxy_session_reactivate_v1,
 *    ff_foxy_pending_expectations_v1, ff_foxy_long_memory_v1,
 *    ff_foxy_context_rich_v1) ramp INDEPENDENTLY in Phase 2 and are NOT gated by
 *    this flag. Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000700_seed_ff_foxy_learning_actions_v1.sql — mirrors the
 *    ff_adaptive_loops_bc_v1 seed precedent (defensive to_regclass guard +
 *    explicit column list + ON CONFLICT (flag_name) DO NOTHING; REG-125). No new
 *    table — event-first, reuses foxy_message_feedback + student_bookmarks.
 *    Spec/plan: Foxy AI Tutor — The Moat (Round 1: Post-Answer Learning Actions
 *    + Living Memory), Phase 1.
 */
export const FOXY_LEARNING_ACTIONS_FLAGS = {
  /** Foxy post-answer learning-action bar redesign (Phase 1). Default off. */
  V1: 'ff_foxy_learning_actions_v1',
} as const;

/**
 * Foxy 3-Agent Math Correctness Pipeline flag (2026-06-14, Part 1F).
 *
 *  ff_foxy_math_pipeline_v1 — master switch for the dedicated math-solve path
 *    inside the EXISTING /api/foxy flow. When ON, a detected math-solve query is
 *    routed through the 3-agent pipeline:
 *      (1) Classifier (Haiku, no thinking — topic/chapter/grade/difficulty),
 *      (2) Solver (Haiku 4.5 + Extended Thinking, cached per-chapter NCERT
 *          system prompt, NO RAG, emits structured step/math/answer blocks),
 *      (3) Verifier (SymPy in the Python AI service, no LLM, fail-closed).
 *    On a verifier mismatch the pipeline escalates ONCE to Sonnet+thinking; if
 *    still wrong/unavailable the confident answer is replaced with
 *    show-the-working + a "Check manually" badge (P12 — never serve a
 *    confidently wrong answer). Non-math Foxy keeps the RAG grounded-answer path
 *    UNCHANGED. When OFF, /api/foxy renders BYTE-IDENTICALLY to today: no math
 *    classifier/solver/verifier runs, the solve-math module + /v1/math/verify
 *    Python endpoint are never reached, and no Verified/Check badge is shown.
 *    Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000800_seed_ff_foxy_math_pipeline_v1.sql — mirrors the
 *    ff_foxy_learning_actions_v1 seed precedent (defensive to_regclass guard +
 *    explicit column list + ON CONFLICT (flag_name) DO NOTHING; REG-125). No new
 *    table. This is the math-pipeline gate ONLY; Part-2 topic progression and
 *    the foxy_pending_expectations `next_topic` CHECK widening (migration
 *    20260619000900) ramp INDEPENDENTLY and are NOT gated by this flag.
 *    Plan: Foxy Math Correctness (3-Agent Pipeline) + Topic-Progression Fixes,
 *    Part 1F.
 */
export const FOXY_MATH_PIPELINE_FLAGS = {
  /** Foxy 3-agent math correctness pipeline (Classifier -> Solver -> SymPy verifier). Default off. */
  V1: 'ff_foxy_math_pipeline_v1',
} as const;

/**
 * Foxy Curriculum Guard — deterministic (no-LLM) curriculum-authenticity gate on
 * the EXISTING /api/foxy STEM path. Two purely-mechanical tiers run when ON:
 *   (T1) Enrolled-grade authenticity — the student's enrolled grade is the only
 *        authority for in-bounds curriculum scope; nothing is inferred from the
 *        query text or model output.
 *   (T4a) Out-of-grade math lexicon — a static lexicon classifies a math query
 *        against the enrolled grade's CBSE band.
 * It HARD-BLOCKS out-of-grade math on ALL STEM Foxy queries and redirects the
 * learner to their current chapter/topic, surfaced with the Outside-Current-
 * Chapter badge in the existing FoxyStructuredRenderer. Decision A (in-grade,
 * DIFFERENT-chapter) stays SOFT (gentle nudge, not a hard block). Decoupled from
 * FOXY_MATH_PIPELINE_FLAGS (the two ramp INDEPENDENTLY; neither gates the other).
 * ENV override FF_FOXY_CURRICULUM_GUARD_V1 is resolved via isCurriculumGuardEnabled
 * in src/lib/foxy/math-flag.ts (backend-owned). OFF = /api/foxy byte-identical to
 * today (no tier runs, no lexicon, no redirect/badge). Default off.
 * Seeded OFF by migration 20260619001000_seed_ff_foxy_curriculum_guard_v1.sql.
 */
export const FOXY_CURRICULUM_GUARD_FLAGS = {
  /** Foxy deterministic curriculum guard (T1 enrolled-grade + T4a out-of-grade math lexicon). Default off. */
  V1: 'ff_foxy_curriculum_guard_v1',
} as const;

/**
 * Post-submit quiz telemetry flag (2026-06-15, SPEC-1..5).
 *
 *  ff_quiz_telemetry_v1 — master switch for the best-effort post-submit learning
 *    telemetry on the server-authoritative quiz submit path (/api/v2/quiz/submit
 *    via the shared submit-side-effects seam). When ON, after a FRESH grade the
 *    route emits per-answer learning_events (SPEC-1), mastery-achieved
 *    learning_events (SPEC-2, 0.8 pre/post threshold), and (when a reliable
 *    node_code↔topic mapping exists — see OQ-5) consecutive-wrong
 *    intervention_alerts (SPEC-3). All telemetry is fire-and-forget and never
 *    blocks/breaks the submit response; idempotent replays + errors emit nothing
 *    (SPEC-5). When OFF/unseeded, the route captures no pre-snapshot and the
 *    telemetry step is a complete no-op (submit path byte-identical to today).
 *    Default: false.
 *
 *    Seeded OFF in a follow-up migration; ships gated (isFeatureEnabled returns
 *    false for the unseeded flag until then).
 */
export const QUIZ_TELEMETRY_FLAGS = {
  /** Post-submit learning telemetry (per-answer + mastery + intervention). Default off. */
  V1: 'ff_quiz_telemetry_v1',
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
  [SCHOOL_ADMIN_RBAC_FLAGS.V1]: false, // seeded OFF by 20260611000100_seed_ff_school_admin_rbac_flag.sql
  [SCHOOL_REPORTS_DEPTH_FLAGS.V1]: false,
  [STUDENT_OS_FLAGS.V1]: false,
  [SUBJECTS_OS_FLAGS.V1]: false,
  [REVISION_OS_FLAGS.V1]: false,
  [PRACTICE_OS_FLAGS.V1]: false,
  [TEST_OS_FLAGS.V1]: false,
  [EDUCATION_INTELLIGENCE_FLAGS.V1]: false,
  [PRINCIPAL_AI_FLAGS.V1]: false,
  [FOXY_OS_FLAGS.V1]: false,
  [SCHOOL_PULSE_FLAGS.V1]: false, // seeded OFF by 20260619000100_seed_ff_school_pulse_v1.sql
  [ADAPTIVE_REMEDIATION_FLAGS.V1]: false, // seeded OFF by 20260619000300_seed_ff_adaptive_remediation_v1.sql
  [ADAPTIVE_LOOPS_BC_FLAGS.V1]: false, // seeded OFF by 20260619000600_seed_ff_adaptive_loops_bc_v1.sql
  [FOXY_LEARNING_ACTIONS_FLAGS.V1]: false, // seeded OFF by 20260619000700_seed_ff_foxy_learning_actions_v1.sql
  [FOXY_MATH_PIPELINE_FLAGS.V1]: false, // seeded OFF by 20260619000800_seed_ff_foxy_math_pipeline_v1.sql
  [FOXY_CURRICULUM_GUARD_FLAGS.V1]: false, // seeded OFF by 20260619001000_seed_ff_foxy_curriculum_guard_v1.sql
  [QUIZ_TELEMETRY_FLAGS.V1]: false, // seeded OFF in a follow-up migration (SPEC-1..5)
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
