# Ops Discovery — Feature Flags, Admin Surfaces, Monitoring, Notifications, Docs

Read-only inventory. Date: 2026-07-02. Scope: `src/lib/feature-flags.ts` + `src/lib/flags/`, `supabase/migrations/`, `src/app/super-admin/`, `src/app/api/super-admin/`, `src/app/internal/admin/`, `src/app/api/internal/`, `src/app/school-admin/`, `src/app/api/school-admin/`, `src/app/api/v1/admin/`, monitoring/observability files, notification producers, `docs/`.

---

## 1. Feature Flag Registry

### 1.1 Evaluation engine
`src/lib/feature-flags.ts` is the evaluation engine (kept monolithic deliberately — cache singleton + vitest coverage threshold keyed on this file). Precedence: flag exists AND `is_enabled` → environment scope → role scope → institution scope → rollout %. Cache TTL 5 min (`CACHE_TTL.STATIC`), invalidated via `invalidateFlagCache()`. Rollout is deterministic per-user hash (`hashForRollout`). Malformed/non-array Supabase response coerces to `[]` (fail-closed to OFF for every flag).

The 36 named registry consts (barrel re-export) live in `src/lib/flags/registries/{payment,platform,pedagogy,consumer,teacher,school,foxy}.ts`, with `src/lib/flags/defaults.ts` as the `FLAG_DEFAULTS` documentation-of-truth map. Actual flag **string** count across all registries: **57** (see table below) — more than the "36" in the barrel comment, because several registry consts hold >1 flag string (e.g. `GOAL_ADAPTIVE_FLAGS` = 6 strings, `EDITORIAL_ATLAS_FLAGS` = 5 strings). The "36" refers to registry export names, not flag strings.

### 1.2 Complete flag table (registries barrel — the typed/known set)

| Flag name | Registry const | Default (FLAG_DEFAULTS) | Gates | Seed migration |
|---|---|---|---|---|
| `reconcile_stuck_subscriptions_enabled` | `PAYMENT_FLAGS.RECONCILE_STUCK_SUBSCRIPTIONS_ENABLED` | not in defaults map (implicit false) | `reconcile_stuck_subscriptions` action in payments Edge Fn | `20260414120000_payment_subscribe_atomic_fix.sql` (legacy) |
| `ff_gst_invoicing_v1` | `PAYMENT_FLAGS.GST_INVOICING_V1` | false | Per-state GST on B2C payment paths + B2B invoice generator | `20260507130003_add_ff_gst_invoicing_v1.sql` |
| `maintenance_banner` | `MAINTENANCE_FLAGS.MAINTENANCE_BANNER` | not in defaults map | Dismissible maintenance banner (all portals) | not tracked in list found (DB-only toggle) |
| `ff_welcome_v2` | `WELCOME_FLAGS.WELCOME_V2` | false (documented) | **Retired 2026-06-10** — WelcomeV2 is now unconditional; flag kept for DB hygiene only, no longer evaluated | `20260426150000_add_ff_welcome_v2.sql` |
| `ff_realtime_subscriptions_v1` | `REALTIME_FLAGS.SUBSCRIPTIONS_V1` | false | Supabase Realtime subscriptions (teacher heatmap, poll results, parent child-progress) | `20260527000002_add_ff_realtime_subscriptions_v1.sql` |
| `ff_cosmic_redesign_v1` | `COSMIC_REDESIGN_FLAGS.V1` | false | Cosmic dark-theme visual identity (Phase 0) | `20260611000000_seed_ff_cosmic_redesign_v1.sql` |
| `ff_goal_profiles` | `GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES` | false | Super-admin Goal Profile Preview page | `20260503120000_add_ff_goal_adaptive_layers.sql` |
| `ff_goal_aware_foxy` | `GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY` | **true** (enabled `20260621000001_enable_core_student_flags.sql`) | Foxy system-prompt persona + QuizResults goal sentence | same |
| `ff_goal_aware_selection` | `GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION` | **true** (enabled `20260621000001`) | Quiz-generate uses `pickQuizParams`/`get_adaptive_questions_v2`; goal-specific mastery thresholds | `20260503140000_add_phase2_goal_aware_selection.sql` |
| `ff_goal_daily_plan` | `GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN` | false | Phase 3 daily plan | `20260503160000_add_ff_goal_daily_plan.sql` |
| `ff_goal_aware_rag` | `GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_RAG` | false | Phase 4 goal-aware RAG | `20260503180000_add_ff_goal_aware_rag.sql` |
| `ff_goal_daily_plan_reminder` | `GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN_REMINDER` | false | Phase 5 reminder | `20260503210000_add_ff_goal_daily_plan_reminder.sql` |
| `ff_productive_failure_v1` | `PEDAGOGY_V2_FLAGS.PRODUCTIVE_FAILURE_V1` | false | ZPD-problem-before-tutorial on `/learn/[subject]/[chapter]` | `20260509120000_pedagogy_v2_wave_1_flags.sql` |
| `ff_distractor_micro_explainer_v1` | `PEDAGOGY_V2_FLAGS.DISTRACTOR_MICRO_EXPLAINER_V1` | **true** (enabled `20260621000001`) | Wrong-MCQ remediation + "Ask Foxy" CTA | same |
| `ff_pedagogy_v2_daily_rhythm` | `PEDAGOGY_V2_FLAGS.DAILY_RHYTHM` | **true** (enabled `20260620001700_enable_pedagogy_v2_daily_rhythm_global.sql`) | `<DailyRhythmQueue/>` + `/api/rhythm/today` | `20260509120000_...` |
| `ff_pedagogy_v2_weekly_dive` | `PEDAGOGY_V2_FLAGS.WEEKLY_DIVE` | false | `/dive` surface + `/api/dive/*` | `20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql` |
| `ff_pedagogy_v2_monthly_synthesis` | `PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS` | false | `/synthesis` surface + `/api/synthesis/*` + daily-cron trigger | `20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql` |
| `ff_adaptive_remediation_v1` | `ADAPTIVE_REMEDIATION_FLAGS.V1` | false | Phase A Loop A closed loop (mastery-cliff → inject → verify → escalate) | `20260619000300_seed_ff_adaptive_remediation_v1.sql` |
| `ff_adaptive_loops_bc_v1` | `ADAPTIVE_LOOPS_BC_FLAGS.V1` | false | Phase A Loops B (inactivity) & C (at-risk concentration) inject branches | `20260619000600_seed_ff_adaptive_loops_bc_v1.sql` |
| `ff_adaptive_live_selection_v1` | `ADAPTIVE_LIVE_SELECTION_FLAGS.V1` | false | Weak-topic candidate provider ahead of quiz selection ladder | `20260622090000_seed_ff_adaptive_live_selection_v1.sql` |
| `ff_digital_twin_v1` | `DIGITAL_TWIN_FLAGS.V1` | false | Digital Twin / Knowledge Graph Slice 1 (concept_edges, twin snapshots) | `20260702000700_seed_ff_digital_twin_v1.sql` |
| `ff_quiz_telemetry_v1` | `QUIZ_TELEMETRY_FLAGS.V1` | false | Post-submit learning telemetry events | `20260615153409_seed_ff_quiz_telemetry_v1.sql` |
| `ff_editorial_atlas_v1` | `EDITORIAL_ATLAS_FLAGS.MASTER` | false | Multi-role Editorial Atlas redesign master | `20260511180000_add_ff_editorial_atlas.sql` (+ earlier `20260511144221`) |
| `ff_editorial_atlas_student/parent/teacher/school` | `EDITORIAL_ATLAS_FLAGS.{STUDENT,PARENT,TEACHER,SCHOOL}` | false | Per-role Atlas canaries | same |
| `ff_study_menu_v2` | `STUDY_MENU_FLAGS.V2` | **removed** — `20260603120100_remove_ff_study_menu_v2.sql` | Sidebar Study consolidation (REG-69) | `20260520120000_study_menu_v2_flag.sql` then removed |
| `ff_today_home_v1` | `CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1` | **true** (enabled `20260621000001`) | Adaptive Today home + 4-tab nav | `20260612000000_seed_phase1_consumer_minimalism_flags.sql` |
| `ff_unified_quiz_v1` | `CONSUMER_MINIMALISM_FLAGS.UNIFIED_QUIZ_V1` | false | Wave B, not yet built | same |
| `ff_parent_glance_v1` | `CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1` | false | Wave C, not yet built | same |
| `ff_parent_unified_auth_v1` | `CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1` | false | Wave D, not yet built | same |
| `ff_parent_encourage_v1` | `CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1` | false | Parent "Encourage" cheer button | `20260613000002_ff_parent_encourage_v1.sql` |
| `ff_student_os_v1` | `STUDENT_OS_FLAGS.V1` | false | "Alfa OS" dashboard + Foxy 3-pane workspace redesign | not yet seeded (per code comment) |
| `ff_subjects_os_v1` | `SUBJECTS_OS_FLAGS.V1` | false | Alfa OS Subjects hub in `/learn` | not yet seeded |
| `ff_revision_os_v1` | `REVISION_OS_FLAGS.V1` | false | Alfa OS Revision Center at `/revision` | not yet seeded |
| `ff_practice_os_v1` | `PRACTICE_OS_FLAGS.V1` | false | Alfa OS Practice Center at `/practice` | not yet seeded |
| `ff_test_os_v1` | `TEST_OS_FLAGS.V1` | false | Alfa OS pre-test briefing hub at `/exam-briefing` | not yet seeded |
| `ff_teacher_command_center` | `TEACHER_COMMAND_CENTER_FLAGS.V1` | false | Dense teacher home + 5-item nav | not yet seeded |
| `ff_teacher_assignment_lifecycle` | `TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS.V1` | false | Grading queue inside Command Center | `20260623010000_seed_unseeded_b2b_flags.sql` |
| `ff_teacher_gradebook_depth` | `TEACHER_GRADEBOOK_DEPTH_FLAGS.V1` | false | Mastery/Bloom's drill-through + class summary + export | `20260623010000_seed_unseeded_b2b_flags.sql` |
| `ff_teacher_parent_comms` | `TEACHER_PARENT_COMMS_FLAGS.V1` | false | "Tell the parent" affordance | `20260623010000_seed_unseeded_b2b_flags.sql` |
| `ff_school_command_center` | `SCHOOL_COMMAND_CENTER_FLAGS.V1` | false (doc says default off, **comment notes globally ON in prod as of 2026-06-16, legacy dispatch removed client-side**) | School-admin Command Center + consolidated nav | not yet seeded via migration list found (manually flipped in prod per code comment) |
| `ff_school_provisioning` | `SCHOOL_PROVISIONING_FLAGS.V1` | false | Seat-enforcement RPCs on provisioning routes | `20260623010000_seed_unseeded_b2b_flags.sql` |
| `ff_school_admin_rbac` | `SCHOOL_ADMIN_RBAC_FLAGS.V1` | false | Role→permission matrix for school-admin roles | `20260611000100_seed_ff_school_admin_rbac_flag.sql` |
| `ff_school_reports_depth` | `SCHOOL_REPORTS_DEPTH_FLAGS.V1` | false | School-wide mastery/Bloom's reporting + export | not yet seeded |
| `ff_education_intelligence` | `EDUCATION_INTELLIGENCE_FLAGS.V1` | false | Super-admin Education Intelligence Cloud dashboards | `20260623010000_seed_unseeded_b2b_flags.sql` |
| `ff_principal_ai_v1` | `PRINCIPAL_AI_FLAGS.V1` | false | Principal AI Assistant (school-scoped) | `20260623010000_seed_unseeded_b2b_flags.sql` (migration for backing tables DRAFTED-not-applied per comment) |
| `ff_school_pulse_v1` | `SCHOOL_PULSE_FLAGS.V1` | false | School Pulse panel on Command Center | `20260619000100_seed_ff_school_pulse_v1.sql` |
| `ff_tenant_type_v1` | `WHITE_LABEL_FLAGS.TENANT_TYPE_V1` | false | Per-tenant `tenant_type` discriminator | `20260615000000_phase3c_seed_white_label_flags.sql` |
| `ff_tenant_module_registry_v1` | `WHITE_LABEL_FLAGS.TENANT_MODULE_REGISTRY_V1` | false | Per-tenant module registry | same |
| `ff_tenant_config_v2` | `WHITE_LABEL_FLAGS.TENANT_CONFIG_V2` | false | Per-tenant config overrides (persona/locale/branding) | same |
| `ff_event_bus_v1` | `WHITE_LABEL_FLAGS.EVENT_BUS_V1` | false | Cross-module domain event bus (not yet activated) | same |
| `ff_foxy_os_v1` | `FOXY_OS_FLAGS.V1` | false | Foxy OS mobile redesign (<lg viewports) | not yet seeded |
| `ff_foxy_learning_actions_v1` | `FOXY_LEARNING_ACTIONS_FLAGS.V1` | false | Foxy post-answer learning-action bar | `20260619000700_seed_ff_foxy_learning_actions_v1.sql` |
| `ff_foxy_math_pipeline_v1` | `FOXY_MATH_PIPELINE_FLAGS.V1` | false | 3-agent math pipeline (Classifier→Solver→SymPy verifier) | `20260619000800_seed_ff_foxy_math_pipeline_v1.sql` |
| `ff_foxy_curriculum_guard_v1` | `FOXY_CURRICULUM_GUARD_FLAGS.V1` | false | Deterministic curriculum-authenticity gate (T1+T4a) | `20260619001000_seed_ff_foxy_curriculum_guard_v1.sql` |

### 1.3 Flags seeded/referenced in code but NOT in the typed registry barrel (drift candidates)

Grep of `src/` for legacy/ad-hoc flag-name string literals found these referenced outside `src/lib/flags/`, each with its own seed migration but no registry const:

| Flag name (string literal) | Non-test files referencing | Seed migration | Note |
|---|---|---|---|
| `ff_quiz_oracle` (see `20260429020000_quiz_oracle_feature_flag.sql`, `20260504100000_enable_quiz_oracle_in_prod.sql`) | 0 | present | Possibly renamed/retired — enabled-in-prod migration exists but no source reference found; verify whether the oracle path now always runs unconditionally |
| `ff_rag_mmr_diversity` | 0 | `20260428120000_ff_rag_mmr_diversity.sql` | No source reference found — dead flag or renamed |
| `ff_foxy_streaming` (`20260429000000_p1_foxy_streaming_flag.sql`) | 2 | present | referenced directly by string, not via registry |
| `ff_learn_read_mode_v1` (`20260507000001_add_ff_learn_read_mode_v1.sql`) | 2 | present | string literal only |
| `ff_school_self_service_billing_v1` (`20260507000002_...`) | 3 | present | string literal only |
| `ff_chapter_reader_v2` (`20260512070302_ff_chapter_reader_v2.sql`) | 1 | present | string literal only |
| `ff_tutor_v1` (`20260512075619_ff_tutor_v1.sql`) | 6 | present | string literal only |
| `ff_tutor_bkt_v1` (`20260525100002_ff_tutor_bkt_v1.sql`) | 7 | present | string literal only |
| `ff_competition_sku` (`20260520000007_competition_sku_substrate.sql`) | 0 | present | no source reference found |
| `ff_board_score_v1` (`20260628000000_board_score_v1.sql`) | 2 | present | string literal only |
| `ff_streak_guardian_cron_v1` (`20260624120000_seed_ff_streak_guardian_cron_v1.sql`) | 1 | present | string literal only |
| `ff_grounded_ai_enabled` (`20260626120000_enable_ff_grounded_ai_enabled.sql`) | 0 | present | no source reference found — verify this migration enabled a flag that has since been hardcoded ON or removed |
| `ff_institution_entitlements_v1` (`20260615205753_...`) | 3 | present | string literal only |
| `ff_demo_accounts_v2` (`20260528000005_add_ff_demo_accounts_v2.sql`) | 0 | present | no source reference found |
| `ff_irt_question_selection` | 1 | `20260428000600_select_questions_by_irt_info.sql` (implied) | matches constitution note "off until calibration accumulates"; only 1 reference — verify it's actually wired into the quiz-selection ladder |
| `ff_offline_payment_reconciliation_v1` (`20260507140002_...`) | 3 | present | string literal only |
| `ff_school_contracts_v1` (`20260507150002_...`) | 4 | present | string literal only, gates 3 daily-cron contract-lifecycle steps |
| MoL flags (`mol_admin_functions_rollback`, `improvement_mode`, etc.) | 0 | `20260603160000_mol_admin_functions_rollback_flag.sql`, `20260405100001_improvement_mode_flag.sql` | 0 direct string hits — likely referenced under a different literal spelling (e.g. `ff_mol_...`); needs a follow-up grep with exact DB flag_name values, not assumed names |
| `ff_v1_quiz_rpc_user_agent` | 0 | `20260504100600_v1_quiz_rpc_user_agent_flag.sql` | no source reference found |
| `server_only_quiz_submit` | 1 | `20260504100300_server_only_quiz_submit_flag.sql` | string literal only |

**Finding**: the codebase has (at minimum) two parallel flag-naming conventions — the typed `src/lib/flags/registries/*` barrel (57 flags, used by newer pedagogy/consumer/teacher/school/foxy work) and a long tail of ad-hoc string-literal flags from `_legacy/` and early-2026 migrations that are read via raw `isFeatureEnabled('literal_string', ...)` calls scattered across routes, never registered in the typed barrel. This makes a single "grep the registry" audit insufficient — several flags above show 0 source hits under my search terms, which is itself a signal (possibly renamed, hardcoded-permanent, or genuinely dead) that needs a backend/architect follow-up with the literal `flag_name` values pulled directly from the `feature_flags` table, not assumed from migration filenames.

### 1.4 Flag lifecycle migrations of note
- Removed flags: `ff_revise_route_v1` (`20260603120000_remove_ff_revise_route_v1.sql`), `ff_study_menu_v2` (`20260603120100_remove_ff_study_menu_v2.sql`).
- Bulk-enable sweeps: `20260615100000_enable_production_flags_local_dev.sql`, `20260620001601_enable_latest_frontend_flags.sql`, `20260621000001_enable_core_student_flags.sql`, `20260621000800_reset_premature_autonomous_flags.sql` (rollback of an earlier bulk-enable — worth checking what it reset), `20260624100000_enable_engagement_flags_phase1.sql`.
- `20260620000400_phase3_enable_school_saas_flags.sql` — enables a set of B2B/school flags in one migration.

---

## 2. Admin Surfaces

### 2.1 Super-admin (`/super-admin`, `/api/super-admin`)
**62 page.tsx files, 119 API route.ts files** (constitution's last-reconciled count of "43 pages / 75 routes, 2026-04-27" is stale — actual surface has grown ~44% in pages and ~59% in routes since).

Grouped by function:

| Group | Pages | Key API routes |
|---|---|---|
| Users & roles | `users`, `rbac`, `oauth-apps`, `view-as/[studentId]/*` (4 impersonation views) | `users`, `roles`, `rbac`, `oauth-apps`, `students/[id]/{dashboard,foxy-history,impersonate,notes,profile,progress,quiz-history,subjects}`, `sessions`, `debug/whoami` |
| Institutions / B2B | `institutions`, `bulk-upload`, `bulk-upload/schools`, `entitlements`, `invoices`, `intelligence/{geography,revenue,schools,schools/[id]}` | `institutions/*` (8 sub-routes incl. `provision`, `bulk-onboard`, `pause`/`resume`, `verify-domain`, `attach-vercel-domain`, `billing`, `health`), `entitlements`, `invoices`, `contracts/*` (3), `intelligence/*` (5), `billing/tax-config` |
| Revenue / payments | `subscriptions`, `subscribers`, `analytics-b2b` | `payment-ops/{reconcile,stats,stuck}`, `reconciliation/*` (3), `subscribers/*` (4, incl. dead-letter retry/replay) |
| Content / CMS | `cms`, `content`, `bulk-actions`, `subjects/{grade-map,plan-access,violations}` | `cms`, `content`, `content-coverage`, `bulk-actions/*` (4), `subjects/*` (5) |
| Learning analytics / intelligence | `learning`, `analytics`, `goal-profiles`, `intelligence` (overview) | `analytics`, `analytics/posthog-summary`, `analytics-v2/*` (2), `strategic-reports/*` (2), `goal-profiles`, `seat-usage` |
| Integrity / marking authenticity | `marking-integrity`, `marking-integrity/[studentId]` | `marking-integrity/*`, `marking-path-mix` |
| AI quality / grounding / oracle | `grounding/{ai-issues,coverage,health,traces,verification-queue}`, `foxy-quality`, `oracle-health`, `mol-shadow`, `module-overrides` | `grounding/*` (5), `foxy-quality`, `oracle-health`, `ai/[fn]`, `ai/oracle-health`, `mol-shadow`, `module-overrides` |
| Misconceptions | `misconceptions` | `misconceptions` |
| Alfabot | `alfabot`, `alfabot/[sessionId]` | `alfabot/{denylist,sessions,sessions/[sessionId],stats}` |
| Ops / health / diagnostics | `diagnostics`, `health`, `observability/*` (3), `sla`, `db-performance` (route only), `readiness-rubric` | `health`, `observability/*` (8 incl. `channels`, `rules`, `events`, `export`, `snapshot`), `db-performance`, `sla`, `readiness-rubric`, `deploy`, `platform-ops`, `projectors/replay` |
| Support | `support` | `support` |
| Demo / test accounts | `demo` | `demo-accounts`, `demo-accounts/[id]/resend-credentials`, `test-accounts` |
| Feature flags | `flags` | `feature-flags` |
| Logs / audit | `logs` | `logs` |
| Alerts | `alerts` | `alerts` |
| Reports | `reports` | `reports` |
| Command center / workbench | `command-center`, `workbench` | (reuses several above) |
| Improvement / staging pipeline | (no dedicated page found) | `improvement/*` (6: `deploy`, `learning-monitors`, `learning-quality`, `qa-gate`, `route`, `staging`) |
| Login | `login` | `login` |

Note: `debug/whoami` route exists under super-admin API — flag for review (debug endpoints in production admin surface should be confirmed gated/removed or intentionally retained for support diagnosis).

### 2.2 Internal admin (`/internal/admin`, `/api/internal/admin`)
Single-page tabbed app: `src/app/internal/admin/page.tsx` + `layout.tsx`, with 10 tab components (`AIMonitorTab`, `CommandTab`, `ContentTab`, `FlagsTab`, `LogsTab`, `ReportsTab`, `RevenueTab`, `SchoolsTab`, `SupportTab`, `UsersTab`) and a `LoginScreen`. Backed by 12 API routes: `ai-monitor`, `bulk-action`, `command-center`, `content`, `feature-flags`, `logs`, `reports`, `revenue`, `schools`, `stats`, `support`, `users`, `users/[id]`. This is a **separate, lighter-weight admin surface duplicating several super-admin concerns** (feature-flags, logs, reports, revenue, schools, support, users) under a different route/auth path — a structural overlap worth flagging (see Section 6).

Also under `/api/v1/admin`: `audit-logs`, `roles` (only 2 routes — much smaller than the constitution's implied "Internal Admin" surface). And `/api/internal/agents/chapter-explorer`, `/api/internal/cron/fix-failed-questions` (cron-adjacent, not admin-panel).

### 2.3 School-admin (`/school-admin`, `/api/school-admin`)
**22 pages**: `page` (home/Command Center), `ai-assistant`, `ai-config`, `announcements`, `api-keys`, `audit-log`, `billing`, `branding`, `classes`, `content`, `enroll`, `exams`, `invite-codes`, `modules`, `parents`, `rbac`, `reports`, `reports-depth`, `setup`, `staff`, `students`, `teachers`.
**39 API routes** under `/api/school-admin/` (classes, classes/[classId], teachers, contracts, students, subscription, and others not individually enumerated here for space — see `find src/app/api/school-admin -name route.ts` for the exhaustive list).

School-admin is **not in this agent's exclusive domain ownership list** per `.claude/CLAUDE.md` (it's B2B/school territory, closer to backend+frontend+architect), but it shares the `ff_school_command_center`, `ff_school_admin_rbac`, `ff_school_provisioning`, `ff_school_reports_depth`, `ff_school_pulse_v1` flags documented above, and its command-center is fed partly by super-admin-owned intelligence tables. Included here for completeness of the "admin surface" inventory.

---

## 3. Monitoring & Observability

| Component | File(s) | Notes |
|---|---|---|
| Sentry client | `sentry.client.config.ts` | `beforeSend` delegates to `redactSentryEvent()` in `src/lib/sentry-client-redact.ts` — pinned by REG-49 (user identity/headers/URL params/body/cookies/extra/contexts/breadcrumbs/tags all redacted before leaving browser) |
| Sentry server | `sentry.server.config.ts` | present, not read in detail this pass |
| Sentry edge | `sentry.edge.config.ts` | present, not read in detail this pass |
| Sentry tunnel | configured in `next.config.js` (routes client errors through `/monitoring` to bypass ad-blockers) | per CLAUDE.md |
| Structured logger | `src/lib/logger.ts` (161 lines) | delegates redaction to `redactPII()` in `src/lib/ops-events-redactor.ts` — redacts password/token/email/phone/API keys per P13 |
| Analytics (event tracking) | `src/lib/analytics.ts` (227 lines), `src/lib/domains/analytics.ts` | event tracking layer, ops-owned per domain map |
| Vercel Analytics | referenced per CLAUDE.md; no dedicated file found beyond Next.js integration | |
| PostHog | `NEXT_PUBLIC_POSTHOG_*` consumed across 19 files incl. `super-admin/analytics/posthog-summary`, payment routes, quiz submit, learner/next, school-admin routes | PostHog is both a client analytics capture point AND a super-admin reporting source (`posthog-summary` route) |
| Health endpoints | `src/app/api/v1/health/route.ts` (shared with backend, canonical), `src/app/api/health/route.ts`, `src/app/api/super-admin/health/route.ts`, `src/app/api/super-admin/observability/route.ts`, `src/app/api/super-admin/institutions/health/route.ts`, `src/app/api/super-admin/oracle-health/route.ts`, `src/app/api/super-admin/ai/oracle-health/route.ts`, `src/app/api/super-admin/grounding/health/route.ts`, `src/app/api/cron/payments-health/route.ts` | 8 distinct health-shaped endpoints — some may be redundant/overlapping (super-admin has 2 oracle-health routes: `oracle-health` and `ai/oracle-health`) |
| CI failure alerting (REG-130) | `.github/workflows/pipeline-alert.yml` | `workflow_run`-triggered watcher; opens/dedupes/auto-closes a GitHub `pipeline-failure` issue on any watched-workflow failure on `main`; optional Slack via `PIPELINE_ALERT_SLACK_WEBHOOK`/`SYNTHETIC_MONITOR_SLACK_WEBHOOK`; zero required secrets. Built in response to a 26-day silent-red incident (2026-06-12) |
| Synthetic monitor | `.github/workflows/synthetic-monitor.yml` | present, not read in detail |
| Canary: `grounding.scoring` | referenced in `.claude/CLAUDE.md` P1 row (REG-52) as "production canary on `grounding.scoring`" | could not locate an exact source-file match under that literal string in this pass — needs ai-engineer/testing follow-up to confirm current implementation location (may have been renamed during the Foxy RAG refactors) |
| Canary: daily-cron static-source contract | `src/__tests__/api/cron/daily-cron-idempotency.test.ts` (REG-118 test surface, referenced in constitution) | pins 14 step/helper pairs + `Promise.allSettled` per-step isolation + flag-gated steps |
| Other canary/contract tests (sample, not exhaustive) | `src/__tests__/quiz-server-shuffle-integration.test.ts`, `src/__tests__/regression-quiz-authenticity-canary.test.ts`, `src/__tests__/score-formula-three-way-parity.test.ts`, `src/__tests__/sentry-pii-redaction.test.ts`, `src/__tests__/contract/auth-module-migration-canaries.test.ts`, `src/__tests__/api/super-admin/bare-name-log-canary.test.ts`, `src/__tests__/api/super-admin/plan-change-atomicity.test.ts`, `src/__tests__/api/super-admin/mol-shadow.test.ts` | 20 files match `canary` by filename/content in `src/__tests__/` |

---

## 4. Notifications / Communications

| Layer | File(s) | Notes |
|---|---|---|
| Notification domain types | `src/lib/domains/notifications.ts` | domain-level type registry |
| Notification trigger logic | `src/lib/notification-triggers.ts` (1489 lines) | large, central producer file — houses "house-shape" conventions referenced by daily-cron comments |
| Event registry (kinds) | `src/lib/state/events/registry.ts` (887 lines, ~48 top-level string literal kinds counted via grep, exact count needs a precise parse — approximate) | includes the 6 Loops-B/C event kinds (`system.engagement_{nudged,returned,escalated}`, `system.concentration_{escalated,resolved,reescalated}`) referenced in the constitution |
| Event publish helper | `src/lib/state/events/publish.ts` | |
| In-app notifications page | `src/app/notifications/page.tsx` | modified in current working tree (per git status) |
| Email delivery | Edge Functions: `send-auth-email`, `send-welcome-email`, `send-transactional-email` | `send-auth-email` MUST return HTTP 200 on all paths per P15 |
| WhatsApp delivery | Edge Function: `whatsapp-notify` | used by monthly-synthesis parent-share and other B2B/parent flows |
| Alert delivery (ops-facing) | Edge Function: `alert-deliverer` | feeds the super-admin `observability/channels` + `alerts` surfaces |
| Daily-cron notification-adjacent steps | `supabase/functions/daily-cron/index.ts` — `triggerMonthlySynthesis`, `triggerAdaptiveRemediation`, `triggerBuildTwinSnapshots`, `triggerWebhookDispatcher`, contract-lifecycle steps (gated `ff_school_contracts_v1`), model-retrain queue insert | each step isolated via `Promise.allSettled`; fail-closed `CRON_SECRET` auth before I/O (REG-127/REG-118) |
| Outbound webhooks (B2B) | Track A.6 `triggerWebhookDispatcher` step + `20260621000660_track_a6_public_api_webhooks_marketplace.sql` | signing/SSRF/retry/DLQ lives in the dispatcher itself, not the cron |

---

## 5. Docs & Runbooks Inventory

### 5.1 Root `docs/` files (top-level, non-exhaustive subfolders noted separately)
`ADMIN_OPERATIONS.md`, `api-catalog.md`, `api-reference-school.md`, `api-surface.md`, `BACKUP_RESTORE.md`, `CMS_SCALABILITY.md`, `COMMAND_CENTER_AGENT_ROLES.md`, `COMMAND_CENTER_OPERATIONS.md`, `COMMAND_CENTER_RUNBOOK.md`, `data-access-patterns.md`, `edge-function-catalog.md`, `feature-flags.md`, `foxy-moat-phase-5-content-seed.md`, `LAUNCH_CHECKLIST.md`, `LAUNCH_FLAG_MATRIX.md`, `landing-page.md`, `MOL_ARCHITECTURE.md`, `MOL_C4_SHADOW_RUNBOOK.md`, `MOL_OPERATIONS.md`, `posthog-integration.md`, `postman_collection.json`, `PYTHON_AI_*.md` (13 files — Python AI service docs), `QUIZ_QA_REDESIGN.md`, `RBAC_MATRIX.md`, `redis-key-schema.md`, `security-compliance.md`, `stabilization-phase-0-memo.md`, `super-admin-python-ai-dashboard-spec.md`, `usage.md`, `V2_READINESS_AUDIT.md`.

`feature-flags.md` and `LAUNCH_FLAG_MATRIX.md` are the two docs most directly relevant to Section 1 above — **these need a staleness check against the 57-flag registry + ~20 legacy string-literal flags found in Section 1.3**, since neither doc was diffed against code in this pass.

### 5.2 Subdirectories (counts only, not exhaustively enumerated — space)
`docs/superpowers/specs/` — 32 files; `docs/superpowers/plans/` — 43 files; `docs/superpowers/runbooks/` — 6 files; `docs/runbooks/` (top-level ops runbooks) — ~47 files including `adaptive-program-rollout.md`, `adaptive-remediation-rollout.md`, `forensic-quiz-investigation.md`, `sentry-alert-setup.md`, `audit-production-readiness.md`, `SRE_RUNBOOK.md`, `staging-schema-drift-resolution.md`, `schema-reproducibility-fix.md`; plus `docs/alfabot/`, `docs/b2b/`, `docs/demo/`, `docs/design/`, `docs/identity/`, `docs/incidents/`, `docs/legal/`, `docs/ops/`, `docs/plans/`, `docs/product/`, `docs/public-api/`, `docs/quality/`, `docs/security/`, `docs/architecture/`, `docs/audit-logs/`, `docs/audits/`, `docs/auth/`.

### 5.3 Ops-owned docs vs. reality check (spot check, not exhaustive)
- `docs/ADMIN_OPERATIONS.md`, `docs/BACKUP_RESTORE.md`, `docs/CMS_SCALABILITY.md`, `docs/LAUNCH_CHECKLIST.md`, `docs/RBAC_MATRIX.md` are the 5 docs explicitly named as ops-owned in the constitution's Critical File Map. Their content was **not diffed against current code** in this read-only pass (would require opening each + cross-referencing against the 119-route super-admin API surface and 62 pages) — flagged as a follow-up rather than asserted stale or fresh.
- `docs/runbooks/audit-production-readiness.md` exists and is explicitly the "re-reconcile the constitution" runbook referenced at the top of `.claude/CLAUDE.md` — this is the correct next step to close the drift found in Section 6.

---

## 6. Ownership + Gaps — Findings

### 6.1 Constitution drift (confirmed)
- **Regression catalog count drift**: `.claude/CLAUDE.md` narrates "142 entries catalogued... latest REG-175" (Digital Twin Slice 1). Actual `.claude/regression-catalog.md` now reads **192 entries**, latest **REG-225** (OAuth partner-surface contracts). The catalog file's own "Catalog total" section states: *"Pre-REG-223: 189 entries... Total catalog: 192 entries (target: 35 — TARGET EXCEEDED)."* This is a 50-entry / 50-REG-id drift between the constitution narrative and the authoritative catalog — confirms the task's premise. `.claude/CLAUDE.md` should be re-reconciled via `docs/runbooks/audit-production-readiness.md`.
- **Super-admin surface size drift**: constitution's Critical File Map states "43 pages, 75 routes... last reconciled 2026-04-27." Actual count: **62 pages, 119 API routes**. Growth since last reconciliation: +44% pages, +59% routes.
- **`ff_school_command_center` default-state ambiguity**: the registry code comment says the flag is "globally ON in prod" as of 2026-06-16 with the client-side legacy dispatch removed, yet `FLAG_DEFAULTS` still lists it as `false` implicitly (it's absent from the `FLAG_DEFAULTS` map entirely, so a fresh/CI env resolves it OFF) — this is an intentional prod-vs-fresh-env divergence per the code comment, but it means CI/staging and production are running different code paths for `/school-admin`, which is a acceptable-but-notable operational fact, not necessarily a bug.

### 6.2 Flags seeded but with no source-code reference found (needs backend/architect confirmation)
`ff_quiz_oracle`, `ff_rag_mmr_diversity`, `ff_competition_sku`, `ff_grounded_ai_enabled`, `ff_demo_accounts_v2`, `ff_v1_quiz_rpc_user_agent`, and the MoL-family flags (`mol_admin_functions_rollback`, `improvement_mode`) — each has a seed migration but 0 hits for the exact string literal in `src/`. Possible explanations (not confirmed): (a) renamed at some point without updating the migration's flag_name reference in this search, (b) the code path became permanent/unconditional and the flag read was deleted without a flag-removal migration (asymmetric cleanup — DB row is now dead weight), (c) referenced only from a Supabase Edge Function (Deno, not searched in this pass — `supabase/functions/` was not grep'd for these literals). **Recommended follow-up**: backend/ai-engineer grep `supabase/functions/` for these 7 flag names before concluding they're dead.

### 6.3 Admin pages with thin/no dedicated doc coverage
- `super-admin/command-center`, `super-admin/workbench`, `super-admin/marking-integrity`, `super-admin/grounding/*` (5 pages), `super-admin/mol-shadow`, `super-admin/module-overrides`, `super-admin/foxy-quality`, `super-admin/oracle-health`, `super-admin/readiness-rubric`, `super-admin/sla`, `super-admin/intelligence/*` (4 pages) have no obviously-named counterpart doc in the root `docs/` listing (Section 5.1) — several likely have specs under `docs/superpowers/specs/` or `docs/superpowers/plans/` (not individually cross-referenced in this pass given the 32+43 file volume).
- `docs/COMMAND_CENTER_*` (3 files: AGENT_ROLES, OPERATIONS, RUNBOOK) likely cover `command-center`/`workbench` — plausible match, not confirmed by content read.

### 6.4 Structural overlap: two admin panels
`/super-admin` (62 pages/119 routes, ops-owned) and `/internal/admin` (1 page/10 tabs, 12 API routes) both expose **users, feature-flags, logs, reports, revenue, schools, support** as separate implementations with separate auth gates and separate API namespaces (`/api/super-admin/*` vs `/api/internal/admin/*`). This is either (a) an intentional lighter/legacy console kept for a narrower audience, or (b) redundant surface accumulated across two build eras. Not resolved in this read-only pass — flagging for architect/ops follow-up on whether `/internal/admin` should be deprecated or has a distinct, still-needed audience (e.g., break-glass access when super-admin auth is degraded).

### 6.5 Two "oracle-health" routes
`src/app/api/super-admin/oracle-health/route.ts` and `src/app/api/super-admin/ai/oracle-health/route.ts` both exist. Content not diffed in this pass — could be intentional (one general oracle-health, one AI-specific) or duplicate/dead code.

### 6.6 Debug route in production admin surface
`src/app/api/super-admin/debug/whoami/route.ts` — a `/debug/` namespace inside the super-admin API surface. Should be confirmed as intentionally scoped (super-admin-secret-gated, used for support diagnosis) rather than a leftover dev endpoint, per this agent's rejection-condition posture on admin auth.

### 6.7 Flag/doc cross-reference not completed
`docs/feature-flags.md` and `docs/LAUNCH_FLAG_MATRIX.md` were not opened/diffed against the 57-flag registry + ~20 legacy flags in this pass (time-boxed). This is the single highest-value follow-up for closing the "docs contradict code" rejection condition this agent owns — recommend a dedicated pass before the next flag-related change ships.

---

## Summary Counts

| Metric | Count |
|---|---|
| Feature flags — typed registry (barrel) | 57 flag strings across 36 registry consts |
| Feature flags — legacy string-literal (found via grep, no registry const) | ~20 identified, 7 with zero source hits |
| Feature-flag seed/lifecycle migrations (grep hits on `feature_flags`) | 128 files (incl. 19 `_legacy/timestamped/`) |
| Super-admin pages | 62 |
| Super-admin API routes | 119 |
| Internal-admin pages | 1 (tabbed, 10 tab components) |
| Internal-admin API routes | 12 (`/api/internal/admin/*`) + 2 (`/api/v1/admin/*`) |
| School-admin pages | 22 |
| School-admin API routes | 39 |
| Health-shaped endpoints | 8 |
| Notification event kinds (registry) | ~48 (approximate, `src/lib/state/events/registry.ts`) |
| Docs — root `docs/*.md` | ~45 |
| Docs — `superpowers/specs` | 32 |
| Docs — `superpowers/plans` | 43 |
| Docs — `runbooks/` (top-level) | ~47 |
| Regression catalog — constitution narrative vs. actual | 142 (REG-175) vs. **192 (REG-225)** — confirmed drift |

---

## Notes on Method
This is an inventory pass only — no code was modified. Counts marked "approximate" used line/pattern grep and may be off by a small margin (e.g., event-kind count, docs subfolder counts). Flags marked "no source reference found" were searched only in `src/` (`.ts`/`.tsx`, non-test); Supabase Edge Functions (`supabase/functions/`, Deno) were not grep'd for these literals and should be checked before treating any flag as fully dead.
