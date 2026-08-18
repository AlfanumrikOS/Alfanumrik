-- Migration: 20260816000003_reinstantiate_secdef_guards_corrected.sql
-- Purpose: Re-instantiate ownership guards on 7 SECURITY DEFINER RPCs that were
-- reverted by 20260815000003 (P0 rollback). Uses a corrected predicate that
-- handles students.auth_user_id = NULL (59% of active students per incident
-- report) without rejecting those students' own dashboard RPC calls.
--
-- Corrected guard pattern (student RPCs):
--   IF auth.uid() IS NOT NULL AND EXISTS (
--     SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id IS NOT NULL
--   ) THEN
--     IF NOT EXISTS (
--       SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
--     ) THEN
--       RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
--     END IF;
--   END IF;
--
-- This means:
--   - service_role / no-JWT callers (auth.uid() IS NULL): always allowed.
--   - authenticated callers with a student whose auth_user_id is non-NULL:
--     ownership is verified; mismatch raises 42501.
--   - authenticated callers with a student whose auth_user_id IS NULL:
--     allowed (can't verify ownership, but blocking breaks the dashboard —
--     this is the same posture as the pre-2026-08-15 era for these students).
--
-- The backfill migration (20260816000004_backfill_students_auth_user_id.sql)
-- links NULL-auth_user_id students to auth users where possible; after it runs
-- the guard covers more students. Until then, the 59% residual is accepted risk.
--
-- Service_role-only RPCs (no guard, no authenticated grant):
--   - generate_exam_paper: called only by /api/quiz via supabaseAdmin.
--   - generate_student_notifications: called only by daily-cron.
--   Both had grants restored to authenticated by 20260815000003 for consistency
--   with the pre-guard state; we restrict them back to service_role only here.
--
-- NOT touched (deferred):
--   - payment_history RLS policy (item 10 from 20260506000003). All production
--     inserts go through service_role. Replacing the broken
--     `student_id = (SELECT auth.uid())` predicate with get_my_student() would
--     CREATE a new authenticated insert path that didn't previously exist.
--     Needs explicit confirmation of no authenticated write path dependency.
--     Tracked separately.
--
-- INCIDENT REF: 2026-08-15/16 SECDEF-guard outage (P0, 59% students locked out).
-- Root cause: original guard (20260815000001) assumed auth_user_id is non-NULL
-- for all active students. Corrected guard + backfill closes the IDOR for the
-- 41% with non-NULL auth_user_id immediately, and for more as the backfill runs.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. get_student_notifications(uuid, integer) — READ, student-ID guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_student_notifications"("p_student_id" "uuid", "p_limit" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_unread integer; v_notifs jsonb; BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id IS NOT NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT count(*) INTO v_unread FROM notifications WHERE recipient_id = p_student_id AND NOT is_read;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', n.id, 'type', COALESCE(n.notification_type, n.type), 'title', n.title, 'body', COALESCE(n.body, n.message), 'data', n.data, 'is_read', n.is_read, 'created_at', n.created_at) ORDER BY n.created_at DESC), '[]'::jsonb) INTO v_notifs
  FROM (SELECT * FROM notifications WHERE recipient_id = p_student_id ORDER BY created_at DESC LIMIT p_limit) n;
  RETURN jsonb_build_object('unread_count', v_unread, 'notifications', v_notifs);
END; $$;

REVOKE ALL ON FUNCTION "public"."get_student_notifications"("uuid", integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_student_notifications"("uuid", integer) TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 2. get_student_snapshot(uuid) — READ, student-ID guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_student_snapshot"("p_student_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total_xp integer;
  v_streak integer;
  v_mastered integer;
  v_in_progress integer;
  v_quizzes integer;
  v_correct integer;
  v_asked integer;
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id IS NOT NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(SUM(xp), 0), COALESCE(MAX(streak_days), 0),
         COALESCE(SUM(total_questions_answered_correctly), 0),
         COALESCE(SUM(total_questions_asked), 0)
  INTO v_total_xp, v_streak, v_correct, v_asked
  FROM student_learning_profiles
  WHERE student_id = p_student_id;

  SELECT GREATEST(v_total_xp, COALESCE(s.xp_total, 0)),
         GREATEST(v_streak, COALESCE(s.streak_days, 0))
  INTO v_total_xp, v_streak
  FROM students s WHERE s.id = p_student_id;

  SELECT COUNT(*) FILTER (WHERE mastery_probability >= 0.95),
         COUNT(*) FILTER (WHERE mastery_probability > 0 AND mastery_probability < 0.95)
  INTO v_mastered, v_in_progress
  FROM concept_mastery WHERE student_id = p_student_id;

  IF v_mastered = 0 AND v_in_progress = 0 THEN
    SELECT COUNT(*) FILTER (WHERE mastery_percent >= 95),
           COUNT(*) FILTER (WHERE mastery_percent > 0 AND mastery_percent < 95)
    INTO v_mastered, v_in_progress
    FROM topic_mastery WHERE student_id = p_student_id;
  END IF;

  SELECT COUNT(*) INTO v_quizzes
  FROM quiz_sessions WHERE student_id = p_student_id AND is_completed = true;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp,
    'current_streak', v_streak,
    'topics_mastered', v_mastered,
    'topics_in_progress', v_in_progress,
    'quizzes_taken', v_quizzes,
    'avg_score', CASE WHEN v_asked > 0 THEN ROUND((v_correct::numeric / v_asked) * 100) ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_student_snapshot"("uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_student_snapshot"("uuid") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 3. get_review_cards(uuid, integer) — READ, student-ID guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_review_cards"("p_student_id" "uuid", "p_limit" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id IS NOT NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sr.id, 'subject', sr.subject, 'topic', sr.topic, 'chapter_title', sr.chapter_title, 'chapter_number', sr.chapter_number, 'card_type', sr.card_type, 'front_text', sr.front_text, 'back_text', sr.back_text, 'hint', sr.hint, 'ease_factor', sr.ease_factor, 'interval_days', sr.interval_days, 'streak', sr.streak) ORDER BY sr.next_review_date, sr.ease_factor)
  FROM spaced_repetition_cards sr
  WHERE sr.student_id = p_student_id AND sr.is_active = true AND sr.next_review_date <= CURRENT_DATE LIMIT p_limit), '[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION "public"."get_review_cards"("uuid", integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_review_cards"("uuid", integer) TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 4. student_join_class(uuid, text) — WRITE (INSERT), student-ID guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."student_join_class"("p_student_id" "uuid", "p_class_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_class RECORD; BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id IS NOT NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT id, name, grade INTO v_class FROM classes WHERE class_code = upper(trim(p_class_code)) AND is_active = true;
  IF v_class.id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid class code.'); END IF;
  IF EXISTS (SELECT 1 FROM class_students WHERE class_id = v_class.id AND student_id = p_student_id) THEN
    RETURN jsonb_build_object('error', 'You are already in this class');
  END IF;
  INSERT INTO class_students (class_id, student_id, joined_at) VALUES (v_class.id, p_student_id, now());
  RETURN jsonb_build_object('success', true, 'class_name', v_class.name, 'class_grade', v_class.grade, 'message', 'Joined class: ' || v_class.name);
END; $$;

REVOKE ALL ON FUNCTION "public"."student_join_class"("uuid", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."student_join_class"("uuid", "text") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 5. join_competition(uuid, uuid) — WRITE (INSERT), student-ID guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."join_competition"("p_student_id" "uuid", "p_competition_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_comp RECORD; BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id IS NOT NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_comp FROM competitions WHERE id = p_competition_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('error', 'Competition not found'); END IF;
  IF v_comp.status NOT IN ('upcoming', 'live') THEN RETURN jsonb_build_object('error', 'Competition is not open'); END IF;
  IF v_comp.max_participants IS NOT NULL THEN
    IF (SELECT count(*) FROM competition_participants WHERE competition_id = p_competition_id) >= v_comp.max_participants THEN
      RETURN jsonb_build_object('error', 'Competition is full');
    END IF;
  END IF;
  INSERT INTO competition_participants (competition_id, student_id) VALUES (p_competition_id, p_student_id)
  ON CONFLICT (competition_id, student_id) DO NOTHING;
  RETURN jsonb_build_object('success', true, 'competition', v_comp.title);
END; $$;

REVOKE ALL ON FUNCTION "public"."join_competition"("uuid", "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."join_competition"("uuid", "uuid") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 6. get_guardian_dashboard(uuid) — READ, guardian-ID guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_guardian_dashboard"("p_guardian_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_children jsonb; BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM guardians WHERE id = p_guardian_id AND auth_user_id IS NOT NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM guardians WHERE id = p_guardian_id AND auth_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.name, 'grade', s.grade, 'board', s.board, 'school', s.school_name, 'xp_total', s.xp_total, 'streak_days', s.streak_days, 'last_active', s.last_active, 'preferred_subject', s.preferred_subject, 'invite_code', s.invite_code, 'link_status', gsl.status, 'linked_at', gsl.linked_at) ORDER BY s.name), '[]'::jsonb) INTO v_children
  FROM guardian_student_links gsl JOIN students s ON s.id = gsl.student_id
  WHERE gsl.guardian_id = p_guardian_id AND gsl.status = 'active';
  RETURN jsonb_build_object('children', v_children, 'child_count', jsonb_array_length(v_children));
END; $$;

REVOKE ALL ON FUNCTION "public"."get_guardian_dashboard"("uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_guardian_dashboard"("uuid") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 7. link_guardian_to_student_via_code(uuid, text) — WRITE (INSERT), guardian-ID guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."link_guardian_to_student_via_code"("p_guardian_id" "uuid", "p_invite_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_student RECORD;
  v_code text := upper(trim(p_invite_code));
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM guardians WHERE id = p_guardian_id AND auth_user_id IS NOT NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM guardians WHERE id = p_guardian_id AND auth_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, name, grade INTO v_student
  FROM students
  WHERE (invite_code = v_code OR link_code = v_code)
    AND is_active = true;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid invite code. Check with your child.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM guardian_student_links
    WHERE guardian_id = p_guardian_id
      AND student_id = v_student.id
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('error', 'Already linked to ' || v_student.name);
  END IF;

  INSERT INTO guardian_student_links (guardian_id, student_id, status, is_verified, linked_at, initiated_by, permission_level)
  VALUES (p_guardian_id, v_student.id, 'active', true, now(), p_guardian_id, 'view');

  RETURN jsonb_build_object(
    'success', true,
    'student_name', v_student.name,
    'student_grade', v_student.grade,
    'message', 'Successfully linked to ' || v_student.name || ' (Grade ' || v_student.grade || ')'
  );
END;
$$;

COMMENT ON FUNCTION "public"."link_guardian_to_student_via_code"("uuid", "text")
  IS 'Parent-portal OTP-redeem link RPC. Matches students.invite_code OR students.link_code. Guarded 2026-08-16 with corrected predicate (handles NULL auth_user_id). Ownership guard re-instantiated — see 20260816000003.';

REVOKE ALL ON FUNCTION "public"."link_guardian_to_student_via_code"("uuid", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."link_guardian_to_student_via_code"("uuid", "text") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 8. generate_exam_paper(uuid, text, text, integer[], uuid) — service_role ONLY
--    Called exclusively by /api/quiz via supabaseAdmin (service_role).
--    No authenticated-end-user call path exists. Restrict grants accordingly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."generate_exam_paper"("p_student_id" "uuid", "p_subject" "text", "p_grade" "text", "p_chapters" integer[] DEFAULT NULL::integer[], "p_template_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_template RECORD; v_sections JSONB; v_section JSONB; v_section_result JSONB; v_all_sections JSONB := '[]'::jsonb; v_questions JSONB; v_i INTEGER; v_section_type TEXT; v_section_count INTEGER; v_section_name TEXT; v_section_name_hi TEXT;
BEGIN
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_template FROM exam_paper_templates WHERE id = p_template_id AND is_active = true;
  ELSE
    SELECT * INTO v_template FROM exam_paper_templates WHERE grade = p_grade AND is_active = true ORDER BY created_at LIMIT 1;
  END IF;
  IF v_template IS NULL THEN RETURN jsonb_build_object('error', 'No exam template found for grade ' || p_grade); END IF;
  v_sections := v_template.sections;
  FOR v_i IN 0 .. jsonb_array_length(v_sections) - 1 LOOP
    v_section := v_sections -> v_i;
    v_section_type := v_section ->> 'question_type';
    v_section_count := (v_section ->> 'total_questions')::INTEGER;
    v_section_name := v_section ->> 'name';
    v_section_name_hi := v_section ->> 'name_hi';
    WITH seen_ids AS (
      SELECT h.question_id, h.last_shown_at
      FROM user_question_history h
      WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
    ),
    section_questions AS (
      SELECT qb.id, qb.question_text, qb.question_hi, qb.question_type, qb.question_type_v2, qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint, qb.difficulty, qb.bloom_level, qb.chapter_number, qb.concept_tag, qb.case_passage, qb.case_passage_hi, qb.expected_answer, qb.expected_answer_hi, qb.max_marks, qb.is_ncert, qb.ncert_exercise,
        CASE WHEN si.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank
      FROM question_bank qb
      LEFT JOIN seen_ids si ON si.question_id = qb.id
      WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
        AND qb.question_type_v2 = v_section_type
        AND (p_chapters IS NULL OR qb.chapter_number = ANY(p_chapters))
      ORDER BY seen_rank, random() LIMIT v_section_count
    )
    SELECT jsonb_agg(jsonb_build_object(
      'id', sq.id, 'question_text', sq.question_text, 'question_hi', sq.question_hi,
      'question_type_v2', COALESCE(sq.question_type_v2, 'mcq'), 'options', sq.options,
      'correct_answer_index', sq.correct_answer_index, 'explanation', sq.explanation,
      'difficulty', sq.difficulty, 'bloom_level', sq.bloom_level, 'chapter_number', sq.chapter_number,
      'max_marks', COALESCE(sq.max_marks, (v_section ->> 'marks_per_question')::INTEGER),
      'is_ncert', COALESCE(sq.is_ncert, false)
    )) INTO v_questions FROM section_questions sq;
    INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number, first_shown_at, last_shown_at, times_shown)
    SELECT p_student_id, (q->>'id')::UUID, p_subject, p_grade, (q->>'chapter_number')::INTEGER, now(), now(), 1
    FROM jsonb_array_elements(COALESCE(v_questions, '[]'::jsonb)) AS q
    ON CONFLICT (student_id, question_id) DO UPDATE SET last_shown_at = now(), times_shown = user_question_history.times_shown + 1;
    v_section_result := jsonb_build_object(
      'name', v_section_name, 'name_hi', v_section_name_hi, 'question_type', v_section_type,
      'marks_per_question', (v_section ->> 'marks_per_question')::INTEGER,
      'total_questions', v_section_count, 'attempt_questions', (v_section ->> 'attempt_questions')::INTEGER,
      'questions', COALESCE(v_questions, '[]'::jsonb)
    );
    v_all_sections := v_all_sections || jsonb_build_array(v_section_result);
  END LOOP;
  RETURN jsonb_build_object(
    'template_name', v_template.name, 'template_name_hi', v_template.name_hi,
    'total_marks', v_template.total_marks, 'duration_minutes', v_template.duration_minutes,
    'board', v_template.board, 'sections', v_all_sections
  );
END; $$;

REVOKE ALL ON FUNCTION "public"."generate_exam_paper"("uuid", "text", "text", integer[], "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."generate_exam_paper"("uuid", "text", "text", integer[], "uuid") TO "service_role";

-- ---------------------------------------------------------------------------
-- 9. generate_student_notifications(uuid) — service_role ONLY
--    Called exclusively by daily-cron. No body change (no per-caller ownership
--    predicate applies). Restrict grants to service_role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION "public"."generate_student_notifications"("uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."generate_student_notifications"("uuid") TO "service_role";

COMMIT;
