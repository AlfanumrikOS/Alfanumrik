# Feature-Flag Launch Matrix

**Audience:** CEO / launch-night operator
**Author:** ops
**Date:** 2026-06-12
**Status:** RECOMMENDATION ARTIFACT — no flags are flipped by this document and no seeding migrations are authored here. Ops decides recommended launch states; the operator executes.

**Authoritative source:** `FLAG_DEFAULTS` in [`src/lib/feature-flags.ts`](../src/lib/feature-flags.ts#L834) (every flag in scope currently defaults `false`). Behavior, OFF-path, and seed status below are grounded in the inline JSDoc above each `*_FLAGS` registry in that same file, cross-checked against the migration files on disk. Where the source is ambiguous, the cell says **VERIFY** instead of guessing.

**Scope note:** This matrix covers exactly the 36 flags in `FLAG_DEFAULTS`. Three flag constants exist in the file but are intentionally OUT of scope because they are not in `FLAG_DEFAULTS`: `maintenance_banner` (operational banner, not a launch toggle), `reconcile_stuck_subscriptions_enabled` (payments-ops action gate, seeded by `20260414120000`), and the un-mapped legacy reads. They are not launch-readiness gates and are excluded by design.

---

## 1. Launch-night ON set (recommended GA-ON)

**Recommended GA-ON at launch: 0 flags.**

This is deliberate and honest. Every flag in `FLAG_DEFAULTS` is either (a) an unproven redesign that should be staged per-tenant, (b) a payment/RBAC/AI-behavior surface that needs CEO sign-off and comms, or (c) mechanically un-toggleable because no seeding migration has landed. None clears the bar of "clearly net-positive AND well-tested AND no approval/dependency gate" for a launch-night global flip. Launch dark; stage redesigns post-launch.

The one near-candidate, `ff_welcome_v2`, is excluded from the ON set because it is **no longer evaluated at runtime** — WelcomeV2 is the unconditional permanent render (flag retired 2026-06-10). Flipping it has no effect.

---

## 2. Mechanical blockers (UNSEEDED — physically cannot be enabled from the console)

These flags have **no seeding migration**, so there is no `feature_flags` row to flip. Until a seeding migration with `is_enabled=false` lands, the super-admin Flags console cannot show or toggle them. Their OFF behavior is already correct (unknown flag → `isFeatureEnabled()` returns false), so the missing row is a **launch-enablement gate, not a safety bug**.

| Flag | Wants-ON blocker |
|---|---|
| `ff_cosmic_redesign_v1` | No migration. Cannot appear in console. |
| `ff_teacher_command_center` | No migration. Cannot appear in console. |
| `ff_teacher_assignment_lifecycle` | No migration + depends on `ff_teacher_command_center`. |
| `ff_teacher_gradebook_depth` | No migration + depends on `ff_teacher_command_center`. |
| `ff_teacher_parent_comms` | No migration + depends on `ff_teacher_command_center`. |
| `ff_school_command_center` | No migration. Cannot appear in console. |
| `ff_school_provisioning` | No migration. **Payment-adjacent (P11 seat billing) — see §3.** |
| `ff_school_reports_depth` | No migration. Cannot appear in console. |
| `ff_student_os_v1` | No migration. Cannot appear in console. |
| `ff_subjects_os_v1` | No migration. Cannot appear in console. |
| `ff_revision_os_v1` | No migration. Cannot appear in console. |
| `ff_practice_os_v1` | No migration. Cannot appear in console. |
| `ff_test_os_v1` | No migration. Cannot appear in console. |
| `ff_education_intelligence` | No flag-seeding migration (`20260616000000` creates EIC tables/RPCs but does NOT insert the flag row — verified). Also needs nightly rollup job before dashboards show data. |
| `ff_principal_ai_v1` | No flag-seeding migration. **AND** backing migration `20260616010000_principal_ai_assistant_v1.sql` is DRAFTED-not-applied, plus grant migration `20260616020000` — both must apply before the flag does anything (it abstains otherwise). **CEO + AI surface — see §3/§4.** |

**Total UNSEEDED: 15 flags.**

---

## 3. CEO sign-off required to flip

| Flag | One-line reason |
|---|---|
| `ff_school_provisioning` | Payment-adjacent (P11): enforces billable-seat caps (hard-block 409 over ceiling) — changes who can enroll = billing impact. |
| `ff_school_admin_rbac` | RBAC-narrowing: enforces role→permission matrix; a misconfigured flip can 403 legitimate principals. Held pending comms per JSDoc. |
| `ff_principal_ai_v1` | AI behavior surface + new principal-only capability (`institution.use_principal_ai`, CEO-approved 2026-06-11); also migration-dependent. |
| `ff_goal_aware_foxy` | AI behavior surface: rewrites Foxy's system prompt persona (goal × mode) — materially changes what a paying student sees from the tutor. |
| `ff_goal_aware_rag` | AI behavior surface: changes RAG rerank/retrieval for goal-aware grounding — affects tutor answer quality. |
| `ff_goal_aware_selection` | Changes quiz question selection + mastery thresholds — materially changes the learning experience a paying user receives. |
| `ff_education_intelligence` | Executive revenue/MRR dashboards (super-admin only); gate the data surface the CEO themselves reads. Low blast radius but revenue-data governance. |

**Total CEO-gated: 7 flags.**

All other flags are **ops**-gated (low-risk cosmetic/additive/presentation-only redesigns and admin-internal previews).

---

## 4. Dependencies / preconditions (something else must happen first)

| Flag | Precondition before flip has any/correct effect |
|---|---|
| `ff_realtime_subscriptions_v1` | The `supabase_realtime` Postgres publication MUST contain `student_learning_profiles` AND `classroom_poll_responses` first (verify via `pg_publication_tables`). See migration `20260527000002` header runbook. |
| `ff_principal_ai_v1` | Migrations `20260616010000` (DRAFTED-not-applied) + `20260616020000` (grant) must both be applied; flag also needs its own seeding row. Until then the route abstains. |
| `ff_education_intelligence` | EIC migrations applied + nightly rollup job run, else dashboards render NoDataState (HTTP 200, empty). Flag also needs a seeding row. |
| `ff_teacher_assignment_lifecycle` | Layered ON TOP of `ff_teacher_command_center` — no effect unless the Command Center is also ON. |
| `ff_teacher_gradebook_depth` | Layered on the Command Center surfaces — depends on `ff_teacher_command_center`. |
| `ff_teacher_parent_comms` | Layered ON TOP of `ff_teacher_command_center` — no effect unless Command Center is ON. |
| `ff_editorial_atlas_*` (per-role) | Per-role canaries are meant to ride the master `ff_editorial_atlas_v1`; flip master or use per-role for staged rollout (comms recommended). |
| `ff_school_admin_rbac` | Production enablement held pending comms (per JSDoc) — operational precondition, not technical. |

---

## 5. Full flag matrix

Legend — **Recommended launch state:** `GA-ON` = flip on at launch · `STAGED` = per-tenant / % canary first · `HOLD` = keep off post-launch.
**Approval:** `CEO` = needs CEO sign-off · `ops` = ops-gated.
**Rollback** is "instant: set `is_enabled=false`" for all rows unless noted.

### Goal-Adaptive Learning Layers

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_goal_profiles` | Super-admin | Goal Profile Preview page (6 personas + config tables) | Page hidden; legacy default | SEEDED (`20260503120000`) | STAGED | ops | instant |
| `ff_goal_aware_foxy` | Student | Foxy goal-persona prompt + goal-aware quiz scorecard sentence | Legacy single-line goal sentence | SEEDED (`20260503120000`) | STAGED | CEO (AI behavior) | instant |
| `ff_goal_aware_selection` | Student | `pickQuizParams` + `get_adaptive_questions_v2` RPC + goal-specific mastery thresholds | Legacy constants + v1 RPC + global 0.8 threshold | SEEDED (`20260503140000`) | STAGED | CEO (learning exp.) | instant |
| `ff_goal_daily_plan` | Student | Goal daily-plan card + plan API (Phase 3) | API returns empty plan; card renders null | SEEDED (`20260503160000`) | STAGED | ops | instant |
| `ff_goal_aware_rag` | Student | Goal-aware RAG rerank (Phase 4) | Rerank module stays installed but inert | SEEDED (`20260503180000`) | STAGED | CEO (AI behavior) | instant |
| `ff_goal_daily_plan_reminder` | Student | Daily-plan reminder notifications (Phase 5) | No new reminders sent (idempotent UTC-day) | SEEDED (`20260503210000`) | HOLD | ops | instant (sent notifications stay) |

### Pedagogy v2

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_productive_failure_v1` | Student | ZPD problem BEFORE tutorial on `/learn/[subject]/[chapter]` | Legacy tutorial-first path | SEEDED (`20260509120000`) | STAGED | ops | instant |
| `ff_distractor_micro_explainer_v1` | Student | Curated remediation + "Ask Foxy" CTA after wrong MCQ | No micro-explainer | SEEDED (`20260509120000`) | STAGED | ops | instant |
| `ff_pedagogy_v2_daily_rhythm` | Student | `<DailyRhythmQueue/>` on dashboard + `/api/rhythm/today` | Dashboard unchanged | SEEDED (`20260509120000`) | STAGED | ops | instant |
| `ff_pedagogy_v2_weekly_dive` | Student | `/dive` surface + `/api/dive/*` + weekly-dive CTA | `/dive` 404s; CTA suppressed (additive) | SEEDED (`20260510000000`) | STAGED | ops | instant |
| `ff_pedagogy_v2_monthly_synthesis` | Student | `/synthesis` + `/api/synthesis/*` + cron synthesis builder + WhatsApp parent-share | `/synthesis` 404s; parent-share + cron skip flagged-out | SEEDED (`20260511000000`) | HOLD | ops | instant |

### Marketing / Landing

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_welcome_v2` | Cross-cutting | (RETIRED) mobile-first `/welcome` redesign | **No runtime effect** — WelcomeV2 is permanent unconditional render; flag no longer evaluated | SEEDED (`20260426150000`, archived in `_legacy/timestamped/`) | HOLD (no-op) | ops | n/a (inert) |

### Editorial Atlas redesign

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_editorial_atlas_v1` | Cross-cutting | Master: new Atlas surfaces across student/parent/teacher/school | Legacy surfaces render unchanged | SEEDED (`20260511180000`) | STAGED (per-tenant via `target_institutions`) | ops | instant |
| `ff_editorial_atlas_student` | Student | Per-role Atlas canary (rides master) | Legacy student surface | SEEDED (`20260511180000`) | STAGED | ops | instant |
| `ff_editorial_atlas_parent` | Parent | Per-role Atlas canary | Legacy parent surface | SEEDED (`20260511180000`) | STAGED | ops | instant |
| `ff_editorial_atlas_teacher` | Teacher | Per-role Atlas canary | Legacy teacher surface | SEEDED (`20260511180000`) | STAGED | ops | instant |
| `ff_editorial_atlas_school` | School-admin | Per-role Atlas canary | Legacy school surface | SEEDED (`20260511180000`) | STAGED | ops | instant |

### Study Menu v2

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_study_menu_v2` | Student | Sidebar "Study" group (Library/Refresh/Exam Sprint) + 301s of old routes | Legacy 4-item "Review" group; old routes reachable | SEEDED (`20260520120000`) | STAGED | ops | instant |

### Realtime

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_realtime_subscriptions_v1` | Teacher + Parent | Supabase Realtime subs (teacher heatmap/polls, parent child-progress) | Falls back to focus/visibility fetch | SEEDED (`20260527000002`) | STAGED (per-tenant) | ops | instant — **but requires publication precondition before ON (see §4)** |

### Cosmic redesign

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_cosmic_redesign_v1` | Cross-cutting | Master switch for cosmic dark-theme CSS/token layer | Existing visual identity unchanged (byte-identical) | **UNSEEDED** | HOLD | ops | instant (once seeded) |

### Consumer Minimalism (Phase 1)

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_today_home_v1` | Student | Adaptive "Today" home + 4-tab nav (Wave A) | `/api/v2/today` 404s; legacy dashboard + 5-tab nav | SEEDED (`20260612000000`) | STAGED | ops | instant |
| `ff_unified_quiz_v1` | Student | Single parameterized quiz runtime (Wave B, **not yet built**) | Legacy quiz runtime | SEEDED (`20260612000000`) | HOLD (not built) | ops | instant |
| `ff_parent_glance_v1` | Parent | Push-first parent glance home (Wave C, **not yet built**) | Legacy parent home | SEEDED (`20260612000000`) | HOLD (not built) | ops | instant |
| `ff_parent_unified_auth_v1` | Parent | Guardian-role parent auth (Wave D, **not yet built**) | Legacy parent auth | SEEDED (`20260612000000`) | HOLD (not built) | ops | instant |
| `ff_parent_encourage_v1` | Parent | Parent→child "Encourage" cheer button on glance home (Wave D) | Button hidden; `POST /api/v2/parent/encourage` not surfaced | SEEDED (`20260612000000`) | HOLD (depends on glance home) | ops | instant |

### Teacher Command Center (Phase 3A)

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_teacher_command_center` | Teacher | Dense desktop teacher home + slimmed 5-item nav | `/teacher` + nav byte-identical to today | **UNSEEDED** | STAGED | ops | instant (once seeded) |
| `ff_teacher_assignment_lifecycle` | Teacher | Cross-assignment grading queue inside Command Center | Queue + button suppressed (byte-identical) | **UNSEEDED** | HOLD (depends on Command Center) | ops | instant (once seeded) |
| `ff_teacher_gradebook_depth` | Teacher | Mastery + Bloom's drill-through + class summary + CSV export | Plain navigate link; score matrix only (byte-identical) | **UNSEEDED** | HOLD (depends on Command Center) | ops | instant (once seeded) |
| `ff_teacher_parent_comms` | Teacher | One-tap "Tell the parent"/"Share with parent" affordance | No affordance; no parent-notify fetch (byte-identical) | **UNSEEDED** | HOLD (depends on Command Center) | ops | instant (once seeded) |

### School Command Center (Phase 3B)

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_school_command_center` | School-admin | Read-only School Command Center home + 5-section nav | `/school-admin` + nav byte-identical to today | **UNSEEDED** | STAGED | ops | instant (once seeded) |
| `ff_school_provisioning` | School-admin / Payments | Server-authoritative seat ENFORCEMENT on enroll/bulk/deactivate/invite (P11 billing) | Enforcement off; legacy soft `seats_purchased` checks (byte-identical) | **UNSEEDED** | HOLD | **CEO** (billing) | instant (once seeded) |
| `ff_school_admin_rbac` | School-admin | Enforce role→permission matrix in `authorizeSchoolAdmin()` | No role-narrowing (byte-identical) | SEEDED OFF (`20260611000100`) | HOLD | **CEO** (RBAC-narrowing) | instant — held pending comms |
| `ff_school_reports_depth` | School-admin | 3 new read routes: mastery rollup, Bloom summary, export (json/csv) | Routes 404 before auth (byte-identical) | **UNSEEDED** | STAGED | ops | instant (once seeded) |

### Alfa OS flagship redesign

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_student_os_v1` | Student | Alfa OS student dashboard + 3-pane Foxy workspace (presentation-only; engines untouched) | `/dashboard` + `/foxy` byte-identical to today | **UNSEEDED** | STAGED | ops | instant (once seeded) |
| `ff_subjects_os_v1` | Student | Per-subject SubjectsOSHub inside `/learn` (presentation-only) | Legacy chapter list (byte-identical) | **UNSEEDED** | STAGED | ops | instant (once seeded) |
| `ff_revision_os_v1` | Student | Revision Center at new `/revision` route | `/revision` 404s (additive) | **UNSEEDED** | STAGED | ops | instant (once seeded) |
| `ff_practice_os_v1` | Student | Practice Center at new `/practice` route | `/practice` 404s (additive) | **UNSEEDED** | STAGED | ops | instant (once seeded) |
| `ff_test_os_v1` | Student | Pre-test briefing hub at new `/exam-briefing` route (display-only predicted score) | `/exam-briefing` 404s (additive) | **UNSEEDED** | STAGED | ops | instant (once seeded) |

### Education Intelligence Cloud / Principal AI

| Flag | Surface | Gates | OFF behavior | Seed | Rec. | Approval | Rollback |
|---|---|---|---|---|---|---|---|
| `ff_education_intelligence` | Super-admin | EIC dashboards (Overview/Schools/Revenue/Geography + drilldown) nav + render | Nav group hidden; pages not-found (API stays behind super-admin auth) | **UNSEEDED** (`20260616000000` creates tables/RPCs but does NOT seed the flag — verified) | HOLD | **CEO** (revenue data) | instant (once seeded); needs rollup job for data |
| `ff_principal_ai_v1` | School-admin / AI | School-scoped principal AI assistant (`POST/GET /api/school-admin/ai-assistant`) | Routes 404 before work (byte-identical); abstains if RPC/tables missing | **UNSEEDED** + migration-dependent (`20260616010000` DRAFTED-not-applied; `20260616020000` grant) | HOLD | **CEO** (AI surface) | instant (once seeded); no effect until both migrations apply |

> **P13 note (`ff_principal_ai_v1`, CEO-approved 2026-06-12):** the assistant's school-data context intentionally includes school STAFF (teacher) names — sent to the LLM provider and persisted — as an accepted egress (staff names are not minor/student PII; principal already sees their own staff; data is school-scoped via verified tenant isolation). STUDENT PII stays forbidden. See the code comments in `src/app/api/school-admin/ai-assistant/route.ts` and `src/lib/ai/principal-ai/prompt.ts`.

---

## 6. Recommended launch posture

Launch dark and minimal. The honest GA-ON set is empty: every flag in scope is either an unproven presentation redesign, a payment/RBAC/AI-behavior surface needing CEO sign-off and comms, or mechanically un-toggleable because no seeding migration has landed (15 of 36 flags). After a stable launch, stage the redesigns per-tenant — start each `*_command_center`, `*_os`, Editorial Atlas, Consumer-Minimalism, and Pedagogy-v2 flag on one friendly school via `target_institutions`, watch error-rate and engagement for a week, then widen by percentage. Hold the three CEO/billing/AI gates (`ff_school_provisioning`, `ff_school_admin_rbac`, `ff_principal_ai_v1`) until their migrations are applied and parent/teacher comms are sent. Before any realtime flip, confirm the `supabase_realtime` publication precondition. Nothing here blocks launch; the redesigns are additive and ride safely OFF.
```
