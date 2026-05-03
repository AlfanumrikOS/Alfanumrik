-- Migration: 20260416000001_performance_score_system.sql
-- Purpose: Create Performance Score system tables (performance_scores, score_history,
--          coin_transactions, coin_balances) and award_coins RPC. Replaces the old
--          inflationary XP system with a bounded 0-100 performance score per subject
--          plus a separate Foxy Coins economy.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. performance_scores — current per-subject scores (0-100 scale)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS performance_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject               TEXT NOT NULL,
  overall_score         NUMERIC(5,2) NOT NULL DEFAULT 0
                          CHECK (overall_score >= 0 AND overall_score <= 100),
  performance_component NUMERIC(5,2) NOT NULL DEFAULT 0
                          CHECK (performance_component >= 0 AND performance_component <= 100),
  behavior_component    NUMERIC(5,2) NOT NULL DEFAULT 0
                          CHECK (behavior_component >= 0 AND behavior_component <= 100),
  consistency_score     NUMERIC(5,2) DEFAULT 0
                          CHECK (consistency_score >= 0 AND consistency_score <= 100),
  challenge_score       NUMERIC(5,2) DEFAULT 0
                          CHECK (challenge_score >= 0 AND challenge_score <= 100),
  revision_score        NUMERIC(5,2) DEFAULT 0
                          CHECK (revision_score >= 0 AND revision_score <= 100),
  persistence_score     NUMERIC(5,2) DEFAULT 0
                          CHECK (persistence_score >= 0 AND persistence_score <= 100),
  breadth_score         NUMERIC(5,2) DEFAULT 0
                          CHECK (breadth_score >= 0 AND breadth_score <= 100),
  velocity_score        NUMERIC(5,2) DEFAULT 0
                          CHECK (velocity_score >= 0 AND velocity_score <= 100),
  level_name            TEXT DEFAULT 'Curious Cub',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_perf_scores_student
  ON performance_scores(student_id);

CREATE INDEX IF NOT EXISTS idx_perf_scores_student_subject
  ON performance_scores(student_id, subject);

-- RLS
ALTER TABLE performance_scores ENABLE ROW LEVEL SECURITY;

-- Student reads own scores
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'perf_scores_student_select' AND tablename = 'performance_scores'
  ) THEN
    CREATE POLICY "perf_scores_student_select" ON performance_scores
      FOR SELECT USING (
        student_id IN (
          SELECT id FROM students WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Parent reads linked child's scores
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'perf_scores_parent_select' AND tablename = 'performance_scores'
  ) THEN
    CREATE POLICY "perf_scores_parent_select" ON performance_scores
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

-- Teacher reads assigned students' scores
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'perf_scores_teacher_select' AND tablename = 'performance_scores'
  ) THEN
    CREATE POLICY "perf_scores_teacher_select" ON performance_scores
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

-- No direct client INSERT/UPDATE — scores are recalculated by server-side
-- RPCs and the daily-cron Edge Function using service role (bypasses RLS).

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_performance_scores_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_performance_scores_updated_at ON performance_scores;
CREATE TRIGGER trg_performance_scores_updated_at BEFORE UPDATE ON performance_scores
  FOR EACH ROW EXECUTE FUNCTION update_performance_scores_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 2. score_history — daily snapshots for trend tracking
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS score_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject               TEXT NOT NULL,
  score                 NUMERIC(5,2) NOT NULL
                          CHECK (score >= 0 AND score <= 100),
  performance_component NUMERIC(5,2)
                          CHECK (performance_component IS NULL OR (performance_component >= 0 AND performance_component <= 100)),
  behavior_component    NUMERIC(5,2)
                          CHECK (behavior_component IS NULL OR (behavior_component >= 0 AND behavior_component <= 100)),
  recorded_at           DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (student_id, subject, recorded_at)
);

-- Index for querying trends: "show me score history for subject X, most recent first"
CREATE INDEX IF NOT EXISTS idx_score_history_student_subject_date
  ON score_history(student_id, subject, recorded_at DESC);

-- RLS
ALTER TABLE score_history ENABLE ROW LEVEL SECURITY;

-- Student reads own history
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'score_history_student_select' AND tablename = 'score_history'
  ) THEN
    CREATE POLICY "score_history_student_select" ON score_history
      FOR SELECT USING (
        student_id IN (
          SELECT id FROM students WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Parent reads linked child's history
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'score_history_parent_select' AND tablename = 'score_history'
  ) THEN
    CREATE POLICY "score_history_parent_select" ON score_history
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

-- Teacher reads assigned students' history
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'score_history_teacher_select' AND tablename = 'score_history'
  ) THEN
    CREATE POLICY "score_history_teacher_select" ON score_history
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

-- No direct client INSERT — snapshots written by daily-cron via service role.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. coin_transactions — ledger for Foxy Coins
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS coin_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,  -- positive for awards, negative for redemptions
  source      TEXT NOT NULL CHECK (source IN (
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
    'admin_adjustment'
  )),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_coin_txn_student_created
  ON coin_transactions(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coin_txn_student_source
  ON coin_transactions(student_id, source);

-- RLS
ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;

-- Student reads own transactions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'coin_txn_student_select' AND tablename = 'coin_transactions'
  ) THEN
    CREATE POLICY "coin_txn_student_select" ON coin_transactions
      FOR SELECT USING (
        student_id IN (
          SELECT id FROM students WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Parent reads linked child's transactions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'coin_txn_parent_select' AND tablename = 'coin_transactions'
  ) THEN
    CREATE POLICY "coin_txn_parent_select" ON coin_transactions
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

-- Teacher reads assigned students' transactions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'coin_txn_teacher_select' AND tablename = 'coin_transactions'
  ) THEN
    CREATE POLICY "coin_txn_teacher_select" ON coin_transactions
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

-- No direct client INSERT — coins awarded via award_coins() RPC using service role.


-- ════════════════════════════════════════════════════════════════════════════
-- 4. coin_balances — materialized balance for fast reads
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS coin_balances (
  student_id  UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  balance     INTEGER NOT NULL DEFAULT 0
                CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE coin_balances ENABLE ROW LEVEL SECURITY;

-- Student reads own balance
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'coin_bal_student_select' AND tablename = 'coin_balances'
  ) THEN
    CREATE POLICY "coin_bal_student_select" ON coin_balances
      FOR SELECT USING (
        student_id IN (
          SELECT id FROM students WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Parent reads linked child's balance
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'coin_bal_parent_select' AND tablename = 'coin_balances'
  ) THEN
    CREATE POLICY "coin_bal_parent_select" ON coin_balances
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

-- Teacher reads assigned students' balance
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'coin_bal_teacher_select' AND tablename = 'coin_balances'
  ) THEN
    CREATE POLICY "coin_bal_teacher_select" ON coin_balances
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
CREATE OR REPLACE FUNCTION update_coin_balances_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coin_balances_updated_at ON coin_balances;
CREATE TRIGGER trg_coin_balances_updated_at BEFORE UPDATE ON coin_balances
  FOR EACH ROW EXECUTE FUNCTION update_coin_balances_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 5. award_coins — RPC to atomically award/redeem Foxy Coins
-- ════════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER: must INSERT into coin_transactions and UPSERT into
-- coin_balances regardless of caller's RLS context. Called from server-side
-- code (API routes, Edge Functions, daily-cron).
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
    'score_milestone', 'redemption', 'xp_migration', 'admin_adjustment'
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
