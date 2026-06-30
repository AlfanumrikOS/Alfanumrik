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
 *    NOTE (2026-06-16): the flag is globally ON in prod, so the client-side
 *    legacy dispatch has been REMOVED. `/school-admin` always renders the Command
 *    Center and SchoolAdminShell always renders the consolidated nav. The legacy
 *    Atlas body is retained, un-wired, at
 *    src/app/school-admin/_deprecated_AtlasSchoolAdmin.tsx. The flag constant
 *    remains for the seed/read-path contract and any server-side gating. The
 *    historical OFF behaviour described below is no longer reachable from the UI.
 *
 *    (Historical) When OFF, BOTH surfaces were byte-identical to the prior
 *    dashboard: `/school-admin` rendered the existing dashboard (or the Atlas
 *    body when the Atlas flag was on) and SchoolAdminShell showed the flat nav.
 *    Default: false. Read client-side via getFeatureFlags.
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
 * Phase 3C — White-label activation flags (2026-06-09).
 *
 * These four flags gate the multi-tenant ("white-label") substrate that already
 * exists in the codebase but is dormant. All four were seeded in PRODUCTION by
 * the pre-baseline `_legacy/` migrations (20260507000004-7) but were NEVER
 * registered here in FLAG_DEFAULTS, so prod (which has the DB rows) and a fresh
 * CI/staging/Preview env (no row, no default) were inconsistent. This registry +
 * the companion seed migration (20260615000000_phase3c_seed_white_label_flags.sql)
 * close that gap: every env now resolves these flags identically — OFF.
 *
 *  ff_tenant_type_v1
 *    Gates the per-tenant `tenant_type` discriminator (b2c | school | white_label).
 *    Default: false. Foundation flag — read by tenant-resolution code paths.
 *
 *  ff_tenant_module_registry_v1
 *    Gates the per-tenant module registry. Read by
 *    src/lib/modules/registry.ts (isModuleEnabled / enabledModulesFor). When OFF
 *    (the default), the resolver SHORT-CIRCUITS to all-modules-enabled, so a
 *    fresh env with no DB row behaves exactly like B2C today. Default: false.
 *
 *  ff_tenant_config_v2
 *    Gates per-tenant config overrides (AI persona / locale / branding). Read by
 *    src/lib/tenant-config/index.ts (getTenantConfig / getAllTenantConfig). When
 *    OFF (the default), the resolver returns the registry DEFAULT for the tenant
 *    type and ignores any DB rows, so a fresh env is identical to today.
 *    Storage table tenant_configs created by legacy migration 20260507000006.
 *    Default: false.
 *
 *  ff_event_bus_v1
 *    Gates the cross-module domain event bus. Registered here for CORRECTNESS /
 *    env-parity ONLY — it is NOT activated this phase and has no consuming
 *    surface wired in Wave A. Default: false.
 *
 * All four default OFF. Seeded by migration
 * 20260615000000_phase3c_seed_white_label_flags.sql.
 * Spec/plan: docs/superpowers/{specs,plans}/2026-06-09-phase-3c-white-label-activation*
 */
export const WHITE_LABEL_FLAGS = {
  TENANT_TYPE_V1:            'ff_tenant_type_v1',
  TENANT_MODULE_REGISTRY_V1: 'ff_tenant_module_registry_v1',
  TENANT_CONFIG_V2:         'ff_tenant_config_v2',
  EVENT_BUS_V1:             'ff_event_bus_v1',
} as const;
