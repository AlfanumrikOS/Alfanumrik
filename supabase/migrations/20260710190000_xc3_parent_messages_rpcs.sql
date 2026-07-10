-- XC-3 parent messaging drain: remove route-level service-role reads/writes
-- from the parent side of teacher-parent messaging.

CREATE OR REPLACE FUNCTION public.parent_send_teacher_message(
  p_thread_id uuid DEFAULT NULL,
  p_teacher_id uuid DEFAULT NULL,
  p_student_id uuid DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_subject text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_guardian_id uuid;
  v_guardian_name text;
  v_thread_id uuid;
  v_teacher_id uuid;
  v_student_id uuid;
  v_school_id uuid;
  v_message_id uuid;
  v_is_new_thread boolean := false;
  v_notif_body text;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  IF p_body IS NULL OR btrim(p_body) = '' OR length(btrim(p_body)) > 4000 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'Invalid message body');
  END IF;

  SELECT g.id, g.name
    INTO v_guardian_id, v_guardian_name
  FROM public.guardians g
  WHERE g.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_guardian', 'error', 'Guardian account not found');
  END IF;

  IF p_thread_id IS NOT NULL THEN
    SELECT t.id, t.teacher_id, t.student_id, t.school_id
      INTO v_thread_id, v_teacher_id, v_student_id, v_school_id
    FROM public.teacher_parent_threads t
    WHERE t.id = p_thread_id
      AND t.guardian_id = v_guardian_id
    LIMIT 1;

    IF v_thread_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.teacher_parent_threads t WHERE t.id = p_thread_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'thread_not_owned', 'error', 'Thread not owned by caller');
      END IF;
      RETURN jsonb_build_object('success', false, 'error_code', 'thread_not_found', 'error', 'Thread not found');
    END IF;
  ELSE
    IF p_teacher_id IS NULL OR p_student_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'teacher_id and student_id are required');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.guardian_student_links gsl
      WHERE gsl.guardian_id = v_guardian_id
        AND gsl.student_id = p_student_id
        AND gsl.status IN ('approved', 'active')
      LIMIT 1
    ) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'not_linked', 'error', 'Child not linked to your account');
    END IF;

    SELECT t.school_id
      INTO v_school_id
    FROM public.teachers t
    WHERE t.id = p_teacher_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'teacher_not_found', 'error', 'Teacher not found');
    END IF;

    SELECT t.id
      INTO v_thread_id
    FROM public.teacher_parent_threads t
    WHERE t.teacher_id = p_teacher_id
      AND t.guardian_id = v_guardian_id
      AND t.student_id = p_student_id
    LIMIT 1;

    IF v_thread_id IS NULL THEN
      INSERT INTO public.teacher_parent_threads (
        teacher_id,
        guardian_id,
        student_id,
        school_id,
        subject
      )
      VALUES (
        p_teacher_id,
        v_guardian_id,
        p_student_id,
        v_school_id,
        p_subject
      )
      RETURNING id INTO v_thread_id;
      v_is_new_thread := true;
    END IF;

    v_teacher_id := p_teacher_id;
    v_student_id := p_student_id;
  END IF;

  INSERT INTO public.teacher_parent_messages (
    thread_id,
    sender_role,
    sender_auth_user_id,
    body
  )
  VALUES (
    v_thread_id,
    'guardian',
    v_auth_user_id,
    btrim(p_body)
  )
  RETURNING id INTO v_message_id;

  INSERT INTO public.state_events (
    event_id,
    kind,
    actor_auth_user_id,
    tenant_id,
    idempotency_key,
    occurred_at,
    payload
  )
  VALUES (
    gen_random_uuid(),
    'parent.teacher_message_sent',
    v_auth_user_id,
    v_school_id,
    'parent_teacher_message_sent:' || v_message_id::text,
    now(),
    jsonb_build_object(
      'threadId', v_thread_id,
      'messageId', v_message_id,
      'teacherId', v_teacher_id,
      'guardianId', v_guardian_id,
      'studentId', v_student_id,
      'bodyLength', length(btrim(p_body)),
      'isNewThread', v_is_new_thread
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  v_notif_body := CASE
    WHEN length(btrim(p_body)) > 200 THEN left(btrim(p_body), 200) || '...'
    ELSE btrim(p_body)
  END;

  INSERT INTO public.notifications (
    recipient_id,
    recipient_type,
    sender_id,
    sender_type,
    type,
    notification_type,
    title,
    message,
    body,
    data,
    is_read,
    delivery_channel
  )
  VALUES (
    v_teacher_id,
    'teacher',
    v_guardian_id,
    'guardian',
    'parent_message',
    'parent_message',
    'New message from ' || COALESCE(v_guardian_name, 'A parent'),
    v_notif_body,
    v_notif_body,
    jsonb_build_object('thread_id', v_thread_id, 'message_id', v_message_id, 'student_id', v_student_id),
    false,
    'in_app'
  );

  RETURN jsonb_build_object(
    'success', true,
    'thread_id', v_thread_id,
    'message_id', v_message_id,
    'is_new_thread', v_is_new_thread
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_list_message_threads(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_guardian_id uuid;
  v_threads jsonb;
  v_unread_total integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian_id
  FROM public.guardians g
  WHERE g.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_guardian', 'error', 'Guardian account not found');
  END IF;

  WITH base AS (
    SELECT t.*
    FROM public.teacher_parent_threads t
    WHERE t.guardian_id = v_guardian_id
    ORDER BY t.last_message_at DESC
    LIMIT v_limit
  ),
  latest AS (
    SELECT DISTINCT ON (m.thread_id)
      m.thread_id,
      m.body,
      m.sender_role,
      m.created_at
    FROM public.teacher_parent_messages m
    JOIN base b ON b.id = m.thread_id
    ORDER BY m.thread_id, m.created_at DESC
  ),
  unread AS (
    SELECT m.thread_id, count(*)::integer AS unread_count
    FROM public.teacher_parent_messages m
    JOIN base b ON b.id = m.thread_id
    WHERE m.sender_role = 'teacher'
      AND m.read_at IS NULL
    GROUP BY m.thread_id
  ),
  enriched AS (
    SELECT
      b.id,
      b.teacher_id,
      b.guardian_id,
      b.student_id,
      b.school_id,
      b.subject,
      b.created_at,
      b.updated_at,
      b.last_message_at,
      te.name AS teacher_name,
      st.name AS student_name,
      CASE
        WHEN latest.body IS NULL THEN NULL
        WHEN length(latest.body) > 120 THEN left(latest.body, 120) || '...'
        ELSE latest.body
      END AS last_message_preview,
      latest.sender_role AS last_message_sender_role,
      COALESCE(unread.unread_count, 0) AS unread_count
    FROM base b
    LEFT JOIN public.teachers te ON te.id = b.teacher_id
    LEFT JOIN public.students st ON st.id = b.student_id
    LEFT JOIN latest ON latest.thread_id = b.id
    LEFT JOIN unread ON unread.thread_id = b.id
    ORDER BY b.last_message_at DESC
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(enriched) ORDER BY enriched.last_message_at DESC), '[]'::jsonb),
    COALESCE(sum(enriched.unread_count), 0)::integer
  INTO v_threads, v_unread_total
  FROM enriched;

  RETURN jsonb_build_object('success', true, 'threads', v_threads, 'unreadTotal', v_unread_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_list_thread_messages(
  p_thread_id uuid,
  p_cursor timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_guardian_id uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
  v_messages jsonb;
  v_has_more boolean := false;
  v_next_cursor timestamptz;
  v_unread_ids uuid[];
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian_id
  FROM public.guardians g
  WHERE g.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_guardian', 'error', 'Guardian account not found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teacher_parent_threads t
    WHERE t.id = p_thread_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'thread_not_found', 'error', 'Thread not found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teacher_parent_threads t
    WHERE t.id = p_thread_id
      AND t.guardian_id = v_guardian_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'thread_not_owned', 'error', 'Thread not owned by caller');
  END IF;

  WITH page_rows AS (
    SELECT m.id, m.thread_id, m.sender_role, m.sender_auth_user_id, m.body, m.created_at, m.read_at
    FROM public.teacher_parent_messages m
    WHERE m.thread_id = p_thread_id
      AND (p_cursor IS NULL OR m.created_at > p_cursor)
    ORDER BY m.created_at ASC
    LIMIT v_limit + 1
  ),
  page_limited AS (
    SELECT *
    FROM page_rows
    ORDER BY created_at ASC
    LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(page_limited) ORDER BY page_limited.created_at ASC), '[]'::jsonb),
    (SELECT count(*) > v_limit FROM page_rows),
    max(page_limited.created_at),
    COALESCE(array_agg(page_limited.id) FILTER (
      WHERE page_limited.sender_role = 'teacher' AND page_limited.read_at IS NULL
    ), ARRAY[]::uuid[])
  INTO v_messages, v_has_more, v_next_cursor, v_unread_ids
  FROM page_limited;

  IF COALESCE(array_length(v_unread_ids, 1), 0) > 0 THEN
    UPDATE public.teacher_parent_messages
       SET read_at = now()
     WHERE id = ANY(v_unread_ids);

    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN (item ->> 'id')::uuid = ANY(v_unread_ids)
          THEN jsonb_set(item, '{read_at}', to_jsonb(now()))
        ELSE item
      END
      ORDER BY item ->> 'created_at'
    ), '[]'::jsonb)
      INTO v_messages
    FROM jsonb_array_elements(v_messages) AS item;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'messages', v_messages,
    'nextCursor', CASE WHEN v_has_more THEN v_next_cursor ELSE NULL END,
    'hasMore', v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parent_send_teacher_message(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_send_teacher_message(uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_send_teacher_message(uuid, uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_list_message_threads(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_list_message_threads(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_list_message_threads(integer) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_list_thread_messages(uuid, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_list_thread_messages(uuid, timestamptz, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_list_thread_messages(uuid, timestamptz, integer) TO authenticated;

COMMENT ON FUNCTION public.parent_send_teacher_message(uuid, uuid, uuid, text, text)
  IS 'XC-3 scoped parent message sender. Resolves guardian via auth.uid(), enforces thread/link ownership, inserts message, state event, and teacher notification.';

COMMENT ON FUNCTION public.parent_list_message_threads(integer)
  IS 'XC-3 scoped parent thread list. Resolves guardian via auth.uid() and returns only guardian-owned teacher-parent threads.';

COMMENT ON FUNCTION public.parent_list_thread_messages(uuid, timestamptz, integer)
  IS 'XC-3 scoped parent thread message list. Resolves guardian via auth.uid(), enforces thread ownership, lists messages, and marks teacher messages read.';
