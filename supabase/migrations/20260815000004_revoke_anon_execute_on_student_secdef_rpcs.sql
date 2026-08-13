-- Migration: 20260815000004_revoke_anon_execute_on_student_secdef_rpcs.sql
-- Purpose: P0 SECURITY FIX — remove UNAUTHENTICATED (`anon`) EXECUTE from 106
--          PostgREST-exposed SECURITY DEFINER RPCs that return or mutate student,
--          guardian, teacher and school data for a CALLER-SUPPLIED id.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- EVIDENCE — CONFIRMED LIVE EXPOSURE, NOT A THEORETICAL FINDING
-- ═════════════════════════════════════════════════════════════════════════════
-- Probed 2026-08-13 against production project `shktyoxqhundlvkiwguu` using the
-- PUBLIC anon key (the one that ships in the browser bundle), with NO user
-- session and an ARBITRARY p_student_id / p_guardian_id:
--
--   ANON get_student_snapshot      200  {"total_xp":12825,"avg_score":84,
--                                        "quizzes_taken":70,...}
--   ANON get_student_notifications 200  {"unread_count":1,"notifications":[
--                                        {"id":"5451e3e7-...
--   ANON get_review_cards          200  [{"topic":"math:14:...",
--                                        "back_text":"B) Per...
--   ANON get_guardian_dashboard    200  {"children":[],"child_count":0}
--
-- The returned 12825-XP profile matches no demo seed value — this is real
-- student data, readable by anyone on the internet. P13 (data privacy) and P8
-- (RLS boundary) breach.
--
-- CONTROL (proves the revoke mechanism works and the probe is sound): the RPCs
-- already hardened by 20260813000007 — get_dashboard_data, get_study_plan,
-- get_knowledge_gaps — answer the SAME anon key with
--   401 / SQLSTATE 42501 "permission denied for function ..."
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE — WHY EARLIER `REVOKE ... FROM anon` STATEMENTS DID NOTHING
-- ═════════════════════════════════════════════════════════════════════════════
-- Supabase's baseline ends with
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
-- and PostgreSQL additionally grants EXECUTE to PUBLIC on every new function by
-- default. A statement of the form
--     REVOKE EXECUTE ON FUNCTION f(...) FROM anon;
-- removes ONLY the named `anon=X` entry. The `=X` (PUBLIC) entry survives, and
-- PUBLIC includes anon — so the function stays fully reachable through PostgREST
-- by an unauthenticated caller. The REVOKE succeeds, looks authoritative in the
-- migration chain, and changes nothing.
--
-- This is the same defect class documented in 20260814000004. A concrete
-- instance in scope here: 20260515000002:212 already ran
--     REVOKE EXECUTE ON FUNCTION public.get_user_role(p_auth_user_id uuid) FROM anon;
-- yet the live probe still shows anon CAN execute get_user_role today — a
-- function that returns name + grade + roles for an ARBITRARY auth_user_id.
--
-- The correct shape, used here and by 20260813000007 / 20260707020000, is:
--     REVOKE ALL ON ROUTINE f(...) FROM PUBLIC, anon;   -- kill the PUBLIC leg too
--     GRANT  EXECUTE ON ROUTINE f(...) TO <roles that actually call it>;
--
-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT METHOD (448 exposed RPCs -> 112 anon-executable -> 106 revoked here)
-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Enumerated all 448 functions exposed by PostgREST from the live OpenAPI
--    spec (GET /rest/v1/ with Accept: application/openapi+json).
-- 2. Probed each of the 348 that accept a non-text scalar parameter with the
--    anon key, passing a deliberately UNCOERCIBLE value (e.g. 'not-a-uuid').
--    PostgreSQL checks EXECUTE permission BEFORE argument coercion, so:
--        401 + 42501  => anon CANNOT execute (correctly revoked)
--        400 + 22P02  => anon CAN execute; the body never ran
--    This was calibrated against the known-revoked / known-exposed controls
--    listed above. NO function body was executed during the audit: of the 112
--    anon-executable results, ZERO returned HTTP 200 (101x 22P02, 10x 22007,
--    1x PGRST203). Mutating RPCs were therefore audited without invoking them.
-- 3. Result: 112 of 348 are anon-executable. 106 are revoked below.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- WHY THIS IS TRANSPARENT TO LOGGED-IN USERS
-- ═════════════════════════════════════════════════════════════════════════════
-- A signed-in browser session sends the user's JWT, so PostgREST resolves the
-- request role as `authenticated`, NEVER `anon`. Only genuinely unauthenticated
-- traffic loses access. Verified caller analysis across apps/host/src,
-- packages/, mobile/ and supabase/functions/:
--   * No public/marketing/landing/pre-login page calls ANY RPC in this list.
--   * Student surfaces (/leaderboard, /notifications, /challenge, /foxy) are in
--     STUDENT_PROTECTED (apps/host/src/proxy.ts:1231) and gate on
--     useAuth().isLoggedIn — they only fire these RPCs with a session.
--   * bootstrap_user_profile (P15 onboarding, the #1 acquisition path) is called
--     ONLY server-side with the service role — getSupabaseAdmin() in
--     apps/host/src/app/api/auth/bootstrap/route.ts:403 and
--     packages/lib/src/identity/complete-signup.ts:259. The AuthScreen.tsx
--     reference is a COMMENT, not a call. Onboarding is unaffected.
--   * security_*, embedding-backfill, compute_*/snapshot_* analytics: all callers
--     are service-role edge functions / API routes / cron.
--   * Functions invoked INTERNALLY from another SECURITY DEFINER function run
--     with the definer's privileges and are immune to EXECUTE grants entirely.
--   * pg_cron jobs run as `postgres`, which is the OWNER of these routines and
--     retains implicit EXECUTE regardless of any GRANT/REVOKE below.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- DELIBERATE EXCLUSIONS (6) — anon EXECUTE INTENTIONALLY LEFT IN PLACE
-- ═════════════════════════════════════════════════════════════════════════════
-- These 6 probed as anon-executable but are NOT revoked here, because they are
-- caller-relative BOOLEAN authorization predicates evaluated INSIDE RLS policy
-- expressions. When a policy calls a function, the CURRENT role needs EXECUTE on
-- it — so revoking `anon` would convert a quiet "policy returns false, zero rows"
-- into a hard 42501 error on every anon-reachable table that uses them. They also
-- leak nothing: each compares against auth.uid(), which is NULL for anon, so they
-- return FALSE unconditionally for an unauthenticated caller.
--   * is_guardian_of(uuid)            — 48 RLS policy references (students,
--                                       concept_mastery, study_plans,
--                                       topic_mastery, spaced_repetition_cards, ...)
--   * is_teacher_of(uuid)             — 38 RLS policy references
--   * is_own_exam_entry(uuid)         — USING + WITH CHECK in
--                                       20260802090100_create_student_exam_entries.sql:156-157
--   * is_school_admin_of_student(uuid)— USING in
--                                       20260702090000_xc3_p1_..._helper.sql:114
--   * is_active_admin, foxy_can_view_student — no source in this repo (live-DB-only,
--     same class as the agent_* routines in 20260814000004 PART C). Name shape and
--     probe behaviour indicate caller-relative authorization predicates likely used
--     by live-only policies. Excluded pending the live-policy dependency audit;
--     a repo grep is NOT sufficient evidence to revoke them.
-- FOLLOW-UP: these 6 need a separate pass that first enumerates live pg_policy
-- dependencies, then revokes anon where provably unreferenced.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- SCOPE LIMITS (explicit)
-- ═════════════════════════════════════════════════════════════════════════════
-- This migration changes GRANTS ONLY.
--   * NO function body is modified. No CREATE OR REPLACE of any function.
--   * The ownership guards from 20260815000001 are NOT re-landed. They remain
--     reverted (59% of production students have NULL auth_user_id — see
--     f7fa8ebb3 / 20260815000003). Guarding needs is_guardian_of()/is_teacher_of()
--     design work plus an auth_user_id backfill, and is explicitly out of scope.
--   * NO DROP of anything.
--   * Revoking anon does NOT fix the missing ownership guards: an AUTHENTICATED
--     caller can still pass an arbitrary p_student_id to these RPCs. That is a
--     separate, still-open defect. This migration closes only the strictly worse
--     UNAUTHENTICATED hole.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCY / CORRECTNESS AGAINST THE ACTUAL LIVE STATE
-- ═════════════════════════════════════════════════════════════════════════════
-- Migrations 20260814000012 onward and the whole 20260815* batch are NOT applied
-- in production (`supabase db push` aborted between 20260814000008 and
-- 20260814000012). This migration therefore assumes NOTHING about grants those
-- files claim to establish — the target list is derived from the LIVE probe above.
--
-- Routines are resolved DYNAMICALLY from pg_proc by name, so every overload that
-- actually exists in the target environment is locked, and a name that does not
-- exist is a clean no-op. A hardcoded signature that is absent would raise 42883
-- and roll back the entire transaction on CI live-DB, fresh staging and DR
-- restores; the DO-block form (house pattern from 20260814000004 PART B3/PART C)
-- avoids that. REVOKE and GRANT are naturally replay-safe.
--
-- `ON ROUTINE` (not `ON FUNCTION`) is used deliberately: it is the correct
-- superset covering functions, aggregates AND procedures, and behaves identically
-- to ON FUNCTION for a function. It keeps these statements robust if any target is
-- ever recreated out-of-band as a procedure — a failure that, because the loop only
-- fires where the object exists, would land on PRODUCTION ONLY and never reproduce
-- in CI.
--
-- EXISTING authenticated / service_role GRANTS ARE PRESERVED EXACTLY, BY
-- CONSTRUCTION: because `REVOKE ... FROM PUBLIC` also removes the PUBLIC leg that
-- these roles may be relying on, each role's CURRENT effective EXECUTE privilege
-- is captured with has_function_privilege() BEFORE the revoke and re-granted
-- afterwards only if it was already held. This migration therefore never widens
-- access for any role, and never narrows it for anyone except `anon`.

BEGIN;

DO $revoke_anon_execute_student_rpcs$
DECLARE
  p               RECORD;
  v_auth_had      boolean;
  v_svc_had       boolean;
  v_count         integer := 0;
  v_anon_before   integer := 0;
  v_names         text[] := ARRAY[
    'assert_seat_capacity', 'bkt_update', 'bootstrap_user_profile',
    'calculate_cohort_bkt_mastery', 'cbse_syllabus_rag_ready', 'claim_embedding_backfill_jobs',
    'claim_embedding_backfill_payload', 'complete_embedding_backfill_success', 'compute_chapter_readiness',
    'compute_education_intelligence_rollup', 'compute_geographic_metrics', 'compute_gst',
    'compute_mrr_snapshot', 'compute_post_quiz_action', 'compute_school_churn_signals',
    'compute_school_health_daily', 'compute_school_mrr_daily', 'compute_subject_readiness',
    'content_request_ist_day', 'content_request_utc_day', 'detect_blocked_dependents',
    'detect_knowledge_gaps', 'eic_clamp_0_100', 'foxy_create_pending_assistant_message',
    'foxy_fail_assistant_message', 'foxy_finalize_assistant_message', 'foxy_get_student_recent_decisions',
    'foxy_get_student_recent_events', 'foxy_get_student_state', 'foxy_get_student_timeline',
    'foxy_policy_decide', 'generate_concept_code', 'generate_exam_paper',
    'generate_student_notifications', 'generate_weekly_study_plan', 'get_adaptive_questions',
    'get_assignment_report', 'get_board_exam_questions', 'get_chapter_rag_content',
    'get_class_detail', 'get_classes_at_risk', 'get_cohort_bkt_mastery_by_student',
    'get_competition_leaderboard', 'get_competitions', 'get_content_tier',
    'get_due_reviews', 'get_embedding_backfill_queue_metrics', 'get_guardian_dashboard',
    'get_hall_of_fame', 'get_leaderboard', 'get_mastery_overview',
    'get_next_topics_adaptive', 'get_next_unstarted_chapter', 'get_or_create_foxy_session',
    'get_or_create_student', 'get_quiz_questions', 'get_review_cards',
    'get_school_classes', 'get_school_dashboard_stats', 'get_school_overview',
    'get_school_students', 'get_school_teachers', 'get_student_curriculum',
    'get_student_dashboard', 'get_student_notifications', 'get_student_snapshot',
    'get_teacher_dashboard', 'get_teacher_engagement', 'get_unread_notifications',
    'get_user_role', 'join_competition', 'link_guardian_to_student_via_code',
    'mark_embedding_backfill_done', 'mark_embedding_backfill_error', 'mark_notification_read',
    'recompute_syllabus_status', 'record_learning_event', 'record_message_feedback',
    'requeue_stale_embedding_backfill_jobs', 'safe_upsert_chat_session', 'search_rag_chunks',
    'security_compute_ai_cost', 'security_reserve_quota', 'security_resolve_route_policy',
    'security_resolve_user_context', 'security_settle_quota', 'security_update_circuit_state',
    'security_write_request_audit', 'select_questions_by_irt_info', 'select_questions_by_irt_info_v2',
    'select_quiz_questions_rag', 'select_quiz_questions_v2', 'snapshot_adaptive_intervention_metrics_daily',
    'start_mock_test_attempt', 'start_quiz_session', 'student_join_class',
    'submit_foxy_message_atomic', 'teacher_create_assignment', 'teacher_create_class',
    'total_questions_in_chapter', 'track_ai_quality', 'traverse_prerequisites',
    'update_chapter_progress', 'update_learner_state_post_quiz', 'update_sm2_parameters',
    'upsert_adaptive_intervention'
  ];
BEGIN
  FOR p IN
    SELECT pr.oid,
           pr.proname,
           pg_get_function_identity_arguments(pr.oid) AS args
      FROM pg_proc pr
      JOIN pg_namespace n ON n.oid = pr.pronamespace
     WHERE n.nspname = 'public'
       AND pr.proname = ANY(v_names)
     ORDER BY pr.proname, pg_get_function_identity_arguments(pr.oid)
  LOOP
    -- Capture CURRENT effective privilege (covers grants held via PUBLIC) so the
    -- post-revoke re-grant restores exactly what each role already had.
    v_auth_had := has_function_privilege('authenticated', p.oid, 'EXECUTE');
    v_svc_had  := has_function_privilege('service_role',  p.oid, 'EXECUTE');

    IF has_function_privilege('anon', p.oid, 'EXECUTE') THEN
      v_anon_before := v_anon_before + 1;
    END IF;

    -- Kill BOTH the explicit `anon=X` grant and the `=X` PUBLIC grant. Revoking
    -- only one of the two is the no-op documented in the header.
    EXECUTE format(
      'REVOKE ALL ON ROUTINE public.%I(%s) FROM PUBLIC, anon',
      p.proname, p.args
    );

    IF v_auth_had THEN
      EXECUTE format(
        'GRANT EXECUTE ON ROUTINE public.%I(%s) TO authenticated',
        p.proname, p.args
      );
    END IF;

    IF v_svc_had THEN
      EXECUTE format(
        'GRANT EXECUTE ON ROUTINE public.%I(%s) TO service_role',
        p.proname, p.args
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '20260815000004: processed % routine(s) across % target name(s); % had anon EXECUTE before this migration (0 processed = correctly skipped on a database that predates these objects)',
    v_count, array_length(v_names, 1), v_anon_before;
END;
$revoke_anon_execute_student_rpcs$;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-CONDITION ASSERTION — fail loudly rather than silently under-applying.
-- If any targeted routine still resolves EXECUTE for `anon`, the migration did
-- not achieve its purpose and must roll back.
-- ─────────────────────────────────────────────────────────────────────────────
DO $verify_anon_revoked$
DECLARE
  v_leaky text;
BEGIN
  SELECT string_agg(format('%s(%s)', pr.proname, pg_get_function_identity_arguments(pr.oid)), ', ')
    INTO v_leaky
    FROM pg_proc pr
    JOIN pg_namespace n ON n.oid = pr.pronamespace
   WHERE n.nspname = 'public'
     AND pr.proname = ANY (ARRAY[
       'get_student_snapshot', 'get_student_notifications', 'get_review_cards',
       'get_guardian_dashboard', 'student_join_class', 'join_competition',
       'link_guardian_to_student_via_code', 'generate_exam_paper',
       'generate_student_notifications', 'get_user_role', 'get_student_dashboard',
       'get_teacher_dashboard', 'get_school_students'
     ])
     AND has_function_privilege('anon', pr.oid, 'EXECUTE');

  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION '20260815000004: anon still holds EXECUTE after revoke on: %', v_leaky;
  END IF;

  RAISE NOTICE '20260815000004: verified — anon holds no EXECUTE on any spot-checked student/guardian/teacher RPC';
END;
$verify_anon_revoked$;

COMMIT;

-- End of migration: 20260815000004_revoke_anon_execute_on_student_secdef_rpcs.sql
--
-- WHAT CHANGED: 106 PostgREST-exposed routines no longer execute for the
--   unauthenticated `anon` role. Each keeps the `authenticated` and/or
--   `service_role` EXECUTE it already effectively held; `postgres` remains owner.
--
-- WHAT DID NOT CHANGE: no function body, no schema, no RLS policy, no ownership
--   guard, no DROP. Logged-in users (role `authenticated`), all service-role
--   API routes / edge functions / cron, and pg_cron jobs running as `postgres`
--   are entirely unaffected.
--
-- STILL OPEN after this migration (tracked separately, NOT addressed here):
--   1. Missing ownership guards — an AUTHENTICATED caller can still pass an
--      arbitrary p_student_id to these RPCs (blocked on the auth_user_id backfill;
--      see 20260815000003 and commit f7fa8ebb3).
--   2. The 6 excluded RLS-predicate helpers listed in the header.
--   3. 100 of the 448 exposed RPCs were NOT probed (65 zero-argument, 35 whose
--      arguments are all text/jsonb/array types). No uncoercible argument value
--      exists for them, so a probe would have EXECUTED the body — unacceptable for
--      the mutating ones. They need a separate live-ACL (proacl) review rather
--      than a black-box probe, and may contain further anon-reachable surface.
