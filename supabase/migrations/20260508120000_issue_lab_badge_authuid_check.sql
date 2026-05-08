-- ─── Harden issue_lab_badge: require p_student_id == auth.uid()-bound student ─
--
-- Background:
-- 20260504200100_stem_lab_badges.sql granted EXECUTE on
-- `public.issue_lab_badge(p_student_id UUID, p_subject TEXT)` to the
-- `authenticated` role. The function is SECURITY DEFINER and accepts an
-- arbitrary p_student_id from the caller — so any logged-in student could
-- call it with another student's id and trigger badge issuance + coin
-- award on that other student's behalf.
--
-- The badges + coins are still gated by the `v_total_count >= v_threshold`
-- check (only awarded if the target student actually has enough completed
-- experiments) and the UNIQUE constraint on (student_id, subject, tier)
-- makes it idempotent. So the worst-case impact is a malicious student
-- forcibly issuing a badge to another student a few hours earlier than
-- they'd have claimed it themselves — no privilege escalation, but a
-- clear cross-tenant write that violates P13.
--
-- This migration adds a tiny guard at the top of the function so callers
-- (= the `authenticated` role, used only by complete_experiment internally)
-- must pass their OWN student id. Server-side callers that go through the
-- service_role bypass auth.uid() and the guard becomes a no-op for them
-- (NULL coalesce + early return only when auth.uid() is set).
--
-- We re-CREATE the function. The body below is byte-identical to the one
-- in 20260504200100_stem_lab_badges.sql except for the new guard block.
-- complete_experiment in 20260504200100 already passes the JWT-resolved
-- v_student_id, so this guard is invisible to the legit call path.

CREATE OR REPLACE FUNCTION public.issue_lab_badge(
  p_student_id UUID,
  p_subject    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_count   INTEGER := 0;
  v_newly_earned  TEXT[]  := ARRAY[]::TEXT[];
  v_coins_awarded INTEGER := 0;
  v_inserted      BOOLEAN;
  v_threshold     INTEGER;
  v_coin_amount   INTEGER;
  v_coin_source   TEXT;
  v_tier          TEXT;
  v_caller_student_id UUID;
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id is required';
  END IF;
  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'subject is required';
  END IF;

  -- ─── P13 guard ───────────────────────────────────────────────
  -- When called from a JWT context (auth.uid() is set), require that
  -- p_student_id resolves to the same student. Service-role callers
  -- have no auth.uid() and skip this branch — that's intended:
  -- complete_experiment is SECURITY DEFINER and calls this with the
  -- already-JWT-resolved student id.
  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_caller_student_id
      FROM public.students
     WHERE auth_user_id = auth.uid();

    IF v_caller_student_id IS NULL OR v_caller_student_id <> p_student_id THEN
      RAISE EXCEPTION 'p_student_id must match the calling user'
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
  END IF;

  -- Count distinct simulations completed in this subject.
  SELECT COUNT(DISTINCT simulation_id)::INTEGER
    INTO v_total_count
    FROM public.experiment_observations
   WHERE student_id = p_student_id
     AND subject    = p_subject;

  -- Walk tiers in ascending order so coins/insert order is deterministic.
  FOR v_tier IN SELECT unnest(ARRAY['bronze','silver','gold']) LOOP
    v_threshold := CASE v_tier
                     WHEN 'bronze' THEN 5
                     WHEN 'silver' THEN 15
                     WHEN 'gold'   THEN 30
                   END;
    v_coin_amount := CASE v_tier
                       WHEN 'bronze' THEN 100
                       WHEN 'silver' THEN 250
                       WHEN 'gold'   THEN 500
                     END;
    v_coin_source := CASE v_tier
                       WHEN 'bronze' THEN 'lab_badge_bronze'
                       WHEN 'silver' THEN 'lab_badge_silver'
                       WHEN 'gold'   THEN 'lab_badge_gold'
                     END;

    IF v_total_count >= v_threshold THEN
      v_inserted := FALSE;
      WITH ins AS (
        INSERT INTO public.student_lab_badges (
          student_id, subject, tier, experiments_at_award
        )
        VALUES (p_student_id, p_subject, v_tier, v_total_count)
        ON CONFLICT (student_id, subject, tier) DO NOTHING
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM ins) INTO v_inserted;

      IF v_inserted THEN
        v_newly_earned := array_append(v_newly_earned, v_tier);
        PERFORM public.award_coins(
          p_student_id,
          v_coin_amount,
          v_coin_source,
          jsonb_build_object(
            'subject',              p_subject,
            'tier',                 v_tier,
            'experiments_at_award', v_total_count,
            'threshold',            v_threshold
          )
        );
        v_coins_awarded := v_coins_awarded + v_coin_amount;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'newly_earned',  v_newly_earned,
    'coins_awarded', v_coins_awarded,
    'total_count',   v_total_count,
    'subject',       p_subject
  );
END;
$$;

-- Grants are unchanged from the original migration.
REVOKE ALL ON FUNCTION public.issue_lab_badge(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_lab_badge(UUID, TEXT) TO authenticated;
