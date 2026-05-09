# function_executable WARN Triage (248 unique functions)

**Date:** 2026-05-09  
**Branch:** `fix/supabase-advisors-tier1`  
**Source:** Supabase advisors `authenticated_security_definer_function_executable` + `anon_security_definer_function_executable` from project `shktyoxqhundlvkiwguu` (snapshot 2026-05-09).  
**Counts in advisor output:** 254 anon WARNs + 254 authenticated WARNs = **508 total**, mapping to **248 unique function names** (some Supabase-internal duplicates around overloads explain the 254 vs 248 delta in our parse).

**Status: ANALYSIS ONLY.** Do not generate the migration from this runbook automatically — Bucket 1 alone contains payment-critical and quiz-critical RPCs that must keep `EXECUTE` for `authenticated`. The migration must be hand-reviewed against this triage and then dry-run on staging before any prod application.

## Method

Static-analysis classifier (`.tmp-classify-final.mjs` in repo root, working artifacts in `.tmp-*.json`):

1. Parse advisor JSON, dedupe to 248 unique function names + their argument signatures.
2. For each name scan:
   - **TS sources** (`src/app/**`, `src/lib/**`, 688 files): match `.rpc('<name>'` and `/rest/v1/rpc/<name>`.
   - **Edge functions** (`supabase/functions/**`, 100 files): same patterns; flag whether the file uses the service-role key.
   - **Migrations** (`supabase/migrations/**`, 432 files): `CREATE TRIGGER ... EXECUTE FUNCTION <name>`, `CREATE FUNCTION <name>`, and bare `<name>(` calls inside other SQL bodies (excluding DDL on the function itself). Plus a paren-aware splitter to find `<name>(` inside `CREATE POLICY` USING/WITH CHECK clauses (RLS helpers).
3. For TS callers, classify each by whether the file imports `@/lib/supabase` / `@/lib/supabase-server` (anon/authenticated client surface) versus `@/lib/supabase-admin` (service-role). Mixed-import files are treated conservatively as authenticated surface.
4. Bucket assignment uses the rules below; ambiguous cases drop to Bucket 5 by design.

## Bucket assignment rules

| Bucket | Definition | Action |
|---|---|---|
| 1 | Function is `.rpc()`-called from a TS file that uses the authenticated/anon Supabase client. | **KEEP** `GRANT EXECUTE ... TO authenticated` (and `anon` where appropriate). The lint is expected for these. |
| 2 | Function is `.rpc()`-called only from `supabase-admin` clients or from Edge Functions wired with the service-role key, OR is called only from inside other SECURITY DEFINER SQL functions. | **REVOKE** `EXECUTE` from `anon, authenticated`. Service-role bypasses GRANTs. SQL-internal callers run as the definer of the outer function. |
| 3 | Function name matches a trigger-naming convention OR is wired via `CREATE TRIGGER ... EXECUTE FUNCTION <name>` and has no RPC callers. | **REVOKE** `EXECUTE` from `anon, authenticated`. Triggers fire under the table-modifier's privileges; SECURITY DEFINER trigger fns run as definer. |
| 4 | Function is defined in a migration but has no RPC callers, no SQL internal callers, no trigger wiring, no policy reference. Likely orphan/legacy/superseded. | **REVOKE** `EXECUTE` from `anon, authenticated`. Flag for follow-up `DROP FUNCTION` review. |
| 5 | Anything ambiguous — RLS-policy helper, name suggests trigger but no CREATE TRIGGER found, mixed-client RPC, or other low-confidence call. | **KEEP** until reviewed manually. False negatives in Buckets 2/3 break production RLS or trigger paths; false positives in Bucket 5 only delay the cleanup. |

## Summary

| Bucket | Count | % of 248 | Action |
|---|---|---|---|
| 1. RPC-callable from authenticated client (KEEP) | 46 | 18.5% | No change |
| 2. Service-role only / SQL-internal only (REVOKE) | 54 | 21.8% | Migration |
| 3. Trigger functions (REVOKE) | 13 | 5.2% | Migration |
| 4. Unused / orphaned (REVOKE; consider drop) | 119 | 48.0% | Migration; follow up to DROP |
| 5. Manual review needed | 16 | 6.5% | Defer |
| **Total** | **248** | **100%** | — |

**Eventual REVOKE migration scope:** Buckets 2 + 3 + 4 = **186 functions**. Each gets one `REVOKE EXECUTE ON FUNCTION public.<name>(<sig>) FROM anon, authenticated;` line.

Bucket 5's 16 functions remain at status quo until a human walks through them (estimate at the bottom).

## Bucket 1 — RPC-callable from authenticated client (KEEP grants)

These are the authenticated-client RPC surface area. The `function_executable` WARN is **expected** for them: revoking `EXECUTE` would 500 the corresponding feature for every signed-in user.

Suppress these advisors via Supabase's per-function exception list (or a query-time filter), or accept them as known.

| Function | Args | Caller(s) |
|---|---|---|
| `atomic_quiz_profile_update` | `p_student_id uuid, p_subject text, p_xp integer, p_total integer, p_correct integer, p_...` | `src/lib/domains/profile.ts`, `src/lib/domains/quiz.ts` |
| `available_chapters_for_student_subject_v2` | `p_student_id uuid, p_subject_code text` | `src/app/api/student/chapters/route.ts` |
| `bootstrap_user_profile` | `p_auth_user_id uuid, p_role text, p_name text, p_email text, p_grade text, p_board text...` | `src/app/api/auth/bootstrap/route.ts`, `src/app/auth/callback/route.ts` |
| `check_and_record_usage` | `p_student_id uuid, p_feature text, p_usage_date date, p_limit integer` | `src/app/api/foxy/route.ts`, `src/lib/usage.ts` |
| `complete_experiment` | `p_simulation_id text, p_subject text, p_grade text, p_observation_type text, p_observat...` | `src/app/stem-centre/page.tsx` |
| `delete_student_account` | `p_student_id uuid` | `src/app/profile/page.tsx` |
| `generate_exam_paper` | `p_student_id uuid, p_subject text, p_grade text, p_chapters integer[], p_template_id uuid` | `src/app/api/quiz/route.ts`, `src/lib/supabase.ts` |
| `generate_student_notifications` | `p_student_id uuid` | `src/lib/supabase.ts` |
| `generate_weekly_study_plan` | `p_student_id uuid, p_subject text, p_daily_minutes integer, p_days integer` | `src/lib/supabase.ts` |
| `get_available_subjects` | `p_student_id uuid` | `src/lib/subjects.ts` |
| `get_available_subjects_v2` | `p_student_id uuid` | `src/app/api/student/subjects/route.ts` |
| `get_bloom_progression` | `p_student_id uuid, p_subject text` | `src/lib/supabase.ts` |
| `get_board_exam_questions` | `p_subject text, p_grade text, p_count integer, p_year integer` | `src/lib/supabase.ts` |
| `get_chapter_rag_content` | `p_grade text, p_subject text, p_chapter_number integer, p_content_type text` | `src/app/api/concept-engine/route.ts`, `src/lib/supabase.ts` |
| `get_competition_leaderboard` | `p_competition_id uuid, p_limit integer` | `src/lib/supabase.ts` |
| `get_competitions` | `p_student_id uuid, p_status text` | `src/lib/supabase.ts` |
| `get_dashboard_data` | `p_student_id uuid` | `src/app/api/super-admin/students/[id]/dashboard/route.ts`, `src/lib/supabase.ts` |
| `get_due_reviews` | `p_student_id uuid, p_subject_code text, p_limit integer` | `src/app/api/rhythm/today/route.ts` |
| `get_guardian_dashboard` | `p_guardian_id uuid` | `src/lib/supabase.ts` |
| `get_hall_of_fame` | `p_limit integer` | `src/lib/supabase.ts` |
| `get_knowledge_gaps` | `p_student_id uuid, p_subject text, p_limit integer` | `src/lib/supabase.ts` |
| `get_leaderboard` | `p_period text, p_limit integer` | `src/app/api/v1/leaderboard/route.ts`, `src/lib/domains/profile.ts` |
| `get_ncert_coverage_report` | `p_grade text, p_subject text` | `src/lib/supabase.ts` |
| `get_quiz_questions` | `p_subject text, p_grade text, p_count integer, p_difficulty integer` | `src/lib/supabase.ts` |
| `get_review_cards` | `p_student_id uuid, p_limit integer` | `src/lib/domains/profile.ts`, `src/lib/supabase.ts` |
| `get_school_classes` | `p_school_id uuid` | `src/app/school-admin/classes/page.tsx` |
| `get_school_dashboard_stats` | `p_school_id uuid` | `src/app/school-admin/page.tsx` |
| `get_school_students` | `p_school_id uuid, p_class_id uuid` | `src/app/school-admin/students/page.tsx` |
| `get_school_teachers` | `p_school_id uuid` | `src/app/school-admin/teachers/page.tsx` |
| `get_student_notifications` | `p_student_id uuid, p_limit integer` | `src/lib/supabase.ts` |
| `get_student_snapshot` | `p_student_id uuid` | `src/lib/domains/profile.ts`, `src/lib/supabase.ts` |
| `get_study_plan` | `p_student_id uuid` | `src/lib/domains/profile.ts`, `src/lib/supabase.ts` |
| `get_user_permissions` | `p_auth_user_id uuid` | `src/lib/rbac.ts`, `src/lib/usePermissions.ts` |
| `get_user_role` | `p_auth_user_id uuid` | `src/lib/AuthContext.tsx`, `src/lib/supabase.ts` |
| `join_competition` | `p_student_id uuid, p_competition_id uuid` | `src/lib/supabase.ts` |
| `link_guardian_to_student_via_code` | `p_guardian_id uuid, p_invite_code text` | `src/app/parent/children/page.tsx`, `src/lib/supabase.ts` |
| `mark_all_notifications_read` | `p_student_id uuid` | `src/app/notifications/page.tsx`, `src/lib/supabase.ts` |
| `select_quiz_questions_rag` | `p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count inte...` | `src/app/api/quiz/route.ts`, `src/lib/domains/quiz.ts` |
| `select_quiz_questions_v2` | `p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count inte...` | `src/lib/domains/quiz.ts`, `src/lib/supabase.ts` |
| `start_quiz_session` | `p_student_id uuid, p_question_ids uuid[]` | `src/lib/supabase.ts` |
| `student_join_class` | `p_student_id uuid, p_class_code text` | `src/lib/supabase.ts` |
| `submit_challenge_attempt` | `p_student_id uuid, p_challenge_id uuid, p_solved boolean, p_moves integer, p_hints_used...` | `src/app/challenge/page.tsx` |
| `submit_quiz_results` | `p_student_id uuid, p_subject text, p_grade text, p_topic text, p_chapter integer, p_res...` | `src/lib/domains/quiz.ts`, `src/lib/supabase.ts` |
| `submit_quiz_results_v2` | `p_session_id uuid, p_student_id uuid, p_subject text, p_grade text, p_topic text, p_cha...` | `src/app/api/quiz/submit/route.ts`, `src/lib/supabase.ts` |
| `track_ai_quality` | `p_subject text, p_is_thumbs_up boolean, p_is_report boolean` | `src/app/api/student/foxy-interaction/route.ts`, `src/app/foxy/page.tsx` |
| `update_chapter_progress` | `p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer` | `src/lib/supabase.ts` |

## Bucket 2 — Service-role only / SQL-internal only (REVOKE EXECUTE)

Either invoked through the service-role client (which bypasses GRANTs anyway) or only from inside another SECURITY DEFINER function (which runs as the function's definer). Revoking `EXECUTE` from `anon, authenticated` is safe.

| Function | Args | Reason / caller |
|---|---|---|
| `activate_subscription` | `p_auth_user_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text...` | called only from inside other SQL functions (2 file(s)) (`supabase/migrations/_legacy/timestamped/20260425150300_activate_with_advisory_lock.sql`, `supabase/migrations/_legacy/timestamped/20260502170000_hotfix_p11_atomic_subscription_rpcs.sql`) |
| `activate_subscription_locked` | `p_auth_user_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text...` | rpc-called only from service-role client (2 file(s)) (`src/app/api/payments/verify/route.ts`, `src/app/api/payments/webhook/route.ts`) |
| `add_xp` | `p_student_id uuid, p_xp integer, p_source text` | rpc-called only from edge functions using service role (`supabase/functions/foxy-tutor/index.ts`) |
| `admin_repair_user_onboarding` | `p_auth_user_id uuid, p_force_role text` | rpc-called only from service-role client (1 file(s)) (`src/app/api/auth/repair/route.ts`) |
| `archive_dead_subject_enrollments` | _(no args)_ | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260415000017_archive_dead_subject_enrollments.sql`) |
| `atomic_cancel_subscription` | `p_student_id uuid, p_immediate boolean, p_reason text` | rpc-called only from service-role client (1 file(s)) (`src/app/api/payments/cancel/route.ts`) |
| `atomic_downgrade_subscription` | `p_student_id uuid, p_cancelled_sub_id text, p_new_status text` | rpc-called only from service-role client (1 file(s)) (`src/app/api/payments/webhook/route.ts`) |
| `atomic_subscription_activation` | `p_student_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, ...` | called only from inside other SQL functions (2 file(s)) (`supabase/migrations/_legacy/timestamped/20260425150300_activate_with_advisory_lock.sql`, `supabase/migrations/_legacy/timestamped/20260502170000_hotfix_p11_atomic_subscription_rpcs.sql`) |
| `atomic_subscription_activation_locked` | `p_student_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, ...` | rpc-called only from service-role client (1 file(s)) (`src/app/api/payments/webhook/route.ts`) |
| `available_chapters_for_student_subject` | `p_student_id uuid, p_subject_code text` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260415000015_validate_academic_scope.sql`) |
| `award_coins` | `p_student_id uuid, p_amount integer, p_source text, p_metadata jsonb` | rpc-called only from service-role client (1 file(s)) (`src/app/api/student/daily-lab/claim/route.ts`) |
| `award_xp` | `p_student_id uuid, p_amount integer, p_source text, p_subject text, p_daily_category te...` | called only from inside other SQL functions (3 file(s)) (`supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260405300000_xp_transaction_ledger.sql`) |
| `cancel_account_deletion` | `p_account_id uuid` | rpc-called only from service-role client (1 file(s)) (`src/app/api/v1/account/delete/route.ts`) |
| `check_and_award_achievements` | `p_student_id uuid` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/00000000000000_baseline_from_prod.sql`) |
| `check_expired_subscriptions` | _(no args)_ | rpc-called only from service-role client (1 file(s)) (`src/app/api/cron/expired-subscriptions/route.ts`) |
| `claim_verification_batch` | `p_batch_size integer, p_claimed_by text, p_claim_ttl_seconds integer` | rpc-called only from edge functions using service role (`supabase/functions/verify-question-bank/index.ts`) |
| `compute_session_cognitive_metrics` | `p_student_id uuid, p_quiz_session_id uuid` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260408000014_affective_state_computation_pipeline.sql`) |
| `compute_student_affective_profile` | `p_student_id uuid` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260408000014_affective_state_computation_pipeline.sql`) |
| `compute_subject_content_readiness` | _(no args)_ | called only from inside other SQL functions (4 file(s)) (`supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260415000013_subject_content_readiness.sql`) |
| `enqueue_event` | `p_event_type text, p_aggregate_type text, p_aggregate_id uuid, p_payload jsonb` | called only from inside other SQL functions (8 file(s)) (`supabase/migrations/20260507000003_atomic_school_plan_change_rpc.sql`, `supabase/migrations/_legacy/timestamped/20260425130000_first_domain_event_publication.sql`) |
| `evaluate_alert_rules` | `p_rule_id uuid` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260413120000_observability_console_1b.sql`) |
| `experiment_coins_today` | `p_student_id uuid` | called only from inside other SQL functions (2 file(s)) (`supabase/migrations/20260504200000_stem_lab_engagement_tier1.sql`, `supabase/migrations/20260504200100_stem_lab_badges.sql`) |
| `find_diagram_references` | `p_grade text, p_subject text` | rpc-called only from edge functions using service role (`supabase/functions/embed-diagrams/index.ts`) |
| `generate_monthly_report` | `p_student_id uuid, p_month date` | rpc-called only from edge functions using service role (`supabase/functions/parent-portal/index.ts`) |
| `get_adaptive_questions_v2` | `p_student_id uuid, p_subject text, p_limit integer, p_include_review boolean, p_mode te...` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/20260503140000_add_phase2_goal_aware_selection.sql`) |
| `get_chapter_concepts` | `p_grade text, p_subject text, p_chapter_number integer` | rpc-called only from service-role client (1 file(s)) (`src/app/api/concept-engine/route.ts`) |
| `get_chapter_progress` | `p_student_id uuid, p_subject text, p_grade text` | rpc-called only from service-role client (1 file(s)) (`src/app/api/quiz/route.ts`) |
| `get_chapter_qa_from_rag` | `p_grade text, p_subject text, p_chapter_number integer` | rpc-called only from service-role client (1 file(s)) (`src/app/api/concept-engine/route.ts`) |
| `get_ncert_questions` | `p_subject text, p_grade text, p_chapter integer, p_question_type text, p_limit integer` | rpc-called only from edge functions using service role (`supabase/functions/ncert-question-engine/index.ts`) |
| `get_plan_limit` | `p_student_id uuid, p_feature text` | called only from inside other SQL functions (2 file(s)) (`supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260408000015_drop_old_check_and_record_usage_overload.sql`) |
| `get_subject_violations` | `p_plan text, p_grade text, p_stream text, p_limit integer, p_offset integer` | rpc-called only from service-role client (1 file(s)) (`src/app/api/super-admin/subjects/violations/route.ts`) |
| `halt_subscription` | `p_student_id uuid` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql`) |
| `hybrid_rag_search` | `query_text text, query_embedding public.vector, p_subject text, p_grade text, p_chapter...` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260428000000_match_rag_chunks_ncert_rrf.sql`) |
| `issue_lab_badge` | `p_student_id uuid, p_subject text` | called only from inside other SQL functions (2 file(s)) (`supabase/migrations/20260504200100_stem_lab_badges.sql`, `supabase/migrations/20260508120000_issue_lab_badge_authuid_check.sql`) |
| `mark_subscription_past_due` | `p_student_id uuid, p_grace_days integer` | rpc-called only from service-role client (1 file(s)) (`src/app/api/payments/webhook/route.ts`) |
| `mark_webhook_event_processed` | `p_id uuid, p_outcome text` | rpc-called only from service-role client (1 file(s)) (`src/app/api/payments/webhook/route.ts`) |
| `match_rag_chunks` | `query_text text, p_subject text, p_grade text, match_count integer, p_chapter text, que...` | rpc-called only from service-role client (1 file(s)) (`src/app/api/concept-engine/route.ts`) |
| `match_rag_chunks_ncert` | `query_text text, p_subject_code text, p_grade text, match_count integer, p_chapter_numb...` | rpc-called only from service-role client (1 file(s)) (`src/lib/ai/retrieval/ncert-retriever.ts`) |
| `next_contract_number` | `p_financial_year text, p_state_code text` | rpc-called only from service-role client (2 file(s)) (`src/app/api/super-admin/contracts/route.ts`, `src/app/api/super-admin/contracts/[id]/renew/route.ts`) |
| `next_invoice_number` | `p_financial_year text, p_state_code text` | rpc-called only from edge functions using service role (`supabase/functions/invoice-generator/index.ts`) |
| `rag_grounding_check` | `p_grade text, p_subject text, p_chapter_num integer, p_language text` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/00000000000000_baseline_from_prod.sql`) |
| `recalibrate_question_irt_2pl` | `p_question_id uuid, p_min_attempts integer` | rpc-called only from service-role client (1 file(s)) (`src/app/api/cron/irt-calibrate/route.ts`) |
| `recompute_subject_content_readiness_daily` | _(no args)_ | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260428130000_schedule_content_readiness.sql`) |
| `reconcile_payment` | `p_reconciliation_id uuid` | rpc-called only from service-role client (1 file(s)) (`src/app/api/super-admin/reconciliation/[id]/approve/route.ts`) |
| `reconcile_xp` | `p_student_id uuid` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260408000004_link_quiz_xp_to_ledger.sql`) |
| `record_webhook_event` | `p_account_id text, p_event_id text, p_event_type text, p_raw_payload jsonb` | rpc-called only from service-role client (1 file(s)) (`src/app/api/payments/webhook/route.ts`) |
| `request_account_deletion` | `p_account_id uuid, p_role text, p_reason text, p_auth_user_id uuid` | rpc-called only from service-role client (1 file(s)) (`src/app/api/v1/account/delete/route.ts`) |
| `send_notification` | `p_recipient_id uuid, p_recipient_type text, p_type text, p_title text, p_body text, p_d...` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/00000000000000_baseline_from_prod.sql`) |
| `set_student_subjects` | `p_student_id uuid, p_subjects text[], p_preferred text` | rpc-called only from service-role client (2 file(s)) (`src/app/api/student/preferences/route.ts`, `src/app/api/super-admin/students/[id]/subjects/route.ts`) |
| `transition_content_status` | `p_table text, p_id uuid, p_new_status text, p_actor_id uuid, p_notes text` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260328020000_cms_scalability.sql`) |
| `update_burst_progress` | `p_student_id uuid, p_action_type text, p_value integer` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/00000000000000_baseline_from_prod.sql`) |
| `update_concept_mastery_bkt` | `p_student_id uuid, p_topic_id uuid, p_is_correct boolean, p_p_learn double precision, p...` | rpc-called only from edge functions using service role (`supabase/functions/queue-consumer/index.ts`) |
| `update_irt_theta` | `p_student_id uuid, p_subject text` | called only from inside other SQL functions (1 file(s)) (`supabase/migrations/_legacy/timestamped/20260408000012_irt_theta_estimation_rpc_and_trigger.sql`) |
| `validate_academic_scope` | `p_student_id uuid, p_grade text, p_subject text, p_chapter_number integer` | rpc-called only from service-role client (1 file(s)) (`src/app/api/quiz/route.ts`) |

## Bucket 3 — Trigger functions (REVOKE EXECUTE)

These are wired via `CREATE TRIGGER` or follow strict trigger-function naming conventions. Postgres calls them internally; no application client should ever invoke them via RPC.

| Function | Args | Pattern |
|---|---|---|
| `audit_student_changes` | _(no args)_ | trigger naming pattern |
| `cbse_syllabus_normalize_display` | _(no args)_ | trigger naming pattern |
| `evaluate_alert_rules_for_event` | _(no args)_ | trigger naming pattern |
| `handle_new_user` | _(no args)_ | trigger naming pattern |
| `handle_user_email_verified` | _(no args)_ | trigger naming pattern |
| `handle_user_login` | _(no args)_ | trigger naming pattern |
| `on_student_created` | _(no args)_ | trigger naming pattern |
| `send_welcome_email_on_confirm` | _(no args)_ | trigger naming pattern |
| `send_welcome_email_on_insert` | _(no args)_ | trigger naming pattern |
| `set_quiz_session_school_id` | _(no args)_ | wired via CREATE TRIGGER |
| `set_slp_school_id` | _(no args)_ | wired via CREATE TRIGGER |
| `trg_fn_quiz_session_affective_state` | _(no args)_ | wired via CREATE TRIGGER |
| `trg_fn_update_irt_theta` | _(no args)_ | wired via CREATE TRIGGER |

## Bucket 4 — Unused / orphaned (REVOKE EXECUTE; flag for DROP)

Defined in a migration but no callers (no RPC, no internal SQL call, no trigger wiring, no policy reference). Most are remnants from superseded `_v1` versions, abandoned features, or scheduled-job helpers that were re-implemented as Edge Functions.

**Step 1 (this advisor sweep):** revoke `EXECUTE` from `anon, authenticated` — zero blast radius if the analysis is correct.

**Step 2 (follow-up, separate migration):** review each for `DROP FUNCTION`. A small number of these are likely called by external systems (Razorpay reconciliation cron, ops scripts) that don't live in the repo — those will surface as failed cron jobs once revoked, at which point promote them to Bucket 2 and re-grant.

| Function | Args | Defined in |
|---|---|---|
| `admin_create_mapping` | `p_admin_auth_id uuid, p_guardian_id uuid, p_student_id uuid, p_notes text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `admin_override_mapping` | `p_admin_auth_id uuid, p_link_id uuid, p_action text, p_notes text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `admin_update_user_status` | `p_admin_auth_id uuid, p_target_auth_user_id uuid, p_action text, p_notes text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `archive_old_data` | `p_days integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `archive_processed_events` | `p_older_than interval` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260425120000_domain_events_outbox.sql` |
| `auto_setup_student` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `bkt_update` | `p_student_id uuid, p_node_code text, p_is_correct boolean, p_response_time_ms integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `bkt_update_personalized` | `p_student_id uuid, p_concept_id uuid, p_is_correct boolean` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `build_interleave_queue` | `p_student_id uuid, p_subject text, p_session_size integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `bulk_generate_hpc` | `p_class_id uuid, p_academic_year text, p_term text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `bulk_transition_status` | `p_table text, p_ids uuid[], p_new_status text, p_actor_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260328020000_cms_scalability.sql` |
| `calculate_rl_reward` | `p_student_id uuid, p_action_id uuid, p_is_correct boolean, p_response_time integer, p_e...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `calibrate_irt_parameters` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `check_entitlement` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260328160000_recurring_billing.sql` |
| `check_foxy_quota` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `check_permission` | `p_auth_user_id uuid, p_permission_code text` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260324070000_production_rbac_system.sql` |
| `check_plan_limits` | `p_student_id uuid, p_usage_type text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `check_rate_limit` | `p_identifier text, p_endpoint text, p_max_per_minute integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `claim_ncert_batch` | `p_batch_size integer, p_max_file_size bigint` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `classify_response_error` | `p_response_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `cleanup_foxy_cache` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `cleanup_old_daily_usage` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `cleanup_old_rate_limits` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `cleanup_old_usage` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260325070000_student_daily_usage.sql` |
| `cleanup_old_versions` | `p_keep integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260328020000_cms_scalability.sql` |
| `cleanup_ops_events` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260411120000_observability_console_1a.sql` |
| `close_poll_and_get_results` | `p_poll_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `complete_onboarding` | `p_student_id uuid, p_name text, p_grade text, p_board text, p_subject text, p_language ...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `count_chapters_needing_concepts` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `create_cms_version` | `p_entity_type text, p_entity_id uuid, p_snapshot jsonb, p_change_summary text, p_create...` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260328010000_cms_foundation_actual.sql` |
| `create_guardian_profile` | `p_auth_id uuid, p_name text, p_email text, p_phone text, p_relationship text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `create_student_profile` | `p_auth_user_id uuid, p_name text, p_email text, p_grade text, p_board text, p_language ...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `create_teacher_profile` | `p_auth_user_id uuid, p_name text, p_email text, p_school_name text, p_subjects text[], ...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `current_school_id` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260416200000_tenant_session_var_rls.sql` |
| `delta_sync_pull` | `p_student_id uuid, p_device_id text, p_mastery_since timestamp with time zone, p_graph_...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `diagnose_student` | `p_student_id uuid, p_subject_code text, p_grade text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `end_tutoring_session` | `p_session_id uuid, p_summary text, p_key_learnings text[], p_areas_for_improvement text[]` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `estimate_student_theta` | `p_student_id uuid, p_subject text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `fast_rag_search` | `query_text text, p_subject text, p_grade text, match_count integer, p_chapter text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `fast_rag_search_v2` | `query_text text, p_subject text, p_grade text, match_count integer, p_chapter text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `find_matching_simulation` | `p_subject text, p_grade text, p_message text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `flush_offline_queue` | `p_student_id uuid, p_device_id text, p_actions jsonb` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `generate_at_risk_alerts` | `p_class_id uuid, p_teacher_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `generate_daily_plan` | `p_student_id uuid, p_date date, p_minutes_available integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `generate_hpc` | `p_student_id uuid, p_academic_year text, p_term text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `generate_learning_path` | `p_student_id uuid, p_subject text, p_grade text, p_path_type text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `generate_parent_link_code` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `generate_review_card_from_quiz` | `p_student_id uuid, p_question_id uuid, p_subject text, p_grade text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `generate_smart_nudges` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260324060000_exam_centric_personalization_engine.sql` |
| `get_active_bursts` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_cache_stats` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_chapter_content` | `p_grade text, p_subject text, p_chapter_number integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260403100000_educational_content_rebuild.sql` |
| `get_chapter_media` | `p_grade text, p_subject text, p_chapter_number integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260403100001_diagram_extraction_helpers.sql` |
| `get_chapter_qa` | `p_grade text, p_subject text, p_chapter_number integer, p_source_type text` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260403100000_educational_content_rebuild.sql` |
| `get_chapter_simulations` | `p_subject text, p_grade text, p_chapter integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_chapters_needing_concepts` | `p_batch_size integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_class_mastery_heatmap` | `p_class_id uuid, p_subject text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_competency_report` | `p_student_id uuid, p_subject text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_daily_xp_by_category` | `p_student_id uuid, p_category text` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260405300000_xp_transaction_ledger.sql` |
| `get_exercise_completion` | `p_student_id uuid, p_subject_code text, p_grade text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_learning_snapshot` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_my_guardian_student_ids` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_my_student_ids` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_my_teacher_student_ids` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_narrative_state` | `p_student_id uuid, p_burst_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_ncert_chapter_stats` | `p_subject text, p_grade text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_next_topic` | `p_student_id uuid, p_subject_code text, p_grade text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_pending_link_requests` | `p_student_auth_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_practice_queue` | `p_student_id uuid, p_subject text, p_grade text, p_session_size integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_questions_for_node` | `p_node_code text, p_count integer, p_bloom_level text, p_exclude_ids uuid[]` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_rag_chunks_for_node` | `p_node_code text, p_limit integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_rag_context_for_adaptive` | `p_student_id uuid, p_node_code text, p_limit integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_rag_context_for_cme` | `p_student_id uuid, p_concept_id uuid, p_limit integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_rag_context_for_sr_card` | `p_grade text, p_subject text, p_chapter_number integer, p_bloom_level text, p_limit int...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_simulation` | `p_sim_id uuid, p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_student_plan` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_student_progress` | `p_student_id uuid, p_subject_code text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_student_usage` | `p_student_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_teacher_dashboard_v2` | `p_teacher_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `get_vault_secret` | `secret_name text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `increment_daily_usage` | `p_student_id uuid, p_feature text, p_usage_date date` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260325070000_student_daily_usage.sql` |
| `instant_rag_search` | `query_text text, p_subject text, p_grade text, match_count integer, p_chapter text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `is_admin` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `launch_classroom_poll` | `p_teacher_id uuid, p_class_id uuid, p_question_text text, p_options jsonb, p_correct_in...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `launch_narrative_burst` | `p_student_id uuid, p_subject text, p_template_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `link_guardian_via_invite_code` | `p_guardian_auth_id uuid, p_invite_code text, p_relation_type text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `log_audit` | `p_auth_user_id uuid, p_action text, p_resource_type text, p_resource_id text, p_details...` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260324070000_production_rbac_system.sql` |
| `lookup_foxy_cache` | `p_q text, p_grade text, p_subject text, p_lang text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `match_syllabus_concept` | `p_query text, p_subject text, p_grade text, p_match_count integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260329160000_cbse_syllabus_graph.sql` |
| `promote_student_grade` | `p_student_id uuid, p_new_grade text, p_new_session text, p_actor_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260328120000_identity_integrity.sql` |
| `quiz_grounding_check` | `p_grade text, p_subject text, p_chapter_num integer, p_question_text text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `rag_resolve_chapter` | `p_grade text, p_subject text, p_query text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `rag_validate_answer` | `p_log_id uuid, p_chunks_used integer, p_confidence double precision, p_has_ncert_cite b...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `reconcile_stuck_payments` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `record_adaptive_response` | `p_student_id uuid, p_node_code text, p_is_correct boolean, p_response_time_ms integer, ...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `record_daily_activity` | `p_student_id uuid, p_subject text, p_questions_asked integer, p_questions_correct integ...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `refresh_leaderboard_week` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `refresh_platform_stats` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `renew_subscription` | `p_student_id uuid, p_razorpay_payment_id text, p_amount_inr integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260328160000_recurring_billing.sql` |
| `request_guardian_link` | `p_guardian_auth_id uuid, p_student_email text, p_relation_type text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `revoke_guardian_link` | `p_requester_auth_id uuid, p_link_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `schedule_retention_test` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `schedule_spaced_review` | `p_student_id uuid, p_topic_id uuid, p_quality integer` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `seed_adaptive_mastery` | `p_student_id uuid, p_subject text, p_grade text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `select_next_content` | `p_student_id uuid, p_subject text, p_grade text, p_epsilon double precision` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `set_tenant_context` | `p_school_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260416200000_tenant_session_var_rls.sql` |
| `snapshot_connection_health` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `student_respond_to_link_request` | `p_student_auth_id uuid, p_link_id uuid, p_action text, p_reason text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `submit_poll_response` | `p_poll_id uuid, p_student_id uuid, p_answer_index integer, p_answer_text text, p_respon...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `submit_quiz_results_rpc` | `p_student_id uuid, p_started_at timestamp with time zone, p_finished_at timestamp with ...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `submit_quiz_results_safe` | `p_student_id uuid, p_items jsonb, p_subject text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `sync_onboarding_completed` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `sync_user_roles_for_user` | `p_auth_user_id uuid` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260402100000_robust_auth_onboarding_system.sql` |
| `teacher_create_adaptive_assignment` | `p_teacher_id uuid, p_class_id uuid, p_title text, p_node_codes text[], p_due_date times...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `update_concept_mastery` | `p_student_id uuid, p_topic_id uuid, p_is_correct boolean, p_used_hint boolean` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `update_ncert_chapter_progress` | _(no args)_ | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `update_streak` | `p_student_id uuid, p_subject text` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |
| `upsert_content_gap` | `p_subject text, p_grade text, p_query text, p_topic_title text` | `supabase/migrations/00000000000000_baseline_from_prod.sql`, `supabase/migrations/_legacy/timestamped/20260403000002_add_content_gap_tracking.sql` |
| `write_foxy_cache` | `p_q text, p_resp text, p_grade text, p_subject text, p_ch integer, p_topic text, p_mode...` | `supabase/migrations/00000000000000_baseline_from_prod.sql` |

## Bucket 5 — Needs manual review (DEFER, status quo for now)

These are deliberate Bucket-5 entries: the cost of a wrong revoke (broken RLS, broken trigger) outweighs the cost of carrying the WARN until a human looks at them.

| Function | Args | Why uncertain |
|---|---|---|
| `fn_onboarding_state_on_profile_created` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `fn_populate_subscription_plan_id` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `fn_quiz_response_bkt_update` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `fn_quiz_session_bkt_update` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `fn_quiz_session_sync_profile` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `fn_sync_subscription_amount_on_charge` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `get_my_guardian_id` | _(no args)_ | name suggests RLS helper; review whether any policy or invoker-context code depends on it |
| `get_my_student_id` | _(no args)_ | used inside CREATE POLICY (RLS helper) — KEEP grant for authenticated |
| `get_my_teacher_id` | _(no args)_ | name suggests RLS helper; review whether any policy or invoker-context code depends on it |
| `get_student_id_for_auth` | _(no args)_ | used inside CREATE POLICY (RLS helper) — KEEP grant for authenticated |
| `is_guardian_of` | `p_student_id uuid` | used inside CREATE POLICY (RLS helper) — KEEP grant for authenticated |
| `is_school_admin_of` | `p_school_id uuid` | name suggests RLS helper; review whether any policy or invoker-context code depends on it |
| `is_teacher_of` | `p_student_id uuid` | used inside CREATE POLICY (RLS helper) — KEEP grant for authenticated |
| `rls_auto_enable` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `sync_school_admin_role` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |
| `sync_user_roles_on_insert` | _(no args)_ | name suggests trigger function (fn_* / *_on_insert) but no CREATE TRIGGER found — verify before any action |

### Top risks (Bucket 5 sticky cases)

1. **`is_guardian_of`, `is_teacher_of`, `get_my_student_id`, `get_student_id_for_auth`** — confirmed via paren-aware scanner to appear inside `CREATE POLICY ... USING(...)` clauses. RLS evaluation runs in the authenticated user's role. **Revoking would break RLS** on tables that use these helpers (multiple tables in stem-lab, badges, parent-child link, observations). KEEP.
2. **`is_school_admin_of`, `get_my_guardian_id`, `get_my_teacher_id`** — only called from within other SECURITY DEFINER functions in baseline (no direct policy reference found). They *should* be safe to revoke under "SQL-internal only" (Bucket 2), but their naming convention is identical to the confirmed RLS helpers above, and the baseline file is large enough that a missed reference is plausible. Conservative call: review by manually grepping the production schema for policy definitions referencing them before revoking.
3. **`fn_*` family (6 functions)** — `fn_onboarding_state_on_profile_created`, `fn_populate_subscription_plan_id`, `fn_quiz_response_bkt_update`, `fn_quiz_session_bkt_update`, `fn_quiz_session_sync_profile`, `fn_sync_subscription_amount_on_charge`. Naming strongly suggests trigger functions, but no `CREATE TRIGGER` found in any migration referencing them. Either: (a) the trigger was dropped and only the function lingers (→ Bucket 4), (b) the trigger is created in a migration where my paren-aware splitter mis-bucketed the statement (→ Bucket 3), or (c) they're event-trigger / table-rewrite hooks with non-standard wiring. **Manual SQL: `select tgname, tgrelid::regclass from pg_trigger where tgfoid = 'public.<name>'::regproc`** on prod resolves this in one shot per function.
4. **`rls_auto_enable`, `sync_school_admin_role`, `sync_user_roles_on_insert`** — also trigger-shaped names with no found wiring. Same query as above will resolve.

## Recommended migration shape (for when Bucket 5 is resolved)

```sql
-- supabase/migrations/<TS>_advisor_revoke_security_definer_executes.sql
-- Revokes EXECUTE on SECURITY DEFINER functions that should not be reachable
-- by anon/authenticated. See docs/superpowers/runbooks/2026-05-09-function-executable-triage.md
-- Apply only after staging dry-run with a passing E2E suite.
BEGIN;

-- Bucket 2 (54) -- service-role only / SQL-internal only
REVOKE EXECUTE ON FUNCTION public.activate_subscription(p_auth_user_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_order_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_subscription_locked(p_auth_user_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_order_id text, p_razorpay_subscription_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_xp(p_student_id uuid, p_xp integer, p_source text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_repair_user_onboarding(p_auth_user_id uuid, p_force_role text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_dead_subject_enrollments() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_cancel_subscription(p_student_id uuid, p_immediate boolean, p_reason text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_downgrade_subscription(p_student_id uuid, p_cancelled_sub_id text, p_new_status text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_subscription_activation(p_student_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_subscription_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(p_student_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_subscription_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.available_chapters_for_student_subject(p_student_id uuid, p_subject_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_coins(p_student_id uuid, p_amount integer, p_source text, p_metadata jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_xp(p_student_id uuid, p_amount integer, p_source text, p_subject text, p_daily_category text, p_daily_cap integer, p_metadata jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_account_deletion(p_account_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_and_award_achievements(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_expired_subscriptions() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_verification_batch(p_batch_size integer, p_claimed_by text, p_claim_ttl_seconds integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_session_cognitive_metrics(p_student_id uuid, p_quiz_session_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_student_affective_profile(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_subject_content_readiness() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_event(p_event_type text, p_aggregate_type text, p_aggregate_id uuid, p_payload jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_alert_rules(p_rule_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.experiment_coins_today(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_diagram_references(p_grade text, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_monthly_report(p_student_id uuid, p_month date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_adaptive_questions_v2(p_student_id uuid, p_subject text, p_limit integer, p_include_review boolean, p_mode text, p_goal text, p_source_tags text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_concepts(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_progress(p_student_id uuid, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_qa_from_rag(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_ncert_questions(p_subject text, p_grade text, p_chapter integer, p_question_type text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(p_student_id uuid, p_feature text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_subject_violations(p_plan text, p_grade text, p_stream text, p_limit integer, p_offset integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.halt_subscription(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hybrid_rag_search(query_text text, query_embedding public.vector, p_subject text, p_grade text, p_chapter text, match_count integer, vector_weight double precision, text_weight double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_lab_badge(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_subscription_past_due(p_student_id uuid, p_grace_days integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_webhook_event_processed(p_id uuid, p_outcome text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_rag_chunks(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text, query_embedding public.vector, p_board text, p_min_quality double precision, p_syllabus_version text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_rag_chunks_ncert(query_text text, p_subject_code text, p_grade text, match_count integer, p_chapter_number integer, p_chapter_title text, p_concept text, p_content_type text, p_min_quality double precision, query_embedding public.vector) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_contract_number(p_financial_year text, p_state_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(p_financial_year text, p_state_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rag_grounding_check(p_grade text, p_subject text, p_chapter_num integer, p_language text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalibrate_question_irt_2pl(p_question_id uuid, p_min_attempts integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_subject_content_readiness_daily() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_payment(p_reconciliation_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_xp(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_webhook_event(p_account_id text, p_event_id text, p_event_type text, p_raw_payload jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_account_deletion(p_account_id uuid, p_role text, p_reason text, p_auth_user_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_notification(p_recipient_id uuid, p_recipient_type text, p_type text, p_title text, p_body text, p_data jsonb, p_channel text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_student_subjects(p_student_id uuid, p_subjects text[], p_preferred text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transition_content_status(p_table text, p_id uuid, p_new_status text, p_actor_id uuid, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_burst_progress(p_student_id uuid, p_action_type text, p_value integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_concept_mastery_bkt(p_student_id uuid, p_topic_id uuid, p_is_correct boolean, p_p_learn double precision, p_p_slip double precision, p_p_guess double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_irt_theta(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_academic_scope(p_student_id uuid, p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;

-- Bucket 3 (13) -- trigger functions
REVOKE EXECUTE ON FUNCTION public.audit_student_changes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cbse_syllabus_normalize_display() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_alert_rules_for_event() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_verified() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_login() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_student_created() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_welcome_email_on_confirm() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_welcome_email_on_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_quiz_session_school_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_slp_school_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_quiz_session_affective_state() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_update_irt_theta() FROM anon, authenticated;

-- Bucket 4 (119) -- orphaned (revoke; consider DROP in a follow-up)
REVOKE EXECUTE ON FUNCTION public.admin_create_mapping(p_admin_auth_id uuid, p_guardian_id uuid, p_student_id uuid, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_override_mapping(p_admin_auth_id uuid, p_link_id uuid, p_action text, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_status(p_admin_auth_id uuid, p_target_auth_user_id uuid, p_action text, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_old_data(p_days integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_processed_events(p_older_than interval) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_setup_student() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bkt_update(p_student_id uuid, p_node_code text, p_is_correct boolean, p_response_time_ms integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bkt_update_personalized(p_student_id uuid, p_concept_id uuid, p_is_correct boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.build_interleave_queue(p_student_id uuid, p_subject text, p_session_size integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bulk_generate_hpc(p_class_id uuid, p_academic_year text, p_term text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bulk_transition_status(p_table text, p_ids uuid[], p_new_status text, p_actor_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_rl_reward(p_student_id uuid, p_action_id uuid, p_is_correct boolean, p_response_time integer, p_engagement_score double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calibrate_irt_parameters() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_entitlement(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_foxy_quota(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_permission(p_auth_user_id uuid, p_permission_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_plan_limits(p_student_id uuid, p_usage_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(p_identifier text, p_endpoint text, p_max_per_minute integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_ncert_batch(p_batch_size integer, p_max_file_size bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.classify_response_error(p_response_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_foxy_cache() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_daily_usage() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_rate_limits() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_usage() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_versions(p_keep integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_ops_events() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_poll_and_get_results(p_poll_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(p_student_id uuid, p_name text, p_grade text, p_board text, p_subject text, p_language text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_chapters_needing_concepts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_cms_version(p_entity_type text, p_entity_id uuid, p_snapshot jsonb, p_change_summary text, p_created_by uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_guardian_profile(p_auth_id uuid, p_name text, p_email text, p_phone text, p_relationship text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_student_profile(p_auth_user_id uuid, p_name text, p_email text, p_grade text, p_board text, p_language text, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_teacher_profile(p_auth_user_id uuid, p_name text, p_email text, p_school_name text, p_subjects text[], p_grades text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_school_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delta_sync_pull(p_student_id uuid, p_device_id text, p_mastery_since timestamp with time zone, p_graph_since timestamp with time zone, p_questions_since timestamp with time zone, p_schedule_since timestamp with time zone) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.diagnose_student(p_student_id uuid, p_subject_code text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_tutoring_session(p_session_id uuid, p_summary text, p_key_learnings text[], p_areas_for_improvement text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.estimate_student_theta(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fast_rag_search(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fast_rag_search_v2(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_matching_simulation(p_subject text, p_grade text, p_message text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.flush_offline_queue(p_student_id uuid, p_device_id text, p_actions jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_at_risk_alerts(p_class_id uuid, p_teacher_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_daily_plan(p_student_id uuid, p_date date, p_minutes_available integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_hpc(p_student_id uuid, p_academic_year text, p_term text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_learning_path(p_student_id uuid, p_subject text, p_grade text, p_path_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_parent_link_code(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_review_card_from_quiz(p_student_id uuid, p_question_id uuid, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_smart_nudges(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_bursts(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cache_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_content(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_media(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_qa(p_grade text, p_subject text, p_chapter_number integer, p_source_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_simulations(p_subject text, p_grade text, p_chapter integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapters_needing_concepts(p_batch_size integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_class_mastery_heatmap(p_class_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_competency_report(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_daily_xp_by_category(p_student_id uuid, p_category text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_exercise_completion(p_student_id uuid, p_subject_code text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_learning_snapshot(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_guardian_student_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_student_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_teacher_student_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_narrative_state(p_student_id uuid, p_burst_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_ncert_chapter_stats(p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_next_topic(p_student_id uuid, p_subject_code text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_link_requests(p_student_auth_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_practice_queue(p_student_id uuid, p_subject text, p_grade text, p_session_size integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_questions_for_node(p_node_code text, p_count integer, p_bloom_level text, p_exclude_ids uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_chunks_for_node(p_node_code text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_context_for_adaptive(p_student_id uuid, p_node_code text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_context_for_cme(p_student_id uuid, p_concept_id uuid, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_context_for_sr_card(p_grade text, p_subject text, p_chapter_number integer, p_bloom_level text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_simulation(p_sim_id uuid, p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_student_plan(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_student_progress(p_student_id uuid, p_subject_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_student_usage(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_teacher_dashboard_v2(p_teacher_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_vault_secret(secret_name text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_daily_usage(p_student_id uuid, p_feature text, p_usage_date date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.instant_rag_search(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.launch_classroom_poll(p_teacher_id uuid, p_class_id uuid, p_question_text text, p_options jsonb, p_correct_index integer, p_question_type text, p_time_limit integer, p_node_code text, p_bloom_level text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.launch_narrative_burst(p_student_id uuid, p_subject text, p_template_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_guardian_via_invite_code(p_guardian_auth_id uuid, p_invite_code text, p_relation_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit(p_auth_user_id uuid, p_action text, p_resource_type text, p_resource_id text, p_details jsonb, p_status text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lookup_foxy_cache(p_q text, p_grade text, p_subject text, p_lang text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_syllabus_concept(p_query text, p_subject text, p_grade text, p_match_count integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_student_grade(p_student_id uuid, p_new_grade text, p_new_session text, p_actor_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quiz_grounding_check(p_grade text, p_subject text, p_chapter_num integer, p_question_text text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rag_resolve_chapter(p_grade text, p_subject text, p_query text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rag_validate_answer(p_log_id uuid, p_chunks_used integer, p_confidence double precision, p_has_ncert_cite boolean, p_answer_length integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_stuck_payments() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_adaptive_response(p_student_id uuid, p_node_code text, p_is_correct boolean, p_response_time_ms integer, p_source text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_daily_activity(p_student_id uuid, p_subject text, p_questions_asked integer, p_questions_correct integer, p_xp_earned integer, p_time_minutes integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_leaderboard_week() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_platform_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.renew_subscription(p_student_id uuid, p_razorpay_payment_id text, p_amount_inr integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_guardian_link(p_guardian_auth_id uuid, p_student_email text, p_relation_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_guardian_link(p_requester_auth_id uuid, p_link_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_retention_test() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_spaced_review(p_student_id uuid, p_topic_id uuid, p_quality integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_adaptive_mastery(p_student_id uuid, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.select_next_content(p_student_id uuid, p_subject text, p_grade text, p_epsilon double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_context(p_school_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_connection_health() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.student_respond_to_link_request(p_student_auth_id uuid, p_link_id uuid, p_action text, p_reason text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_poll_response(p_poll_id uuid, p_student_id uuid, p_answer_index integer, p_answer_text text, p_response_time_ms integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_results_rpc(p_student_id uuid, p_started_at timestamp with time zone, p_finished_at timestamp with time zone, p_items jsonb, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_results_safe(p_student_id uuid, p_items jsonb, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_onboarding_completed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_roles_for_user(p_auth_user_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.teacher_create_adaptive_assignment(p_teacher_id uuid, p_class_id uuid, p_title text, p_node_codes text[], p_due_date timestamp with time zone, p_question_count integer, p_bloom_level text, p_assignment_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_concept_mastery(p_student_id uuid, p_topic_id uuid, p_is_correct boolean, p_used_hint boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_ncert_chapter_progress() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_streak(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_content_gap(p_subject text, p_grade text, p_query text, p_topic_title text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.write_foxy_cache(p_q text, p_resp text, p_grade text, p_subject text, p_ch integer, p_topic text, p_model text, p_lang text) FROM anon, authenticated;

COMMIT;
```

**Don't apply this verbatim.** Several functions in Bucket 4 may have args strings that include problem characters (default values, complex composite types). Verify by running each REVOKE manually against staging first; Postgres will return `ERROR: function ... does not exist` if the signature is off, which is a safe failure mode.

## Rollback

If anything in Bucket 2/3/4 turns out to be needed by a real authenticated client (most likely scenario: an external cron, mobile app, or partner integration the repo doesn't know about):

```sql
GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated;
-- (or anon if it's a public unauthenticated endpoint)
```

Re-classify in this runbook (move from its current bucket up to Bucket 1) and add a note about the external caller.

## Effort estimate (solo developer)

- **Bucket 5 manual review (16 functions):** ~2 hours of `pg_trigger`/`pg_policy` queries on prod + spot-checking, then re-classify into 2/3/4.
- **Migration draft + per-signature verification on staging:** ~3 hours (every revoke compiles or fails fast; the bulk is sanity-checking arg lists for default-value characters and `OUT` parameters that change the signature shape).
- **Staging soak (E2E + Foxy + payments + parent portal + school-admin + quiz submit):** 1 hour active + overnight passive.
- **Prod application + post-deploy advisor re-run:** 30 minutes.
- **Bucket 4 DROP FUNCTION follow-up (separate runbook):** another ~3 hours, lower priority.

**Total to close 254 anon + 254 authenticated WARNs (Buckets 2+3+4):** ~6.5 solo-dev-hours including staging time.
