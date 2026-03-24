-- ============================================================
-- Migration 007: Dashboard & Core RPCs
-- Project: Alfanumrik
-- Description: Creates all RPC functions needed by the frontend
--              for dashboard, quiz, leaderboard, study plan,
--              review, notifications, teacher, and guardian flows.
-- ============================================================

-- ============================================================
-- 1. get_user_role — Returns all roles for an auth user
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role(p_auth_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  v_roles TEXT[] := '{}';
  v_primary TEXT := 'none';
  v_student JSONB := 'null';
  v_teacher JSONB := 'null';
  v_guardian JSONB := 'null';
  rec RECORD;
BEGIN
  -- Check student
  SELECT id, name, grade INTO rec
    FROM students WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_roles := array_append(v_roles, 'student');
    v_primary := 'student';
    v_student := jsonb_build_object('id', rec.id, 'name', rec.name, 'grade', rec.grade);
  END IF;

  -- Check teacher
  SELECT id, name INTO rec
    FROM teachers WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF FOUND THEN
    v_roles := array_append(v_roles, 'teacher');
    v_primary := 'teacher';
    v_teacher := jsonb_build_object('id', rec.id, 'name', rec.name);
  END IF;

  -- Check guardian
  SELECT id, name INTO rec
    FROM guardians WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF FOUND THEN
    v_roles := array_append(v_roles, 'guardian');
    IF v_primary = 'none' THEN v_primary := 'guardian'; END IF;
    v_guardian := jsonb_build_object('id', rec.id, 'name', rec.name);
  END IF;

  RETURN jsonb_build_object(
    'roles', to_jsonb(v_roles),
    'primary_role', v_primary,
    'student', v_student,
    'teacher', v_teacher,
    'guardian', v_guardian
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 2. get_student_snapshot — Dashboard stats for a student
-- ============================================================
CREATE OR REPLACE FUNCTION get_student_snapshot(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_xp BIGINT := 0;
  v_streak INT := 0;
  v_mastered INT := 0;
  v_in_progress INT := 0;
  v_quizzes INT := 0;
  v_correct BIGINT := 0;
  v_asked BIGINT := 0;
  v_avg_score INT := 0;
BEGIN
  SELECT COALESCE(SUM(xp), 0),
         COALESCE(MAX(streak_days), 0),
         COALESCE(SUM(total_questions_answered_correctly), 0),
         COALESCE(SUM(total_questions_asked), 0)
    INTO v_total_xp, v_streak, v_correct, v_asked
    FROM student_learning_profiles
   WHERE student_id = p_student_id;

  SELECT COUNT(*) INTO v_mastered
    FROM concept_mastery
   WHERE student_id = p_student_id AND mastery_level >= 0.95;

  SELECT COUNT(*) INTO v_in_progress
    FROM concept_mastery
   WHERE student_id = p_student_id AND mastery_level < 0.95 AND mastery_level > 0;

  SELECT COUNT(*) INTO v_quizzes
    FROM quiz_sessions
   WHERE student_id = p_student_id;

  IF v_asked > 0 THEN
    v_avg_score := ROUND((v_correct::NUMERIC / v_asked) * 100);
  END IF;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp,
    'current_streak', v_streak,
    'topics_mastered', v_mastered,
    'topics_in_progress', v_in_progress,
    'quizzes_taken', v_quizzes,
    'avg_score', v_avg_score
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 3. get_dashboard_data — Full dashboard payload
-- ============================================================
CREATE OR REPLACE FUNCTION get_dashboard_data(p_student_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN get_student_snapshot(p_student_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 4. get_quiz_questions — Fetch quiz questions
-- ============================================================
CREATE OR REPLACE FUNCTION get_quiz_questions(
  p_subject TEXT,
  p_grade TEXT,
  p_count INT DEFAULT 10,
  p_difficulty INT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_subject_id UUID;
  v_questions JSONB;
BEGIN
  SELECT id INTO v_subject_id FROM subjects WHERE code = p_subject LIMIT 1;

  IF v_subject_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Pull questions from question_bank if it exists, else from curriculum_topics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_text_hi, options, correct_option,
             explanation, explanation_hi, difficulty, bloom_level, topic_id
        FROM question_bank
       WHERE subject = p_subject
         AND grade = p_grade
         AND is_active = true
         AND (p_difficulty IS NULL OR difficulty = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) q;
  ELSE
    -- Fallback: generate placeholder from curriculum_topics
    SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, title AS question_text, title_hi AS question_text_hi,
             '["Option A","Option B","Option C","Option D"]'::JSONB AS options,
             0 AS correct_option,
             description AS explanation,
             NULL AS explanation_hi,
             difficulty_level AS difficulty,
             'remember' AS bloom_level,
             id AS topic_id
        FROM curriculum_topics
       WHERE subject_id = v_subject_id
         AND grade = p_grade
         AND is_active = true
         AND (p_difficulty IS NULL OR difficulty_level = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) t;
  END IF;

  RETURN v_questions;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 5. submit_quiz_results — Record quiz completion + XP
-- ============================================================
CREATE OR REPLACE FUNCTION submit_quiz_results(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT,
  p_chapter INT,
  p_responses JSONB,
  p_time INT
)
RETURNS JSONB AS $$
DECLARE
  v_total INT;
  v_correct INT := 0;
  v_score NUMERIC;
  v_xp INT;
  v_session_id UUID;
  r JSONB;
BEGIN
  v_total := jsonb_array_length(p_responses);

  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    IF (r->>'is_correct')::BOOLEAN THEN
      v_correct := v_correct + 1;
    END IF;
  END LOOP;

  v_score := CASE WHEN v_total > 0 THEN ROUND((v_correct::NUMERIC / v_total) * 100) ELSE 0 END;
  v_xp := v_correct * 10 + CASE WHEN v_score >= 80 THEN 20 ELSE 0 END;

  INSERT INTO quiz_sessions (student_id, subject, topic_id, total_questions, correct_answers, score_percent, xp_earned, time_spent_seconds, completed_at)
  VALUES (p_student_id, p_subject, NULL, v_total, v_correct, v_score, v_xp, p_time, now())
  RETURNING id INTO v_session_id;

  -- Update XP in learning profile
  INSERT INTO student_learning_profiles (student_id, subject, xp, level, total_sessions, total_questions_asked, total_questions_answered_correctly, streak_days, longest_streak)
  VALUES (p_student_id, p_subject, v_xp, 1, 1, v_total, v_correct, 1, 1)
  ON CONFLICT (student_id, subject)
  DO UPDATE SET
    xp = student_learning_profiles.xp + v_xp,
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_xp) / 500) + 1),
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + v_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + v_correct,
    last_session_at = now(),
    updated_at = now();

  -- Update concept mastery
  IF p_topic IS NOT NULL THEN
    INSERT INTO concept_mastery (student_id, topic_tag, chapter_number, mastery_level, last_attempted)
    VALUES (p_student_id, p_topic, p_chapter, v_score / 100.0, now())
    ON CONFLICT (student_id, topic_tag)
    DO UPDATE SET
      mastery_level = LEAST(1.0, concept_mastery.mastery_level * 0.7 + (v_score / 100.0) * 0.3),
      last_attempted = now(),
      next_review_at = now() + INTERVAL '1 day' * GREATEST(1, FLOOR(concept_mastery.mastery_level * 7)),
      updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'score', v_score,
    'correct', v_correct,
    'total', v_total,
    'xp_earned', v_xp
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. get_leaderboard — Weekly/monthly/all-time leaderboard
-- ============================================================
CREATE OR REPLACE FUNCTION get_leaderboard(
  p_period TEXT DEFAULT 'weekly',
  p_limit INT DEFAULT 20
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(r ORDER BY r.rank), '[]'::JSONB) INTO v_result
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY COALESCE(s.xp_total, slp.total_xp) DESC) AS rank,
      s.id AS student_id,
      s.name AS student_name,
      COALESCE(s.xp_total, slp.total_xp, 0) AS total_xp,
      COALESCE(s.streak_days, slp.max_streak, 0) AS streak,
      CASE WHEN slp.total_asked > 0
        THEN ROUND((slp.total_correct::NUMERIC / slp.total_asked) * 100)
        ELSE 0
      END AS accuracy,
      s.avatar_url,
      s.grade,
      s.school_name AS school,
      s.city
    FROM students s
    LEFT JOIN (
      SELECT student_id,
             SUM(xp) AS total_xp,
             MAX(streak_days) AS max_streak,
             SUM(total_questions_asked) AS total_asked,
             SUM(total_questions_answered_correctly) AS total_correct
        FROM student_learning_profiles
       GROUP BY student_id
    ) slp ON slp.student_id = s.id
    WHERE s.is_active = true
    ORDER BY COALESCE(s.xp_total, slp.total_xp, 0) DESC
    LIMIT p_limit
  ) r;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 7. get_study_plan — Return study plan for student
-- ============================================================
CREATE OR REPLACE FUNCTION get_study_plan(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_student RECORD;
BEGIN
  SELECT preferred_subject, grade INTO v_student FROM students WHERE id = p_student_id;

  SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_result
  FROM (
    SELECT ct.id, ct.title, ct.title_hi, ct.grade, ct.chapter_number,
           ct.difficulty_level, ct.estimated_minutes, ct.bloom_focus,
           COALESCE(cm.mastery_level, 0) AS mastery_level,
           CASE WHEN cm.mastery_level >= 0.95 THEN 'mastered'
                WHEN cm.mastery_level > 0 THEN 'in_progress'
                ELSE 'not_started'
           END AS status
      FROM curriculum_topics ct
      LEFT JOIN concept_mastery cm ON cm.topic_tag = ct.title AND cm.student_id = p_student_id
      LEFT JOIN subjects s ON s.id = ct.subject_id
     WHERE ct.grade = v_student.grade
       AND ct.is_active = true
       AND (v_student.preferred_subject IS NULL OR s.code = v_student.preferred_subject)
     ORDER BY ct.display_order, ct.chapter_number
     LIMIT 20
  ) t;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 8. get_review_cards — Spaced repetition review cards
-- ============================================================
CREATE OR REPLACE FUNCTION get_review_cards(p_student_id UUID, p_limit INT DEFAULT 10)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(r), '[]'::JSONB) INTO v_result
  FROM (
    SELECT cm.id, cm.topic_tag, cm.chapter_number, cm.mastery_level,
           cm.last_attempted, cm.next_review_at
      FROM concept_mastery cm
     WHERE cm.student_id = p_student_id
       AND cm.next_review_at <= now()
     ORDER BY cm.mastery_level ASC, cm.next_review_at ASC
     LIMIT p_limit
  ) r;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 9. get_teacher_dashboard — Teacher overview
-- ============================================================
CREATE OR REPLACE FUNCTION get_teacher_dashboard(p_teacher_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_classes JSONB;
  v_total_students INT := 0;
BEGIN
  SELECT COALESCE(jsonb_agg(c), '[]'::JSONB), COALESCE(SUM((c->>'student_count')::INT), 0)
    INTO v_classes, v_total_students
  FROM (
    SELECT jsonb_build_object(
      'id', cl.id,
      'name', cl.name,
      'grade', cl.grade,
      'section', cl.section,
      'class_code', cl.class_code,
      'student_count', (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = cl.id)
    ) AS c
    FROM classes cl
    JOIN class_teachers ct ON ct.class_id = cl.id
    WHERE ct.teacher_id = p_teacher_id
    ORDER BY cl.created_at DESC
  ) sub;

  RETURN jsonb_build_object(
    'classes', v_classes,
    'total_students', v_total_students
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 10. teacher_create_class
-- ============================================================
CREATE OR REPLACE FUNCTION teacher_create_class(
  p_teacher_id UUID,
  p_name TEXT,
  p_grade TEXT,
  p_section TEXT DEFAULT NULL,
  p_subject TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_class_id UUID;
  v_code TEXT;
BEGIN
  v_code := UPPER(SUBSTR(md5(random()::TEXT), 1, 6));

  INSERT INTO classes (name, grade, section, subject, class_code, created_by)
  VALUES (p_name, p_grade, p_section, p_subject, v_code, p_teacher_id)
  RETURNING id INTO v_class_id;

  INSERT INTO class_teachers (class_id, teacher_id) VALUES (v_class_id, p_teacher_id);

  RETURN jsonb_build_object('class_id', v_class_id, 'class_code', v_code);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. student_join_class
-- ============================================================
CREATE OR REPLACE FUNCTION student_join_class(p_student_id UUID, p_class_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_class_id UUID;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE class_code = UPPER(TRIM(p_class_code));

  IF v_class_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid class code');
  END IF;

  INSERT INTO class_students (class_id, student_id)
  VALUES (v_class_id, p_student_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true, 'class_id', v_class_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. get_class_detail
-- ============================================================
CREATE OR REPLACE FUNCTION get_class_detail(p_class_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_class JSONB;
  v_students JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', cl.id, 'name', cl.name, 'grade', cl.grade,
    'section', cl.section, 'class_code', cl.class_code
  ) INTO v_class FROM classes cl WHERE cl.id = p_class_id;

  SELECT COALESCE(jsonb_agg(s), '[]'::JSONB) INTO v_students
  FROM (
    SELECT st.id, st.name, st.grade, COALESCE(st.xp_total, 0) AS xp_total
      FROM students st
      JOIN class_students cs ON cs.student_id = st.id
     WHERE cs.class_id = p_class_id
     ORDER BY st.name
  ) s;

  RETURN jsonb_build_object('class', v_class, 'students', v_students);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 13. teacher_create_assignment
-- ============================================================
CREATE OR REPLACE FUNCTION teacher_create_assignment(
  p_teacher_id UUID,
  p_class_id UUID,
  p_title TEXT,
  p_type TEXT DEFAULT 'practice',
  p_topic_id UUID DEFAULT NULL,
  p_subject TEXT DEFAULT NULL,
  p_due_date TIMESTAMPTZ DEFAULT NULL,
  p_question_count INT DEFAULT 10
)
RETURNS JSONB AS $$
DECLARE
  v_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assignments') THEN
    INSERT INTO assignments (class_id, teacher_id, title, assignment_type, topic_id, subject, due_date, question_count, created_at)
    VALUES (p_class_id, p_teacher_id, p_title, p_type, p_topic_id, p_subject, p_due_date, p_question_count, now())
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('assignment_id', v_id);
  ELSE
    RETURN jsonb_build_object('error', 'Assignments table not yet created');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 14. get_assignment_report
-- ============================================================
CREATE OR REPLACE FUNCTION get_assignment_report(p_assignment_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assignments') THEN
    RETURN (
      SELECT jsonb_build_object(
        'assignment', jsonb_build_object('id', a.id, 'title', a.title, 'due_date', a.due_date),
        'submissions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'student_id', sub.student_id,
            'score', sub.score_percent,
            'completed_at', sub.completed_at
          ))
          FROM assignment_submissions sub
          WHERE sub.assignment_id = a.id
        ), '[]'::JSONB)
      ) FROM assignments a WHERE a.id = p_assignment_id
    );
  END IF;
  RETURN '{}'::JSONB;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 15. get_guardian_dashboard
-- ============================================================
CREATE OR REPLACE FUNCTION get_guardian_dashboard(p_guardian_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_children JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(c), '[]'::JSONB) INTO v_children
  FROM (
    SELECT s.id, s.name, s.grade,
           COALESCE(s.xp_total, 0) AS xp_total,
           COALESCE(s.streak_days, 0) AS streak_days,
           s.last_active
      FROM students s
      JOIN guardian_student_links gsl ON gsl.student_id = s.id
     WHERE gsl.guardian_id = p_guardian_id
       AND gsl.status = 'active'
     ORDER BY s.name
  ) c;

  RETURN jsonb_build_object('children', v_children);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 16. Notification RPCs
-- ============================================================

-- get_unread_notifications
CREATE OR REPLACE FUNCTION get_unread_notifications(p_recipient_type TEXT, p_recipient_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(n ORDER BY n.created_at DESC), '[]'::JSONB)
    FROM notifications n
    WHERE n.recipient_type = p_recipient_type
      AND n.recipient_id = p_recipient_id
      AND n.read_at IS NULL
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- mark_notification_read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    UPDATE notifications SET read_at = now() WHERE id = p_notification_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_student_notifications
CREATE OR REPLACE FUNCTION get_student_notifications(p_student_id UUID, p_limit INT DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
  v_notifications JSONB := '[]'::JSONB;
  v_unread INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    SELECT COALESCE(jsonb_agg(n), '[]'::JSONB) INTO v_notifications
    FROM (
      SELECT id, title, body, icon, notification_type, read_at, created_at
        FROM notifications
       WHERE recipient_id = p_student_id
         AND recipient_type = 'student'
       ORDER BY created_at DESC
       LIMIT p_limit
    ) n;

    SELECT COUNT(*) INTO v_unread
      FROM notifications
     WHERE recipient_id = p_student_id
       AND recipient_type = 'student'
       AND read_at IS NULL;
  END IF;

  RETURN jsonb_build_object('notifications', v_notifications, 'unread_count', v_unread);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- generate_student_notifications (contextual notifications)
CREATE OR REPLACE FUNCTION generate_student_notifications(p_student_id UUID)
RETURNS VOID AS $$
DECLARE
  v_streak INT;
  v_due_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    RETURN;
  END IF;

  -- Streak milestone notifications
  SELECT COALESCE(MAX(streak_days), 0) INTO v_streak
    FROM student_learning_profiles WHERE student_id = p_student_id;

  IF v_streak > 0 AND v_streak % 7 = 0 THEN
    INSERT INTO notifications (recipient_id, recipient_type, title, body, icon, notification_type)
    SELECT p_student_id, 'student',
           v_streak || ' day streak!',
           'Amazing consistency! Keep it going!',
           '🔥', 'streak_milestone'
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications
       WHERE recipient_id = p_student_id
         AND notification_type = 'streak_milestone'
         AND created_at > now() - INTERVAL '1 day'
    );
  END IF;

  -- Review due notifications
  SELECT COUNT(*) INTO v_due_count
    FROM concept_mastery
   WHERE student_id = p_student_id
     AND next_review_at <= now();

  IF v_due_count > 0 THEN
    INSERT INTO notifications (recipient_id, recipient_type, title, body, icon, notification_type)
    SELECT p_student_id, 'student',
           v_due_count || ' topics due for review',
           'Strengthen your memory with a quick review session!',
           '🔄', 'review_due'
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications
       WHERE recipient_id = p_student_id
         AND notification_type = 'review_due'
         AND created_at > now() - INTERVAL '6 hours'
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- mark_all_notifications_read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_student_id UUID)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    UPDATE notifications SET read_at = now()
     WHERE recipient_id = p_student_id
       AND recipient_type = 'student'
       AND read_at IS NULL;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 17. Curriculum & Mastery RPCs
-- ============================================================

-- get_curriculum_browser
CREATE OR REPLACE FUNCTION get_curriculum_browser(p_grade TEXT, p_subject TEXT DEFAULT NULL)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(t), '[]'::JSONB)
    FROM (
      SELECT ct.id, ct.title, ct.title_hi, ct.grade, ct.chapter_number,
             ct.difficulty_level, ct.estimated_minutes, ct.bloom_focus,
             ct.learning_objectives, ct.topic_type,
             s.code AS subject_code, s.name AS subject_name, s.icon AS subject_icon
        FROM curriculum_topics ct
        JOIN subjects s ON s.id = ct.subject_id
       WHERE ct.grade = p_grade
         AND ct.is_active = true
         AND (p_subject IS NULL OR s.code = p_subject)
       ORDER BY s.display_order, ct.display_order
    ) t
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- get_mastery_overview
CREATE OR REPLACE FUNCTION get_mastery_overview(p_student_id UUID, p_subject TEXT DEFAULT NULL)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(m), '[]'::JSONB)
    FROM (
      SELECT cm.id, cm.topic_tag, cm.chapter_number, cm.mastery_level,
             cm.last_attempted, cm.next_review_at
        FROM concept_mastery cm
       WHERE cm.student_id = p_student_id
       ORDER BY cm.chapter_number, cm.topic_tag
    ) m
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- record_learning_event
CREATE OR REPLACE FUNCTION record_learning_event(
  p_student_id UUID,
  p_topic_id UUID,
  p_is_correct BOOLEAN,
  p_interaction_type TEXT DEFAULT 'practice',
  p_bloom_level TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_topic RECORD;
  v_new_mastery NUMERIC;
BEGIN
  SELECT title, chapter_number INTO v_topic FROM curriculum_topics WHERE id = p_topic_id;

  IF v_topic IS NULL THEN
    RETURN jsonb_build_object('error', 'Topic not found');
  END IF;

  -- Upsert concept mastery
  INSERT INTO concept_mastery (student_id, topic_id, topic_tag, chapter_number, mastery_level, last_attempted)
  VALUES (p_student_id, p_topic_id, v_topic.title, COALESCE(v_topic.chapter_number, 0),
          CASE WHEN p_is_correct THEN 0.3 ELSE 0.1 END, now())
  ON CONFLICT (student_id, topic_tag)
  DO UPDATE SET
    mastery_level = LEAST(1.0,
      concept_mastery.mastery_level + CASE WHEN p_is_correct THEN 0.1 ELSE -0.05 END
    ),
    last_attempted = now(),
    next_review_at = now() + INTERVAL '1 day' * GREATEST(1, FLOOR(concept_mastery.mastery_level * 7)),
    updated_at = now()
  RETURNING mastery_level INTO v_new_mastery;

  -- Update bloom progression if level provided
  IF p_bloom_level IS NOT NULL THEN
    INSERT INTO bloom_progression (student_id, topic_id, bloom_level, correct_at_level, total_at_level)
    VALUES (p_student_id, p_topic_id, p_bloom_level,
            CASE WHEN p_is_correct THEN 1 ELSE 0 END, 1)
    ON CONFLICT (student_id, topic_id, bloom_level)
    DO UPDATE SET
      correct_at_level = bloom_progression.correct_at_level + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
      total_at_level = bloom_progression.total_at_level + 1,
      mastered_at = CASE
        WHEN bloom_progression.correct_at_level + CASE WHEN p_is_correct THEN 1 ELSE 0 END >= 3
        THEN COALESCE(bloom_progression.mastered_at, now())
        ELSE bloom_progression.mastered_at
      END,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object('mastery_level', v_new_mastery, 'topic', v_topic.title);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 18. generate_weekly_study_plan
-- ============================================================
CREATE OR REPLACE FUNCTION generate_weekly_study_plan(
  p_student_id UUID,
  p_subject TEXT DEFAULT NULL,
  p_daily_minutes INT DEFAULT 60,
  p_days INT DEFAULT 7
)
RETURNS JSONB AS $$
DECLARE
  v_student RECORD;
  v_plan JSONB;
BEGIN
  SELECT grade, preferred_subject INTO v_student FROM students WHERE id = p_student_id;

  SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_plan
  FROM (
    SELECT ct.id, ct.title, ct.title_hi, ct.difficulty_level,
           ct.estimated_minutes, ct.bloom_focus,
           COALESCE(cm.mastery_level, 0) AS current_mastery,
           ROW_NUMBER() OVER () AS day_number
      FROM curriculum_topics ct
      LEFT JOIN concept_mastery cm ON cm.topic_tag = ct.title AND cm.student_id = p_student_id
      LEFT JOIN subjects s ON s.id = ct.subject_id
     WHERE ct.grade = v_student.grade
       AND ct.is_active = true
       AND (COALESCE(p_subject, v_student.preferred_subject) IS NULL
            OR s.code = COALESCE(p_subject, v_student.preferred_subject))
       AND COALESCE(cm.mastery_level, 0) < 0.95
     ORDER BY COALESCE(cm.mastery_level, 0) ASC, ct.display_order
     LIMIT p_days
  ) t;

  RETURN v_plan;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 19. Competition RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION get_competitions(p_student_id UUID, p_status TEXT DEFAULT NULL)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'competitions') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(c), '[]'::JSONB)
    FROM (
      SELECT co.id, co.title, co.title_hi, co.description, co.description_hi,
             co.competition_type, co.status, co.start_date, co.end_date,
             co.is_featured, co.accent_color, co.banner_emoji,
             co.bonus_xp_1, co.bonus_xp_2, co.bonus_xp_3,
             (SELECT COUNT(*) FROM competition_participants cp WHERE cp.competition_id = co.id) AS participant_count,
             EXISTS(SELECT 1 FROM competition_participants cp WHERE cp.competition_id = co.id AND cp.student_id = p_student_id) AS is_joined
        FROM competitions co
       WHERE (p_status IS NULL OR co.status = p_status)
       ORDER BY co.is_featured DESC, co.start_date DESC
    ) c
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION join_competition(p_student_id UUID, p_competition_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'competitions') THEN
    RETURN jsonb_build_object('error', 'Competitions not available');
  END IF;

  INSERT INTO competition_participants (competition_id, student_id)
  VALUES (p_competition_id, p_student_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_competition_leaderboard(p_competition_id UUID, p_limit INT DEFAULT 50)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'competitions') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(r), '[]'::JSONB)
    FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY cp.score DESC) AS rank,
             cp.student_id, s.name AS student_name, cp.score AS total_xp
        FROM competition_participants cp
        JOIN students s ON s.id = cp.student_id
       WHERE cp.competition_id = p_competition_id
       ORDER BY cp.score DESC
       LIMIT p_limit
    ) r
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_hall_of_fame(p_limit INT DEFAULT 30)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'student_titles') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(f), '[]'::JSONB)
    FROM (
      SELECT st.id, st.student_id, s.name AS student_name,
             st.title_name AS title, st.icon, st.earned_at
        FROM student_titles st
        JOIN students s ON s.id = st.student_id
       WHERE st.is_active = true
       ORDER BY st.earned_at DESC
       LIMIT p_limit
    ) f
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 20. link_guardian_to_student_via_code
-- ============================================================
CREATE OR REPLACE FUNCTION link_guardian_to_student_via_code(p_guardian_id UUID, p_invite_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_student_id UUID;
BEGIN
  -- Check if invite codes table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guardian_invite_codes') THEN
    SELECT student_id INTO v_student_id
      FROM guardian_invite_codes
     WHERE code = UPPER(TRIM(p_invite_code))
       AND used_at IS NULL
       AND expires_at > now();

    IF v_student_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired invite code');
    END IF;

    INSERT INTO guardian_student_links (guardian_id, student_id, status)
    VALUES (p_guardian_id, v_student_id, 'active')
    ON CONFLICT DO NOTHING;

    UPDATE guardian_invite_codes SET used_at = now(), used_by = p_guardian_id
     WHERE code = UPPER(TRIM(p_invite_code));

    RETURN jsonb_build_object('success', true, 'student_id', v_student_id);
  ELSE
    -- Fallback: try matching student by parent_phone
    SELECT id INTO v_student_id FROM students
     WHERE parent_phone IS NOT NULL
     LIMIT 1;

    RETURN jsonb_build_object('success', false, 'error', 'Invite code system not configured');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 21. Ensure notifications table exists
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL,
  recipient_type TEXT NOT NULL DEFAULT 'student',
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT DEFAULT '🔔',
  notification_type TEXT DEFAULT 'general',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, recipient_type, read_at);

-- ============================================================
-- 22. Ensure quiz_sessions has time_spent_seconds column
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quiz_sessions' AND column_name = 'time_spent_seconds'
  ) THEN
    ALTER TABLE quiz_sessions ADD COLUMN time_spent_seconds INT;
  END IF;
END $$;

-- ============================================================
-- 23. Ensure concept_mastery has needed columns
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'concept_mastery' AND column_name = 'next_review_at'
  ) THEN
    ALTER TABLE concept_mastery ADD COLUMN next_review_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'concept_mastery' AND column_name = 'topic_id'
  ) THEN
    ALTER TABLE concept_mastery ADD COLUMN topic_id UUID;
  END IF;
END $$;
