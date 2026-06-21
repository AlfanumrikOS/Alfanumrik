-- Production-grade data-erasure purge hardening: locks, transaction-safe RPC,
-- dry-run support, and immutable audit markers.

BEGIN;

ALTER TABLE public.data_erasure_requests
  ADD COLUMN IF NOT EXISTS lock_token uuid NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS failure_classification text NULL CHECK (
    failure_classification IS NULL OR failure_classification IN ('retryable', 'permanent', 'partial', 'orphan-risk')
  );

CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_active_lock
  ON public.data_erasure_requests (id, status, locked_at)
  WHERE status IN ('pending', 'purging');

CREATE OR REPLACE FUNCTION public.classify_data_erasure_failure(p_message text, p_rows_deleted jsonb DEFAULT '{}'::jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_msg text := lower(coalesce(p_message, ''));
  v_partial boolean := EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(p_rows_deleted, '{}'::jsonb)) AS e(k, v) WHERE e.v ~ '^[0-9]+$' AND e.v::integer > 0);
BEGIN
  IF v_msg LIKE '%foreign key%' OR v_msg LIKE '%violates%' OR v_msg LIKE '%orphan%' THEN RETURN 'orphan-risk'; END IF;
  IF v_partial THEN RETURN 'partial'; END IF;
  IF v_msg LIKE '%timeout%' OR v_msg LIKE '%connection%' OR v_msg LIKE '%temporar%' OR v_msg LIKE '%rate limit%' THEN RETURN 'retryable'; END IF;
  RETURN 'permanent';
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_data_erasure_audit_event(
  p_request_id uuid,
  p_action text,
  p_status text,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.data_erasure_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.data_erasure_requests WHERE id = p_request_id;
  INSERT INTO public.audit_logs(auth_user_id, action, resource_type, resource_id, details, status)
  VALUES (
    NULL,
    p_action,
    'data_erasure_request',
    p_request_id,
    jsonb_build_object('request_id', p_request_id, 'student_id', v_req.student_id, 'guardian_id', v_req.guardian_id) || coalesce(p_details, '{}'::jsonb),
    p_status
  );
END;
$$;

-- Restrict insert_data_erasure_audit_event to service_role only.
-- Without this revoke any anon/authenticated client can call a SECURITY DEFINER
-- function and forge audit entries.
REVOKE ALL ON FUNCTION public.insert_data_erasure_audit_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.insert_data_erasure_audit_event(uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_data_erasure_purge(
  p_request_id uuid,
  p_dry_run boolean DEFAULT false,
  p_operator_event_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.data_erasure_requests%ROWTYPE;
  v_auth_user_id uuid;
  v_lock uuid := gen_random_uuid();
  v_rows jsonb := '{}'::jsonb;
  v_count integer;
  v_tables text[] := ARRAY['audit_logs','notifications','foxy_chat_messages','quiz_attempts','quiz_sessions','score_history','student_learning_profiles','student_subscriptions','class_students','parental_consent','guardian_student_links','students'];
  v_table text;
  v_sql text;
BEGIN
  SELECT * INTO v_req FROM public.data_erasure_requests WHERE id = p_request_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    -- Row is locked by a concurrent tick; raise 55P03 which the EXCEPTION block
    -- below catches separately and returns as {status:'skipped'}.
    RAISE EXCEPTION 'data erasure request % is locked or absent', p_request_id USING ERRCODE = '55P03';
  END IF;
  IF v_req.status = 'completed' THEN
    RETURN jsonb_build_object('status', 'completed', 'already_completed', true, 'rows_deleted', '{}'::jsonb, 'school_id', v_req.school_id);
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'data erasure request % is not pending (status=%)', p_request_id, v_req.status USING ERRCODE = 'P0001';
  END IF;

  -- FIX: use auth_user_id (the actual column name on students); actor_auth_user_id
  -- was a typo that caused every purge to crash at the DELETE step.
  SELECT auth_user_id INTO v_auth_user_id FROM public.students WHERE id = v_req.student_id;
  PERFORM public.insert_data_erasure_audit_event(p_request_id, CASE WHEN p_dry_run THEN 'data_erasure.dry_run_started' ELSE 'data_erasure.purge_started' END, 'success', jsonb_build_object('dry_run', p_dry_run, 'operator_event_id', p_operator_event_id));

  IF p_dry_run THEN
    FOREACH v_table IN ARRAY v_tables LOOP
      IF to_regclass('public.' || quote_ident(v_table)) IS NULL THEN
        v_rows := v_rows || jsonb_build_object(v_table, NULL);
        CONTINUE;
      END IF;
      IF v_table = 'audit_logs' THEN
        -- FIX: use auth_user_id not actor_auth_user_id (column name typo).
        EXECUTE 'SELECT count(*) FROM public.audit_logs WHERE auth_user_id = $1' INTO v_count USING v_auth_user_id;
      ELSIF v_table = 'notifications' THEN
        EXECUTE 'SELECT count(*) FROM public.notifications WHERE recipient_id = $1' INTO v_count USING v_auth_user_id;
      ELSIF v_table = 'students' THEN
        EXECUTE 'SELECT count(*) FROM public.students WHERE id = $1' INTO v_count USING v_req.student_id;
      ELSE
        v_sql := format('SELECT count(*) FROM public.%I WHERE student_id = $1', v_table);
        EXECUTE v_sql INTO v_count USING v_req.student_id;
      END IF;
      v_rows := v_rows || jsonb_build_object(v_table, v_count);
    END LOOP;
    PERFORM public.insert_data_erasure_audit_event(p_request_id, 'data_erasure.dry_run_completed', 'success', jsonb_build_object('rows_deleted', v_rows, 'dry_run', true));
    RETURN jsonb_build_object('status', 'dry_run', 'dry_run', true, 'rows_deleted', v_rows, 'school_id', v_req.school_id);
  END IF;

  UPDATE public.data_erasure_requests SET status = 'purging', lock_token = v_lock, locked_at = now(), failure_classification = NULL WHERE id = p_request_id;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(v_table)) IS NULL THEN CONTINUE; END IF;
    IF v_table = 'audit_logs' THEN
      -- FIX: use auth_user_id not actor_auth_user_id (column name typo).
      DELETE FROM public.audit_logs WHERE auth_user_id = v_auth_user_id;
    ELSIF v_table = 'notifications' THEN
      DELETE FROM public.notifications WHERE recipient_id = v_auth_user_id;
    ELSIF v_table = 'students' THEN
      DELETE FROM public.students WHERE id = v_req.student_id;
    ELSE
      v_sql := format('DELETE FROM public.%I WHERE student_id = $1', v_table);
      EXECUTE v_sql USING v_req.student_id;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows := v_rows || jsonb_build_object(v_table, v_count);
  END LOOP;

  UPDATE public.data_erasure_requests
    SET status = 'completed', processed_at = now(), error_message = NULL, lock_token = NULL, locked_at = NULL, failure_classification = NULL
    WHERE id = p_request_id AND lock_token = v_lock;
  PERFORM public.insert_data_erasure_audit_event(p_request_id, 'data_erasure.purge_completed', 'success', jsonb_build_object('rows_deleted', v_rows, 'dry_run', false));
  RETURN jsonb_build_object('status', 'completed', 'rows_deleted', v_rows, 'school_id', v_req.school_id);

EXCEPTION
  -- Row locked by a concurrent tick: skip cleanly. Do NOT update status to
  -- 'failed' — the other tick is (or already did) handle it successfully.
  WHEN SQLSTATE '55P03' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'locked_by_concurrent_tick');

  WHEN OTHERS THEN
    -- IMPORTANT: do NOT re-RAISE. Re-raising here would roll back this entire
    -- transaction, meaning the status UPDATE below would never commit and the
    -- row would stay stuck in 'purging' forever. Instead, return a failure
    -- jsonb so the caller can handle it; the UPDATE + audit write commit.
    UPDATE public.data_erasure_requests
      SET status = 'failed', processed_at = now(), error_message = left(SQLERRM, 2000),
          lock_token = NULL, locked_at = NULL,
          failure_classification = public.classify_data_erasure_failure(SQLERRM, v_rows)
      WHERE id = p_request_id;
    PERFORM public.insert_data_erasure_audit_event(
      p_request_id, 'data_erasure.failed', 'failure',
      jsonb_build_object(
        'error', left(SQLERRM, 2000),
        'failure_classification', public.classify_data_erasure_failure(SQLERRM, v_rows),
        'rows_deleted', v_rows
      )
    );
    RETURN jsonb_build_object(
      'status', 'failed',
      'error', left(SQLERRM, 2000),
      'failure_classification', public.classify_data_erasure_failure(SQLERRM, v_rows)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_data_erasure_purge(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_data_erasure_purge(uuid, boolean, uuid) TO service_role;

COMMIT;
