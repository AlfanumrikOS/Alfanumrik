-- Migration: 20260803130000_teacher_messaging_rpcs.sql
-- Purpose: Symmetric teacher-side messaging RPCs so the teacher↔parent
--          messaging routes can drop the RLS-bypassing service-role client
--          (P8). Mirrors the proven parent set in
--          20260710190000_xc3_parent_messages_rpcs.sql.
--
-- WHY THESE ARE SECURITY DEFINER
-- ==============================
-- The base-table RLS on teacher_parent_threads / teacher_parent_messages
-- (migration 20260527000003) only grants teachers a SELECT policy anchored on
-- auth.uid(); there is NO teacher thread-INSERT policy and NO read_at UPDATE
-- policy, and guardians/students are not teacher-readable for name enrichment.
-- That is precisely why the routes use the service-role client today. Rather
-- than loosen the base-table RLS (which would widen the blast radius for every
-- PostgREST caller), we follow the parent side's chosen pattern exactly: a
-- small set of SECURITY DEFINER RPCs that re-derive the *session* identity
-- from auth.uid() INSIDE the function and enforce the
-- teacher↔student↔guardian relationship as the authorization boundary. The
-- caller can supply teacher_id/student_id/guardian_id only as *routing* hints;
-- the security boundary is always the auth.uid()→teachers.id resolution, never
-- a request-supplied id (the P1-4 id-semantics lesson: teachers.id ≠
-- auth.uid()).
--
-- BASE-TABLE RLS: intentionally UNCHANGED by this migration.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. teacher_send_parent_message
--    Append to an owned thread (thread_id) OR upsert a thread for a
--    (student, guardian) the teacher legitimately teaches, then insert the
--    teacher-authored message, the state event, and the guardian
--    notification. This is the missing thread-INSERT path.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.teacher_send_parent_message(
  p_thread_id uuid DEFAULT NULL,
  p_guardian_id uuid DEFAULT NULL,
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
  v_teacher_id uuid;
  v_teacher_school_id uuid;
  v_thread_id uuid;
  v_guardian_id uuid;
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

  -- Session identity is the ONLY auth boundary: resolve teachers.id from
  -- auth.uid(). Fail-closed if the caller is not a teacher.
  SELECT t.id, t.school_id
    INTO v_teacher_id, v_teacher_school_id
  FROM public.teachers t
  WHERE t.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_teacher', 'error', 'Teacher account not found');
  END IF;

  IF p_thread_id IS NOT NULL THEN
    -- Append path: the thread must exist AND be owned by the resolved
    -- teacher. Ownership (teacher_id = the session teacher) is the boundary
    -- for replies — no roster re-check (a parent-initiated thread is a
    -- legitimate reply target even if the roster later changes).
    SELECT t.id, t.guardian_id, t.student_id, t.school_id
      INTO v_thread_id, v_guardian_id, v_student_id, v_school_id
    FROM public.teacher_parent_threads t
    WHERE t.id = p_thread_id
      AND t.teacher_id = v_teacher_id
    LIMIT 1;

    IF v_thread_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.teacher_parent_threads t WHERE t.id = p_thread_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'thread_not_owned', 'error', 'Thread not owned by caller');
      END IF;
      RETURN jsonb_build_object('success', false, 'error_code', 'thread_not_found', 'error', 'Thread not found');
    END IF;
  ELSE
    IF p_student_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'student_id is required');
    END IF;

    -- Resolve the recipient guardian. If a guardian_id was supplied, the
    -- (guardian, student) link must be approved/active; otherwise resolve the
    -- student's primary (earliest) approved/active guardian. This mirrors the
    -- route's student-only vs explicit-pair paths.
    IF p_guardian_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.guardian_student_links gsl
        WHERE gsl.guardian_id = p_guardian_id
          AND gsl.student_id = p_student_id
          AND gsl.status IN ('approved', 'active')
        LIMIT 1
      ) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_linked', 'error', 'No approved guardian/student link');
      END IF;
      v_guardian_id := p_guardian_id;
    ELSE
      SELECT gsl.guardian_id
        INTO v_guardian_id
      FROM public.guardian_student_links gsl
      WHERE gsl.student_id = p_student_id
        AND gsl.status IN ('approved', 'active')
      ORDER BY gsl.created_at ASC
      LIMIT 1;

      IF v_guardian_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_linked', 'error', 'No approved guardian linked to this student');
      END IF;
    END IF;

    v_student_id := p_student_id;
    v_school_id := v_teacher_school_id;

    -- Reuse an existing thread for this tuple if one exists (repeat
    -- conversation) — this counts as an owned reply, so no roster re-check.
    SELECT t.id
      INTO v_thread_id
    FROM public.teacher_parent_threads t
    WHERE t.teacher_id = v_teacher_id
      AND t.guardian_id = v_guardian_id
      AND t.student_id = p_student_id
    LIMIT 1;

    IF v_thread_id IS NULL THEN
      -- INITIATING a brand-new thread is the one action that requires the
      -- teacher↔student legitimacy join: a teacher may only start a
      -- conversation about a student they actively teach. Same active
      -- class_teachers ⋈ class_enrollments join as canAccessStudent's teacher
      -- branch (packages/lib/src/rbac.ts). Fail-closed.
      IF NOT EXISTS (
        SELECT 1
        FROM public.class_teachers ct
        JOIN public.class_enrollments ce ON ce.class_id = ct.class_id
        WHERE ct.teacher_id = v_teacher_id
          AND ct.is_active = true
          AND ce.student_id = p_student_id
          AND ce.is_active = true
        LIMIT 1
      ) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_authorized_for_student', 'error', 'You do not teach this student');
      END IF;

      INSERT INTO public.teacher_parent_threads (
        teacher_id,
        guardian_id,
        student_id,
        school_id,
        subject
      )
      VALUES (
        v_teacher_id,
        v_guardian_id,
        p_student_id,
        v_school_id,
        p_subject
      )
      RETURNING id INTO v_thread_id;
      v_is_new_thread := true;
    END IF;
  END IF;

  INSERT INTO public.teacher_parent_messages (
    thread_id,
    sender_role,
    sender_auth_user_id,
    body
  )
  VALUES (
    v_thread_id,
    'teacher',
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
    'teacher.parent_message_sent',
    v_auth_user_id,
    v_school_id,
    'teacher_parent_message_sent:' || v_message_id::text,
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
    v_guardian_id,
    'guardian',
    v_teacher_id,
    'teacher',
    'teacher_message',
    'teacher_message',
    'New message from teacher',
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

-- ─────────────────────────────────────────────────────────────────────────
-- 2. teacher_list_message_threads
--    The teacher's own threads (teacher_id = the session teacher), newest
--    first, with guardian/student name enrichment and teacher-perspective
--    unread counts (= guardian-sent messages with read_at IS NULL).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.teacher_list_message_threads(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_teacher_id uuid;
  v_threads jsonb;
  v_unread_total integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  SELECT t.id
    INTO v_teacher_id
  FROM public.teachers t
  WHERE t.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_teacher', 'error', 'Teacher account not found');
  END IF;

  WITH base AS (
    SELECT t.*
    FROM public.teacher_parent_threads t
    WHERE t.teacher_id = v_teacher_id
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
    WHERE m.sender_role = 'guardian'
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
      g.name AS guardian_name,
      st.name AS student_name,
      CASE
        WHEN latest.body IS NULL THEN NULL
        WHEN length(latest.body) > 120 THEN left(latest.body, 120) || '...'
        ELSE latest.body
      END AS last_message_preview,
      latest.sender_role AS last_message_sender_role,
      COALESCE(unread.unread_count, 0) AS unread_count
    FROM base b
    LEFT JOIN public.guardians g ON g.id = b.guardian_id
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. teacher_list_thread_messages
--    Messages for a thread the session teacher owns (oldest-first, cursor
--    paginated), and — the missing read_at UPDATE path — marks the
--    guardian-sent unread rows read for the viewing teacher.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.teacher_list_thread_messages(
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
  v_teacher_id uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
  v_messages jsonb;
  v_has_more boolean := false;
  v_next_cursor timestamptz;
  v_unread_ids uuid[];
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  SELECT t.id
    INTO v_teacher_id
  FROM public.teachers t
  WHERE t.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_teacher', 'error', 'Teacher account not found');
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
      AND t.teacher_id = v_teacher_id
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
      WHERE page_limited.sender_role = 'guardian' AND page_limited.read_at IS NULL
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

-- ─────────────────────────────────────────────────────────────────────────
-- GRANT / REVOKE — identical posture to the parent set (20260710190000):
-- execute for authenticated sessions only; never anon / public.
-- ─────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.teacher_send_parent_message(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_send_parent_message(uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_send_parent_message(uuid, uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.teacher_list_message_threads(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_list_message_threads(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_list_message_threads(integer) TO authenticated;

REVOKE ALL ON FUNCTION public.teacher_list_thread_messages(uuid, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_list_thread_messages(uuid, timestamptz, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_list_thread_messages(uuid, timestamptz, integer) TO authenticated;

-- SECURITY DEFINER justification comments (architect rule: no SECURITY DEFINER
-- without a SQL comment explaining why).
COMMENT ON FUNCTION public.teacher_send_parent_message(uuid, uuid, uuid, text, text)
  IS 'Teacher-side symmetric twin of parent_send_teacher_message. SECURITY DEFINER: resolves teachers.id from auth.uid() (never a request-supplied id), enforces thread ownership on append and the active class_teachers ⋈ class_enrollments legitimacy join before INITIATING a new thread, then inserts the teacher-authored message, the teacher.parent_message_sent state event, and the guardian notification. Definer is required only to perform the thread INSERT + notification/state writes and guardian/student enrichment that base-table RLS deliberately does not grant teachers; base-table RLS is unchanged.';

COMMENT ON FUNCTION public.teacher_list_message_threads(integer)
  IS 'Teacher-side symmetric twin of parent_list_message_threads. SECURITY DEFINER: resolves teachers.id from auth.uid() and returns only threads where teacher_id = the resolved teacher, with guardian/student name enrichment (definer-only reads) and teacher-perspective unread counts (guardian-sent, read_at IS NULL). Base-table RLS is unchanged.';

COMMENT ON FUNCTION public.teacher_list_thread_messages(uuid, timestamptz, integer)
  IS 'Teacher-side symmetric twin of parent_list_thread_messages. SECURITY DEFINER: resolves teachers.id from auth.uid(), enforces thread ownership (teacher_id = the resolved teacher), lists messages, and performs the read_at UPDATE for guardian-sent unread rows that base-table RLS does not grant teachers. Base-table RLS is unchanged.';
