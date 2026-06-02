-- Migration: 20260608000000_streak_freeze_and_curriculum.sql
-- Purpose: Add streak freeze tracking columns to the students table.

BEGIN;

ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS freezes_available INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS freezes_used_total INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_freeze_grant_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_freeze_used_at TIMESTAMPTZ;

COMMENT ON COLUMN public.students.freezes_available IS 'Number of streak freezes currently available to the student.';
COMMENT ON COLUMN public.students.freezes_used_total IS 'Total number of streak freezes used by the student.';
COMMENT ON COLUMN public.students.last_freeze_grant_at IS 'Timestamp of the last time a streak freeze was granted to the student.';
COMMENT ON COLUMN public.students.last_freeze_used_at IS 'Timestamp of the last time a streak freeze was used/consumed by the student.';

-- RPC to atomically purchase a streak freeze
CREATE OR REPLACE FUNCTION public.purchase_streak_freeze(p_student_id uuid, p_cost integer, p_currency text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_balance integer;
BEGIN
  -- Deduct currency
  IF p_currency = 'coins' THEN
    v_balance := public.award_coins(p_student_id, -p_cost, 'redemption', jsonb_build_object('item', 'streak_freeze'));
  ELSIF p_currency = 'xp' THEN
    -- Check XP balance
    SELECT xp_total INTO v_balance FROM public.students WHERE id = p_student_id;
    IF v_balance IS NULL OR v_balance < p_cost THEN
      RAISE EXCEPTION 'Insufficient XP balance';
    END IF;
    PERFORM public.award_xp(p_student_id, -p_cost, 'redemption');
    v_balance := v_balance - p_cost;
  ELSE
    RAISE EXCEPTION 'Invalid currency: %', p_currency;
  END IF;

  -- Grant streak freeze
  UPDATE public.students
  SET freezes_available = freezes_available + 1,
      last_freeze_grant_at = now()
  WHERE id = p_student_id;

  RETURN v_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purchase_streak_freeze(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_streak_freeze(uuid, integer, text) TO authenticated;

COMMIT;
