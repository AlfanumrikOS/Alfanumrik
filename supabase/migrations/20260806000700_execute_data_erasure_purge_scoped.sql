-- Migration: 20260806000700_execute_data_erasure_purge_scoped.sql
-- Purpose: Foxy North-Star Phase 1 (approval A3) — teach the DPDP purge worker
--          RPC `execute_data_erasure_purge` about SCOPED (student-initiated,
--          per-memory-layer) erasure requests.
--
-- Source body: copied from 20260618090000_data_erasure_purger_compliance.sql —
-- the NEWEST (and only) definition of this function in the active chain
-- (verified 2026-08-05: no later migration redefines it; the baseline predates
-- the table). The full-account cascade path below is IDENTICAL to that body;
-- the only change is the additive scoped branch taken when the request row has
-- scope IS NOT NULL (column added by 20260806000300; nullable guardian_id by
-- 20260806000600).
--
-- ─── Scoped-layer → table mapping (spec T2, approval A3) ─────────────────────
--   'preferences' -> student_learning_profiles: NULL out learning_style +
--                    preferred_explanation_depth (UPDATE, not DELETE — the
--                    profile row also carries IRT/adaptive state owned by the
--                    'cognitive' layer).
--   'long_memory' -> DELETE monthly_synthesis_runs rows for the student.
--   'twin'        -> DELETE learner_twin_snapshots + learner_twin_memory rows.
--   'cognitive'   -> DELETE concept_mastery, knowledge_gaps, cme_error_log,
--                    student_skill_state rows (see in-branch comment;
--                    assessment-approved semantics).
--   unknown layer -> RAISE (fail closed) — the row transitions to 'failed'
--                    via the shared WHEN OTHERS handler, and the fail-closed
--                    memory erasure guard keeps memory blanked.
--
--   scope->>'subject' (optional narrowing) is NOT applied in v1: the whole
--   layer is erased for the student. Over-erasure is the safe failure
--   direction for a privacy request; per-subject narrowing is a separate
--   reviewed change.
--
-- Idempotent: CREATE OR REPLACE + re-asserted grants. The scoped branch reuses
-- the existing lock/status/audit machinery, so concurrency, dry-run, audit
-- immutability and failure classification behave identically to the
-- full-account path.

BEGIN;

-- SECURITY DEFINER justification: this worker must bypass RLS to erase rows
-- across student-owned tables during a DPDP purge. EXECUTE is revoked from
-- PUBLIC/anon/authenticated and granted only to service_role (re-asserted at
-- the bottom of this file), and the function validates request state itself.
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
  -- Scoped-erasure branch (Foxy North-Star Phase 1):
  v_layer text;
  v_scoped_tables text[];
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
  PERFORM public.insert_data_erasure_audit_event(
    p_request_id,
    CASE WHEN p_dry_run THEN 'data_erasure.dry_run_started' ELSE 'data_erasure.purge_started' END,
    'success',
    jsonb_build_object('dry_run', p_dry_run, 'operator_event_id', p_operator_event_id,
                       'scoped', v_req.scope IS NOT NULL, 'scope_layer', v_req.scope->>'layer')
  );

  -- ─── SCOPED branch (scope IS NOT NULL): erase ONE memory layer, keep the
  --     account. Student-initiated via /api/learner/memory DELETE (A3). ──────
  IF v_req.scope IS NOT NULL THEN
    v_layer := v_req.scope->>'layer';

    IF v_layer = 'preferences' THEN
      v_scoped_tables := ARRAY[]::text[];  -- handled by UPDATE below, not DELETE
    ELSIF v_layer = 'long_memory' THEN
      v_scoped_tables := ARRAY['monthly_synthesis_runs'];
    ELSIF v_layer = 'twin' THEN
      v_scoped_tables := ARRAY['learner_twin_snapshots','learner_twin_memory'];
    ELSIF v_layer = 'cognitive' THEN
      -- Cognitive-layer semantics APPROVED BY ASSESSMENT: erasing the
      -- 'cognitive' memory layer = FULL RESET of the student's adaptive state
      -- (concept mastery, detected knowledge gaps, CME error history, and
      -- per-skill state). The student restarts adaptive placement from a cold
      -- profile; this is intentional, not data loss.
      v_scoped_tables := ARRAY['concept_mastery','knowledge_gaps','cme_error_log','student_skill_state'];
    ELSE
      -- Fail closed: unknown/malformed scope must never fall through to the
      -- full-account cascade. WHEN OTHERS marks the row 'failed' + audits.
      RAISE EXCEPTION 'unknown scoped erasure layer "%" for request %', coalesce(v_layer, '<null>'), p_request_id USING ERRCODE = 'P0001';
    END IF;

    IF p_dry_run THEN
      IF v_layer = 'preferences' THEN
        IF to_regclass('public.student_learning_profiles') IS NULL THEN
          v_rows := v_rows || jsonb_build_object('student_learning_profiles', NULL);
        ELSE
          SELECT count(*) INTO v_count FROM public.student_learning_profiles
           WHERE student_id = v_req.student_id
             AND (learning_style IS NOT NULL OR preferred_explanation_depth IS NOT NULL);
          v_rows := v_rows || jsonb_build_object('student_learning_profiles', v_count);
        END IF;
      ELSE
        FOREACH v_table IN ARRAY v_scoped_tables LOOP
          IF to_regclass('public.' || quote_ident(v_table)) IS NULL THEN
            v_rows := v_rows || jsonb_build_object(v_table, NULL);
            CONTINUE;
          END IF;
          v_sql := format('SELECT count(*) FROM public.%I WHERE student_id = $1', v_table);
          EXECUTE v_sql INTO v_count USING v_req.student_id;
          v_rows := v_rows || jsonb_build_object(v_table, v_count);
        END LOOP;
      END IF;
      PERFORM public.insert_data_erasure_audit_event(p_request_id, 'data_erasure.dry_run_completed', 'success', jsonb_build_object('rows_deleted', v_rows, 'dry_run', true, 'scoped', true, 'scope_layer', v_layer));
      RETURN jsonb_build_object('status', 'dry_run', 'dry_run', true, 'scoped', true, 'scope_layer', v_layer, 'rows_deleted', v_rows, 'school_id', v_req.school_id);
    END IF;

    UPDATE public.data_erasure_requests SET status = 'purging', lock_token = v_lock, locked_at = now(), failure_classification = NULL WHERE id = p_request_id;

    IF v_layer = 'preferences' THEN
      IF to_regclass('public.student_learning_profiles') IS NOT NULL THEN
        UPDATE public.student_learning_profiles
           SET learning_style = NULL,
               preferred_explanation_depth = NULL,
               updated_at = now()
         WHERE student_id = v_req.student_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_rows := v_rows || jsonb_build_object('student_learning_profiles', v_count);
      END IF;
    ELSE
      FOREACH v_table IN ARRAY v_scoped_tables LOOP
        IF to_regclass('public.' || quote_ident(v_table)) IS NULL THEN CONTINUE; END IF;
        v_sql := format('DELETE FROM public.%I WHERE student_id = $1', v_table);
        EXECUTE v_sql USING v_req.student_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_rows := v_rows || jsonb_build_object(v_table, v_count);
      END LOOP;
    END IF;

    UPDATE public.data_erasure_requests
      SET status = 'completed', processed_at = now(), error_message = NULL, lock_token = NULL, locked_at = NULL, failure_classification = NULL
      WHERE id = p_request_id AND lock_token = v_lock;
    PERFORM public.insert_data_erasure_audit_event(p_request_id, 'data_erasure.purge_completed', 'success', jsonb_build_object('rows_deleted', v_rows, 'dry_run', false, 'scoped', true, 'scope_layer', v_layer));
    RETURN jsonb_build_object('status', 'completed', 'scoped', true, 'scope_layer', v_layer, 'rows_deleted', v_rows, 'school_id', v_req.school_id);
  END IF;
  -- ─── end SCOPED branch; below is the unchanged full-account cascade. ───────

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

-- Re-assert the 20260618090000 grant posture (CREATE OR REPLACE preserves
-- ACLs, but re-asserting keeps fresh-DB replays deterministic).
REVOKE ALL ON FUNCTION public.execute_data_erasure_purge(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_data_erasure_purge(uuid, boolean, uuid) TO service_role;

COMMIT;
