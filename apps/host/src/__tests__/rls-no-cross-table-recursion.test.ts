import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * GENERALIZED RLS cross-table-recursion static guard (P8) — XC-3 Phase 0a.
 *
 * WHY THIS EXISTS
 * ===============
 * On 2026-07-02 migration `20260702010000_teacher_assigned_students_rls.sql`
 * (TSB-4) added a policy ON public.students whose USING clause INLINED a subquery
 * over public.class_students (a different RLS-enabled table). Because that inline
 * subquery runs as SECURITY INVOKER, class_students' OWN policy "Students can view
 * own enrollment" — which reads public.students BACK — re-entered the RLS
 * evaluator and Postgres raised "infinite recursion detected in policy for
 * relation students", breaking EVERY authenticated read of students. The fix
 * `20260702080000` delegated the boundary to the SECURITY DEFINER helper
 * public.is_teacher_of(id) (its inner reads BYPASS RLS — no cycle can form).
 *
 * REG-210 (`students-rls-no-recursion.test.ts`) guards this for `students` ONLY.
 * The XC-3 audit found the pattern is SYSTEMIC: ~141 baseline policies (242 across
 * the whole effective chain after Phase 0a.1, now 240 after the Phase 1 drain and the
 * Phase 4 first drain — see below) inline a cross-table
 * subquery that re-enters another
 * table's RLS — every one is a latent edge that can close a TSB-4-style cycle the
 * moment a back-edge is added. We cannot retroactively rewrite all of them now,
 * but we CAN FREEZE the surface so NO NEW or RENAMED policy adds another.
 *
 * THE RULE (RS-RULE, binding — see the plan §4)
 * =============================================
 * Every NEW or MODIFIED RLS policy MUST NOT inline a FROM/JOIN over a DIFFERENT
 * RLS-enabled table in its USING / WITH CHECK. Cross-table authorization MUST
 * delegate to a SECURITY DEFINER helper (is_teacher_of, is_guardian_of,
 * is_school_admin_of, get_my_* …) whose inner reads bypass RLS. Same-table
 * self-references, auth.uid() comparisons, and helper CALLS are allowed.
 *
 * HOW THIS GUARD WORKS (static SQL-text — no live Postgres)
 * ========================================================
 * Consistent with the sibling source pins (`rls-student-id-policies.test.ts`,
 * `students-rls-no-recursion.test.ts`): the cycle is a property of the policy
 * DEFINITION and is provable statically. It parses the root migration chain
 * (baseline + later root migrations in timestamp order; `_legacy/` is intentionally
 * excluded because Supabase `db push` only applies files at the immediate
 * migrations root), then:
 *   1. builds R = every table with `ENABLE ROW LEVEL SECURITY` (effective final);
 *   2. reduces every CREATE/DROP POLICY (DROPs applied in order) to the FINAL
 *      effective policy per (table, name) — so `20260702080000` supersedes the
 *      recursive `20260702010000`;
 *   3. flags a surviving policy as a RECURSION RISK iff its USING/WITH CHECK
 *      inlines a FROM/JOIN over `b ∈ R, b ≠ policyTable`;
 *   4. asserts the detected risk set is a SUBSET of GRANDFATHERED_INLINE_POLICIES
 *      (the explicit, reviewable debt ledger of the current 240). The guard FAILS
 *      only when a NEW or RENAMED inline cross-table policy appears. Phase 1+ drains
 *      the ledger one table at a time (inline → helper), shrinking this list.
 *
 * PHASE 1 RATCHET-DOWN #1 (XC-3, migration 20260702090000)
 * ========================================================
 * The apex `students` policy "School admins can view school students" was the last
 * latent inline cross-table edge ON `students` (it inlined `FROM school_admins`).
 * Migration 20260702090000 refactored it to the SECURITY DEFINER helper
 * public.is_school_admin_of_student(id) — the IDENTICAL school-scoping + is_active
 * boundary, but the helper's inner reads bypass RLS so no recursion can form. The
 * detector no longer flags it, so its grandfather entry was pruned: the ledger
 * ratcheted 242 → 241 (the FIRST drain), and `students` now carries ZERO inline
 * cross-table edges. is_school_admin_of_student joined the helper roster (set H).
 *
 * PHASE 0a.1 HARDENING (XC-3, an earlier revision)
 * ==========================================
 * The original CREATE/DROP POLICY name matching saw QUOTED names only
 * (`CREATE POLICY "name" ON …`). Hand-written root migrations sometimes use
 * UNQUOTED names (`CREATE POLICY my_policy ON public.t …`); those were INVISIBLE to
 * the detector — a false negative under which a future unquoted-name policy could
 * inline a cross-table subquery and slip the freeze. The name regex now accepts BOTH
 * forms (for CREATE and DROP, so DROP-before-CREATE reduction still works). Widening
 * the regex surfaced 28 previously-hidden unquoted-name inline policies (214 → 242).
 * ALL 28 are on CHILD tables inlining a PARENT boundary table that does NOT inline
 * them back — none forms a live recursion cycle (verified reaches-self=false for
 * each); the change is purely defensive. The 28 are frozen in the Phase 0a.1 block
 * of GRANDFATHERED_INLINE_POLICIES and proven catchable by a dedicated self-test.
 *
 * Plan: docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5).
 * Incident fix: supabase/migrations/20260702080000_fix_students_rls_infinite_recursion.sql.
 * Owner: testing. Catalog: REG-212 (Phase 0a.1 extends its unquoted-name coverage).
 * Supersedes the students-only intent of REG-210.
 */

// ── repo / file resolution (cwd or one level up, matching the sibling pins) ──
function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const MIGRATIONS_ABS = resolveRepo('supabase/migrations');

// ── SECURITY DEFINER RLS helpers (set H). A policy that merely CALLS one of these
//    has no FROM/JOIN of its own, so it is never flagged. Listed (and asserted)
//    so an accidental edit to the helper roster is visible. Confirmed against the
//    baseline definitions (00000000000000_baseline_from_prod.sql:8979-9228). ──
const RLS_HELPERS = [
  'is_teacher_of',
  'is_guardian_of',
  'is_school_admin_of',
  // XC-3 Phase 1 (20260702090000): student-scoped school-admin helper that
  // replaced the inline `FROM school_admins` subquery in the students policy
  // "School admins can view school students". Tagged `-- rls-helper` at its
  // definition; SECURITY DEFINER so its inner reads of students + school_admins
  // bypass RLS (no recursion). Listed here so a policy that CALLS it is recognised
  // as delegating, not inlining.
  'is_school_admin_of_student',
  'is_admin',
  'get_my_student_id',
  'get_my_student_ids',
  'get_student_id_for_auth',
  'get_my_teacher_id',
  'get_my_teacher_student_ids',
  'get_admin_school_id',
] as const;

// ════════════════════════════════════════════════════════════════════════════
// GRANDFATHERED_INLINE_POLICIES — the frozen baseline of CURRENT recursion-risk
// policies (keyed "<table>::<policyName>"). Generated programmatically from the
// live chain, then hardcoded so the test is deterministic and the ledger is
// reviewable. The detected set MUST be a subset of this; any NEW/RENAMED inline
// cross-table policy is absent here and FAILS the guard. Phase 4 removes entries
// as it migrates inline policies to SECURITY DEFINER helpers.
// ════════════════════════════════════════════════════════════════════════════
const GRANDFATHERED_INLINE_POLICIES: ReadonlySet<string> = new Set([
  // ── Phase 0a.1 (XC-3) additions — 28 policies the quoted-only name regex MISSED.
  //    All defined with UNQUOTED policy names in their root migrations, so the
  //    original detector never saw them. NONE forms a live recursion cycle: every
  //    one is on a CHILD table whose USING inlines a PARENT boundary table
  //    (students / guardians / guardian_student_links / class_students /
  //    class_teachers / teachers / roles / user_roles / admin_users), and none of
  //    those parents inlines these child tables back (verified: reaches-self=false
  //    for all 28). Frozen here as defensive debt, not active cycles. ──
  // XC-3 backport (migration 20260722091000_adaptive_interventions_rls_xc3_backport.sql,
  // 2026-07-22): adaptive_interventions_parent_select and
  // adaptive_interventions_teacher_select were refactored from inlined
  // guardian_student_links x guardians / class_students x class_teachers x
  // teachers subqueries to public.is_guardian_of(student_id) /
  // public.is_teacher_of(student_id) respectively (also closing a P8
  // missing-is_active over-grant on the teacher policy). Both now contain no
  // FROM/JOIN of their own, so the detector no longer flags them — their
  // grandfather entries are pruned. adaptive_interventions_student_select was
  // NOT touched by this migration and remains detected/grandfathered.
  // Ledger: 223 → 221.
  // Phase 8 item 8.6 (migration 20260722102000_synthesis_quality_scores.sql,
  // 2026-07-22): the new synthesis_quality_scores_read_admin policy inlines
  // the IDENTICAL admin_users subquery pattern as the already-grandfathered
  // foxy_quality_scores_read_admin below (`auth.uid() IN (SELECT auth_user_id
  // FROM public.admin_users WHERE is_active = true)`), including the same
  // service_role short-circuit and is_active guard. This is the same
  // reviewed, accepted pattern — not a new risk class. Ledger: 221 → 222.
  'synthesis_quality_scores::synthesis_quality_scores_read_admin',
  'adaptive_interventions::adaptive_interventions_student_select',
  'board_score_predictions::board_score_predictions_admin_select',
  'board_score_predictions::board_score_predictions_guardian_select',
  'board_score_predictions::board_score_predictions_student_select',
  'concept_attempts::concept_attempts_read_own',
  'foxy_message_feedback::foxy_message_feedback_read_self',
  'foxy_pending_expectations::foxy_pending_expectations_student_read',
  'foxy_quality_scores::foxy_quality_scores_read_admin',
  'geographic_metrics::geographic_metrics_admin_select',
  // XC-3 Phase drain (migration 20260702110000): 4 of the original 6 policies on
  // learner_twin_snapshots and learner_twin_memory were refactored to SECURITY
  // DEFINER helpers — _parent_select now calls is_guardian_of(student_id) and
  // _teacher_select calls is_teacher_of(student_id) on both tables. Those 4 entries
  // are pruned from the ledger (no longer detected). Ledger: 240 → 236.
  //
  // XC-3 Phase drain (migration 20260702130000): the remaining 2 _student_select
  // entries are pruned. The scalar subquery (= (SELECT id FROM public.students …
  // LIMIT 1)) is replaced by a call to the EXISTING SECURITY DEFINER helper
  // public.get_my_student_id() (already on the roster — no new helper minted) — the
  // policy USING predicate now contains no FROM/JOIN at all, so the static detector
  // no longer flags them. Ledger: 236 → 234.
  'mol_feedback::mol_feedback_student_insert',
  'mol_request_logs::mol_request_logs_admin_read',
  'mrr_snapshots::mrr_snapshots_admin_select',
  'parent_cheers::parent_cheers_guardian_select',
  'school_churn_signals::school_churn_signals_admin_select',
  'school_health_daily::school_health_daily_admin_select',
  'school_mrr_daily::school_mrr_daily_admin_select',
  // XC-3 backport (migration 20260722091000, 2026-07-22) touched these three
  // teacher_remediation_assignments policies too — the roster-membership half
  // of each was replaced with public.is_teacher_of(student_id) — but all three
  // (plus the INSERT policy's separate class_id-ownership check) RETAIN a
  // same-shape inline `teacher_id IN (SELECT t.id FROM public.teachers t
  // WHERE t.auth_user_id = auth.uid())` ownership subquery that the migration
  // deliberately left untouched (a different fact than roster membership).
  // That subquery is itself an inline FROM over `teachers` (RLS-enabled,
  // ≠ policyTable), so the detector still flags all three — they remain
  // correctly grandfathered, unlike the two adaptive_interventions entries
  // above which had NO remaining inline predicate at all.
  'teacher_remediation_assignments::teacher_remediation_assignments_student_select',
  'teacher_remediation_assignments::teacher_remediation_assignments_teacher_insert',
  'teacher_remediation_assignments::teacher_remediation_assignments_teacher_select',
  'teacher_remediation_assignments::teacher_remediation_assignments_teacher_update',
  // ── original quoted-name baseline (214) ──
  'academic_terms::academic_terms_authenticated_select',
  'academic_terms::academic_terms_school_admin_insert',
  'academic_terms::academic_terms_school_admin_update',
  'ai_issue_reports::ai_issue_reports_insert_own',
  'ai_issue_reports::ai_issue_reports_read_own_or_admin',
  'ai_issue_reports::ai_issue_reports_update_admin',
  'ai_response_reports::Students can create reports',
  'ai_response_reports::Students can read own reports',
  'analytics_events::analytics_insert',
  'analytics_events::analytics_select',
  'api_keys::api_keys_select',
  'assessment_schedule::assessment_schedule_teacher_select',
  'assignment_submissions::assignment_submissions_parent_select',
  'assignment_submissions::Students can manage own submissions',
  'assignment_submissions::Teachers can grade submissions',
  'assignment_submissions::Teachers can view assignment submissions',
  'assignments::assignments_teacher_class_teachers_select',
  'assignments::School admins can view school assignments',
  'assignments::Students can view class assignments',
  'assignments::Teachers can manage own assignments',
  // (XC-3 Phase 4 first drain removed 'at_risk_alerts::Teachers see own at-risk
  //  alerts' from here — migration 20260702100000. See the note below.)
  'audit_logs::audit_logs_select',
  'audit_logs::school_admins_see_school_audit_logs',
  // XC-3 Phase 4 first drain (migration 20260702100000): the at_risk_alerts policy
  // "Teachers see own at-risk alerts" was refactored from an inline
  // `FROM public.teachers` subquery to the SECURITY DEFINER helper
  // public.get_my_teacher_id(). Because teachers.auth_user_id is UNIQUE the inline
  // IN-subquery returned at most one id, so `teacher_id = get_my_teacher_id()` is the
  // EXACT boundary equivalent (same table, same auth.uid() filter, no extra guards).
  // It no longer inlines a cross-table FROM/JOIN, so the detector no longer flags it
  // — its grandfather entry (formerly 'at_risk_alerts::Teachers see own at-risk
  // alerts', sorted just above 'audit_logs::…') is therefore pruned so
  // `detected === allowlist` holds. This is the FIRST Phase 4 drain (241 → 240).
  // Parent-dashboard RCA drain (migration 20260720170000_parent_dashboard_rca_fixes.sql,
  // 2026-07-20): 11 parent-select policies (score_history, xp_transactions,
  // coin_balances, coin_transactions, challenge_attempts, challenge_streaks,
  // quiz_session_shuffles, student_skill_state, performance_scores,
  // exam_configs, monthly_reports) were refactored from an inline
  // guardian_student_links/guardians FROM-subquery onto the SECURITY DEFINER
  // helper public.is_guardian_of(student_id) -- this was also a functional
  // fix (Finding A: the inline status='approved' literal silently excluded
  // guardians linked via the live OTP flow, which sets status='active').
  // They no longer inline a cross-table FROM/JOIN, so the detector no longer
  // flags them; their 11 grandfather entries (formerly interspersed
  // alphabetically below, e.g. 'challenge_attempts::challenge_attempts_parent_select')
  // are pruned. One new entry was ALSO added and immediately resolved without
  // a grandfather exception: the new teacher_parent_threads INSERT policy
  // (tp_threads_guardian_insert) initially inlined a guardians subquery and
  // was rewritten to use public.get_my_guardian_id() instead, per this same
  // guard's own instructions -- it required no grandfathering.
  // Net: 234 - 11 + 0 = 223: this drain removes 11 grandfather entries and
  // adds 0 (the new teacher_parent_threads policy was fixed, not
  // grandfathered) = 223, matching the toBe() counts below.
  'backup_status::backup_status_admin',
  'bloom_progression::bloom_own_insert',
  'bloom_progression::bloom_own_select',
  'bloom_progression::bloom_own_update',
  'cbse_syllabus::cbse_syllabus_write_admin',
  'challenge_attempts::challenge_attempts_student_select',
  'challenge_streaks::challenge_streaks_student_select',
  'chapter_progress::cp_select_merged',
  'chapter_progress::cp_student_insert',
  'chapter_progress::cp_student_update',
  'class_enrollments::class_enrollments_school_admin_select',
  'class_enrollments::class_enrollments_student_select',
  'class_enrollments::class_enrollments_teacher_select',
  'class_schedule::class_schedule_parent_select',
  'class_schedule::class_schedule_school_admin_select',
  'class_schedule::class_schedule_student_select',
  'class_schedule::class_schedule_teacher_delete',
  'class_schedule::class_schedule_teacher_insert',
  'class_schedule::class_schedule_teacher_select',
  'class_schedule::class_schedule_teacher_update',
  'class_students::School admins can manage school class_students',
  'class_students::Students can insert own enrollment via class code',
  'class_students::Students can view own enrollment',
  'class_students::Teachers can manage students in their classes',
  'class_students::Teachers can view students in their classes',
  'class_teachers::School admins can manage school class_teachers',
  'class_teachers::Teachers can view own class assignments',
  'classes::classes_school_admin_select',
  'classes::Guardians can view childrens classes',
  'classes::School admins can view school classes',
  'classes::Students can view their enrolled classes',
  'classes::Teachers can insert classes',
  'classes::Teachers can view their classes',
  'classroom_lesson_plans::Students can view classroom lesson plans',
  'classroom_lesson_plans::Teachers can manage classroom lesson plans',
  'classroom_lesson_plans::Teachers can view classroom lesson plans',
  'classroom_poll_responses::Students submit own poll responses',
  'classroom_polls::Students see live polls for their class',
  'classroom_polls::Teachers see own class polls',
  'cme_concept_state::cme_state_own',
  'cme_exam_readiness::cme_readiness_own',
  'cme_revision_schedule::cme_revision_own',
  'cms_assets::cms_assets_admin',
  'cms_item_versions::cms_versions_insert_admin',
  'cms_item_versions::cms_versions_select_admin',
  'cms_item_versions::cms_versions_update_admin',
  'cognitive_session_metrics::csm_own_insert',
  'cognitive_session_metrics::csm_own_select',
  'coin_balances::coin_bal_student_select',
  'coin_transactions::coin_txn_student_select',
  'content_reports::reports_insert',
  'content_reports::reports_select',
  'content_requests::content_requests_insert_own',
  'content_requests::content_requests_read_own',
  'coverage_audit_snapshots::coverage_audit_snapshots_read_admin',
  'data_erasure_requests::guardian_sees_own_erasure_requests',
  'data_erasure_requests::school_admin_sees_school_erasure_requests',
  'deployment_history::deploy_history_admin',
  'domain_events::domain_events_super_admin_select',
  'exam_chapters::students_own_exam_chapters',
  'exam_configs::students_own_exam_configs',
  'exam_simulations::students_own_exam_simulations',
  'ff_grounded_ai_enforced_pairs::ff_pairs_write_admin',
  'foxy_chat_messages::school_admins_see_school_foxy_messages',
  'foxy_scan_queries::foxy_scan_insert',
  'foxy_scan_queries::foxy_scan_own',
  'foxy_sessions::Students can update own foxy sessions',
  'grade_book_entries::grade_book_entries_teacher_delete',
  'grade_book_entries::grade_book_entries_teacher_insert',
  'grade_book_entries::grade_book_entries_teacher_select',
  'grade_book_entries::grade_book_entries_teacher_update',
  'grounded_ai_traces::grounded_traces_read_admin',
  'guardian_student_links::Guardians can insert own links',
  'guardian_student_links::Guardians can update own links',
  'guardian_student_links::Guardians can view own links',
  'guardian_student_links::Students can update links to themselves',
  'guardian_student_links::Students can view links to themselves',
  'guardian_student_links::Teachers can view links for their students',
  'hpc_records::Students see own HPC',
  'image_uploads::students_own_image_uploads',
  'improvement_executions::improvement_executions_admin_insert',
  'improvement_executions::improvement_executions_admin_select',
  'improvement_executions::improvement_executions_admin_update',
  'improvement_issues::improvement_issues_admin_insert',
  'improvement_issues::improvement_issues_admin_select',
  'improvement_issues::improvement_issues_admin_update',
  'improvement_recommendations::improvement_recommendations_admin_insert',
  'improvement_recommendations::improvement_recommendations_admin_select',
  'improvement_recommendations::improvement_recommendations_admin_update',
  'institution_entitlements::school_admin read own',
  'institution_entitlements::super_admin read all',
  'interleave_queue::Students see own interleave queue',
  'intervention_alerts::teachers_intervention_alerts_select',
  'intervention_alerts::teachers_intervention_alerts_update',
  'knowledge_gaps::kg_own_insert',
  'knowledge_gaps::kg_own_select',
  'leaderboard_snapshots::leaderboard_snapshots_student_select',
  'learning_paths::learning_paths_own',
  'learning_velocity::lv_own_insert',
  'learning_velocity::lv_own_select',
  'legacy_alert_rules::Admin read alert_rules',
  'monthly_reports::students_own_monthly_reports',
  'narrative_progress::Students see own narrative',
  'offline_pending_responses::Students manage own pending',
  'parental_consent::Guardians can insert own consent',
  'parental_consent::Guardians can update own consent',
  'parental_consent::Guardians can view own consent',
  'payment_webhook_events::payment_webhook_events_super_admin_select',
  'performance_scores::perf_scores_student_select',
  'permissions::permissions_admin',
  'platform_health_snapshots::Admin read health snapshots',
  'practice_session_log::Students see own practice sessions',
  'product_events::product_events_admin_select',
  'question_misconceptions::qm_super_admin_write',
  'question_responses::qr_own_insert',
  'question_responses::qr_own_select',
  'quiz_session_shuffles::quiz_session_shuffles_student_select',
  'quiz_session_shuffles::quiz_session_shuffles_teacher_select',
  'rag_ingestion_failures::rag_ingestion_failures_read_admin',
  'retrieval_traces::rt_super_admin_select',
  'role_permissions::role_permissions_admin',
  'roles::roles_admin',
  'scheduled_actions::student read own',
  'school_announcements::announcements_student_select',
  'school_contracts::school_admin_can_read_own_contracts',
  'school_exams::school_exams_student_select',
  'school_invite_codes::School admins can manage their school codes',
  'school_invite_codes::Teachers can view codes for their school',
  'school_questions::school_questions_student_select',
  'score_history::score_history_student_select',
  'smart_nudges::students_own_smart_nudges',
  'student_assessment_attempts::attempts_own',
  'student_attendance::student_attendance_parent_select',
  'student_attendance::student_attendance_student_select',
  'student_attendance::student_attendance_teacher_insert',
  'student_attendance::student_attendance_teacher_select',
  'student_attendance::student_attendance_teacher_update',
  'student_burst_progress::Students see own burst progress',
  'student_cluster_assignments::students_own_student_cluster_assignments',
  'student_competency_scores::Students see own competency scores',
  'student_daily_usage::student_usage_insert',
  'student_daily_usage::student_usage_select',
  'student_daily_usage::student_usage_update',
  'student_scans::scans_insert',
  'student_scans::scans_own',
  'student_skill_state::skill_state_teacher_select',
  'student_skill_state::student_skill_state_student_select',
  'student_skill_state::student_skill_state_teacher_select',
  // XC-3 Phase 1 ratchet-DOWN #1 (migration 20260702090000): the students policy
  // "School admins can view school students" was refactored from an inline
  // `FROM school_admins` subquery to the SECURITY DEFINER helper
  // public.is_school_admin_of_student(id). It no longer inlines a cross-table
  // FROM/JOIN, so the detector no longer flags it — its grandfather entry is
  // pruned here so `detected === allowlist` holds. This is the FIRST drain of the
  // Phase 4 ledger (242 → 241) and leaves the apex students table with ZERO
  // latent inline cross-table edges.
  'study_plan_tasks::spt_readonly_others',
  'subject_content_readiness_daily::scrd_super_admin_select',
  'support_tickets::Anyone can create tickets',
  'support_tickets::support_tickets_self_insert',
  'support_tickets::support_tickets_self_select',
  'support_tickets::Users can read own tickets',
  'sync_ledger::Students see own sync ledger',
  'system_metrics::admin_system_metrics_select',
  'teacher_parent_messages::tp_messages_guardian_insert',
  'teacher_parent_messages::tp_messages_guardian_select',
  'teacher_parent_messages::tp_messages_teacher_insert',
  'teacher_parent_messages::tp_messages_teacher_select',
  'teacher_parent_threads::tp_threads_guardian_select',
  'teacher_parent_threads::tp_threads_teacher_select',
  'teacher_student_notes::teachers_own_notes_insert',
  'teacher_student_notes::teachers_own_notes_select',
  'teacher_student_notes::teachers_own_notes_update',
  'teachers::School admins can view school teachers',
  'tenant_configs::school_admin read own',
  'tenant_configs::school_admin write own',
  'tenant_modules::school_admin read own',
  'tenant_modules::school_admin write own',
  'tutor_feedback::feedback_own',
  'tutoring_sessions::sessions_own',
  'user_question_history::uqh_student_insert',
  'user_question_history::uqh_student_select',
  'user_question_history::uqh_student_update',
  'user_roles::user_roles_admin',
  'user_roles::user_roles_select',
  'xp_transactions::xp_txn_student_select',
  'xp_transactions::xp_txn_teacher_select',
]);

// ── parsing ─────────────────────────────────────────────────────────────────
/** Strip `-- …` line comments so only EXECUTABLE SQL is inspected. */
function stripLineComments(sql: string): string {
  return sql
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const ENABLE_RE =
  /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i;
const DISABLE_RE =
  /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i;
// Phase 0a.1 (XC-3): the policy NAME now matches BOTH a quoted identifier
// (`"my policy"`) AND a bare unquoted identifier (`my_policy`). Hand-written root
// migrations sometimes use unquoted names; the original quoted-only regex was BLIND
// to them — a false negative that would let a future unquoted-name policy inline a
// cross-table subquery and slip past the freeze. Capture group 1 = quoted name (kept
// verbatim, case-sensitive like Postgres), group 2 = unquoted name (folded to lower
// case, matching Postgres' unquoted-identifier case folding so DROP↔CREATE by
// unquoted name still reduce). Table-name capture (group 3) is unchanged. The `i`
// flag + `\s+` make both robust to case/whitespace/multiline (statements are already
// whitespace-collapsed before matching).
const CREATE_RE =
  /^\s*CREATE\s+POLICY\s+(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s+ON\s+(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i;
const DROP_RE =
  /^\s*DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s+ON\s+(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i;

/** Resolve the effective policy name from a CREATE_RE/DROP_RE match: quoted name
 *  verbatim (group 1), else the unquoted name folded to lower case (group 2) — so a
 *  DROP by unquoted name reduces the matching CREATE regardless of source casing. */
function policyName(m: RegExpExecArray): string {
  return m[1] !== undefined ? m[1] : m[2].toLowerCase();
}

interface ChainState {
  /** R: tables with effective ENABLE ROW LEVEL SECURITY. */
  rls: Set<string>;
  /** Final effective policy statement text, keyed "<table>::<name>". */
  policies: Map<string, string>;
}

/** Parse the whole root chain (timestamp order) into R + the effective policy set. */
function parseChain(): ChainState {
  const rls = new Set<string>();
  const policies = new Map<string, string>();
  if (!MIGRATIONS_ABS) return { rls, policies };

  // Root-only `.sql`, lexicographically sorted == apply order ("00000000000000_…"
  // sorts before the "2026…" timestamps). readdirSync is non-recursive, so
  // `_legacy/` is naturally excluded — matching Supabase `db push`.
  const files = readdirSync(MIGRATIONS_ABS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const exec = stripLineComments(readFileSync(resolve(MIGRATIONS_ABS, file), 'utf8'));
    // CREATE/DROP POLICY and ALTER … ENABLE/DISABLE RLS contain no internal `;`,
    // so splitting on `;` cleanly isolates them. Function-body fragments split off
    // by inner `;` never match the anchored CREATE/DROP/ENABLE patterns.
    for (const stmtRaw of exec.split(';')) {
      const stmt = stmtRaw.replace(/\s+/g, ' ').trim();
      if (!stmt) continue;
      let m: RegExpExecArray | null;
      if ((m = ENABLE_RE.exec(stmt))) {
        rls.add(m[1].toLowerCase());
        continue;
      }
      if ((m = DISABLE_RE.exec(stmt))) {
        rls.delete(m[1].toLowerCase());
        continue;
      }
      if ((m = CREATE_RE.exec(stmt))) {
        // group 3 = table (lower-cased), policyName(m) = quoted-verbatim or
        // unquoted-lowered name. Covers both `"..."` and bare-identifier policies.
        policies.set(`${m[3].toLowerCase()}::${policyName(m)}`, stmt);
        continue;
      }
      if ((m = DROP_RE.exec(stmt))) {
        policies.delete(`${m[3].toLowerCase()}::${policyName(m)}`);
      }
    }
  }
  return { rls, policies };
}

const { rls: R, policies: POLICIES } = parseChain();

// ── detector ────────────────────────────────────────────────────────────────
const FROMJOIN_RE =
  /\b(?:FROM|JOIN)\s+(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi;

/** The predicate portion of a CREATE POLICY statement (from USING / WITH CHECK).
 *  Excludes the policy name and `ON "public"."<table>"` header so neither can
 *  produce a false FROM/JOIN match. */
function predicate(stmt: string): string {
  const m = /\b(?:USING|WITH\s+CHECK)\b/i.exec(stmt);
  return m ? stmt.slice(m.index) : '';
}

/**
 * Tables `b` that the policy on `policyTable` inlines a FROM/JOIN over, where
 * `b ∈ R` and `b ≠ policyTable`. Empty ⇒ not a recursion risk. EXEMPT by
 * construction: self-references (b === policyTable), foreign-schema relations
 * (auth./vault.), reference tables not in R, and SECURITY DEFINER helper CALLS
 * (which carry no FROM/JOIN of their own).
 */
function detectInlineCrossTable(policyTable: string, stmt: string): string[] {
  const body = predicate(stmt);
  const hits = new Set<string>();
  let mm: RegExpExecArray | null;
  FROMJOIN_RE.lastIndex = 0;
  while ((mm = FROMJOIN_RE.exec(body))) {
    const schema = mm[1] ? mm[1].toLowerCase() : null;
    const b = mm[2].toLowerCase();
    if (schema && schema !== 'public') continue; // foreign schema, not a public RLS table
    if (!R.has(b)) continue; // not RLS-protected → no foreign RLS to re-enter
    if (b === policyTable) continue; // self-reference exempt
    hits.add(b);
  }
  return [...hits].sort();
}

/** All surviving policies the detector currently flags as recursion risks. */
function detectedRiskKeys(): string[] {
  const out: string[] = [];
  for (const [key, stmt] of POLICIES) {
    const table = key.slice(0, key.indexOf('::'));
    if (detectInlineCrossTable(table, stmt).length > 0) out.push(key);
  }
  return out.sort();
}

// ════════════════════════════════════════════════════════════════════════════
// 0. Parser non-vacuity — if this is empty/wrong, every assertion below is hollow.
// ════════════════════════════════════════════════════════════════════════════
describe('generalized RLS recursion guard: parser non-vacuity', () => {
  it('resolves the migrations root and the baseline', () => {
    expect(MIGRATIONS_ABS).not.toBeNull();
    expect(
      existsSync(resolve(MIGRATIONS_ABS!, '00000000000000_baseline_from_prod.sql')),
    ).toBe(true);
  });

  it('builds a large R (RLS-enabled tables) from the live chain — not a hardcoded list', () => {
    // Sanity floor: the baseline alone enables RLS on 270 tables.
    expect(R.size).toBeGreaterThanOrEqual(270);
    for (const t of [
      'students',
      'class_students',
      'class_teachers',
      'classes',
      'teachers',
      'guardians',
      'guardian_student_links',
      'school_admins',
    ]) {
      expect(R.has(t), `R should contain RLS-enabled table "${t}"`).toBe(true);
    }
  });

  it('reduces a large effective policy set across the whole chain', () => {
    expect(POLICIES.size).toBeGreaterThanOrEqual(500);
    // The fixed students teacher backstop must survive in its non-recursive form.
    expect(POLICIES.has('students::Teachers can view students in their classes')).toBe(true);
    expect(POLICIES.has('students::students_select_merged')).toBe(true);
  });

  it('exposes the SECURITY DEFINER helper roster (set H)', () => {
    expect(RLS_HELPERS).toContain('is_teacher_of');
    expect(RLS_HELPERS).toContain('is_guardian_of');
    expect(RLS_HELPERS).toContain('is_school_admin_of');
    // XC-3 Phase 1: the new student-scoped school-admin helper joined the roster.
    expect(RLS_HELPERS).toContain('is_school_admin_of_student');
    expect(RLS_HELPERS.length).toBe(11);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE FREEZE — detected recursion-risk set ⊆ GRANDFATHERED_INLINE_POLICIES.
//    Fails ONLY when a NEW or RENAMED policy inlines a cross-table subquery.
// ════════════════════════════════════════════════════════════════════════════
describe('generalized RLS recursion guard: no NEW inline cross-table policy', () => {
  it('every detected recursion-risk policy is in the grandfather allowlist', () => {
    const detected = detectedRiskKeys();
    const offenders = detected.filter((k) => !GRANDFATHERED_INLINE_POLICIES.has(k));

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `RLS INFINITE-RECURSION RISK (P8) — ${offenders.length} NEW/RENAMED policy(ies) ` +
            `inline a FROM/JOIN over a DIFFERENT RLS-enabled table in USING/WITH CHECK:\n` +
            offenders
              .map((k) => {
                const table = k.slice(0, k.indexOf('::'));
                const tables = detectInlineCrossTable(table, POLICIES.get(k)!);
                return `  • ${k}  →  inlines ${tables.join(', ')}`;
              })
              .join('\n') +
            `\n\nThis is the 2026-07-02 TSB-4 class: an inline SECURITY-INVOKER subquery ` +
            `re-enters the referenced table's OWN RLS and can close a students→…→students ` +
            `recursion cycle (Postgres: "infinite recursion detected in policy for relation ` +
            `…"). Express cross-table authorization via a SECURITY DEFINER helper ` +
            `(is_teacher_of / is_guardian_of / is_school_admin_of / get_my_* — their inner ` +
            `reads bypass RLS) instead of inlining the join. If this policy is a legitimate, ` +
            `reviewed addition, an architect must add its "<table>::<name>" key to ` +
            `GRANDFATHERED_INLINE_POLICIES with justification. See ` +
            `docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5) and ` +
            `supabase/migrations/20260702080000_fix_students_rls_infinite_recursion.sql.`,
    ).toEqual([]);
  });

  it('the grandfather ledger has no STALE entries (matches current debt exactly)', () => {
    // Hygiene + Phase-4 ratchet: when an inline policy is migrated to a helper (or
    // renamed/dropped) it leaves the detected set, so its allowlist entry must be
    // pruned in the same change. This keeps the ledger an exact, reviewable mirror
    // of the live debt and forces the count to ratchet DOWN, never drift.
    const detected = new Set(detectedRiskKeys());
    const stale = [...GRANDFATHERED_INLINE_POLICIES].filter((k) => !detected.has(k)).sort();
    expect(
      stale,
      stale.length === 0
        ? ''
        : `Stale GRANDFATHERED_INLINE_POLICIES entries (no longer detected — remove them ` +
            `to ratchet the ledger down): ${stale.join(', ')}.`,
    ).toEqual([]);
  });

  it('freezes the current blast radius at exactly 234 inline cross-table policies', () => {
    // The audit found ~141 inline policies in the BASELINE; the whole effective
    // chain carried 242 AFTER Phase 0a.1 widened policy-NAME matching to also see
    // UNQUOTED-name policies (was 214 with the quoted-only regex; the 28 newly-visible
    // policies all carry unquoted names — see the Phase 0a.1 block in
    // GRANDFATHERED_INLINE_POLICIES). XC-3 Phase 1 (migration 20260702090000) drained
    // the FIRST entry — the apex students policy "School admins can view school
    // students" was refactored to the SECURITY DEFINER helper
    // is_school_admin_of_student(id), so it is no longer flagged: 242 → 241. XC-3
    // Phase 4 began draining the REMAINING grandfathered inline policies table by
    // table: migration 20260702100000 refactored the at_risk_alerts policy "Teachers
    // see own at-risk alerts" from an inline `FROM public.teachers` subquery to the
    // SECURITY DEFINER helper get_my_teacher_id() (boundary-identical via the UNIQUE
    // teachers.auth_user_id constraint): 241 → 240. Migration 20260702110000 drained
    // 4 Digital Twin policies (_parent_select and _teacher_select on both
    // learner_twin_snapshots and learner_twin_memory) to is_guardian_of() and
    // is_teacher_of() helpers: 240 → 236. Migration 20260702130000 drained the
    // remaining 2 Digital Twin _student_select policies to the EXISTING SECURITY
    // DEFINER helper public.get_my_student_id() (already on the roster — no new
    // helper minted): 236 → 234. The parent-dashboard RCA drain (migration
    // 20260720170000) removed 11 more: 234 → 223. The XC-3 backport (migration
    // 20260722091000, 2026-07-22) refactored adaptive_interventions_parent_select
    // and adaptive_interventions_teacher_select to is_guardian_of()/is_teacher_of()
    // helpers with NO remaining inline predicate at all (the sibling
    // teacher_remediation_assignments policies touched by the same migration
    // retain a same-table-ownership ...IN (SELECT ... FROM teachers...)
    // subquery and so are still detected/grandfathered — see the ledger
    // comment above): 223 → 221. Phase 8 item 8.6 (migration
    // 20260722102000_synthesis_quality_scores.sql, 2026-07-22) added ONE new
    // grandfathered entry: synthesis_quality_scores_read_admin inlines the
    // identical admin_users subquery pattern as the already-grandfathered
    // foxy_quality_scores_read_admin (same service_role short-circuit + same
    // is_active guard) — the same reviewed, accepted pattern, not a new risk
    // class: 221 → 222. This pins the number so any drift (up = new
    // violation, down = un-pruned ledger) trips a guard above.
    expect(GRANDFATHERED_INLINE_POLICIES.size).toBe(222);
    expect(detectedRiskKeys().length).toBe(222);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. POSITIVE SHAPE — the apex `students` table is clean except the single known,
//    tracked latent edge; the fixed teacher policy delegates to the helper.
// ════════════════════════════════════════════════════════════════════════════
describe('generalized RLS recursion guard: students apex is helper-delegating', () => {
  it('the fixed "Teachers can view students in their classes" policy is NOT flagged (uses is_teacher_of)', () => {
    const stmt = POLICIES.get('students::Teachers can view students in their classes')!;
    expect(stmt).toMatch(/public\.is_teacher_of\s*\(\s*id\s*\)/i);
    expect(detectInlineCrossTable('students', stmt)).toEqual([]);
    // …and because it is non-recursive it is correctly ABSENT from the ledger,
    // so re-introducing the old inline shape under this same name FAILS the guard.
    expect(
      GRANDFATHERED_INLINE_POLICIES.has('students::Teachers can view students in their classes'),
    ).toBe(false);
  });

  it('students_select_merged expresses teacher/parent boundaries via helpers only (not flagged)', () => {
    const stmt = POLICIES.get('students::students_select_merged')!;
    expect(stmt).toMatch(/is_teacher_of/i);
    expect(stmt).toMatch(/is_guardian_of/i);
    expect(detectInlineCrossTable('students', stmt)).toEqual([]);
  });

  it('the apex students table now has ZERO inline cross-table edges (XC-3 Phase 1 drained the last one)', () => {
    // Before XC-3 Phase 1 the students policy "School admins can view school
    // students" inlined `FROM school_admins` and was the single grandfathered latent
    // edge on the apex table. Migration 20260702090000 refactored it to the SECURITY
    // DEFINER helper is_school_admin_of_student(id), so students now carries NO inline
    // cross-table policy at all — every cross-table boundary on the apex table
    // delegates to a helper.
    const studentsRisks = detectedRiskKeys().filter((k) => k.startsWith('students::'));
    expect(studentsRisks).toEqual([]);
    // …and the refactored policy delegates to the helper (not inlining), so it is
    // correctly ABSENT from the ledger — re-introducing the old inline shape under
    // this same name would FAIL the guard.
    const stmt = POLICIES.get('students::School admins can view school students')!;
    expect(stmt).toMatch(/public\.is_school_admin_of_student\s*\(\s*id\s*\)/i);
    expect(detectInlineCrossTable('students', stmt)).toEqual([]);
    expect(
      GRANDFATHERED_INLINE_POLICIES.has('students::School admins can view school students'),
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. DETECTOR SELF-TEST (non-vacuous proof) — it MUST flag the old recursive
//    TSB-4 text and MUST clear the fixed helper form, independent of the live
//    chain. This is the "would it catch the incident?" proof.
// ════════════════════════════════════════════════════════════════════════════
describe('generalized RLS recursion guard: detector self-test', () => {
  const RECURSIVE_OLD = `CREATE POLICY "Teachers can view students in their classes"
    ON public.students FOR SELECT TO authenticated
    USING ( id IN ( SELECT cs.student_id
                    FROM public.class_students cs
                    JOIN public.class_teachers ct ON ct.class_id = cs.class_id
                    JOIN public.teachers t ON t.id = ct.teacher_id
                    WHERE t.auth_user_id = auth.uid()
                      AND cs.is_active = true AND ct.is_active = true ) )`.replace(/\s+/g, ' ');

  const FIXED_NEW = `CREATE POLICY "Teachers can view students in their classes"
    ON public.students FOR SELECT TO authenticated
    USING ( public.is_teacher_of(id) )`.replace(/\s+/g, ' ');

  it('FLAGS the old inline class_students/class_teachers/teachers policy on students', () => {
    const hits = detectInlineCrossTable('students', RECURSIVE_OLD);
    expect(hits).toContain('class_students');
    expect(hits).toContain('class_teachers');
    expect(hits).toContain('teachers');
  });

  it('CLEARS the fixed is_teacher_of(id) helper-delegating policy', () => {
    expect(detectInlineCrossTable('students', FIXED_NEW)).toEqual([]);
  });

  it('CLEARS a pure auth.uid()/column predicate (no FROM over a foreign table)', () => {
    const own = `CREATE POLICY "x" ON public.students FOR SELECT TO authenticated
      USING ( auth_user_id = auth.uid() )`.replace(/\s+/g, ' ');
    expect(detectInlineCrossTable('students', own)).toEqual([]);
  });

  it('CLEARS a helper-call combination (is_teacher_of OR is_guardian_of)', () => {
    const helperCombo = `CREATE POLICY "x" ON public.students FOR SELECT TO authenticated
      USING ( public.is_teacher_of(id) OR public.is_guardian_of(id) )`.replace(/\s+/g, ' ');
    expect(detectInlineCrossTable('students', helperCombo)).toEqual([]);
  });

  it('EXEMPTS a same-table self-reference (b === policyTable)', () => {
    // A class_students policy that subqueries class_students itself is not a
    // foreign-RLS re-entry and must not be flagged.
    const selfRef = `CREATE POLICY "x" ON public.class_students FOR SELECT TO authenticated
      USING ( class_id IN ( SELECT cs.class_id FROM public.class_students cs
                            WHERE cs.student_id = auth.uid() ) )`.replace(/\s+/g, ' ');
    expect(detectInlineCrossTable('class_students', selfRef)).toEqual([]);
  });

  it('FLAGS an inline guardian/parent link join on students', () => {
    const guardianInline = `CREATE POLICY "x" ON public.students FOR SELECT TO authenticated
      USING ( id IN ( SELECT gsl.student_id FROM public.guardian_student_links gsl
                      WHERE gsl.guardian_id = auth.uid() ) )`.replace(/\s+/g, ' ');
    expect(detectInlineCrossTable('students', guardianInline)).toContain('guardian_student_links');
  });

  it('does NOT flag a FROM over a non-RLS reference table', () => {
    // If a table is not in R there is no foreign RLS to re-enter. Use a clearly
    // non-RLS name; assert it is genuinely absent from R first.
    expect(R.has('definitely_not_a_real_rls_table')).toBe(false);
    const refJoin = `CREATE POLICY "x" ON public.students FOR SELECT TO authenticated
      USING ( id IN ( SELECT r.id FROM public.definitely_not_a_real_rls_table r ) )`.replace(
      /\s+/g,
      ' ',
    );
    expect(detectInlineCrossTable('students', refJoin)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. UNQUOTED POLICY-NAME SELF-TEST (Phase 0a.1) — proves the widened name regex
//    now SEES bare-identifier policies that the quoted-only regex would have missed
//    entirely. The recursion-detection itself is name-agnostic, so the real risk
//    closed here is the PARSING blind spot: an unquoted-name policy was never even
//    registered, so it could never be flagged. These tests exercise CREATE_RE /
//    DROP_RE / policyName directly + the same per-statement reduction parseChain
//    uses, independent of the live chain.
// ════════════════════════════════════════════════════════════════════════════
describe('generalized RLS recursion guard: unquoted policy-name coverage (Phase 0a.1)', () => {
  // The exact false-negative shape the old guard hid: an UNQUOTED-name policy on
  // students inlining class_students (a different RLS table) — the TSB-4 class.
  const UNQUOTED_RECURSIVE = `CREATE POLICY teacher_inline ON public.students FOR SELECT TO authenticated
    USING ( id IN ( SELECT student_id FROM public.class_students WHERE class_id = 1 ) )`.replace(
    /\s+/g,
    ' ',
  );

  it('CREATE_RE now MATCHES an unquoted policy name and extracts name + table', () => {
    const m = CREATE_RE.exec(UNQUOTED_RECURSIVE);
    expect(m).not.toBeNull();
    expect(policyName(m!)).toBe('teacher_inline'); // group 2 (unquoted), lower-cased
    expect(m![3].toLowerCase()).toBe('students'); // table is still group 3
  });

  it('FLAGS the unquoted-name recursive policy as an inline cross-table risk', () => {
    // Parse the name/table via the regex, then run the detector on the predicate —
    // i.e. the full parse→detect path the old quoted-only regex short-circuited.
    const m = CREATE_RE.exec(UNQUOTED_RECURSIVE)!;
    const table = m[3].toLowerCase();
    expect(detectInlineCrossTable(table, UNQUOTED_RECURSIVE)).toContain('class_students');
  });

  it('still MATCHES a quoted policy name (no regression from the widening)', () => {
    const quoted = `CREATE POLICY "Teachers can view x" ON public.students FOR SELECT
      USING ( id IN ( SELECT student_id FROM public.class_students ) )`.replace(/\s+/g, ' ');
    const m = CREATE_RE.exec(quoted);
    expect(m).not.toBeNull();
    expect(policyName(m!)).toBe('Teachers can view x'); // group 1 (quoted), verbatim
    expect(m![3].toLowerCase()).toBe('students');
  });

  it('DROP by unquoted name reduces the matching CREATE (DROP-before-CREATE still works)', () => {
    // Mirror parseChain's per-statement reduction for a CREATE then DROP of the SAME
    // unquoted-name policy: the key must be inserted then deleted, leaving nothing.
    const drop = `DROP POLICY IF EXISTS teacher_inline ON public.students`.replace(/\s+/g, ' ');
    const policies = new Map<string, string>();

    const cm = CREATE_RE.exec(UNQUOTED_RECURSIVE)!;
    policies.set(`${cm[3].toLowerCase()}::${policyName(cm)}`, UNQUOTED_RECURSIVE);
    expect(policies.has('students::teacher_inline')).toBe(true);

    const dm = DROP_RE.exec(drop)!;
    expect(policyName(dm)).toBe('teacher_inline');
    policies.delete(`${dm[3].toLowerCase()}::${policyName(dm)}`);
    expect(policies.has('students::teacher_inline')).toBe(false);
  });

  it('folds unquoted-name case so a mixed-case DROP cancels a lower-case CREATE', () => {
    // Postgres folds unquoted identifiers to lower case; the parser must too, or a
    // `DROP POLICY Teacher_Inline` would fail to reduce a `CREATE POLICY teacher_inline`.
    const create = `CREATE POLICY teacher_inline ON public.students USING ( true )`.replace(
      /\s+/g,
      ' ',
    );
    const dropMixed = `DROP POLICY Teacher_Inline ON public.students`.replace(/\s+/g, ' ');
    const ck = (() => {
      const m = CREATE_RE.exec(create)!;
      return `${m[3].toLowerCase()}::${policyName(m)}`;
    })();
    const dk = (() => {
      const m = DROP_RE.exec(dropMixed)!;
      return `${m[3].toLowerCase()}::${policyName(m)}`;
    })();
    expect(ck).toBe('students::teacher_inline');
    expect(dk).toBe(ck); // mixed-case DROP resolves to the same key → reduction works
  });

  it('the remaining Phase 0a.1 unquoted-name policies are present in the live detected set', () => {
    // Anchor proof that the widening is what surfaced them: each is detected now.
    // NOTE (2026-07-22 XC-3 backport, migration 20260722091000):
    // adaptive_interventions::adaptive_interventions_teacher_select was
    // refactored to is_teacher_of(student_id) with no remaining inline
    // predicate and is no longer detected (see the ledger comment above) — it
    // was removed from this anchor list; teacher_remediation_assignments_
    // teacher_select remains detected (retains an inline teacher-ownership
    // subquery) and still anchors the same migration's grandfathered survivors.
    const detected = new Set(detectedRiskKeys());
    for (const k of [
      'adaptive_interventions::adaptive_interventions_student_select',
      'teacher_remediation_assignments::teacher_remediation_assignments_teacher_select',
      'board_score_predictions::board_score_predictions_student_select',
      'parent_cheers::parent_cheers_guardian_select',
    ]) {
      expect(detected.has(k), `Phase 0a.1 unquoted-name policy "${k}" should be detected`).toBe(
        true,
      );
    }
  });
});
