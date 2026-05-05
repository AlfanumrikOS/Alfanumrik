-- Migration: 20260504200000_stem_lab_engagement_tier1.sql
-- Purpose: STEM Lab Engagement Tier 1 — coin economy + streaks for guided experiments.
--
-- Adds:
--   1. student_lab_streaks table (write-protected; service-role/RPC writes only)
--   2. experiment_observations.coins_awarded + dedupe_key (idempotency surface)
--   3. award_coins() whitelist extension for experiment-related sources (Tier 1 + Tier 3)
--   4. experiment_coins_today() helper (Asia/Kolkata daily cap accounting)
--   5. complete_experiment() atomic RPC — single transaction:
--        validate -> idempotency check -> insert observation -> compute coins
--        (base + viva + first-of-day) -> update streak -> apply streak bonus
--        -> daily-cap to 100 -> award_coins() once -> stamp coins_awarded -> return JSONB
--
-- All grade values are TEXT ('6'..'12') per P5.  All timezone math uses
-- Asia/Kolkata since Alfanumrik is India-only.  No PII written to metadata (P13).
--
-- Idempotent: all CREATE statements use IF NOT EXISTS / CREATE OR REPLACE.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. student_lab_streaks
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_lab_streaks (
  student_id          UUID PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  current_streak      INTEGER     NOT NULL DEFAULT 0 CHECK (current_streak     >= 0),
  longest_streak      INTEGER     NOT NULL DEFAULT 0 CHECK (longest_streak     >= 0),
  last_activity_date  DATE,
  total_experiments   INTEGER     NOT NULL DEFAULT 0 CHECK (total_experiments  >= 0),
  total_guided        INTEGER     NOT NULL DEFAULT 0 CHECK (total_guided       >= 0),
  total_viva_score    INTEGER     NOT NULL DEFAULT 0 CHECK (total_viva_score   >= 0),
  total_viva_max      INTEGER     NOT NULL DEFAULT 0 CHECK (total_viva_max     >= 0),
  total_time_seconds  BIGINT      NOT NULL DEFAULT 0 CHECK (total_time_seconds >= 0),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.student_lab_streaks ENABLE ROW LEVEL SECURITY;

-- SELECT-only policies. There is intentionally NO insert/update/delete policy:
-- writes happen exclusively through the SECURITY DEFINER RPC complete_experiment().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_streaks'
      AND policyname = 'student_lab_streaks_self_select'
  ) THEN
    CREATE POLICY "student_lab_streaks_self_select"
      ON public.student_lab_streaks FOR SELECT
      USING (student_id = public.get_student_id_for_auth());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_streaks'
      AND policyname = 'student_lab_streaks_guardian_select'
  ) THEN
    CREATE POLICY "student_lab_streaks_guardian_select"
      ON public.student_lab_streaks FOR SELECT
      USING (public.is_guardian_of(student_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_streaks'
      AND policyname = 'student_lab_streaks_teacher_select'
  ) THEN
    CREATE POLICY "student_lab_streaks_teacher_select"
      ON public.student_lab_streaks FOR SELECT
      USING (public.is_teacher_of(student_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_lab_streaks'
      AND policyname = 'student_lab_streaks_admin_select'
  ) THEN
    CREATE POLICY "student_lab_streaks_admin_select"
      ON public.student_lab_streaks FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.admin_users
          WHERE auth_user_id = auth.uid() AND is_active = TRUE
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_lab_streaks_last_activity
  ON public.student_lab_streaks(last_activity_date);

COMMENT ON TABLE public.student_lab_streaks IS
  'STEM lab engagement counters per student. Writes exclusively via complete_experiment() RPC; no INSERT/UPDATE RLS policy by design.';

-- ────────────────────────────────────────────────────────────────
-- 2. experiment_observations: coins_awarded + dedupe_key
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.experiment_observations
  ADD COLUMN IF NOT EXISTS coins_awarded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.experiment_observations
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- Partial unique index: idempotency only when caller supplies a key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_experiment_obs_student_dedupe
  ON public.experiment_observations(student_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3. award_coins(): extend whitelist with experiment + Tier-3 sources.
-- Body is otherwise byte-identical to the baseline definition.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_coins(
  p_student_id UUID,
  p_amount     INTEGER,
  p_source     TEXT,
  p_metadata   JSONB DEFAULT '{}'::jsonb
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_current_balance INTEGER; v_new_balance INTEGER;
BEGIN
  IF p_source NOT IN (
    -- Pre-existing sources (preserved verbatim)
    'quiz_complete','first_quiz_of_day','streak_3_day','streak_7_day','streak_30_day',
    'revise_decaying_topic','study_task_complete','study_plan_week','score_milestone',
    'redemption','xp_migration','admin_adjustment','daily_challenge',
    -- Tier 1: STEM lab core
    'experiment_complete','guided_experiment_complete',
    'viva_perfect_bonus','first_experiment_of_day',
    'lab_streak_3_day','lab_streak_7_day','lab_streak_30_day',
    'experiment_subject_streak_5',
    -- Tier 3: badges + quality (added now to avoid future migration churn)
    'lab_badge_bronze','lab_badge_silver','lab_badge_gold','conclusion_quality_bonus'
  ) THEN
    RAISE EXCEPTION 'Invalid coin source: %', p_source;
  END IF;
  IF p_amount < 0 THEN
    SELECT COALESCE(balance,0) INTO v_current_balance FROM coin_balances WHERE student_id=p_student_id FOR UPDATE;
    IF v_current_balance IS NULL THEN v_current_balance:=0; END IF;
    IF v_current_balance+p_amount<0 THEN RAISE EXCEPTION 'Insufficient coin balance'; END IF;
  END IF;
  INSERT INTO coin_transactions (student_id,amount,source,metadata) VALUES (p_student_id,p_amount,p_source,p_metadata);
  INSERT INTO coin_balances (student_id,balance,updated_at) VALUES (p_student_id,GREATEST(p_amount,0),now()) ON CONFLICT (student_id) DO UPDATE SET balance=coin_balances.balance+p_amount, updated_at=now();
  SELECT balance INTO v_new_balance FROM coin_balances WHERE student_id=p_student_id;
  RETURN v_new_balance;
END; $$;

-- ────────────────────────────────────────────────────────────────
-- 4. experiment_coins_today(): sum of today's experiment-source awards.
-- Used to enforce the 100-coin daily cap inside complete_experiment().
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.experiment_coins_today(p_student_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_sum   INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_sum
    FROM coin_transactions
   WHERE student_id = p_student_id
     AND amount > 0
     AND source IN (
       'experiment_complete','guided_experiment_complete',
       'viva_perfect_bonus','first_experiment_of_day',
       'lab_streak_3_day','lab_streak_7_day','lab_streak_30_day',
       'experiment_subject_streak_5',
       'lab_badge_bronze','lab_badge_silver','lab_badge_gold','conclusion_quality_bonus'
     )
     AND ((created_at AT TIME ZONE 'Asia/Kolkata')::date) = v_today;
  RETURN COALESCE(v_sum, 0);
END;
$$;

COMMENT ON FUNCTION public.experiment_coins_today(UUID) IS
  'Sums today''s positive coin awards (Asia/Kolkata) for experiment-related sources. Powers the 100-coin daily cap in complete_experiment().';

-- ────────────────────────────────────────────────────────────────
-- 5. complete_experiment(): atomic RPC.
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
    )
  );
END;
$$;

COMMENT ON FUNCTION public.complete_experiment(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT
) IS
  'Atomic STEM lab completion. Inserts experiment_observations row, updates student_lab_streaks, awards coins (base + viva + first-of-day + streak bonus) capped at 100/day, all in one transaction. Idempotent via dedupe_key. SECURITY DEFINER because student_lab_streaks has no INSERT/UPDATE policy by design.';

-- ────────────────────────────────────────────────────────────────
-- 6. Grants: authenticated users only
-- ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.complete_experiment(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_experiment(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.experiment_coins_today(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.experiment_coins_today(UUID) TO authenticated;

COMMIT;
