-- Migration: 20260715000000_seed_ff_foxy_durable_thread_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_durable_thread_v1` (Foxy Phase 0.2 —
--          durable conversation thread) so the row EXISTS in
--          public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_foxy_durable_thread_v1
--     When ON: the Foxy client sends an authoritative client-generated session
--     id on every turn and resolveSession (apps/host/src/app/api/foxy/_lib/
--     session.ts) treats the thread as DURABLE — it is NEVER silently reset. A
--     subject/chapter/mode change UPDATES the foxy_sessions row IN PLACE (it
--     does NOT fork a new session), idle age is ignored, and a well-formed
--     client id that has no row yet is INSERTed with that exact id
--     (client-authoritative). A PK collision with ANOTHER student's row falls
--     back to a server-generated id (no cross-tenant read/write).
--     When OFF (the default): resolveSession behavior is byte-identical to
--     today — the ff_foxy_session_reactivate_v1 path + the >4h idle logic are
--     untouched. This is a SEPARATE flag from ff_foxy_session_reactivate_v1;
--     when durable is ON it takes precedence and the reactivate/idle paths do
--     not run.
--
-- Spec/task: Foxy "context breaks" fix, Phase 0.2 (server side). Durable thread
--            so a conversation is never silently reset on topic change or idle.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts) returns
-- false for both `is_enabled = false` AND `rollout_percentage <= 0`, so the flag
-- stays OFF until an operator explicitly flips it via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change (resolveSession
-- reads this flag and, finding it OFF, runs the existing path verbatim).
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000600_seed_ff_adaptive_loops_bc_v1.sql,
-- 20260619000300_seed_ff_adaptive_remediation_v1.sql, and
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). Scoping arrays are left NULL (no
-- role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. The explicit column list (flag_name
-- first) + ON CONFLICT (flag_name) DO NOTHING conform to REG-125 (canonical
-- feature_flags shape: flag_name/is_enabled, NOT name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: backend (resolveSession reads this exact flag name) + architect
--        (session-identity/security review, P14) + ops (flag flip procedure).
-- Added: 2026-07-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_durable_thread_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (resolveSession reverts to the existing reactivate/idle
-- path).

DO $foxy_durable_thread$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_foxy_durable_thread_v1',
      false,
      0,
      'Foxy Phase 0.2 durable conversation thread. When ON, resolveSession treats the client-authoritative session id as a durable thread: a subject/chapter/mode change UPDATES the foxy_sessions row IN PLACE (no new session), idle age is ignored (never reset on idle), a well-formed client id with no row yet is INSERTed with that exact id, and a PK collision with ANOTHER student falls back to a server-generated id (no cross-tenant read/write; logs foxy.session.thread_id_collision). SEPARATE flag from ff_foxy_session_reactivate_v1; takes precedence when ON. When OFF (default) resolveSession is byte-identical to today. Default off; staging-first. Task: Foxy context-breaks fix Phase 0.2 (server).',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_durable_thread_v1 seed (fresh DB).';
  END IF;
END $foxy_durable_thread$;
