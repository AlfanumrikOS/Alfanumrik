-- Migration: Retention enforcement via bounded archive + DELETE (P1-3)
-- Audit remediation 2026-08-07 — REBUILT against real schema.
--
-- Real schema fact: audit_logs (baseline:9952) is a NON-partitioned table.
-- CREATE TABLE ... PARTITION OF audit_logs is impossible without a destructive
-- table swap (drop + rename) that would break RLS policies, grants, triggers,
-- indexes, and FKs. The safe approach is Option A: a bounded, resumable DELETE
-- over the real table, plus an archive table for the 'keep' data class.
--
-- pg_cron is disabled on this project (migration 20260505100000) in favor of
-- Vercel cron; the daily retention run is scheduled from /api/cron/governance-health
-- (registered in apps/host/vercel.json). This migration only defines the
-- idempotent SQL primitives.

-- ── 1. Archive table (self-contained, LIKE-inherits real schema) ────────────
CREATE TABLE IF NOT EXISTS public.audit_logs_archive (
  LIKE public.audit_logs INCLUDING ALL
);

ALTER TABLE public.audit_logs_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access audit_logs_archive"
  ON public.audit_logs_archive FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── 2. Bounded, resumable retention enforcement ──────────────────────────────
-- Deletes rows older than the interval in bounded batches (default 5,000) with
-- a short sleep between batches so autovacuum keeps up and locks stay short.
-- Works on the real non-partitioned schema. SECURITY DEFINER with search_path
-- pinned; EXECUTE revoked from PUBLIC/anon and granted to service_role only.
CREATE OR REPLACE FUNCTION public.enforce_retention_policy(
  p_table_name text,
  p_column_name text DEFAULT 'created_at',
  p_retention_interval interval DEFAULT interval '12 months',
  p_batch_size integer DEFAULT 5000
) RETURNS TABLE(deleted_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '60s'
AS $$
DECLARE
  v_cutoff timestamptz := now() - p_retention_interval;
  v_deleted bigint;
  v_qualified_name text;
BEGIN
  -- Guard: only allow deletion from a fixed allow-list of tables we own.
  IF p_table_name NOT IN (
    'audit_logs', 'notifications', 'quiz_responses', 'task_queue',
    'analytics_events', 'chat_sessions', 'foxy_chat_messages', 'foxy_sessions'
  ) THEN
    RAISE EXCEPTION 'retention deletion not allowed on table %', p_table_name
      USING ERRCODE = 'P0001';
  END IF;

  v_qualified_name := 'public.' || quote_ident(p_table_name);

  LOOP
    EXECUTE format(
      'DELETE FROM %s WHERE %I < %L',
      v_qualified_name, p_column_name, v_cutoff
    );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    deleted_count := v_deleted;
    RETURN NEXT;
    EXIT WHEN v_deleted < p_batch_size;
    PERFORM pg_sleep(0.1);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_retention_policy(text, text, interval, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_retention_policy(text, text, interval, integer) TO service_role;

-- ── 3. Archive-before-delete for audit_logs (forensic retention) ────────────
-- Copies rows older than the archive window into audit_logs_archive, then
-- deletes them from audit_logs. Bounded and resumable.
CREATE OR REPLACE FUNCTION public.archive_audit_logs(
  p_archive_before_interval interval DEFAULT interval '12 months',
  p_batch_size integer DEFAULT 5000
) RETURNS TABLE(archived_count bigint, deleted_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '120s'
AS $$
DECLARE
  v_cutoff timestamptz := now() - p_archive_before_interval;
  v_archived bigint := 0;
  v_deleted bigint := 0;
  v_count bigint;
BEGIN
  LOOP
    WITH to_archive AS (
      SELECT id FROM public.audit_logs
      WHERE created_at < v_cutoff
      ORDER BY created_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    ), copied AS (
      INSERT INTO public.audit_logs_archive
      SELECT al.* FROM public.audit_logs al
      JOIN to_archive t ON t.id = al.id
      RETURNING 1
    )
    SELECT count(*) FROM copied INTO v_count;
    v_archived := v_archived + v_count;

    DELETE FROM public.audit_logs
    WHERE id IN (
      SELECT al.id FROM public.audit_logs al
      LEFT JOIN public.audit_logs_archive arc ON arc.id = al.id
      WHERE al.created_at < v_cutoff AND arc.id IS NOT NULL
      LIMIT p_batch_size
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted := v_deleted + v_count;

    archived_count := v_archived;
    deleted_count := v_deleted;
    RETURN NEXT;
    EXIT WHEN v_count < p_batch_size;
    PERFORM pg_sleep(0.1);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_audit_logs(interval, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_audit_logs(interval, integer) TO service_role;
