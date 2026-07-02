# Discovery — Database & Infrastructure Inventory (2026-07-02)

Read-only inventory. Source: `supabase/migrations/00000000000000_baseline_from_prod.sql` (22,629
lines, pg_dump-derived) + all subsequent root-level migrations through
`20260702130000_xc3_student_select_helper.sql`. Counts derived via `grep`/`awk` regex extraction
against the SQL text, not a live DB introspection — flagged as **sampled** where extraction is
regex-based and could miss edge-case formatting. `_legacy/` archive excluded from live-schema
counts (not read by `supabase db push`) but inventoried separately in §3.

## Summary counts

| Object | Baseline (as of 2026-05-03 snapshot) | Full root chain (as of 2026-07-02) |
|---|---|---|
| Root migration files | 1 (the baseline itself) | **345** (baseline + 344 dated files) |
| Tables | 270 | **364** (+94 net-new since baseline) |
| Views | 7 | 7 (no new views found post-baseline in a quick scan — not exhaustively re-verified) |
| Materialized views | 0 | 0 |
| Functions/RPCs (distinct names) | 315 | **414** distinct (534 `CREATE OR REPLACE FUNCTION` statements total, incl. redefinitions/patches) |
| SECURITY DEFINER functions | 242 distinct (251 occurrences of the keyword) | 572 keyword occurrences across full chain (not de-duped) |
| Triggers | 116 (`CREATE OR REPLACE TRIGGER`, 50 distinct trigger functions) | not re-counted chain-wide (sampled) |
| Indexes | 615 | not re-counted chain-wide (sampled) |
| Enum types (`CREATE TYPE ... AS ENUM`) | 0 | 0 — the schema uses `TEXT` + `CHECK` constraints instead of native enums everywhere sampled |
| pgvector columns | 3 tables (`question_bank`, `rag_content_chunks` — both `vector(1024)`; `textbook_chunks` — `vector(1536)`) | same, no new vector columns found in post-baseline scan |
| pgvector HNSW indexes | 2 (`question_bank_embedding_hnsw_idx`, `rag_content_chunks_embedding_hnsw_idx`) | same |
| RLS-enabled tables | 270 / 270 (100%) | **364 / 364 (100%)** — every table with a `CREATE TABLE` in the root chain has a matching `ENABLE ROW LEVEL SECURITY` somewhere in the chain (verified, see §2) |
| Policies | 522 | not re-counted chain-wide (sampled) |
| DROP TABLE / DROP COLUMN executed | 0 | **0** — every `DROP TABLE`/`DROP COLUMN` string found in the chain is inside a `--` rollback-plan comment, never live DDL (verified by grep across all 345 files) |
| Supabase Edge Functions | — | **47-48** function directories with `index.ts` (+ `_shared/`, `_archive/` support dirs) |
| RBAC roles | — | **11** (`RoleName` type + `roles` table seed) |
| RBAC permission codes | — | **~69** in the TS `PERMISSIONS` registry; **~90-110** distinct codes seeded across migrations (regex-approximate, see §4) |
| CI/CD workflows | — | **22** files under `.github/workflows/` |

**Headline drift vs constitution claims** (`.claude/CLAUDE.md`, reconciled 2026-04-27): the
constitution states "1 baseline migration + 349 archived", "6 roles, 71 permissions", "29 Supabase
Edge Functions", and "3 workflows" (from the architect's own system prompt). All four are stale —
see §6 for detail. This is expected drift given the constitution's last reconciliation date predates
~2 months of active development; it is not itself a defect, but it means any automation or agent
prompt reasoning from those numbers is working from stale data.

---

## 1. Database objects

### 1.1 Tables — exhaustive list, categorized (364 total)

The baseline (270 tables) plus 94 net-new tables added by migrations dated 2026-05-04 through
2026-07-02. All table names below come from `CREATE TABLE IF NOT EXISTS` extraction; grouping into
categories is a manual/heuristic read of the name and is **not** validated against actual FK
structure (sampled interpretation, not exhaustive schema analysis).

#### Baseline tables by domain (270) — names only, exhaustive; purpose column sampled below

<details>
<summary>Full baseline table name list (click to expand in a text viewer — shown as a flat list here)</summary>

achievements, adaptive_interactions, adaptive_mastery, adaptive_profile, admin_announcements,
admin_audit_log, admin_impersonation_sessions, admin_support_notes, admin_users, agent_anomalies,
ai_governance_log, ai_interaction_logs, ai_issue_reports, ai_quality_metrics, ai_response_reports,
ai_role_rules, ai_usage_stats, ai_workflow_traces, alert_dispatches, alert_rules, analytics_events,
api_keys, api_rate_limits, api_rate_limits_v2, assessment_questions, assessment_schedule,
assessments, assignment_submissions, assignments, at_risk_alerts, audit_logs, auth_audit_log,
backup_status, bloom_progression, cbse_board_papers, cbse_competency_map, cbse_question_config,
cbse_syllabus, cbse_syllabus_graph, challenge_attempts, challenge_streaks, chapter_concepts,
chapter_progress, chapter_study_sessions, chapters, chat_sessions, class_enrollments, class_students,
class_teachers, classes, classroom_poll_responses, classroom_polls, cme_action_log,
cme_concept_state, cme_error_log, cme_exam_readiness, cme_revision_schedule, cms_assets,
cms_item_versions, cognitive_session_metrics, cohort_weekly_snapshots, coin_balances,
coin_transactions, competition_participants, competitions, concept_graph, concept_mastery,
concept_mastery_score, connection_budget, connection_health_log, content_gaps, content_media,
content_reports, content_requests, content_versions, conversation_messages, coupons,
coverage_audit_snapshots, curriculum_topics, daily_activity, daily_challenges, daily_goals,
deployment_history, deployment_snapshots, devops_agent_logs, diagnostic_assessments,
diagnostic_responses, difficulty_attempts, domain_events, engagement_events, evaluation_state,
exam_chapters, exam_configs, exam_paper_templates, exam_simulations, feature_flags,
ff_grounded_ai_enforced_pairs, formative_assessments, foxy_chat_messages, foxy_response_cache,
foxy_scan_queries, foxy_sessions, gamification_bursts, grade_subject_map, grounded_ai_traces,
guardian_student_links, guardians, hall_of_fame, hpc_records, identity_events, image_uploads,
improvement_executions, improvement_issues, improvement_recommendations, interactive_simulations,
interleave_config, interleave_queue, invite_codes, knowledge_gaps, layer_mastery, leaderboard,
leaderboard_snapshots, learner_clusters, learning_graph, learning_journey, learning_loop_state,
learning_objectives, learning_paths, learning_velocity, legacy_alert_rules,
legacy_subjects_archive, lesson_progress, loop_phase_log, mass_gen_log, messages,
misconception_patterns, mixed_recall_queue, monthly_reports, narrative_progress,
narrative_templates, ncert_book_catalog, ncert_exercises, ncert_formulas, nipun_competencies,
nipun_diagnostic_items, nipun_instructional_tasks, nipun_levels, notification_channels,
notifications, offline_pending_responses, onboarding_responses, onboarding_state, ops_events,
parent_tips, payment_history, payment_webhook_events, performance_scores, permissions,
pilot_cohorts, pilot_daily_metrics, pilot_weekly_snapshots, plan_subject_access,
platform_analytics, platform_health_scores, platform_health_snapshots, practice_session_log,
product_events, question_bank, question_misconceptions, question_responses, quiz_responses,
quiz_session_shuffles, quiz_sessions, rag_content_audit, rag_content_chunks,
rag_content_documents, rag_content_flags, rag_content_sources, rag_ingestion_failures,
rag_neighbor_cache, rag_query_logs, rag_retrieval_logs, rag_syllabus_map, rate_limits,
referral_rewards, remediation_sessions, resource_access_rules, response_cache, retention_tests,
retrieval_traces, rl_learning_actions, role_permissions, roles, school_admins, school_alert_rules,
school_announcements, school_api_keys, school_audit_log, school_exams, school_invite_codes,
school_invoices, school_questions, school_seat_usage, school_subscriptions, schools,
score_history, smart_nudges, solver_accuracy, solver_results, spaced_repetition_cards,
student_achievements, student_assessment_attempts, student_avatar_preferences,
student_baselines, student_bookmarks, student_burst_progress, student_cluster_assignments,
student_competency_scores, student_concept_state, student_daily_usage,
student_improvement_log, student_learning_profiles, student_misconceptions, student_moments,
student_ncert_attempts, student_ncert_chapter_progress, student_nipun_composite,
student_nipun_scores, student_notes, student_scans, student_simulation_progress,
student_skill_state, student_subject_enrollment, student_subscriptions, student_titles,
students, study_plan_tasks, study_plans, subject_content_readiness_daily, subjects,
subscription_events, subscription_plans, support_tickets, sync_ledger, tarl_sessions,
task_queue, teacher_actions, teacher_analytics_cache, teacher_student_links,
teacher_student_notes, teachers, textbook_chunks, textbooks, thinking_growth,
thinking_loops, topic_diagrams, topic_mastery, tutor_avatars, tutor_feedback, tutor_personas,
tutoring_cohorts, tutoring_sessions, user_active_sessions, user_question_history, user_roles,
vernacular_content, voice_interaction_logs, waitlist, wrong_answer_remediations, xp_transactions

</details>

**Category breakdown (heuristic, from name prefix — SAMPLED interpretation):**

| Category | Approx. count | Examples |
|---|---|---|
| Core identity/roles | ~10 | `students`, `teachers`, `guardians`, `schools`, `roles`, `permissions`, `role_permissions`, `user_roles`, `school_admins` |
| Quiz/assessment engine | ~25 | `question_bank`, `quiz_sessions`, `quiz_responses`, `quiz_session_shuffles`, `assessment_questions`, `diagnostic_assessments`, `formative_assessments`, `exam_configs`, `exam_simulations` |
| Cognitive/adaptive/mastery engine | ~30 | `adaptive_mastery`, `adaptive_profile`, `concept_mastery`, `concept_mastery_score`, `cme_concept_state`, `cme_exam_readiness`, `learning_graph`, `learner_clusters`, `bloom_progression`, `topic_mastery` |
| NCERT/curriculum content | ~20 | `ncert_book_catalog`, `ncert_exercises`, `ncert_formulas`, `cbse_syllabus`, `cbse_syllabus_graph`, `chapters`, `curriculum_topics`, `textbooks`, `textbook_chunks` |
| RAG/AI retrieval | ~15 | `rag_content_chunks`, `rag_content_documents`, `rag_content_sources`, `rag_query_logs`, `rag_retrieval_logs`, `rag_neighbor_cache`, `grounded_ai_traces` |
| Foxy/AI tutor | ~6 | `foxy_chat_messages`, `foxy_sessions`, `foxy_response_cache`, `foxy_scan_queries`, `tutor_avatars`, `tutor_personas` |
| Gamification/engagement | ~20 | `achievements`, `leaderboard`, `xp_transactions`, `coin_balances`, `coin_transactions`, `daily_challenges`, `challenge_streaks`, `hall_of_fame`, `student_titles`, `gamification_bursts` |
| Parent/guardian portal | ~5 | `guardian_student_links`, `parent_tips`, `monthly_reports` |
| Teacher/class management | ~10 | `classes`, `class_students`, `class_teachers`, `class_enrollments`, `assignments`, `assignment_submissions`, `teacher_student_links`, `teacher_student_notes` |
| Payments/billing | ~10 | `payment_history`, `payment_webhook_events`, `subscription_plans`, `subscription_events`, `student_subscriptions`, `school_subscriptions`, `school_invoices`, `coupons` |
| Admin/audit/ops | ~25 | `admin_users`, `admin_audit_log`, `audit_logs`, `ops_events`, `deployment_history`, `deployment_snapshots`, `backup_status`, `devops_agent_logs`, `improvement_issues`, `improvement_recommendations` |
| Study plan/spaced repetition | ~10 | `study_plans`, `study_plan_tasks`, `spaced_repetition_cards`, `interleave_config`, `interleave_queue`, `mixed_recall_queue`, `retention_tests` |
| Simulations/STEM | ~5 | `interactive_simulations`, `exam_simulations`, `student_simulation_progress` |
| NIPUN/TaRL (early-grade literacy program) | ~7 | `nipun_competencies`, `nipun_diagnostic_items`, `nipun_instructional_tasks`, `nipun_levels`, `tarl_sessions`, `student_nipun_composite`, `student_nipun_scores` |
| Misc/other | ~50 | `waitlist`, `rate_limits`, `sync_ledger`, `task_queue`, `messages`, `pilot_cohorts`, `pilot_daily_metrics`, `legacy_subjects_archive`, `mass_gen_log`, etc. |

#### Post-baseline net-new tables (94, added 2026-05-04 → 2026-07-02) — exhaustive

Grouped by the feature wave that introduced them (inferred from migration filename adjacency —
SAMPLED grouping):

- **Agent mesh / autonomous-loop substrate** (`20260511120000_agent_mesh_foundation.sql`): `cycles`, `cycle_evaluations`, `tasks`, `lessons_learned`, `agent_prompts`, `outcome_metrics`
- **Pedagogy v2 Wave 2/3**: `foxy_message_feedback`, `foxy_quality_scores`, (dive/synthesis tables likely reuse existing `student_*` tables, not independently listed here)
- **Domain-event bus / state runtime**: `domain_events` (baseline) extended by `state_events`, `bus_cursor`, `subscriber_offsets`, `subscriber_retry_state`, `subscriber_dead_letters`
- **B2B/school SaaS (white-label, GST, contracts)**: `tenant_modules`, `tenant_configs`, `platform_module_overrides`, `invoice_number_sequences`, `contract_number_sequences`, `school_contracts`, `payment_reconciliation_queue`, `school_gst_details`, `supplier_gstins`, `tax_config`, `school_admin_claim_tokens`, `school_churn_signals`, `school_health_daily`, `school_mrr_daily`, `mrr_snapshots`, `geographic_metrics`
- **Exam papers / mock tests**: `exam_papers`, `mock_test_attempts`, `mock_test_responses`
- **AlfaBot v1 (landing-page widget)**: `alfabot_denylist`, `alfabot_kb_chunks`, `alfabot_leads`, `alfabot_messages`, `alfabot_sessions`
- **Platform security layer** (`20260618000001_platform_security_layer.sql`): `security_circuit_state`, `security_internal_callers`, `security_quota_profiles`, `security_request_audit`, `security_request_usage_daily`, `security_request_usage_monthly`, `security_route_policies`, `security_tenant_ai_budgets`, `security_tenant_ai_usage_daily`, `security_tenant_ai_usage_monthly`
- **Digital Twin / Knowledge Graph (Slice 1, 2026-07-02)**: `concept_edges`, `learner_twin_snapshots`, `learner_twin_memory`
- **Adaptive program (Loops A/B/C)**: `adaptive_interventions`, `teacher_remediation_assignments`
- **Education Intelligence Cloud / Principal AI**: (aggregation functions layered on existing tables + `principal_ai_sessions`, `principal_ai_messages`, `institution_entitlements`)
- **Telemetry/observability**: `micro_telemetry_events`, `learning_events`, `intervention_alerts`, `system_metrics`, `synthetic_monitor_results`
- **Compliance (DPDP)**: `data_erasure_requests`, `parental_consent`, `link_code_otp_challenges`
- **Misc**: `demo_requests`, `parent_cheers`, `parent_weekly_reports`, `grade_book_entries`, `classroom_lesson_plans`, `class_schedule`, `academic_terms`, `student_attendance`, `boards`, `cbse_chapter_weights`, `readiness_rubric_config`, `experiment_observations`, `student_lab_badges`, `student_lab_streaks`, `board_score_predictions`, `cognitive_misconceptions`, `concept_attempts`, `learner_mastery`, `mol_shadow_text_buffer`, `foxy_pending_expectations`, `foxy_served_items`, `teacher_parent_threads`, `teacher_parent_messages`, `scheduled_actions`, `cycle_goal_inbox`, `webhook_subscriptions`, `webhook_deliveries`, `integration_listings`, `integration_installs`, `outcome_metrics` (dup, see agent mesh), `_ao10b_grade_backfill_backup`, `_tsb4_isactive_backfill_backup` (temp backup tables from data-fix migrations, likely droppable once verified — flagged in §6)

### 1.2 Views (7, baseline; no chain-wide re-scan for new views)

| View | Inferred purpose (SAMPLED) |
|---|---|
| `admin_question_verification_status` | Admin dashboard read model for question-bank verification workflow |
| `cbse_syllabus_rag_diagnostic` | Diagnostic view comparing CBSE syllabus coverage against RAG-ingested content |
| `ingestion_gaps` | Content-pipeline gap report (missing chapters/chunks) |
| `misconception_candidates` | Feeds the super-admin misconception curator |
| `rag_chapter_coverage` | RAG chunk coverage per chapter, for content-QA |
| `super_admin_subject_readiness` | Subject-readiness rollup for super-admin dashboard |
| `v_ops_timeline` | Operational events timeline view |

Also referenced elsewhere in the constitution: `public.marking_audit_last_30d` (forensic quiz-marking
view, migration `20260504100400_marking_audit_view.sql` — SECURITY INVOKER, service-role-only) is a
post-baseline view not captured by the baseline-only grep above; confirms views do get added
post-baseline and the "7" count is baseline-only, not current total (sampled gap, not re-verified
exhaustively).

### 1.3 Functions / RPCs

- **315 distinct functions in the baseline**, growing to **414 distinct names across the full root
  chain** (534 total `CREATE OR REPLACE FUNCTION` statements — the delta between 534 and 414 is
  re-definitions/patches of existing functions in later migrations, which is the expected idempotent
  pattern).
- **SECURITY DEFINER**: 242 distinct functions in the baseline carry `SECURITY DEFINER` (251 keyword
  occurrences — some functions have the keyword in both the definition and a `COMMENT ON FUNCTION`).
  Across the full chain, `SECURITY DEFINER` appears 572 times (not de-duplicated per function).
  **This is a very large SECURITY DEFINER surface** — roughly 80% of baseline functions run with
  elevated privilege. Two dedicated remediation migrations exist:
  `20260516000000_fix_security_definer_views.sql` and a `20260614200000_repair_security_advisor_batch1.sql`
  — suggesting this was already flagged by Supabase's security advisor and partially remediated. Not
  independently re-verified here whether every current SECURITY DEFINER function carries a
  justifying comment per the architect's own "no SECURITY DEFINER without SQL comment" rule (SAMPLED
  — spot-checked a handful, all had inline rationale, but not exhaustive across 242+).
- **RLS/authorization helper roster** (functions used inside RLS policies or `authorizeRequest`-adjacent
  checks, found via `is_*`/`has_*`/`can_*`/`get_user_role*`/`get_admin*` name-pattern grep):
  - `get_admin_school_id` — resolves the school a school-admin belongs to
  - `get_user_role` — canonical role resolver (hardened by `20260610090000_secure_get_user_role.sql`,
    extended by `20260609180000_extend_get_user_role_school_admin.sql`)
  - `is_admin`, `is_guardian_of`, `is_teacher_of`, `is_school_admin_of`, `is_platform_super_admin`
  - `is_school_admin_of_student` (new, `20260702090000_xc3_p1_is_school_admin_of_student_helper.sql`)
  - `is_devanagari_mojibake` — **not** an RLS helper despite the naming-pattern match; it's a Hindi
    text-quality/content-QA helper (false positive in the grep, noted for accuracy)

### 1.4 Triggers (baseline: 116, 50 distinct trigger functions)

Notable trigger bindings (sampled from the full 116):
`audit_student_mutation` (AFTER DELETE/UPDATE on `students` → `audit_student_changes()`),
`on_student_created` (AFTER INSERT on `students` → `auto_setup_student()`),
`question_bank_recompute_trigger` / `rag_chunks_recompute_trigger` (content-integrity recompute),
`rate_limit_quiz` / `rate_limit_ai_logs` (BEFORE INSERT rate-limit enforcement at the DB layer —
defense-in-depth alongside the app-layer Upstash limiter), `sanitize_student` / `sanitize_student_update`
(BEFORE INSERT/UPDATE data sanitization, includes the P5 grade-format sanitize trigger), 20+
`set_updated_at`-pattern triggers (one per table needing `updated_at` maintenance — `adaptive_profile`,
`admin_users`, `chat_sessions`, `concept_mastery`, `daily_activity`, `daily_goals`,
`evaluation_state`, `feature_flags`, and more).

### 1.5 Indexes (baseline: 615)

Per-table index counts, top tables (SAMPLED — baseline only, not chain-wide):

| Table | Index count |
|---|---|
| `question_bank` | 30 |
| `rag_content_chunks` | 22 |
| `students` | 10 |
| `quiz_sessions` | 10 |
| `curriculum_topics` | 10 |
| `quiz_responses` | 8 |
| `guardian_student_links` | 8 |
| `student_notes` | 7 |
| `ops_events` | 7 |
| `learning_graph` | 7 |
| `concept_mastery` | 7 |
| `admin_audit_log` | 7 |

Several dedicated perf-index migrations exist post-baseline: `20260514120000_add_perf_indexes.sql`,
`20260515000003_perf_covering_indexes_batch_a.sql`, `20260515000003_perf_covering_indexes_batch_b.sql`
(sic — filename as observed), `20260525130002_api_query_path_indexes_batch2.sql`,
`20260614200001_repair_api_query_path_indexes.sql` — indicating iterative, reactive index tuning
rather than a single upfront design (consistent with an actively-scaling product).

### 1.6 pgvector usage

Three tables carry vector embedding columns:

| Table | Column | Dimension | HNSW index |
|---|---|---|---|
| `question_bank` | `embedding` | 1024 | `question_bank_embedding_hnsw_idx` — partial (`WHERE embedding IS NOT NULL AND is_active = true`), `m=16, ef_construction=64` |
| `rag_content_chunks` | `embedding` | 1024 | `rag_content_chunks_embedding_hnsw_idx` — `m=16, ef_construction=64` |
| `textbook_chunks` | `embedding` | 1536 | none found in baseline grep (SAMPLED — may exist under a different index name not matching the `vector(` regex, not independently verified) |

Both HNSW indexes carry a comment noting they replace a legacy IVFFlat (lists=50) index — consistent
with the "Foxy moat plan Phase 1" reference in the constitution.

---

## 2. RLS posture

- **270/270 baseline tables have RLS enabled** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) — 1:1
  match against the baseline `CREATE TABLE` count. **364/364 tables across the full root chain have
  a matching RLS-enable statement somewhere in the chain** — verified via full-chain regex diff
  (zero tables in `CREATE TABLE` set minus `ENABLE ROW LEVEL SECURITY` set). No critical "table
  without RLS" gap found.
- **522 policies in the baseline.** 268/270 baseline tables have at least one `CREATE POLICY`; the
  two exceptions (`mass_gen_log`, `school_subscriptions`) are RLS-enabled with **zero** policies —
  this is documented as **intentional** for `school_subscriptions` (migration
  `20260516030000_document_school_subscriptions_rls.sql`: "Service-role only... Anon/authenticated
  callers correctly see zero rows," with an audited list of every code path that reads it via
  `supabaseAdmin`). `mass_gen_log` was not independently re-verified for a similar comment (SAMPLED
  gap — flagged in §6 as a follow-up check, likely the same intentional pattern given the name
  suggests an internal batch-generation log).
- Top policy-count tables (baseline, SAMPLED): `guardian_student_links` (9), `classes` (8),
  `class_students` (7), `student_notes` (6), `teachers` (5), `students` (5), `foxy_sessions` (5),
  `assignments` (5), `assignment_submissions` (5) — consistent with the architect's four-pattern
  policy convention (student-own / parent-linked / teacher-assigned / admin-service-role) needing
  multiple policies per table.
- **RLS helper roster** — see §1.3. These are the functions RLS policies call to resolve
  ownership/role without recursion (the repo has at least one dedicated regression test file for
  this: `src/__tests__/rls-no-cross-table-recursion.test.ts`, currently modified per git status).
- **No tables without RLS found.** This is a clean result for the P8 invariant at the schema level —
  the CI `ci.yml` "Migration safety — RLS-on-CREATE-TABLE" step (blocking, since 2026-04-27 per audit
  finding F23) enforces this per-file at merge time, which is consistent with the clean full-chain
  result observed here.

---

## 3. Migration chain health

- **Root-level (live) migration count: 345** — `00000000000000_baseline_from_prod.sql` +
  344 dated migrations spanning `20260430010000` (Apr 30) through `20260702130000` (Jul 2, today).
  Only root-level files are read by `supabase db push` / the CLI; subdirectories are skipped
  automatically.
- **`_legacy/` archive: 359 files** — 10 flat pre-timestamp legacy files (`000_core_schema.sql`
  through `008_fix_snapshot_rpc_and_rls.sql`) plus 349 timestamped files under `_legacy/timestamped/`
  (spanning `20260307074838` through migrations that predate the 2026-05-03 baseline cutover). These
  are dead weight for deployment (never executed by the CLI against root) but retained as history —
  matches the constitution's "349 archived" framing, though the constitution's headline "1 baseline
  migration" for the *root* is now stale (see §6).
- **Ordering**: strictly timestamp-ordered filenames, no gaps observed in the year/month coverage
  scanned (202604, 202605, 202606, 202607 all represented; no 202603 root files — consistent with the
  baseline being generated ~2026-05-03 and only a single stray `20260430010000` file predating it,
  likely a late-arriving hotfix cherry-picked onto the new chain).
- **Idempotency conventions**: 1,056 `IF NOT EXISTS` occurrences, 729 `CREATE OR REPLACE` occurrences,
  100 `DO $$ ... END $$` exception-handling blocks across the full chain. A strict 3-marker check
  (IF NOT EXISTS / CREATE OR REPLACE / DO $$) flags ~120 files as having none of the three — spot-
  checking a sample of these (`add_ff_goal_daily_plan.sql`, `fix_pricing_family_school_plan.sql`,
  `revoke_execute_internal_functions.sql`, `rbac_matrix_conformance.sql`) shows they all use a
  **different but equally valid idempotency mechanism**: `INSERT ... ON CONFLICT (...) DO NOTHING`
  for seed/flag migrations, or naturally-idempotent `GRANT`/`REVOKE`/`UPDATE` statements. This is
  **not** a gap — it's the expected pattern for seed/flag/grant-only migrations that don't touch DDL.
  Not exhaustively verified for all ~120 files (sampled 4).
- **DROP operations**: `grep -rn "DROP TABLE"` and `grep -rn "DROP COLUMN"` across all 345 root files
  return zero live-executed instances — every match is inside a `--` rollback-plan comment (many
  migrations explicitly document "Rollback: DROP TABLE IF EXISTS public.x CASCADE" as the *undo*
  procedure, never executed automatically). Several migrations carry an explicit self-attestation
  comment: `"No DROP TABLE / DROP COLUMN. Additive only."` — this is now a consistent house style
  across the 2026-06+ migrations, suggesting the architect's own rule ("No DROP TABLE/COLUMN without
  user approval") is being followed in practice, not just in principle.
- **Backup/temp tables**: `_ao10b_grade_backfill_backup` and `_tsb4_isactive_backfill_backup` are
  data-fix backup tables (from `20260702070000_ao10b_backfill_student_grade_p5.sql` and a related
  `_tsb4` migration) — created to snapshot pre-fix state before a backfill `UPDATE`. Still present in
  the chain; no follow-up migration found that drops them. Flagged in §6 as a minor cleanup item, not
  a defect (they carry RLS per §2's full-coverage check).

---

## 4. Auth & middleware

### 4.1 `src/proxy.ts` (renamed from `middleware.ts` for Next.js 16; ~1,260 lines)

Documented layer sequence (from the file's own header comment, which is more granular than the
CLAUDE.md summary):

| Layer | Responsibility |
|---|---|
| 0 | Subdomain/custom-domain → school config resolution (white-label multi-tenant) |
| 0.5 | `/api/v1/*` bearer/cookie auth gate (401 if neither present, except `/api/v1/health`) |
| 0.6 | Protected page-route redirect for a hardcoded parent-portal prefix list |
| 0.65 | Role-based cross-portal route protection (fail-open, Redis/in-memory role cache, gated by `ENABLE_LAYER_065` — defaults ON in production, OFF elsewhere) |
| 0.7 | Anonymous-visitor `alf_anon_id` cookie mint (for feature-flag rollout sampling determinism) |
| 0.8 | Session-revocation check (`alfanumrik_sid` against `user_active_sessions`, 3-tier cache: in-memory → Redis → Supabase REST, fail-open) |
| 0.9 | Explicitly **removed** — documented as dead code with a "DO NOT re-add" warning (cookie-based route protection broke `signInWithPassword()`'s localStorage token flow) |
| 1 | Supabase session refresh (`supabase.auth.getUser()`, fail-open on outage — sets `x-auth-degraded` header rather than crashing) |
| 2 | Security headers (X-Frame-Options, CSP frame-ancestors, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, HSTS) |
| 2.1 | Bot/scanner path blocking (`/wp-*`, `.php`, `.env`, `/.git`, `/cgi-bin`, path-traversal `..`) — 404, not 403, to avoid signaling existence |
| 2.1 (admin) | `/internal/admin/*` + `/api/internal/admin/*` protection — 3-mechanism secret auth (header / one-time query-param / hashed session cookie), constant-time `secureEqual()` comparisons, dedicated 10 req/min rate bucket |
| 2.5 | Unauthenticated `/` → `/welcome` redirect |
| 3 | Distributed rate limiting (Upstash Redis `Ratelimit.slidingWindow`, in-memory `Map`-based fallback) |

**Rate limits** (constants in the file, recently tuned per an in-file incident writeup dated
2026-05-20): general bucket 600 req/min/IP (raised from 200 to absorb Indian CGNAT IP-sharing —
documented CEO bug report about a "JSON viewer instead of page" symptom), parent bucket 20 req/min/IP,
admin bucket 60 req/min. The rate-limit response is **content-negotiated**: HTML (bilingual, styled)
for browser navigations, JSON for API/XHR callers — a deliberate fix for the CGNAT incident.
`/api/payments/webhook` is explicitly **exempted** from the general rate limiter (documented rationale:
Razorpay's shared egress IPs could get 429'd, which Razorpay treats as terminal and does not retry —
auth integrity is preserved because the route still HMAC-verifies every request before any DB write).

**Bot detection**: static path/extension denylist only (no user-agent sniffing or behavioral
heuristics observed in this file).

**Session handling**: Supabase SSR cookie-based (`@supabase/ssr` `createServerClient`), plus a
custom `alfanumrik_sid` device-limit session-revocation layer independent of Supabase's own session.

### 4.2 RBAC shape

- **`src/lib/rbac.ts`** (798 lines) — `authorizeRequest()`, `hasPermission()`/`hasAnyPermission()`/
  `hasAllPermissions()`, `canAccessStudent()` (the single ownership-check function covering
  own/parent-linked/teacher-assigned/admin/institution-admin paths), Redis-backed permission cache
  (5-min TTL, in-memory fallback, taint-marker instant-invalidation for security events), audit
  logging (`logAudit()`).
- **`src/lib/rbac-types.ts`** — canonical `RoleName` type: **11 roles** —
  `student | parent | teacher | tutor | admin | super_admin | institution_admin | content_manager |
  reviewer | support | finance`.
- **`src/lib/rbac.ts` `PERMISSIONS` registry**: 69 named constants (TS companion to the DB
  `permissions` table, documented as "must have a matching row in the DB").
- **DB matrix source of truth**: migration `20260612123200_rbac_matrix_conformance.sql` (REG-120,
  "single additive idempotent root migration covers every role/permission/grant") seeds 11 roles
  (`student` hierarchy_level 10 → `super_admin` 100) and ~94 permission tuples in one `INSERT`
  statement (`ON CONFLICT (code) DO NOTHING`). A broader regex across the full chain for
  permission-code-shaped literals finds ~110 distinct matches (**approximate — this regex is loose
  and likely over/undercounts**; a live `SELECT COUNT(*) FROM permissions` would be the authoritative
  number, not obtained here since this is a read-only file-based audit).
- **Additional roles beyond CLAUDE.md's "6 roles" claim**: `institution_admin`, `content_manager`,
  `reviewer`, `support`, `finance` are all real, seeded, hierarchy-leveled roles — not experimental
  or dead code (see §6).

---

## 5. CI/CD + deployment

### 5.1 GitHub Actions workflows (22 files, not the "3 workflows" the architect's own system prompt claims)

| Workflow | Trigger | Purpose (from filename/header) |
|---|---|---|
| `ci.yml` | push (main/master/develop), PR | Main gate: secret-scan (gitleaks + regex, blocking since 2026-04-27) → RLS-on-CREATE-TABLE migration safety (blocking) → lint/type-check/test/coverage → auth/identity test gate (blocking) → Deno edge-function tests → live-DB integration tests (blocking) → build + bundle-size gate (2 mechanisms: largest-chunk check + authoritative gzipped per-page `check:bundle-size` script) → E2E (advisory) → E2E critical-paths (blocking, quiz+payment specs only, PRs into main/staging) → post-deploy health check (main only, with Vercel deployment-protection soft-pass handling) |
| `deploy-production.yml` | push to main | 10 jobs — production deploy pipeline |
| `deploy-staging.yml` | push to develop/staging | 7 jobs |
| `deploy-aws.yml` | push to main | 7 jobs — AWS ECS deploy (parallel deployment target to Vercel — see §6 drift note) |
| `python-ai-deploy.yml` | push to main, paths `python/**` | 7 jobs — Python AI services CI/CD (Cloud Run migration referenced in CLAUDE.md) |
| `sync-staging-migrations.yml` | push to main, paths `supabase/migrations/**` | 3 jobs |
| `sync-staging-functions.yml` | push to main, paths `supabase/functions/**` | 3 jobs |
| `schema-reproducibility-fix.yml` | manual (`workflow_dispatch`) | 9 jobs — the P0 schema-reproducibility runbook automation |
| `migration-lint.yml` | PR, paths `supabase/migrations/**` | 2 jobs — SELECT-1 placeholder guard |
| `openapi-contract.yml` | push, paths `src/lib/api/v2/contract.ts` | 3 jobs — OpenAPI drift check |
| `mobile-ci.yml` | PR, paths `mobile/**`, `openapi/v2.json` | 4 jobs |
| `mobile-release.yml` | manual | 3 jobs — Play Store release |
| `rag-eval.yml` | manual + nightly (22:00 UTC) + PR | 4 jobs — grounded-answer regression detector |
| `content-quality-nightly.yml` | manual + nightly (04:00 UTC) | 3 jobs |
| `mesh-cron.yml` | nightly (02:00 UTC) + manual | 3 jobs — "Mesh Autonomous Cron" |
| `synthetic-monitor.yml` | every 15 min + manual | 3 jobs |
| `pipeline-alert.yml` | `workflow_run` (watches Deploy Production, Sync Migrations to Staging, CI) | 3 jobs — REG-130 out-of-band pipeline-failure alerting |
| `peer-deps-guard.yml` | PR, paths `package.json`/`package-lock.json`/`next.config.js` | 3 jobs |
| `branch-cleanup-on-merge.yml` | PR closed | 2 jobs |
| `branch-stale-sweep.yml` | weekly (Mon 06:00 UTC) + manual | 3 jobs |
| `staging-adaptive-drill.yml` | manual | 2 jobs |
| `staging-flag-set.yml` | manual | 2 jobs |
| `seed-staging-test-student.yml` | manual | 2 jobs |

### 5.2 `ci.yml` gates enforced (detail)

1. **Secret scanning** — gitleaks (blocking) + a regex-based supplementary scan (advisory,
   `exit 0` even on hits — flagged in §6, this is inconsistent with the "blocking since 2026-04-27"
   comment directly above it in the same file).
2. **Migration RLS safety** — blocking, per-file `CREATE TABLE` → `ENABLE ROW LEVEL SECURITY`
   co-presence check, skips `_legacy/`.
3. **Lint** (`npm run lint`), **type-check** (`npm run type-check`, 6GB heap), **test with coverage**
   (`npm test -- --coverage`) — all blocking.
4. **Auth & Identity test gate** — separately re-run and explicitly blocking (`src/__tests__/auth-*`,
   `identity-*`), a deliberate defense against unrelated test-suite changes masking an auth
   regression.
5. **Edge Function Deno tests** — narrow, hermetic, offline-only subset (`--allow-read --allow-env`,
   no `--allow-net`); explicitly excludes any Edge Function test that binds a socket via
   `Deno.serve()`.
6. **Integration tests (live DB)** — blocking (`continue-on-error: false`, restored 2026-05-05 after
   a staging schema-drift debugging period), gated on `STAGING_SUPABASE_*` secrets being present
   (skips cleanly on forked PRs).
7. **Build** — `npm run build`, 6GB heap.
8. **Bundle size** — two mechanisms: (a) bash-based largest-single-chunk + middleware + per-page-dir
   check against `SHARED_JS_LIMIT_KB=160` / `PAGE_JS_LIMIT_KB=260` / `MIDDLEWARE_LIMIT_KB=120`; (b)
   `npm run check:bundle-size` — the "authoritative" gzipped HTML-scan script referenced in the P10
   constitution section, with its own internal `CAP_SHARED_KB` (284 per the constitution's latest
   entry). Both blocking.
9. **E2E (full suite)** — advisory (`continue-on-error: true`), documented as pending flake cleanup.
10. **E2E critical-paths** — blocking, scoped to `quiz-happy-path.spec.ts` + `payment-checkout.spec.ts`
    only, runs against the live production domain with `page.route()`-mocked RPC responses (REG-45,
    REG-46).
11. **Post-deploy health check** (main only) — hits `https://alfanumrik.com/api/v1/health`, with a
    documented soft-pass carve-out for Vercel's own deployment-protection challenge responses
    (401/403/429) distinguished from genuine app-level failures (5xx or unexpected non-200 always
    hard-fail).

### 5.3 `vercel.json`

- Region: `bom1` (Mumbai) — matches constitution.
- Function timeouts: default API routes 30s, `src/app/**/*.tsx` (SSR) 15s — matches constitution.
  Four specific cron routes get an extended 300s timeout (`daily-cron`, `irt-calibrate`,
  `board-score`, `internal/cron/fix-failed-questions`); all other `/api/cron/**` get 60s.
- **12 Vercel cron jobs** registered (not mentioned as a count anywhere in the constitution):
  `school-operations` (02:00 UTC), `daily-cron` (02:30 UTC), `irt-calibrate` (02:50 UTC, matches
  REG-44 pin), `reconcile-payments` (every 30 min), `payments-health` (every 10 min),
  `expired-subscriptions` (every 6h), `account-purge` (04:00 UTC), `pre-debit-notice` (every 6h),
  `board-score` (03:00 UTC), `reverify-domains` (03:45 UTC), `foxy-quality-sample` (03:40 UTC),
  `internal/cron/fix-failed-questions` (every 15 min), `streak-guardian` (16:30 UTC).
- `cleanUrls: true`, `trailingSlash: false`.

### 5.4 Environment variable requirements (`src/lib/env.ts`, validated at production build)

Required (throws at build/runtime if missing in production): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPER_ADMIN_SECRET` — exact match to both
CLAUDE.md and the constitution's stated list. `next.config.js` itself does not directly reference
these (validation lives in `src/lib/env.ts`, invoked elsewhere in the build path) — a minor
indirection from what the task prompt implied ("from next.config.js validation") but functionally
equivalent.

### 5.5 `next.config.js` security/caching (sampled, not exhaustively read)

Security headers block (`async headers()`) sets `X-Frame-Options: DENY`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, and a
`Content-Security-Policy`. Caching: `no-cache, no-store, must-revalidate` for one path group,
`public, max-age=31536000, immutable` for hashed static assets, `stale-while-revalidate` patterns
(86400s / 604800s) for two other groups, and `no-store, max-age=0` for a dynamic group.

### 5.6 Build-enforced auth-topology guard (`scripts/auth-guard.js`)

Not a GitHub Action but a script referenced by CLAUDE.md as "build-enforced." Checks (fail-closed,
`process.exit(1)`): `src/middleware.ts` must **not** exist (Next.js 16 requires `proxy.ts` only);
`src/proxy.ts` must exist, export a `proxy` function, and contain security headers
(`X-Frame-Options`). Confirms the CLAUDE.md claim that this script build-enforces the proxy.ts
rename.

---

## 6. Ownership + gaps

### 6.1 Constitution drift (numbers that no longer match reality)

| Claim (source) | Stated value | Observed value | Drift |
|---|---|---|---|
| Root migrations (architect prompt: "160+ migrations") | 160+ | **345** | Understated by >2x — the architect's own domain-ownership line is stale |
| `.claude/CLAUDE.md`: "1 baseline migration + 349 archived" | 1 root file | **345 root files** (1 baseline + 344 dated) | The "1 baseline" framing describes the state immediately after the 2026-05-03 cleanup, not the current state 2 months later — 344 migrations have landed since |
| `.claude/CLAUDE.md`: "RBAC (6 roles, 71 permissions)" | 6 roles / 71 permissions | **11 roles** (`RoleName` type + DB seed) / **~69-110 permissions** depending on source (TS registry vs. migration seed vs. full-chain regex) | Roles undercounted by nearly 2x; `institution_admin`, `content_manager`, `reviewer`, `support`, `finance` are real, seeded, non-experimental roles absent from the constitution's headline |
| `.claude/CLAUDE.md` / `CLAUDE.md`: "29 Supabase Edge Functions" | 29 | **47-48** function directories with `index.ts` | Understated by ~65% — significant growth (AlfaBot, board-score, invoice-generator, bulk-jee-neet imports, webhook-dispatcher, projector-runner/health-check, coverage-audit, grade-experiment-conclusion, etc. are all present on disk and not in the constitution's function list) |
| Architect's own system prompt: "3 workflows" | 3 | **22** | Understated by >7x — the architect prompt's CI/CD ownership line was written when the pipeline was much smaller |
| CLAUDE.md: "440+ policies" (RLS) | 440+ | 522 in baseline alone (chain-wide not re-counted) | Roughly consistent, possibly now higher given 94 new tables since baseline |
| CLAUDE.md: "280+ API routes" | 280+ | not verified in this pass (out of scope — belongs to a backend-owned inventory, not re-derived here) | n/a |

These are not new defects introduced by any change under review — they are the natural result of
active development outpacing periodic constitution reconciliation. Flagging them here because the
task asked for "infra config drift vs constitution claims," and because stale numbers in an agent's
own system prompt (roles, workflow count, Edge Function count) could lead a future agent invocation
to under-scope a review (e.g., assuming only 3 CI workflows need updating when a middleware change
actually touches 22).

### 6.2 Additional deployment target not mentioned in CLAUDE.md

`deploy-aws.yml` (7 jobs, triggers on push to `main`) deploys to AWS ECS. Neither `CLAUDE.md` nor
`.claude/CLAUDE.md` mentions AWS as a deployment target — both describe Vercel (bom1) as *the*
deployment platform. This could be: (a) a parallel/DR target intentionally undocumented in the
product constitution, (b) a stale/abandoned workflow left over from an earlier infra decision, or
(c) a genuine gap in the constitution. Not resolved here — flagged for the user/ops to clarify, since
"which target is authoritative for production traffic" has real operational-safety implications
(e.g., which one the post-deploy health check in `ci.yml` is actually validating — it hits
`alfanumrik.com`, which resolves to whichever target currently owns DNS).

### 6.3 Secret-scan inconsistency inside `ci.yml`

The `secret-scan` job's supplementary regex scan is commented as having been "flipped from advisory
→ BLOCKING" on 2026-04-27 (per the comment directly above the gitleaks step), but the regex-scan step
itself still ends with `exit 0` on findings (explicitly commented "Non-blocking: deploy should not be
gated by noisy regex false positives"). The **gitleaks** step is genuinely blocking (no
`continue-on-error`); the **regex** step is advisory despite a comment implying otherwise one section
up. This is a documentation/comment drift inside the same file, not a security hole (gitleaks still
blocks) — but worth a one-line comment fix so a future reader doesn't assume the regex scan blocks.

### 6.4 Two orphaned backup tables

`_ao10b_grade_backfill_backup` and `_tsb4_isactive_backfill_backup` — created by data-fix migrations
as pre-change snapshots, never dropped in a follow-up migration. Not a security or correctness issue
(both carry RLS per the full-coverage check in §2), but they're schema clutter that should eventually
get a `DROP TABLE` migration (with user approval, per the architect's own DROP rule) once the
underlying backfills (`ao10b_backfill_student_grade_p5`, the `_tsb4` isactive backfill) are confirmed
safe and no longer need a rollback path.

### 6.5 `mass_gen_log` — undocumented RLS-enabled-no-policy table

Unlike `school_subscriptions` (which has an explicit `COMMENT ON TABLE` documenting the
zero-policy posture as intentional, migration `20260516030000`), `mass_gen_log` has RLS enabled with
zero policies but **no equivalent documentation comment found** in this scan. Very likely the same
"service-role-only, intentional" pattern (the name suggests a bulk-generation audit log, a
service-role-only write path), but it should get the same one-line `COMMENT ON TABLE` treatment as
`school_subscriptions` so the Supabase advisor's `0008_rls_enabled_no_policy` lint has a documented
override rather than an implicit one. Low-risk, easy follow-up.

### 6.6 SECURITY DEFINER surface size

242 distinct SECURITY DEFINER functions in the baseline alone is a large elevated-privilege surface
(roughly 80% of all baseline functions). Two remediation migrations exist
(`20260516000000_fix_security_definer_views.sql`, `20260614200000_repair_security_advisor_batch1.sql`)
indicating active management of this surface, and the architect's own rule requires a justifying
comment on every one. Not exhaustively verified here whether all 242+ carry that comment — this is
the single highest-value follow-up audit if a deeper security pass is warranted (a targeted
`grep -B5 "SECURITY DEFINER"` sweep checking for an adjacent rationale comment on every function,
which was out of scope for this read-only inventory pass given the ~800-line budget).

### 6.7 Duplicate-looking helper functions (not resolved, flagged for backend/architect follow-up)

Several RAG-retrieval RPCs coexist with overlapping signatures: `hybrid_rag_search`,
`match_rag_chunks`, `match_rag_chunks_ncert`, `search_rag_chunks`, `select_quiz_questions_rag`, and
`get_rag_chunks_for_node` all query `rag_content_chunks`/`question_bank` with vector-similarity
signatures that look like iterative refinements of the same capability rather than clearly distinct
call sites. This wasn't resolved by tracing every caller (out of scope for a schema-only inventory)
but is flagged as a candidate for an ai-engineer-owned consolidation review — dead/superseded RPCs
left in the schema are exactly the kind of drift this kind of audit exists to surface.

### 6.8 What was NOT independently re-verified (explicit scope boundary)

- Chain-wide (as opposed to baseline-only) trigger, index, and policy counts — only spot-checked.
- Whether every one of the ~120 "no idempotency marker" migration files uses a genuinely-idempotent
  alternative (4 were sampled and confirmed; the remaining ~116 were not individually opened).
- Live DB introspection (`\d`, `pg_policies`, `pg_proc`) — everything here is derived from migration
  SQL text, which is authoritative for what *should* be applied but was not cross-checked against an
  actual running Postgres instance.
- API route count, RBAC route-level enforcement completeness, and non-AI/AI Edge Function code
  content — these belong to backend/ai-engineer inventories respectively and were not duplicated
  here.
