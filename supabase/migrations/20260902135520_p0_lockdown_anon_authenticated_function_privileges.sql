-- P0-1 / P0-2 (2026-09-02 launch audit) — lock down SECURITY DEFINER
-- functions that had no legitimate anon/authenticated caller, and fix two
-- NULL-collapses-to-pass-through guard bugs on functions that do.
--
-- ROOT CAUSE: Supabase's default privileges grant EXECUTE on every new
-- function to `anon` and `authenticated`. No prior migration ever revoked
-- these for the functions below, and several of them either have no
-- in-body caller check at all, or a check written as
--   IF NOT (p_student_id = get_my_student_id() OR is_teacher_of(...) OR ...)
-- which is fine for a real (non-matching) auth.uid(), but for an
-- ANONYMOUS caller every one of those helpers returns NULL, the whole
-- OR-chain evaluates to NULL, `NOT NULL` is NULL, and `IF NULL THEN` never
-- fires — so the guard silently passes anonymous callers through.
--
-- LIVE-CONFIRMED 2026-09-02 (harmless read-only probes with only the public
-- anon key, random UUID, no auth session):
--   POST /rest/v1/rpc/get_progress_report   {"p_student_id":"0000…0001"} → 200
--   POST /rest/v1/rpc/get_activity_timeline {"p_student_id":"0000…0001"} → 200
--   POST /rest/v1/rpc/get_table_sizes {} → 200 (schema/row-count disclosure)
--   POST /rest/v1/rpc/get_connection_stats {} → 200
-- Not exercised live because they write, but confirmed by reading the body
-- (SECURITY DEFINER, anon_exec=true or auth_exec=true, no auth.uid() check
-- at all): update_learner_state_post_quiz, submit_foxy_message_atomic,
-- foxy_create_pending_assistant_message, foxy_finalize_assistant_message,
-- foxy_fail_assistant_message, get_or_create_foxy_session,
-- upsert_adaptive_intervention, the security_* AI-quota ledger writers, and
-- bootstrap_user_profile (P0-2 — lets any caller self-provision as
-- institution_admin; see that section below).
--
-- SCOPE OF THIS MIGRATION: every function touched below was individually
-- verified (grep across apps/host/src, packages/lib/src, packages/ui/src,
-- mobile/lib, supabase/functions) to have EITHER zero callers anywhere in
-- this codebase, OR callers that exclusively use a service-role client
-- (supabaseAdmin / getSupabaseAdmin() / getServiceClient() / Edge Function
-- internal clients) — never a browser or user-JWT client. Revoking
-- anon/authenticated EXECUTE from those functions is a pure privilege
-- change: service_role is untouched by these REVOKEs (it is granted
-- separately and does not inherit from anon/authenticated), so every
-- verified legitimate call path keeps working unchanged.
--
-- generate_weekly_study_plan is different: it IS called from the browser
-- (apps/host/src/app/(student)/exam-prep/page.tsx, a real student-facing
-- feature) via the anon-key RLS client, so its authenticated EXECUTE grant
-- is kept — instead its body gets the same ownership-check pattern already
-- proven in atomic_quiz_profile_update (skip the check only when
-- auth.uid() IS NULL, i.e. for genuine service-role callers, which carry no
-- JWT and are unaffected by RLS/ownership checks in the first place).
--
-- DELIBERATELY OUT OF SCOPE (follow-up migration, needs staging validation
-- first — see the launch audit's P0-1 remediation notes): the sweeping
-- "REVOKE EXECUTE ON ALL FUNCTIONS FROM anon, authenticated by default,
-- then GRANT an explicit allowlist" change. That affects the ~150 RPCs
-- genuinely called from browser/mobile/user-context server code, and a
-- single missed name in that allowlist silently breaks a live feature —
-- verifying it needs the three-role signup + quiz + Foxy E2E suite run
-- against staging, which this session cannot do. This migration closes
-- every function that was individually verified to need no anon/
-- authenticated access at all, which is the highest-confidence, lowest-
-- blast-radius subset of the fix.
--
-- ROLLBACK: re-run the GRANT statements this file's own comments describe
-- REVOKE-ing (i.e. `GRANT EXECUTE ON FUNCTION public.<name> TO anon,
-- authenticated;` for the Section A list, `TO anon;` for Section B), and
-- `CREATE OR REPLACE FUNCTION` the two Section B/C functions back to the
-- bodies captured in this file's own "-- previous body:" comments.


-- ============================================================================
-- SECTION A — functions with ZERO legitimate anon or authenticated caller.
-- Pure privilege change; no function body touched.
-- ============================================================================

-- Foxy write path (server-only: apps/host/.../api/foxy/route.ts and siblings
-- call these via supabaseAdmin, never via a user-JWT client). Un-revoked,
-- any authenticated user could create/finalize/fail Foxy chat-session
-- messages for an arbitrary student_id.
REVOKE EXECUTE ON FUNCTION public.foxy_create_pending_assistant_message FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.foxy_finalize_assistant_message      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.foxy_fail_assistant_message          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_foxy_session           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_foxy_message_atomic           FROM anon, authenticated;

-- Mastery/adaptive write path (server-only). Un-revoked, any authenticated
-- user could rewrite BKT mastery state or inject an adaptive intervention
-- row for an arbitrary student_id.
REVOKE EXECUTE ON FUNCTION public.update_learner_state_post_quiz FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_adaptive_intervention   FROM anon, authenticated;

-- tutor_commit_attempt: append-only concept_attempts writer, called only via
-- supabaseAdmin.rpc() from api/tutor/answer and api/foxy/quiz-answer.
REVOKE EXECUTE ON FUNCTION public.tutor_commit_attempt FROM anon, authenticated;

-- AI-quota/circuit-breaker ledger (server-only: supabase/functions/_shared/
-- security/{quota,audit,circuit}.ts call these with the Edge Function's
-- internal service client, never a user JWT). Un-revoked, an anonymous
-- caller could reserve/settle another tenant's AI quota or flip a route's
-- circuit-breaker state.
REVOKE EXECUTE ON FUNCTION public.security_reserve_quota        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.security_settle_quota         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.security_write_request_audit  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.security_update_circuit_state FROM anon, authenticated;

-- Schema/row-count/connection-pool disclosure (zero callers in this
-- codebase; live-confirmed anon-readable today).
REVOKE EXECUTE ON FUNCTION public.get_table_sizes         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_connection_stats     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_slow_functions_stats FROM anon, authenticated;

-- Cohort mastery aggregates (zero callers in this codebase for the plain
-- calculate_ variant; the by_student sibling is called only via
-- getServiceClient() inside supabase/functions/teacher-dashboard).
REVOKE EXECUTE ON FUNCTION public.calculate_cohort_bkt_mastery         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cohort_bkt_mastery_by_student    FROM anon, authenticated;


-- ============================================================================
-- SECTION A2 (P0-2) — bootstrap_user_profile
-- ============================================================================
-- Only legitimate caller is packages/lib/src/identity/complete-signup.ts,
-- which uses getSupabaseAdmin() (service role) exclusively — never a
-- browser or user-JWT client. Un-revoked, ANY caller (including a fresh
-- self-signup account) could call this directly with
-- p_role='institution_admin' and self-provision as the principal of a new
-- school with the institution_admin RBAC role (the AFTER INSERT trigger
-- trg_sync_school_admin_role grants it automatically), bypassing the
-- role validation in apps/host/src/app/api/auth/bootstrap/route.ts
-- entirely. This privilege revoke alone closes that path; the legitimate
-- P15 onboarding funnel (student/teacher/parent signup) is unaffected
-- since it never calls this RPC from the browser.
REVOKE EXECUTE ON FUNCTION public.bootstrap_user_profile FROM anon, authenticated;


-- ============================================================================
-- SECTION B — get_progress_report / get_activity_timeline: fix the
-- NULL-collapse guard bug, then revoke from anon (neither has any caller in
-- this codebase today, but both clearly intend authenticated self/teacher/
-- guardian/admin access per their own guard logic, so authenticated EXECUTE
-- is kept rather than fully revoked, for whichever surface re-adopts them).
-- ============================================================================

-- previous body (get_progress_report), for rollback:
--   IF NOT (
--     p_student_id = get_my_student_id()
--     OR is_teacher_of(p_student_id)
--     OR is_guardian_of(p_student_id)
--     OR is_admin()
--   ) THEN
--     RAISE EXCEPTION 'Access denied';
--   END IF;
CREATE OR REPLACE FUNCTION public.get_progress_report(p_student_id uuid, p_from date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date, p_to date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- SECURITY FIX (2026-09-02, P0-1): auth.uid() IS NULL for an anonymous
  -- caller, which made every helper below return NULL, the OR-chain
  -- evaluate to NULL, and `IF NOT NULL` never fire. Reject anonymous
  -- callers explicitly before evaluating the ownership chain.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    p_student_id = get_my_student_id()
    OR is_teacher_of(p_student_id)
    OR is_guardian_of(p_student_id)
    OR is_admin()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'student_id', p_student_id,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (
      SELECT jsonb_build_object(
        'login_count',        COALESCE(SUM(login_count), 0),
        'quizzes_completed',  COALESCE(SUM(quizzes_completed), 0),
        'questions_answered', COALESCE(SUM(questions_answered), 0),
        'questions_correct',  COALESCE(SUM(questions_correct), 0),
        'accuracy_pct',       CASE WHEN SUM(questions_answered) > 0
          THEN ROUND(SUM(questions_correct)::numeric / SUM(questions_answered) * 100, 1)
          ELSE NULL END,
        'foxy_sessions',      COALESCE(SUM(foxy_sessions), 0),
        'foxy_messages_sent', COALESCE(SUM(foxy_messages_sent), 0),
        'chapters_completed', COALESCE(SUM(chapters_completed), 0),
        'concept_checks',     COALESCE(SUM(concept_checks), 0),
        'ncert_attempts',     COALESCE(SUM(ncert_attempts), 0),
        'xp_earned',          COALESCE(SUM(xp_earned), 0),
        'challenges_attempted', COALESCE(SUM(challenges_attempted), 0),
        'achievements_earned',  COALESCE(SUM(achievements_earned), 0),
        'total_events',       COALESCE(SUM(total_events), 0),
        'active_days',        COUNT(*)
      )
      FROM analytics.student_daily_summary
      WHERE student_id = p_student_id
        AND activity_date_ist BETWEEN p_from AND p_to
    ),
    'daily', COALESCE((
      SELECT jsonb_agg(row_to_json(d.*)::jsonb ORDER BY d.activity_date_ist DESC)
      FROM (
        SELECT
          activity_date_ist,
          login_count,
          quizzes_completed,
          questions_answered,
          questions_correct,
          foxy_sessions,
          chapters_completed,
          xp_earned,
          subjects_studied,
          total_events
        FROM analytics.student_daily_summary
        WHERE student_id = p_student_id
          AND activity_date_ist BETWEEN p_from AND p_to
        ORDER BY activity_date_ist DESC
      ) d
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_progress_report FROM anon;


-- previous body (get_activity_timeline), for rollback: identical
-- `IF NOT (p_student_id = get_my_student_id() OR is_teacher_of(...) OR
-- is_guardian_of(...) OR is_admin()) THEN RAISE EXCEPTION` guard, no
-- auth.uid() IS NULL check.
CREATE OR REPLACE FUNCTION public.get_activity_timeline(p_student_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_category text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- SECURITY FIX (2026-09-02, P0-1): see get_progress_report above — same
  -- NULL-collapse bug, same fix.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    p_student_id = get_my_student_id()
    OR is_teacher_of(p_student_id)
    OR is_guardian_of(p_student_id)
    OR is_admin()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'student_id', p_student_id,
    'total', (
      SELECT COUNT(*)
      FROM analytics.student_activity_timeline t
      WHERE t.student_id = p_student_id
        AND (p_category IS NULL OR t.activity_category = p_category)
        AND (p_from IS NULL OR t.occurred_at >= p_from)
        AND (p_to IS NULL OR t.occurred_at < p_to)
    ),
    'events', COALESCE((
      SELECT jsonb_agg(row_to_json(sub.*)::jsonb ORDER BY sub.occurred_at DESC)
      FROM (
        SELECT
          t.occurred_at,
          t.activity_type,
          t.activity_category,
          t.subject,
          t.grade,
          t.detail,
          t.source_table,
          t.source_id
        FROM analytics.student_activity_timeline t
        WHERE t.student_id = p_student_id
          AND (p_category IS NULL OR t.activity_category = p_category)
          AND (p_from IS NULL OR t.occurred_at >= p_from)
          AND (p_to IS NULL OR t.occurred_at < p_to)
        ORDER BY t.occurred_at DESC
        LIMIT p_limit OFFSET p_offset
      ) sub
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_activity_timeline FROM anon;


-- ============================================================================
-- SECTION C — generate_weekly_study_plan: real student-facing feature
-- (apps/host/src/app/(student)/exam-prep/page.tsx calls it via the
-- browser's anon-key RLS client), so authenticated EXECUTE stays granted.
-- Add the same ownership-check pattern already proven in
-- atomic_quiz_profile_update: skip the check only when auth.uid() IS NULL
-- (a genuine service-role caller, which bypasses RLS and carries no JWT
-- to check ownership against in the first place).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_weekly_study_plan(p_student_id uuid, p_subject text DEFAULT NULL::text, p_daily_minutes integer DEFAULT 60, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student RECORD;
  v_plan_id uuid;
  v_subject_id uuid;
  v_subject_name text;
  v_subject_code text;
  v_day integer;
  v_date date;
  v_task_order integer;
  v_remaining integer;
  v_topic RECORD;
  v_review RECORD;
  v_total_tasks integer := 0;
  v_plan_title text;
  v_reasoning text;
  v_topic_offset integer := 0;
  v_new_topics text[] := '{}';
  v_review_count integer;
BEGIN
  -- SECURITY FIX (2026-09-02, P0-1): this function had no ownership check —
  -- any authenticated caller could generate (and overwrite the active
  -- study_plans row for) an arbitrary p_student_id. Same skip-when-NULL
  -- pattern as atomic_quiz_profile_update: a genuine service-role caller
  -- carries no JWT (auth.uid() IS NULL) and bypasses RLS anyway, so this is
  -- an app-level ownership assertion, not a privilege boundary.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  SELECT * INTO v_student FROM students WHERE id = p_student_id;
  IF v_student IS NULL THEN
    RETURN jsonb_build_object('error', 'Student not found');
  END IF;
  v_subject_code := COALESCE(p_subject, v_student.preferred_subject, 'math');
  SELECT id, name INTO v_subject_id, v_subject_name FROM subjects WHERE code = v_subject_code AND is_active = true;
  IF v_subject_id IS NULL THEN
    SELECT id, name, code INTO v_subject_id, v_subject_name, v_subject_code FROM subjects WHERE is_active = true ORDER BY display_order LIMIT 1;
  END IF;
  UPDATE study_plans SET is_active = false, updated_at = now() WHERE student_id = p_student_id AND is_active = true;
  SELECT count(*) INTO v_review_count FROM spaced_repetition_cards WHERE student_id = p_student_id AND is_active = true AND next_review_date <= CURRENT_DATE + p_days;
  v_plan_title := v_subject_name || ' - Week of ' || to_char(CURRENT_DATE, 'Mon DD');
  v_reasoning := 'Evidence-backed plan';
  IF v_review_count > 0 THEN
    v_reasoning := v_reasoning || '. ' || v_review_count || ' review cards integrated.';
  END IF;
  INSERT INTO study_plans (student_id, subject, grade, plan_type, title, description, start_date, end_date, total_tasks, generated_by, ai_reasoning, is_active)
  VALUES (p_student_id, v_subject_code, v_student.grade, 'weekly', v_plan_title, 'Learn > Practice > Quiz > Review cycle for ' || p_days || ' days', CURRENT_DATE, CURRENT_DATE + (p_days - 1), 0, 'ai', v_reasoning, true)
  RETURNING id INTO v_plan_id;
  FOR v_day IN 1..p_days LOOP
    v_date := CURRENT_DATE + (v_day - 1);
    v_task_order := 0;
    v_remaining := p_daily_minutes;
    IF v_day > 1 THEN
      v_task_order := v_task_order + 1;
      INSERT INTO study_plan_tasks (plan_id, student_id, day_number, scheduled_date, task_order, task_type, subject, grade, title, description, duration_minutes, difficulty, xp_reward)
      VALUES (v_plan_id, p_student_id, v_day, v_date, v_task_order, 'revision', v_subject_code, v_student.grade, 'Quick Recall', 'Write 3 key points from yesterday.', 5, 2, 5);
      v_remaining := v_remaining - 5;
      v_total_tasks := v_total_tasks + 1;
    END IF;
    SELECT id, subject, topic INTO v_review FROM spaced_repetition_cards WHERE student_id = p_student_id AND is_active = true AND next_review_date <= v_date ORDER BY ease_factor ASC LIMIT 1;
    IF v_review.id IS NOT NULL AND v_remaining >= 8 THEN
      v_task_order := v_task_order + 1;
      INSERT INTO study_plan_tasks (plan_id, student_id, day_number, scheduled_date, task_order, task_type, subject, grade, title, description, duration_minutes, difficulty, xp_reward)
      VALUES (v_plan_id, p_student_id, v_day, v_date, v_task_order, 'review', v_subject_code, v_student.grade, 'Flashcard Review', 'Review spaced repetition cards.', 8, 2, 10);
      v_remaining := v_remaining - 8;
      v_total_tasks := v_total_tasks + 1;
    END IF;
    SELECT ct.id, ct.title, ct.chapter_number, ct.description, ct.difficulty_level INTO v_topic FROM curriculum_topics ct WHERE ct.subject_id = v_subject_id AND ct.grade = v_student.grade AND ct.is_active = true AND ct.parent_topic_id IS NULL ORDER BY ct.chapter_number ASC, ct.display_order ASC OFFSET v_topic_offset LIMIT 1;
    IF v_topic.id IS NOT NULL AND v_remaining >= 20 THEN
      v_new_topics := array_append(v_new_topics, v_topic.title);
      v_topic_offset := v_topic_offset + 1;
      v_task_order := v_task_order + 1;
      INSERT INTO study_plan_tasks (plan_id, student_id, day_number, scheduled_date, task_order, task_type, chapter_number, chapter_title, topic, subject, grade, title, description, duration_minutes, difficulty, xp_reward)
      VALUES (v_plan_id, p_student_id, v_day, v_date, v_task_order, 'learn', v_topic.chapter_number, v_topic.title, v_topic.title, v_subject_code, v_student.grade, 'Learn: Ch ' || v_topic.chapter_number || ' - ' || v_topic.title, COALESCE(v_topic.description, 'Study with AI tutor.'), LEAST(20, v_remaining), COALESCE(v_topic.difficulty_level, 2), 20);
      v_remaining := v_remaining - LEAST(20, v_remaining);
      v_total_tasks := v_total_tasks + 1;
    END IF;
    IF v_remaining >= 10 AND v_day > 1 THEN
      v_task_order := v_task_order + 1;
      INSERT INTO study_plan_tasks (plan_id, student_id, day_number, scheduled_date, task_order, task_type, subject, grade, title, description, duration_minutes, question_count, difficulty, xp_reward)
      VALUES (v_plan_id, p_student_id, v_day, v_date, v_task_order, 'practice', v_subject_code, v_student.grade, 'Mixed Practice', 'Problems from today + earlier chapters.', LEAST(12, v_remaining), 5, 3, 15);
      v_remaining := v_remaining - LEAST(12, v_remaining);
      v_total_tasks := v_total_tasks + 1;
    END IF;
    IF v_remaining >= 10 AND (v_day % 2 = 0 OR v_day = p_days) THEN
      v_task_order := v_task_order + 1;
      INSERT INTO study_plan_tasks (plan_id, student_id, day_number, scheduled_date, task_order, task_type, subject, grade, title, description, duration_minutes, question_count, difficulty, xp_reward)
      VALUES (v_plan_id, p_student_id, v_day, v_date, v_task_order, 'quiz', v_subject_code, v_student.grade, CASE WHEN v_day = p_days THEN 'Week-End Assessment' ELSE 'Check-In Quiz' END, 'Quiz check.', LEAST(10, v_remaining), CASE WHEN v_day = p_days THEN 10 ELSE 5 END, 3, CASE WHEN v_day = p_days THEN 30 ELSE 15 END);
      v_remaining := v_remaining - LEAST(10, v_remaining);
      v_total_tasks := v_total_tasks + 1;
    END IF;
    IF v_remaining >= 10 THEN
      v_task_order := v_task_order + 1;
      INSERT INTO study_plan_tasks (plan_id, student_id, day_number, scheduled_date, task_order, task_type, subject, grade, title, description, duration_minutes, difficulty, xp_reward)
      VALUES (v_plan_id, p_student_id, v_day, v_date, v_task_order, 'notes', v_subject_code, v_student.grade, 'NCERT Notes', 'Read textbook chapter.', v_remaining, 1, 5);
      v_total_tasks := v_total_tasks + 1;
    END IF;
  END LOOP;
  UPDATE study_plans SET total_tasks = v_total_tasks, ai_reasoning = v_reasoning || ' Topics covered: ' || array_to_string(v_new_topics, ', '), updated_at = now() WHERE id = v_plan_id;
  RETURN jsonb_build_object('success', true, 'plan_id', v_plan_id, 'total_tasks', v_total_tasks, 'days', p_days, 'daily_minutes', p_daily_minutes, 'topics_scheduled', COALESCE(array_length(v_new_topics, 1), 0), 'topics', v_new_topics, 'subject', v_subject_name);
END;
$function$;
