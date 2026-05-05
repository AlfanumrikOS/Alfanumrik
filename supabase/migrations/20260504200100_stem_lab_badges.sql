-- Migration: 20260504200100_stem_lab_badges.sql
-- Purpose: STEM Lab Engagement Tier 3 R9 — Lab Mastery Badges (Bronze/Silver/Gold per subject).
--
-- Adds:
--   1. student_lab_badges table — one row per (student, subject, tier).
--      Write-protected (no INSERT/UPDATE policy); writes only via SECURITY DEFINER RPC.
--   2. issue_lab_badge() RPC — counts distinct simulations per subject and
--      issues any newly-earned tiers atomically (insert + award_coins).
--   3. complete_experiment() — re-defined to invoke issue_lab_badge() at the
--      end so badges fire automatically as students progress.  Body is byte-
--      identical to the Tier 1 definition except for the appended badge block
--      and the additional 'badges' key in the returned JSONB.
--   4. v_class_lab_leaderboard — read-only view used by Tier 3 R11 leaderboard.
--      Underlying table RLS enforces visibility (own / guardian / teacher / admin).
--
-- Badge thresholds (distinct simulations completed per subject):
--   Bronze =  5  → +100 coins  (source: lab_badge_bronze)
--   Silver = 15  → +250 coins  (source: lab_badge_silver)
--   Gold   = 30  → +500 coins  (source: lab_badge_gold)
-- The award_coins() whitelist already accepts these sources (Tier 1 migration).
--
-- All grade values remain TEXT '6'..'12' (P5).  No PII in RPC return values (P13).
-- Idempotent: all CREATE statements use IF NOT EXISTS / CREATE OR REPLACE.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. student_lab_badges
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_lab_badges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject               TEXT        NOT NULL,
  tier                  TEXT        NOT NULL CHECK (tier IN ('bronze','silver','gold')),
  earned_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  experiments_at_award  INTEGER     NOT NULL CHECK (experiments_at_award >= 0),
  CONSTRAINT uq_student_lab_badges_student_subject_tier
    UNIQUE (student_id, subject, tier)
);

ALTER TABLE public.student_lab_badges ENABLE ROW LEVEL SECURITY;

-- SELECT-only policies. There is intentionally NO INSERT/UPDATE/DELETE policy:
-- writes happen exclusively through the SECURITY DEFINER RPC issue_lab_badge().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_badges'
      AND policyname = 'student_lab_badges_self_select'
  ) THEN
    CREATE POLICY "student_lab_badges_self_select"
      ON public.student_lab_badges FOR SELECT
      USING (student_id = public.get_student_id_for_auth());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_badges'
      AND policyname = 'student_lab_badges_guardian_select'
  ) THEN
    CREATE POLICY "student_lab_badges_guardian_select"
      ON public.student_lab_badges FOR SELECT
      USING (public.is_guardian_of(student_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_badges'
      AND policyname = 'student_lab_badges_teacher_select'
  ) THEN
    CREATE POLICY "student_lab_badges_teacher_select"
      ON public.student_lab_badges FOR SELECT
      USING (public.is_teacher_of(student_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_badges'
      AND policyname = 'student_lab_badges_admin_select'
  ) THEN
    CREATE POLICY "student_lab_badges_admin_select"
      ON public.student_lab_badges FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.admin_users
          WHERE auth_user_id = auth.uid() AND is_active = TRUE
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_lab_badges_student_subject
  ON public.student_lab_badges(student_id, subject);

CREATE INDEX IF NOT EXISTS idx_student_lab_badges_earned_at
  ON public.student_lab_badges(earned_at DESC);

COMMENT ON TABLE public.student_lab_badges IS
  'STEM Lab Mastery Badges (per student per subject). Bronze=5 / Silver=15 / Gold=30 distinct simulations completed in subject. Writes exclusively via issue_lab_badge() RPC; no INSERT/UPDATE policy by design.';

-- ────────────────────────────────────────────────────────────────
-- 2. issue_lab_badge() — award any newly-earned tiers for a subject.
--
-- Counts distinct simulation_id from experiment_observations for the
-- given (student, subject), then for each tier the student now qualifies
-- for AND doesn't already have, inserts a badge row and calls award_coins().
-- ON CONFLICT DO NOTHING on the UNIQUE index protects against concurrent
-- duplicate inserts (e.g. simultaneous experiment completions).
--
-- Returns: {newly_earned: ['bronze','silver'], coins_awarded: 350, total_count: 17}
-- ────────────────────────────────────────────────────────────────
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
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id is required';
  END IF;
  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'subject is required';
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

COMMENT ON FUNCTION public.issue_lab_badge(UUID, TEXT) IS
  'Issues any newly-earned STEM Lab Mastery badges (Bronze=5/Silver=15/Gold=30 distinct simulations per subject) and awards matching coins atomically. Idempotent via student_lab_badges UNIQUE constraint. SECURITY DEFINER because student_lab_badges has no INSERT/UPDATE policy by design. Returns {newly_earned, coins_awarded, total_count, subject}.';

REVOKE ALL ON FUNCTION public.issue_lab_badge(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_lab_badge(UUID, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. complete_experiment(): re-define to call issue_lab_badge() at end.
--
-- Body is identical to Tier 1 (20260504200000_stem_lab_engagement_tier1.sql)
-- except for the appended badge block and the 'badges' key in the return.
-- Badge issuance is wrapped in EXCEPTION WHEN OTHERS so a badge bug can never
-- fail the surrounding experiment completion (which is the user-visible action).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_experiment(
  p_simulation_id     TEXT,
  p_subject           TEXT,
  p_grade             TEXT,
  p_observation_type  TEXT,
  p_observation_text  TEXT    DEFAULT NULL,
  p_structured        JSONB   DEFAULT NULL,
  p_data_entries      JSONB   DEFAULT NULL,
  p_conclusion        TEXT    DEFAULT NULL,
  p_quiz_score        INTEGER DEFAULT NULL,
  p_total_questions   INTEGER DEFAULT NULL,
  p_time_spent_seconds INTEGER DEFAULT 0,
  p_experiment_id     TEXT    DEFAULT NULL,
  p_dedupe_key        TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_student_id     UUID;
  v_obs_id         UUID;
  v_existing_id    UUID;
  v_existing_coins INTEGER;
  v_today          DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_yesterday      DATE := v_today - INTERVAL '1 day';
  v_last_date      DATE;
  v_old_current    INTEGER;
  v_old_longest    INTEGER;
  v_new_streak     INTEGER;
  v_longest        INTEGER;
  v_is_guided      BOOLEAN;
  v_base           INTEGER := 0;
  v_viva_bonus     INTEGER := 0;
  v_first_today    INTEGER := 0;
  v_streak_bonus   INTEGER := 0;
  v_uncapped       INTEGER := 0;
  v_capped_award   INTEGER := 0;
  v_today_coins    INTEGER := 0;
  v_room           INTEGER := 0;
  v_balance        INTEGER := 0;
  v_perfect        BOOLEAN := FALSE;
  v_source         TEXT;
  v_meta           JSONB;
  v_already_today  BOOLEAN := FALSE;
  v_badge_result   JSONB   := '{}'::jsonb;
BEGIN
  -- ─── Auth ──────────────────────────────────────────────────────
  v_student_id := public.get_student_id_for_auth();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as a student';
  END IF;

  -- ─── Validation ───────────────────────────────────────────────
  IF p_simulation_id IS NULL OR length(trim(p_simulation_id)) = 0 THEN
    RAISE EXCEPTION 'simulation_id is required';
  END IF;
  IF p_observation_type NOT IN ('simple','guided') THEN
    RAISE EXCEPTION 'observation_type must be simple or guided, got: %', p_observation_type;
  END IF;
  -- P5: grade is TEXT in '6'..'12'
  IF p_grade IS NULL OR p_grade NOT IN ('6','7','8','9','10','11','12') THEN
    RAISE EXCEPTION 'grade must be a string between 6 and 12, got: %', p_grade;
  END IF;
  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'subject is required';
  END IF;
  IF p_time_spent_seconds < 0 THEN
    RAISE EXCEPTION 'time_spent_seconds cannot be negative';
  END IF;

  v_is_guided := (p_observation_type = 'guided');

  -- ─── Idempotency check ────────────────────────────────────────
  IF p_dedupe_key IS NOT NULL THEN
    SELECT id, coins_awarded
      INTO v_existing_id, v_existing_coins
      FROM public.experiment_observations
     WHERE student_id = v_student_id
       AND dedupe_key = p_dedupe_key
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'observation_id', v_existing_id,
        'idempotent',     TRUE,
        'coins_awarded',  COALESCE(v_existing_coins, 0),
        'message',        'Already recorded'
      );
    END IF;
  END IF;

  -- ─── Detect "first of day" BEFORE inserting the new row ───────
  SELECT EXISTS (
    SELECT 1 FROM public.experiment_observations
     WHERE student_id = v_student_id
       AND ((created_at AT TIME ZONE 'Asia/Kolkata')::date) = v_today
  ) INTO v_already_today;

  -- ─── Insert observation (coins_awarded stamped after award) ───
  INSERT INTO public.experiment_observations (
    student_id, simulation_id, experiment_id, observation_type,
    observation_text, structured_observations, data_entries, conclusion,
    quiz_score, total_questions, time_spent_seconds,
    grade, subject, dedupe_key, coins_awarded
  ) VALUES (
    v_student_id, p_simulation_id, p_experiment_id, p_observation_type,
    p_observation_text, p_structured, p_data_entries, p_conclusion,
    p_quiz_score, p_total_questions, COALESCE(p_time_spent_seconds, 0),
    p_grade, p_subject, p_dedupe_key, 0
  )
  RETURNING id INTO v_obs_id;

  -- ─── Streak update (always runs — engagement is rewarded even if
  --     coins are zero due to anti-grind) ──────────────────────────
  SELECT current_streak, longest_streak, last_activity_date
    INTO v_old_current, v_old_longest, v_last_date
    FROM public.student_lab_streaks
   WHERE student_id = v_student_id
   FOR UPDATE;

  IF v_old_current IS NULL THEN
    -- New row.
    v_new_streak := 1;
    v_longest    := 1;
    INSERT INTO public.student_lab_streaks (
      student_id, current_streak, longest_streak, last_activity_date,
      total_experiments, total_guided, total_viva_score, total_viva_max,
      total_time_seconds, updated_at
    ) VALUES (
      v_student_id, 1, 1, v_today,
      1, CASE WHEN v_is_guided THEN 1 ELSE 0 END,
      COALESCE(p_quiz_score, 0), COALESCE(p_total_questions, 0),
      GREATEST(COALESCE(p_time_spent_seconds, 0), 0), now()
    );
  ELSE
    IF v_last_date = v_today THEN
      v_new_streak := v_old_current;          -- same-day: no streak change
    ELSIF v_last_date = v_yesterday THEN
      v_new_streak := v_old_current + 1;      -- consecutive day
    ELSE
      v_new_streak := 1;                       -- gap → reset
    END IF;
    v_longest := GREATEST(v_old_longest, v_new_streak);

    UPDATE public.student_lab_streaks
       SET current_streak     = v_new_streak,
           longest_streak     = v_longest,
           last_activity_date = v_today,
           total_experiments  = total_experiments  + 1,
           total_guided       = total_guided       + CASE WHEN v_is_guided THEN 1 ELSE 0 END,
           total_viva_score   = total_viva_score   + COALESCE(p_quiz_score, 0),
           total_viva_max     = total_viva_max     + COALESCE(p_total_questions, 0),
           total_time_seconds = total_time_seconds + GREATEST(COALESCE(p_time_spent_seconds, 0), 0),
           updated_at         = now()
     WHERE student_id = v_student_id;
  END IF;

  -- ─── Coin computation (anti-grind: only if >= 60s engaged) ────
  IF COALESCE(p_time_spent_seconds, 0) >= 60 THEN
    v_base := CASE WHEN v_is_guided THEN 40 ELSE 20 END;

    IF p_total_questions IS NOT NULL
       AND p_total_questions > 0
       AND p_quiz_score IS NOT NULL
       AND p_quiz_score = p_total_questions THEN
      v_viva_bonus := 25;
      v_perfect    := TRUE;
    END IF;

    IF NOT v_already_today THEN
      v_first_today := 10;
    END IF;

    IF v_new_streak = 3 THEN
      v_streak_bonus := 15;
    ELSIF v_new_streak = 7 THEN
      v_streak_bonus := 40;
    ELSIF v_new_streak = 30 THEN
      v_streak_bonus := 150;
    END IF;

    v_uncapped := v_base + v_viva_bonus + v_first_today + v_streak_bonus;
  END IF;

  -- ─── Daily cap (100 coins/day across experiment sources) ──────
  v_today_coins  := public.experiment_coins_today(v_student_id);
  v_room         := GREATEST(0, 100 - v_today_coins);
  v_capped_award := LEAST(v_uncapped, v_room);

  -- ─── Single award_coins() call (if any award) ─────────────────
  IF v_capped_award > 0 THEN
    v_source := CASE WHEN v_is_guided
                     THEN 'guided_experiment_complete'
                     ELSE 'experiment_complete'
                END;
    v_meta := jsonb_build_object(
      'observation_id',   v_obs_id,
      'simulation_id',    p_simulation_id,
      'subject',          p_subject,
      'grade',            p_grade,
      'observation_type', p_observation_type,
      'time_spent_seconds', COALESCE(p_time_spent_seconds, 0),
      'breakdown', jsonb_build_object(
        'base',         v_base,
        'viva_bonus',   v_viva_bonus,
        'first_today',  v_first_today,
        'streak_bonus', v_streak_bonus
      ),
      'uncapped',         v_uncapped,
      'capped',           (v_capped_award < v_uncapped),
      'streak_after',     v_new_streak
    );
    v_balance := public.award_coins(v_student_id, v_capped_award, v_source, v_meta);
  ELSE
    -- No award: still report the current balance for the UI.
    SELECT COALESCE(balance, 0) INTO v_balance
      FROM coin_balances WHERE student_id = v_student_id;
    v_balance := COALESCE(v_balance, 0);
  END IF;

  -- ─── Stamp the observation row ────────────────────────────────
  UPDATE public.experiment_observations
     SET coins_awarded = v_capped_award
   WHERE id = v_obs_id;

  -- ─── Tier 3 R9: check for newly-earned mastery badges ─────────
  -- Wrapped: a bug here MUST NOT fail the surrounding experiment
  -- completion (the user already finished the experiment).
  BEGIN
    v_badge_result := public.issue_lab_badge(v_student_id, p_subject);
    -- Badge coin awards are a separate transaction-internal effect
    -- (still atomic with this RPC). Refresh the visible balance.
    IF (v_badge_result ->> 'coins_awarded')::INTEGER > 0 THEN
      SELECT COALESCE(balance, 0) INTO v_balance
        FROM coin_balances WHERE student_id = v_student_id;
      v_balance := COALESCE(v_balance, 0);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_badge_result := '{}'::jsonb;
  END;

  RETURN jsonb_build_object(
    'observation_id', v_obs_id,
    'idempotent',     FALSE,
    'coins_awarded',  v_capped_award,
    'coins_uncapped', v_uncapped,
    'capped',         (v_capped_award < v_uncapped),
    'breakdown', jsonb_build_object(
      'base',         v_base,
      'viva_bonus',   v_viva_bonus,
      'first_today',  v_first_today,
      'streak_bonus', v_streak_bonus
    ),
    'streak', jsonb_build_object(
      'current',       v_new_streak,
      'longest',       v_longest,
      'is_new_record', (v_new_streak = v_longest AND v_new_streak > 1)
    ),
    'coin_balance', v_balance,
    'viva', jsonb_build_object(
      'score',   COALESCE(p_quiz_score, 0),
      'max',     COALESCE(p_total_questions, 0),
      'perfect', v_perfect
    ),
    'badges', v_badge_result
  );
END;
$$;

COMMENT ON FUNCTION public.complete_experiment(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT
) IS
  'Atomic STEM lab completion. Inserts experiment_observations row, updates student_lab_streaks, awards coins (base + viva + first-of-day + streak bonus) capped at 100/day, then issues any newly-earned mastery badges via issue_lab_badge() — all in one transaction. Idempotent via dedupe_key. SECURITY DEFINER because student_lab_streaks and student_lab_badges have no INSERT/UPDATE policy by design.';

-- Re-grant: CREATE OR REPLACE preserves grants but be defensive.
REVOKE ALL ON FUNCTION public.complete_experiment(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_experiment(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT
) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. v_class_lab_leaderboard — read-only view for Tier 3 R11.
--
-- NOTE: students has NO class_id column (verified against baseline schema).
-- Class membership lives in the public.class_students join table. Since one
-- student can belong to multiple classes, exposing a single class_id in this
-- view would be lossy and ambiguous. Tier 3 R11 will instead filter rows
-- using is_teacher_of(student_id) to scope to a teacher's assigned students.
-- Underlying RLS (students, student_lab_streaks, student_lab_badges) enforces
-- visibility — a SECURITY INVOKER view inherits the caller's RLS.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_class_lab_leaderboard AS
SELECT
  s.id                                    AS student_id,
  s.name                                  AS full_name,
  s.grade                                 AS grade,                  -- TEXT '6'..'12' (P5)
  COALESCE(sls.current_streak, 0)         AS lab_streak,
  COALESCE(sls.longest_streak, 0)         AS longest_lab_streak,
  COALESCE(sls.total_experiments, 0)      AS total_experiments,
  COALESCE(sls.total_guided, 0)           AS total_guided,
  CASE
    WHEN COALESCE(sls.total_viva_max, 0) > 0
    THEN ROUND(100.0 * sls.total_viva_score / sls.total_viva_max)::INTEGER
    ELSE NULL
  END                                     AS avg_viva_pct,
  (SELECT COUNT(*) FROM public.student_lab_badges b
     WHERE b.student_id = s.id AND b.tier = 'gold')   AS gold_badges,
  (SELECT COUNT(*) FROM public.student_lab_badges b
     WHERE b.student_id = s.id AND b.tier = 'silver') AS silver_badges,
  (SELECT COUNT(*) FROM public.student_lab_badges b
     WHERE b.student_id = s.id AND b.tier = 'bronze') AS bronze_badges
FROM public.students s
LEFT JOIN public.student_lab_streaks sls ON sls.student_id = s.id
WHERE s.is_active     = TRUE
  AND s.deleted_at    IS NULL
  AND s.account_status = 'active'
  AND COALESCE(s.is_demo, FALSE) = FALSE;

COMMENT ON VIEW public.v_class_lab_leaderboard IS
  'STEM lab leaderboard rollup per student: lab streak + experiment counters + viva accuracy + per-tier badge counts. SECURITY INVOKER — visibility enforced by underlying RLS on students / student_lab_streaks / student_lab_badges. Tier 3 R11 callers should filter rows by is_teacher_of(student_id) for teacher-scoped class views.';

GRANT SELECT ON public.v_class_lab_leaderboard TO authenticated;

COMMIT;
