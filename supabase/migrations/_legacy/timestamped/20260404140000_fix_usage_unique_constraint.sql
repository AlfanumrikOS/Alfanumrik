-- Fix: unique constraint must include 'feature' column for the
-- check_and_record_usage RPC's ON CONFLICT clause to work.
-- The old constraint was (student_id, usage_date) but the RPC inserts
-- per-feature rows, so it needs (student_id, feature, usage_date).

-- Drop the old constraint
ALTER TABLE public.student_daily_usage
  DROP CONSTRAINT IF EXISTS student_daily_usage_student_id_usage_date_key;

-- Add the correct constraint that matches the RPC's ON CONFLICT spec
ALTER TABLE public.student_daily_usage
  ADD CONSTRAINT student_daily_usage_student_feature_date_key
  UNIQUE (student_id, feature, usage_date);
