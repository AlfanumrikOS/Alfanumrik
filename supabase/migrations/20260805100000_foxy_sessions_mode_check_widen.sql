-- Migration: 20260805100000_foxy_sessions_mode_check_widen.sql
-- Purpose: Foxy North-Star Phase 0 item F5 — widen the foxy_sessions.mode
--   CHECK constraint from the baseline's 4 modes to the 9 modes the live
--   route actually accepts.
--
-- Drift being closed:
--   Baseline (00000000000000_baseline_from_prod.sql ~L11330):
--     CHECK (mode = ANY (ARRAY['learn','explain','practice','revise']))
--   Code (apps/host/src/app/api/foxy/_lib/constants.ts VALID_MODES, verified
--   2026-08-05):
--     ['learn','explain','practice','revise','doubt','homework','explorer',
--      'olympiad','lesson']
--   Any session INSERT/UPDATE carrying one of the 5 newer modes violates the
--   stale constraint (23514). The new set is a strict SUPERSET of the old
--   one, so re-validating existing rows is trivially safe — no data change,
--   no RLS change, no new table.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + guarded ADD. Safe to re-run.

DO $$
BEGIN
  ALTER TABLE public.foxy_sessions
    DROP CONSTRAINT IF EXISTS foxy_sessions_mode_check;

  ALTER TABLE public.foxy_sessions
    ADD CONSTRAINT foxy_sessions_mode_check
    CHECK (mode = ANY (ARRAY[
      'learn'::text,
      'explain'::text,
      'practice'::text,
      'revise'::text,
      'doubt'::text,
      'homework'::text,
      'explorer'::text,
      'olympiad'::text,
      'lesson'::text
    ]));
EXCEPTION WHEN duplicate_object THEN
  -- Concurrent/partial re-run already added the constraint — nothing to do.
  NULL;
END $$;

COMMENT ON CONSTRAINT foxy_sessions_mode_check ON public.foxy_sessions IS
  'Widened 2026-08-05 (Foxy North-Star F5) to the full 9-mode set mirroring '
  'VALID_MODES in apps/host/src/app/api/foxy/_lib/constants.ts. Keep the two '
  'lists in lockstep: any future mode added to VALID_MODES needs a companion '
  'migration widening this CHECK.';
