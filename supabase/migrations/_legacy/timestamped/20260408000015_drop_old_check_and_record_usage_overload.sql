-- Migration: drop_old_check_and_record_usage_overload
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: Remove the old check_and_record_usage overload that used the caller-supplied
--          p_limit (an integer at position 3) instead of deriving the limit from the
--          student's actual subscription plan via get_plan_limit().
--
-- Old signature: (p_student_id uuid, p_feature text, p_limit integer, p_usage_date date)
--   → returns TABLE(allowed boolean, current_count integer)   ← client-controlled limit (WRONG)
--
-- Correct signature kept: (p_student_id uuid, p_feature text, p_usage_date date, p_limit integer DEFAULT NULL)
--   → returns TABLE(allowed boolean, used_count integer)       ← DB-derived limit (CORRECT)
--
-- Also updated foxy-tutor to v32 (deployed directly) removing p_limit from the RPC call
-- and fixing the return column name current_count → used_count in the 429 payload.

DROP FUNCTION IF EXISTS public.check_and_record_usage(
  uuid,    -- p_student_id
  text,    -- p_feature
  integer, -- p_limit  ← position 3 in old overload
  date     -- p_usage_date
);
