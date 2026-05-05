-- Migration: 20260505100100_notifications_idempotency_key.sql
-- Purpose: Add an `idempotency_key` column + partial unique index on
--          public.notifications so daily-cron (and any other periodic
--          notification producer) can safely upsert without creating duplicate
--          parent_digest / score_milestone rows on re-run.
--
-- Per launch-readiness D6: even though pg_cron is now disabled (sister
-- migration 20260505100000), the Vercel runner can still be retried by
-- Vercel's own retry-on-failure policy, and partial-failure responses (HTTP
-- 207) may cause a second invocation. The idempotency_key makes those re-runs
-- safe.
--
-- Convention used by daily-cron:
--   idempotency_key = 'daily_digest_'  || YYYY_MM_DD || '_' || recipient_id
--   idempotency_key = 'score_drop_'    || YYYY_MM_DD || '_' || student_id || '_' || subject
--   idempotency_key = 'score_above80_' || YYYY_MM_DD || '_' || student_id || '_' || subject
--   idempotency_key = 'score_below50_' || YYYY_MM_DD || '_' || student_id || '_' || subject
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Partial unique index: only enforce uniqueness when idempotency_key is set,
-- so legacy/manual notification inserts (with NULL key) remain unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_idx
  ON public.notifications (recipient_id, type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.notifications.idempotency_key IS
  'Deterministic key used by periodic producers (daily-cron, schedulers) to '
  'prevent duplicate notifications on retry. NULL for ad-hoc notifications. '
  'Convention: <type-prefix>_<YYYY_MM_DD>_<entity_id>[_<sub_entity>]';
