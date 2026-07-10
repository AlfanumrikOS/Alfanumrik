-- XC-3 RCA-01: scoped authenticated helpers for parent notification reads.
-- Moves guardian-owned list/read mutations out of route-level service-role
-- access while preserving the existing route auth gate and response contract.

CREATE OR REPLACE FUNCTION public.parent_list_notifications(
  p_filter text DEFAULT 'all',
  p_cursor timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id uuid;
  v_filter text := CASE WHEN p_filter = 'unread' THEN 'unread' ELSE 'all' END;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 50));
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_cursor text := NULL;
  v_unread_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian_id
    FROM public.guardians g
   WHERE g.auth_user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Guardian account not found');
  END IF;

  WITH limited AS (
    SELECT n.id,
           n.title,
           n.message,
           n.body,
           n.type,
           n.data,
           n.is_read,
           n.read_at,
           n.created_at,
           n.delivery_channel
      FROM public.notifications n
     WHERE n.recipient_id = v_guardian_id
       AND n.recipient_type = 'guardian'
       AND (v_filter <> 'unread' OR n.is_read = false)
       AND (p_cursor IS NULL OR n.created_at < p_cursor)
     ORDER BY n.created_at DESC
     LIMIT v_limit + 1
  ),
  page AS (
    SELECT *
      FROM limited
     ORDER BY created_at DESC
     LIMIT v_limit
  ),
  aggregate_page AS (
    SELECT coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id', id,
                 'title', title,
                 'message', message,
                 'body', body,
                 'type', type,
                 'data', coalesce(data, '{}'::jsonb),
                 'is_read', is_read,
                 'read_at', read_at,
                 'created_at', created_at,
                 'delivery_channel', delivery_channel
               )
               ORDER BY created_at DESC
             ),
             '[]'::jsonb
           ) AS items
      FROM page
  ),
  page_cursor AS (
    SELECT created_at
      FROM page
     ORDER BY created_at ASC
     LIMIT 1
  ),
  page_meta AS (
    SELECT count(*) > v_limit AS has_more
      FROM limited
  )
  SELECT aggregate_page.items,
         page_meta.has_more,
         CASE WHEN page_meta.has_more THEN page_cursor.created_at::text ELSE NULL END
    INTO v_items, v_has_more, v_next_cursor
    FROM aggregate_page
    CROSS JOIN page_meta
    LEFT JOIN page_cursor ON true;

  SELECT count(*)::integer
    INTO v_unread_count
    FROM public.notifications n
   WHERE n.recipient_id = v_guardian_id
     AND n.recipient_type = 'guardian'
     AND n.is_read = false;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'items', v_items,
      'nextCursor', v_next_cursor,
      'hasMore', coalesce(v_has_more, false),
      'unreadCount', coalesce(v_unread_count, 0)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_mark_notification_read(
  p_notification_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id uuid;
  v_updated record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian_id
    FROM public.guardians g
   WHERE g.auth_user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Guardian account not found');
  END IF;

  UPDATE public.notifications n
     SET is_read = true,
         read_at = now()
   WHERE n.id = p_notification_id
     AND n.recipient_id = v_guardian_id
     AND n.recipient_type = 'guardian'
   RETURNING n.id, n.read_at
    INTO v_updated;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Notification not found or not owned');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object('id', v_updated.id, 'read_at', v_updated.read_at)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_mark_all_notifications_read()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id uuid;
  v_updated integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian_id
    FROM public.guardians g
   WHERE g.auth_user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Guardian account not found');
  END IF;

  UPDATE public.notifications n
     SET is_read = true,
         read_at = now()
   WHERE n.recipient_id = v_guardian_id
     AND n.recipient_type = 'guardian'
     AND n.is_read = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object('updated', v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parent_list_notifications(text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_list_notifications(text, timestamptz, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_list_notifications(text, timestamptz, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_mark_notification_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_mark_notification_read(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_mark_notification_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_mark_all_notifications_read() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_mark_all_notifications_read() FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_mark_all_notifications_read() TO authenticated;

COMMENT ON FUNCTION public.parent_list_notifications(text, timestamptz, integer) IS
  'XC-3 scoped authenticated helper for listing the caller-owned guardian notifications.';
COMMENT ON FUNCTION public.parent_mark_notification_read(uuid) IS
  'XC-3 scoped authenticated helper for marking one caller-owned guardian notification read.';
COMMENT ON FUNCTION public.parent_mark_all_notifications_read() IS
  'XC-3 scoped authenticated helper for marking all caller-owned guardian notifications read.';
