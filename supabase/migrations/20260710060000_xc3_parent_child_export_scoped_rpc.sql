-- XC-3: move parent child DPDP export data aggregation behind an
-- authenticated helper. The route still uses service-role for the existing
-- state_events publisher side effect, so this is a partial migration.

CREATE OR REPLACE FUNCTION public.parent_child_export_data(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id uuid;
  v_student jsonb;
  v_subscription_rows jsonb;
  v_learning_profile_rows jsonb;
  v_quiz_sessions jsonb;
  v_quiz_responses jsonb;
  v_foxy_chat_messages jsonb;
  v_score_history jsonb;
  v_assignment_submissions jsonb;
  v_notifications jsonb;
  v_audit_logs jsonb;
  v_subscription_count integer := 0;
  v_learning_profile_count integer := 0;
  v_export jsonb;
  v_table_counts jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Authentication required');
  END IF;

  SELECT g.id
    INTO v_guardian_id
  FROM public.guardians g
  JOIN public.guardian_student_links gsl
    ON gsl.guardian_id = g.id
   AND gsl.student_id = p_student_id
   AND gsl.status IN ('active', 'approved')
  WHERE g.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'You are not linked to this student');
  END IF;

  SELECT to_jsonb(s.*)
    INTO v_student
  FROM public.students s
  WHERE s.id = p_student_id;

  SELECT COUNT(*), COALESCE(jsonb_agg(to_jsonb(ss.*) ORDER BY ss.created_at DESC), '[]'::jsonb)
    INTO v_subscription_count, v_subscription_rows
  FROM public.student_subscriptions ss
  WHERE ss.student_id = p_student_id;

  SELECT COUNT(*), COALESCE(jsonb_agg(to_jsonb(slp.*)), '[]'::jsonb)
    INTO v_learning_profile_count, v_learning_profile_rows
  FROM public.student_learning_profiles slp
  WHERE slp.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(qs.*) ORDER BY qs.created_at DESC), '[]'::jsonb)
    INTO v_quiz_sessions
  FROM public.quiz_sessions qs
  WHERE qs.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(qr.*) ORDER BY qr.created_at DESC), '[]'::jsonb)
    INTO v_quiz_responses
  FROM public.quiz_responses qr
  WHERE qr.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(fcm.*) ORDER BY fcm.created_at DESC), '[]'::jsonb)
    INTO v_foxy_chat_messages
  FROM public.foxy_chat_messages fcm
  WHERE fcm.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(sh.*) ORDER BY sh.created_at DESC), '[]'::jsonb)
    INTO v_score_history
  FROM public.score_history sh
  WHERE sh.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(asub.*) ORDER BY asub.created_at DESC), '[]'::jsonb)
    INTO v_assignment_submissions
  FROM public.assignment_submissions asub
  WHERE asub.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(n.*) ORDER BY n.created_at DESC), '[]'::jsonb)
    INTO v_notifications
  FROM public.notifications n
  WHERE n.recipient_id = p_student_id
    AND n.recipient_type = 'student';

  SELECT COALESCE(jsonb_agg(to_jsonb(al.*) ORDER BY al.created_at DESC), '[]'::jsonb)
    INTO v_audit_logs
  FROM public.audit_logs al
  WHERE al.resource_id = p_student_id
    AND al.resource_type = 'students';

  v_export := jsonb_build_object(
    'schema_version', 'v1-2026-05',
    'exported_at', now(),
    'student', v_student,
    'subscription', CASE
      WHEN v_subscription_count = 1 THEN v_subscription_rows->0
      ELSE v_subscription_rows
    END,
    'learning_profile', CASE
      WHEN v_learning_profile_count = 1 THEN v_learning_profile_rows->0
      ELSE v_learning_profile_rows
    END,
    'quiz_sessions', v_quiz_sessions,
    'quiz_attempts', v_quiz_responses,
    'foxy_chat_messages', v_foxy_chat_messages,
    'score_history', v_score_history,
    'submissions', v_assignment_submissions,
    'notifications', v_notifications,
    'audit_logs', v_audit_logs,
    'consents', '[]'::jsonb
  );

  v_table_counts := jsonb_build_object(
    'students', CASE WHEN v_student IS NULL THEN 0 ELSE 1 END,
    'student_subscriptions', v_subscription_count,
    'student_learning_profiles', v_learning_profile_count,
    'quiz_sessions', jsonb_array_length(v_quiz_sessions),
    'quiz_responses', jsonb_array_length(v_quiz_responses),
    'foxy_chat_messages', jsonb_array_length(v_foxy_chat_messages),
    'score_history', jsonb_array_length(v_score_history),
    'assignment_submissions', jsonb_array_length(v_assignment_submissions),
    'notifications', jsonb_array_length(v_notifications),
    'audit_logs', jsonb_array_length(v_audit_logs),
    'parental_consent', 0
  );

  RETURN jsonb_build_object(
    'success', true,
    'data', v_export,
    'tableCounts', v_table_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parent_child_export_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_child_export_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_child_export_data(uuid) TO authenticated;

COMMENT ON FUNCTION public.parent_child_export_data(uuid)
  IS 'XC-3 scoped DPDP child export helper. Resolves guardian ownership from auth.uid() and active/approved guardian_student_links before reading child data.';
