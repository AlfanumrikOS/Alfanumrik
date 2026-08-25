-- Migration: 20260825045039_fix_foxy_broadcast_operation_arg_swap.sql
-- NOTE: version 20260825045039 is not arbitrary. This change was applied
-- directly to production on 2026-08-25 to stop active data loss, and the
-- ledger (supabase_migrations.schema_migrations) recorded it under that
-- timestamp. The filename MUST match the recorded version or the migration
-- pipeline sees an applied-but-untracked migration and refuses on drift.
-- Purpose: Repair the 22-day Foxy message-loss outage (launch-blocker P0-1).
--
-- ── THE INCIDENT ───────────────────────────────────────────────────────────
-- `public.foxy_chat_messages` persisted ZERO rows between 2026-08-02 04:43 and
-- 2026-08-25, while `public.foxy_sessions` kept writing normally (1,978 rows,
-- 273 of them after the last persisted message). Foxy answered students the
-- whole time — `grounded-answer` logged 51 invocations in a single 24h window
-- — and every question and every answer was discarded. `POST /api/foxy`
-- returned HTTP 200 with `messageId: null`.
--
-- PR #1619 (2026-08-24) correctly diagnosed that the seven write sites
-- swallowed `error` and routed them through a single seam
-- (apps/host/src/app/api/foxy/_lib/message-persistence.ts) with a
-- `foxy_message_persist_failure` counter. That made the failure VISIBLE but
-- did not fix it — the cause is here, in the database, not in the route.
--
-- ── ROOT CAUSE ─────────────────────────────────────────────────────────────
-- `realtime.broadcast_changes` has this signature:
--
--   (topic_name text, event_name text, operation text,
--    table_name text, table_schema text, new record, old record,
--    level text DEFAULT 'ROW')
--
-- `operation` must be 'INSERT' | 'UPDATE' | 'DELETE'. The previous body of
-- `trg_broadcast_foxy_chat_message_change` passed:
--
--   realtime.broadcast_changes(v_topic, tg_op, v_event, ...)
--                                       ^^^^^  ^^^^^^^
--                                       event  operation   <-- SWAPPED
--
-- so `operation` received the custom event name 'foxy_message_created'.
-- Realtime rejected it with SQLSTATE P0001:
--
--   "Failed to process the row: Unexpected operation type: foxy_message_created"
--
-- Because the trigger is AFTER INSERT and therefore runs inside the caller's
-- transaction, that exception rolled back the INSERT itself. Every Foxy
-- message write aborted. Reproduced 2026-08-25 by calling
-- `submit_foxy_message_atomic` inside a rolled-back DO block, which returned
-- exactly that message.
--
-- ── PROVENANCE NOTE ────────────────────────────────────────────────────────
-- Neither `trg_broadcast_foxy_chat_message_change` nor any `broadcast_changes`
-- call appears anywhere in the tracked tree (`git grep` over origin/main finds
-- nothing). This trigger was created directly against production, outside the
-- migration chain, and was therefore never reviewed. This migration brings it
-- under version control for the first time.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- 1. Pass the arguments in the correct order: event_name := v_event,
--    operation := tg_op.
-- 2. Wrap the broadcast in an exception handler. A realtime-notification
--    failure must NEVER again roll back a student's message. The handler
--    raises a WARNING (visible in Postgres logs) instead of aborting, so the
--    failure is degraded-but-loud rather than silent-and-destructive. Losing a
--    live-update ping is recoverable; losing the student's question is not.
--
-- Idempotent: CREATE OR REPLACE only. No trigger is created, dropped or
-- re-pointed; no table or data is touched.
--
-- Rollback: re-create the function with `v_event` and `tg_op` swapped back
-- (restores the broken behaviour — only do this to reproduce the incident).
--
-- Verification after apply:
--   1. The rolled-back probe returns inner_ok=t:
--        do $$ declare ok boolean := false; begin
--          begin perform public.submit_foxy_message_atomic(
--            p_session_id => '<session>', p_student_id => '<student>',
--            p_role => 'user', p_content => 'probe', p_sources => '{}'::jsonb,
--            p_tokens_used => 0, p_structured => null,
--            p_coach_mode_used => null, p_pending => false); ok := true;
--          exception when others then null; end;
--          raise exception 'inner_ok=%', ok; end $$;
--   2. A real POST /api/foxy returns a non-null messageId and
--      `select count(*) from foxy_chat_messages where session_id = <new>` > 0.

create or replace function public.trg_broadcast_foxy_chat_message_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  v_topic text;
  v_event text;
begin
  v_topic := 'foxy:session:' || coalesce(new.session_id, old.session_id)::text;

  v_event := case tg_op
    when 'INSERT' then 'foxy_message_created'
    when 'UPDATE' then 'foxy_message_updated'
    when 'DELETE' then 'foxy_message_deleted'
    else 'foxy_message_changed'
  end;

  -- A broadcast failure must never abort the student's message write.
  begin
    perform realtime.broadcast_changes(
      v_topic,            -- topic_name
      v_event,            -- event_name  (custom, client-facing)
      tg_op,              -- operation   (MUST be INSERT/UPDATE/DELETE)
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  exception when others then
    raise warning 'foxy broadcast failed (non-fatal): topic=% sqlstate=% message=%',
      v_topic, sqlstate, sqlerrm;
  end;

  return coalesce(new, old);
end;
$$;

comment on function public.trg_broadcast_foxy_chat_message_change() is
  'Broadcasts foxy_chat_messages row changes to the foxy:session:<id> realtime '
  'topic. Arg order fixed 2026-08-25 (event_name/operation were swapped, which '
  'raised P0001 and rolled back every message INSERT for 22 days). Broadcast '
  'failures are now warned, never fatal.';
