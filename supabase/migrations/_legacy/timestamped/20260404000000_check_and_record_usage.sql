-- Migration: atomic check_and_record_usage RPC
--
-- Replaces the two-step check→increment pattern (TOCTOU race) with a single
-- transaction that checks the count and increments atomically using FOR UPDATE.
--
-- Two concurrent requests at the daily limit can no longer both pass the check
-- before either increments — the second request blocks on the row lock until
-- the first transaction commits, then sees the updated count and is denied.
--
-- Returns: TABLE(allowed BOOLEAN, current_count INTEGER)
--   allowed       = true if the request was within limit and has been recorded
--   current_count = the count AFTER increment (if allowed) or current count (if denied)

CREATE OR REPLACE FUNCTION public.check_and_record_usage(
  p_student_id  UUID,
  p_feature     TEXT,
  p_limit       INTEGER,
  p_usage_date  DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(allowed BOOLEAN, current_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Ensure the row exists before locking (INSERT OR IGNORE)
  INSERT INTO public.student_daily_usage (student_id, feature, usage_date, usage_count)
  VALUES (p_student_id, p_feature, p_usage_date, 0)
  ON CONFLICT (student_id, feature, usage_date) DO NOTHING;

  -- Lock the row so concurrent transactions queue behind this one
  SELECT usage_count INTO v_count
  FROM public.student_daily_usage
  WHERE student_id = p_student_id
    AND feature    = p_feature
    AND usage_date = p_usage_date
  FOR UPDATE;

  IF v_count < p_limit THEN
    -- Within limit: increment and return allowed
    UPDATE public.student_daily_usage
    SET    usage_count = v_count + 1,
           updated_at  = NOW()
    WHERE  student_id = p_student_id
      AND  feature    = p_feature
      AND  usage_date = p_usage_date;

    RETURN QUERY SELECT true::BOOLEAN, (v_count + 1)::INTEGER;
  ELSE
    -- Over limit: do NOT increment, return denied
    RETURN QUERY SELECT false::BOOLEAN, v_count::INTEGER;
  END IF;
END;
$$;

-- Grant execute to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.check_and_record_usage(UUID, TEXT, INTEGER, DATE)
  TO authenticated, service_role;
