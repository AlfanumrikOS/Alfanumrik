-- Reconstructed from production ledger (supabase_migrations.schema_migrations).
-- Originally applied out-of-band 2026-08-29; committed to restore parity.
-- Content verified byte-identical to stored statements. Do not re-run
-- against production — already applied at version 20260829164203.

CREATE OR REPLACE FUNCTION public.get_activity_timeline(
  p_student_id uuid,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_category text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.get_activity_timeline(uuid, int, int, text, timestamptz, timestamptz)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.get_progress_report(
  p_student_id uuid,
  p_from date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.get_progress_report(uuid, date, date)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.get_class_activity_report(
  p_class_id uuid,
  p_from date DEFAULT (CURRENT_DATE - INTERVAL '7 days')::date,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_authorized boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM class_teachers ct
    WHERE ct.class_id = p_class_id
      AND ct.teacher_id IN (
        SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid()
      )
  ) OR is_admin()
  INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'class_id', p_class_id,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'daily', COALESCE((
      SELECT jsonb_agg(row_to_json(d.*)::jsonb ORDER BY d.activity_date_ist DESC)
      FROM (
        SELECT
          activity_date_ist,
          active_students,
          total_events,
          quizzes_completed,
          questions_answered,
          questions_correct,
          accuracy_pct,
          foxy_sessions,
          foxy_messages,
          xp_earned,
          chapters_completed,
          concept_checks
        FROM analytics.class_activity_summary
        WHERE class_id = p_class_id
          AND activity_date_ist BETWEEN p_from AND p_to
        ORDER BY activity_date_ist DESC
      ) d
    ), '[]'::jsonb),
    'students', COALESCE((
      SELECT jsonb_agg(row_to_json(st.*)::jsonb ORDER BY st.total_events DESC)
      FROM (
        SELECT
          sds.student_id,
          s.full_name,
          SUM(sds.total_events)::int AS total_events,
          SUM(sds.quizzes_completed)::int AS quizzes_completed,
          SUM(sds.questions_answered)::int AS questions_answered,
          SUM(sds.questions_correct)::int AS questions_correct,
          CASE WHEN SUM(sds.questions_answered) > 0
            THEN ROUND(SUM(sds.questions_correct)::numeric
                       / SUM(sds.questions_answered) * 100, 1)
            ELSE NULL END AS accuracy_pct,
          SUM(sds.xp_earned)::int AS xp_earned,
          SUM(sds.chapters_completed)::int AS chapters_completed,
          COUNT(*)::int AS active_days
        FROM analytics.student_daily_summary sds
        JOIN class_enrollments ce
          ON ce.student_id = sds.student_id AND ce.is_active = true
        JOIN students s ON s.id = sds.student_id
        WHERE ce.class_id = p_class_id
          AND sds.activity_date_ist BETWEEN p_from AND p_to
        GROUP BY sds.student_id, s.full_name
        ORDER BY SUM(sds.total_events) DESC
      ) st
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_class_activity_report(uuid, date, date)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.get_school_usage_analytics(
  p_school_id uuid,
  p_from date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (is_school_admin_of(p_school_id) OR is_admin()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'school_id', p_school_id,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'enrolled_students', (
      SELECT COUNT(*) FROM students
      WHERE school_id = p_school_id AND is_demo IS NOT TRUE
    ),
    'daily', COALESCE((
      SELECT jsonb_agg(row_to_json(d.*)::jsonb ORDER BY d.activity_date_ist DESC)
      FROM (
        SELECT
          activity_date_ist,
          active_students,
          total_events,
          quizzes_completed,
          questions_answered,
          questions_correct,
          accuracy_pct,
          foxy_sessions,
          xp_earned,
          chapters_completed
        FROM analytics.school_activity_summary
        WHERE school_id = p_school_id
          AND activity_date_ist BETWEEN p_from AND p_to
        ORDER BY activity_date_ist DESC
      ) d
    ), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'active_students',    COALESCE(SUM(active_students), 0),
        'total_events',       COALESCE(SUM(total_events), 0),
        'quizzes_completed',  COALESCE(SUM(quizzes_completed), 0),
        'questions_answered', COALESCE(SUM(questions_answered), 0),
        'questions_correct',  COALESCE(SUM(questions_correct), 0),
        'accuracy_pct',       CASE WHEN SUM(questions_answered) > 0
          THEN ROUND(SUM(questions_correct)::numeric
                     / SUM(questions_answered) * 100, 1)
          ELSE NULL END,
        'xp_earned',          COALESCE(SUM(xp_earned), 0),
        'chapters_completed', COALESCE(SUM(chapters_completed), 0)
      )
      FROM analytics.school_activity_summary
      WHERE school_id = p_school_id
        AND activity_date_ist BETWEEN p_from AND p_to
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_usage_analytics(uuid, date, date)
  TO authenticated;