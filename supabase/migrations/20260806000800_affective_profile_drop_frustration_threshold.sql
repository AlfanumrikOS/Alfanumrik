-- Migration: 20260806000800_affective_profile_drop_frustration_threshold.sql
-- Purpose: Foxy North-Star Phase 1 PR6 (approval A4, APPROVED 2026-08-05 with
--          no conditions) — retire the never-consumed latent-labeling column
--          student_learning_profiles.frustration_threshold.
--
-- Order matters and both steps run in ONE transaction:
--   1. CREATE OR REPLACE compute_student_affective_profile() from its NEWEST
--      body (20260506000001_fix_irt_and_affective_race_conditions.sql — the
--      last definition in the active chain; verified 2026-08-05 that the only
--      later references, 20260516040000/20260516050000, are EXECUTE revokes,
--      not redefinitions) MINUS the frustration_threshold write. Everything
--      else is preserved byte-identically, except the p90_rt PERCENTILE_CONT
--      column in the UPDATE's subquery, which existed solely to feed the
--      removed write and is dropped with it.
--   2. DROP COLUMN IF EXISTS frustration_threshold — the last writer is gone
--      by the time the column drops, so no window exists where the function
--      references a missing column.
--
-- NOTE: public.evaluation_state.frustration_threshold (integer DEFAULT 4) is a
-- DIFFERENT column on a different table and is NOT covered by A4 — untouched.
--
-- Idempotent: CREATE OR REPLACE + DROP COLUMN IF EXISTS; replays cleanly on
-- databases where the column is already gone.

BEGIN;

-- SECURITY DEFINER justification (carried over from 20260506000001): this is
-- an internal learner-state recompute invoked from server-side pipelines; it
-- must write adaptive_profile / student_learning_profiles across RLS. EXECUTE
-- is revoked from PUBLIC/anon/authenticated (20260516040000 + 20260516050000;
-- re-asserted below).
CREATE OR REPLACE FUNCTION public.compute_student_affective_profile(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc_d1      numeric;
  v_acc_d2      numeric;
  v_acc_d3      numeric;
  v_boredom     integer;
  v_frustration integer;
BEGIN
  SELECT
    AVG(CASE WHEN difficulty = 1 THEN is_correct::int END),
    AVG(CASE WHEN difficulty = 2 THEN is_correct::int END),
    AVG(CASE WHEN difficulty = 3 THEN is_correct::int END)
  INTO v_acc_d1, v_acc_d2, v_acc_d3
  FROM (SELECT is_correct, difficulty FROM quiz_responses
        WHERE student_id = p_student_id ORDER BY created_at DESC LIMIT 50) recent;

  -- boredom_floor: highest difficulty with ≥75% accuracy (too easy)
  v_boredom := 1;
  IF COALESCE(v_acc_d1, 0) >= 0.75 THEN v_boredom := 1; END IF;
  IF COALESCE(v_acc_d2, 0) >= 0.75 THEN v_boredom := 2; END IF;
  IF COALESCE(v_acc_d3, 0) >= 0.75 THEN v_boredom := 3; END IF;

  -- frustration_ceiling: lowest difficulty with <40% accuracy (frustrating)
  v_frustration := 3;
  IF COALESCE(v_acc_d1, 1) < 0.40 THEN v_frustration := 1;
  ELSIF COALESCE(v_acc_d2, 1) < 0.40 THEN v_frustration := 2;
  ELSIF COALESCE(v_acc_d3, 1) < 0.40 THEN v_frustration := 3;
  END IF;

  -- Atomic Upsert for adaptive_profile
  INSERT INTO adaptive_profile (id, student_id, boredom_floor, frustration_ceiling, updated_at)
  VALUES (gen_random_uuid(), p_student_id, v_boredom, v_frustration, now())
  ON CONFLICT (student_id) DO UPDATE
  SET boredom_floor = EXCLUDED.boredom_floor,
      frustration_ceiling = EXCLUDED.frustration_ceiling,
      updated_at = EXCLUDED.updated_at;

  -- Update avg_response_time_seconds per subject.
  -- (A4, 2026-08-05: the frustration_threshold write — and the p90_rt
  -- percentile that existed only to feed it — were removed here; the column
  -- is dropped in this same migration.)
  UPDATE student_learning_profiles slp SET
    avg_response_time_seconds = COALESCE(subq.avg_rt, slp.avg_response_time_seconds),
    updated_at                = now()
  FROM (SELECT subject,
          AVG(time_taken_seconds::float)::double precision AS avg_rt
        FROM quiz_responses WHERE student_id = p_student_id AND time_taken_seconds > 0
        GROUP BY subject) subq
  WHERE slp.student_id = p_student_id AND slp.subject = subq.subject;
END;
$$;

-- Re-assert the 20260516040000/20260516050000 execute posture (CREATE OR
-- REPLACE preserves ACLs; re-asserting keeps fresh-DB replays deterministic).
REVOKE EXECUTE ON FUNCTION public.compute_student_affective_profile(p_student_id uuid) FROM PUBLIC, anon, authenticated;

-- Step 2: with the last writer replaced above, drop the column (approval A4).
ALTER TABLE public.student_learning_profiles
  DROP COLUMN IF EXISTS frustration_threshold;

COMMIT;
