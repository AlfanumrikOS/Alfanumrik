-- Migration: 20260417000001_daily_challenge_system.sql
-- Purpose: Create Daily Challenge system tables (daily_challenges, challenge_attempts,
--          challenge_streaks) with RLS, indexes, and submit_challenge_attempt RPC.
--          Also extends coin_transactions source enum and award_coins() validation
--          to include 'daily_challenge' as a valid coin source.


-- ════════════════════════════════════════════════════════════════════════════
-- 0. Extend coin_transactions source CHECK and award_coins() to allow
--    'daily_challenge' as a valid source
-- ════════════════════════════════════════════════════════════════════════════

-- Drop the old CHECK constraint and add a new one that includes 'daily_challenge'
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'coin_transactions_source_check'
  ) THEN
    ALTER TABLE coin_transactions DROP CONSTRAINT coin_transactions_source_check;
  END IF;
END $$;

ALTER TABLE coin_transactions
  ADD CONSTRAINT coin_transactions_source_check CHECK (source IN (
    'quiz_complete',
    'first_quiz_of_day',
    'streak_3_day',
    'streak_7_day',
    'streak_30_day',
    'revise_decaying_topic',
    'study_task_complete',
    'study_plan_week',
    'score_milestone',
    'redemption',
    'xp_migration',
    'admin_adjustment',
    'daily_challenge'
  ));

-- Recreate award_coins with 'daily_challenge' in its validation list
-- SECURITY DEFINER: must INSERT into coin_transactions and UPSERT into
-- coin_balances regardless of caller's RLS context. Called from server-side
-- code (API routes, Edge Functions, daily-cron, submit_challenge_attempt).
CREATE OR REPLACE FUNCTION award_coins(
  p_student_id UUID,
  p_amount     INTEGER,
  p_source     TEXT,
  p_metadata   JSONB DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance     INTEGER;
BEGIN
  -- Validate source
  IF p_source NOT IN (
    'quiz_complete', 'first_quiz_of_day',
    'streak_3_day', 'streak_7_day', 'streak_30_day',
    'revise_decaying_topic', 'study_task_complete', 'study_plan_week',
    'score_milestone', 'redemption', 'xp_migration', 'admin_adjustment',
    'daily_challenge'
  ) THEN
    RAISE EXCEPTION 'Invalid coin source: %', p_source;
  END IF;

  -- For redemptions (negative amount), validate balance won't go negative
  IF p_amount < 0 THEN
    SELECT COALESCE(balance, 0) INTO v_current_balance
    FROM coin_balances
    WHERE student_id = p_student_id
    FOR UPDATE;  -- lock row to prevent race conditions

    -- If no balance row exists, current balance is 0
    IF v_current_balance IS NULL THEN
      v_current_balance := 0;
    END IF;

    IF v_current_balance + p_amount < 0 THEN
      RAISE EXCEPTION 'Insufficient coin balance: have %, need %',
        v_current_balance, ABS(p_amount);
    END IF;
  END IF;

  -- Insert transaction record
  INSERT INTO coin_transactions (student_id, amount, source, metadata)
  VALUES (p_student_id, p_amount, p_source, p_metadata);

  -- Upsert balance
  INSERT INTO coin_balances (student_id, balance, updated_at)
  VALUES (p_student_id, GREATEST(p_amount, 0), now())
  ON CONFLICT (student_id) DO UPDATE
  SET balance    = coin_balances.balance + p_amount,
      updated_at = now();

  -- Return new balance
  SELECT balance INTO v_new_balance
  FROM coin_balances
  WHERE student_id = p_student_id;

  RETURN v_new_balance;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. daily_challenges — one chain-ordering puzzle per grade per day
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade           TEXT NOT NULL,              -- P5: grades are strings "6"-"12"
  subject         TEXT NOT NULL,
  chapter         TEXT,
  topic           TEXT NOT NULL,
  challenge_date  DATE NOT NULL,
  base_chain      JSONB NOT NULL,             -- ordered array of {id, text, text_hi, position}
  distractors     JSONB DEFAULT '[]',         -- array of {id, text, text_hi, position: -1}
  explanation     TEXT NOT NULL,
  explanation_hi  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'auto_generated'
                    CHECK (status IN ('auto_generated', 'approved', 'rejected', 'live')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grade, challenge_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_challenges_grade_date
  ON daily_challenges(grade, challenge_date);

CREATE INDEX IF NOT EXISTS idx_daily_challenges_date_status
  ON daily_challenges(challenge_date, status);

-- RLS
ALTER TABLE daily_challenges ENABLE ROW LEVEL SECURITY;

-- All authenticated users can SELECT challenges (challenges are public per grade)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'daily_challenges_authenticated_select' AND tablename = 'daily_challenges'
  ) THEN
    CREATE POLICY "daily_challenges_authenticated_select" ON daily_challenges
      FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- No client INSERT/UPDATE/DELETE — all writes via service role (Edge Functions, API routes).


-- ════════════════════════════════════════════════════════════════════════════
-- 2. challenge_attempts — one attempt per student per challenge
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS challenge_attempts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id             UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  challenge_id           UUID NOT NULL REFERENCES daily_challenges(id),
  solved                 BOOLEAN NOT NULL DEFAULT false,
  moves                  INTEGER DEFAULT 0,
  hints_used             INTEGER DEFAULT 0,
  distractors_excluded   INTEGER DEFAULT 0,
  time_spent_seconds     INTEGER DEFAULT 0,
  coins_earned           INTEGER DEFAULT 0,
  attempted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, challenge_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_challenge_attempts_student_challenge
  ON challenge_attempts(student_id, challenge_id);

CREATE INDEX IF NOT EXISTS idx_challenge_attempts_challenge_solved
  ON challenge_attempts(challenge_id, solved);

-- RLS
ALTER TABLE challenge_attempts ENABLE ROW LEVEL SECURITY;

-- Student reads own attempts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'challenge_attempts_student_select' AND tablename = 'challenge_attempts'
  ) THEN
    CREATE POLICY "challenge_attempts_student_select" ON challenge_attempts
      FOR SELECT USING (
        student_id IN (
          SELECT id FROM students WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Parent reads linked child's attempts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'challenge_attempts_parent_select' AND tablename = 'challenge_attempts'
  ) THEN
    CREATE POLICY "challenge_attempts_parent_select" ON challenge_attempts
      FOR SELECT USING (
        student_id IN (
          SELECT student_id FROM guardian_student_links
          WHERE guardian_id IN (
            SELECT id FROM guardians WHERE auth_user_id = auth.uid()
          )
          AND status = 'approved'
        )
      );
  END IF;
END $$;

-- Teacher reads assigned students' attempts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'challenge_attempts_teacher_select' AND tablename = 'challenge_attempts'
  ) THEN
    CREATE POLICY "challenge_attempts_teacher_select" ON challenge_attempts
      FOR SELECT USING (
        student_id IN (
          SELECT student_id FROM class_students
          WHERE class_id IN (
            SELECT id FROM classes WHERE teacher_id IN (
              SELECT id FROM teachers WHERE auth_user_id = auth.uid()
            )
          )
        )
      );
  END IF;
END $$;

-- No client INSERT/UPDATE — writes via submit_challenge_attempt RPC (service role).


-- ════════════════════════════════════════════════════════════════════════════
-- 3. challenge_streaks — one row per student, tracks consecutive days
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS challenge_streaks (
  student_id             UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  current_streak         INTEGER NOT NULL DEFAULT 0,
  best_streak            INTEGER NOT NULL DEFAULT 0,
  last_challenge_date    DATE,
  mercy_days_used_week   INTEGER DEFAULT 0,
  mercy_week_start       DATE,
  badges                 JSONB DEFAULT '[]',
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE challenge_streaks ENABLE ROW LEVEL SECURITY;

-- Student reads own streak
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'challenge_streaks_student_select' AND tablename = 'challenge_streaks'
  ) THEN
    CREATE POLICY "challenge_streaks_student_select" ON challenge_streaks
      FOR SELECT USING (
        student_id IN (
          SELECT id FROM students WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Parent reads linked child's streak
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'challenge_streaks_parent_select' AND tablename = 'challenge_streaks'
  ) THEN
    CREATE POLICY "challenge_streaks_parent_select" ON challenge_streaks
      FOR SELECT USING (
        student_id IN (
          SELECT student_id FROM guardian_student_links
          WHERE guardian_id IN (
            SELECT id FROM guardians WHERE auth_user_id = auth.uid()
          )
          AND status = 'approved'
        )
      );
  END IF;
END $$;

-- Teacher reads assigned students' streaks
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'challenge_streaks_teacher_select' AND tablename = 'challenge_streaks'
  ) THEN
    CREATE POLICY "challenge_streaks_teacher_select" ON challenge_streaks
      FOR SELECT USING (
        student_id IN (
          SELECT student_id FROM class_students
          WHERE class_id IN (
            SELECT id FROM classes WHERE teacher_id IN (
              SELECT id FROM teachers WHERE auth_user_id = auth.uid()
            )
          )
        )
      );
  END IF;
END $$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_challenge_streaks_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_challenge_streaks_updated_at ON challenge_streaks;
CREATE TRIGGER trg_challenge_streaks_updated_at BEFORE UPDATE ON challenge_streaks
  FOR EACH ROW EXECUTE FUNCTION update_challenge_streaks_updated_at();

-- No client INSERT/UPDATE — writes via submit_challenge_attempt RPC (service role).


-- ════════════════════════════════════════════════════════════════════════════
-- 4. submit_challenge_attempt — RPC for atomic challenge submission
-- ════════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER: must INSERT into challenge_attempts (bypassing RLS),
-- UPSERT challenge_streaks, and call award_coins() — all in a single
-- transaction. Called from server-side API routes only.
CREATE OR REPLACE FUNCTION submit_challenge_attempt(
  p_student_id           UUID,
  p_challenge_id         UUID,
  p_solved               BOOLEAN,
  p_moves                INTEGER,
  p_hints_used           INTEGER,
  p_distractors_excluded INTEGER,
  p_time_spent           INTEGER,
  p_coins_earned         INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt       challenge_attempts%ROWTYPE;
  v_challenge_date DATE;
  v_last_date     DATE;
  v_current_streak INTEGER;
  v_best_streak   INTEGER;
  v_new_balance   INTEGER;
BEGIN
  -- 1. Validate the challenge exists and get its date
  SELECT challenge_date INTO v_challenge_date
  FROM daily_challenges
  WHERE id = p_challenge_id;

  IF v_challenge_date IS NULL THEN
    RAISE EXCEPTION 'Challenge not found: %', p_challenge_id;
  END IF;

  -- 2. Upsert the attempt (ON CONFLICT allows retry/update)
  INSERT INTO challenge_attempts (
    student_id, challenge_id, solved, moves, hints_used,
    distractors_excluded, time_spent_seconds, coins_earned, attempted_at
  )
  VALUES (
    p_student_id, p_challenge_id, p_solved, p_moves, p_hints_used,
    p_distractors_excluded, p_time_spent, p_coins_earned, now()
  )
  ON CONFLICT (student_id, challenge_id) DO UPDATE
  SET solved               = EXCLUDED.solved,
      moves                = EXCLUDED.moves,
      hints_used           = EXCLUDED.hints_used,
      distractors_excluded = EXCLUDED.distractors_excluded,
      time_spent_seconds   = EXCLUDED.time_spent_seconds,
      coins_earned         = EXCLUDED.coins_earned,
      attempted_at         = EXCLUDED.attempted_at
  RETURNING * INTO v_attempt;

  -- 3. If solved, update the streak
  IF p_solved THEN
    -- Get current streak state (if any)
    SELECT last_challenge_date, current_streak, best_streak
    INTO v_last_date, v_current_streak, v_best_streak
    FROM challenge_streaks
    WHERE student_id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
      -- First ever solved challenge: insert new streak row
      INSERT INTO challenge_streaks (
        student_id, current_streak, best_streak, last_challenge_date, updated_at
      )
      VALUES (p_student_id, 1, 1, v_challenge_date, now());
    ELSE
      -- Calculate new streak based on date gap
      IF v_last_date IS NULL OR v_challenge_date > v_last_date THEN
        IF v_last_date IS NOT NULL AND (v_challenge_date - v_last_date) = 1 THEN
          -- Consecutive day: increment
          v_current_streak := v_current_streak + 1;
        ELSIF v_last_date IS NOT NULL AND (v_challenge_date - v_last_date) = 0 THEN
          -- Same day (re-solve): no change to streak count
          NULL;
        ELSE
          -- Gap > 1 day: reset streak to 1
          v_current_streak := 1;
        END IF;

        -- Update best if needed
        IF v_current_streak > v_best_streak THEN
          v_best_streak := v_current_streak;
        END IF;

        UPDATE challenge_streaks
        SET current_streak      = v_current_streak,
            best_streak         = v_best_streak,
            last_challenge_date = v_challenge_date,
            updated_at          = now()
        WHERE student_id = p_student_id;
      END IF;
      -- If v_challenge_date <= v_last_date (solving an older challenge), do not change streak
    END IF;
  END IF;

  -- 4. If solved and coins > 0, award coins via the existing award_coins RPC
  v_new_balance := NULL;
  IF p_solved AND p_coins_earned > 0 THEN
    v_new_balance := award_coins(
      p_student_id,
      p_coins_earned,
      'daily_challenge',
      jsonb_build_object(
        'challenge_id', p_challenge_id,
        'challenge_date', v_challenge_date,
        'moves', p_moves,
        'hints_used', p_hints_used,
        'time_spent', p_time_spent
      )
    );
  END IF;

  -- 5. Return the attempt row as JSONB
  RETURN jsonb_build_object(
    'attempt_id',           v_attempt.id,
    'student_id',           v_attempt.student_id,
    'challenge_id',         v_attempt.challenge_id,
    'solved',               v_attempt.solved,
    'moves',                v_attempt.moves,
    'hints_used',           v_attempt.hints_used,
    'distractors_excluded', v_attempt.distractors_excluded,
    'time_spent_seconds',   v_attempt.time_spent_seconds,
    'coins_earned',         v_attempt.coins_earned,
    'attempted_at',         v_attempt.attempted_at,
    'new_coin_balance',     v_new_balance
  );
END;
$$;
