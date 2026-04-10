-- Migration: 20260405300000_xp_transaction_ledger.sql
-- Purpose: Create XP transaction ledger as single source of truth for all XP
--          awards/redemptions, with daily cap enforcement and reconciliation.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. XP Transaction Ledger table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS xp_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,  -- can be negative for redemptions
  source          TEXT NOT NULL CHECK (source IN (
    'quiz_correct', 'quiz_high_score', 'quiz_perfect',
    'foxy_chat', 'foxy_lesson_complete',
    'streak_daily', 'streak_milestone',
    'topic_mastered', 'chapter_complete',
    'study_task', 'study_week',
    'challenge_win', 'competition_prize',
    'first_quiz_of_day',
    'redemption',         -- negative amount for spending XP
    'admin_adjustment'    -- manual corrections
  )),
  subject         TEXT,              -- NULL for non-subject XP (streaks, etc.)
  metadata        JSONB DEFAULT '{}',-- quiz_id, session_id, task_id, etc.
  daily_category  TEXT,              -- for daily cap tracking: 'quiz', 'chat', 'streak', 'study'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Indexes for fast lookups
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_xp_txn_student
  ON xp_transactions(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xp_txn_daily
  ON xp_transactions(student_id, daily_category, created_at)
  WHERE daily_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_xp_txn_source
  ON xp_transactions(student_id, source);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. RLS — students read own, parents read linked, teachers read assigned
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE xp_transactions ENABLE ROW LEVEL SECURITY;

-- Student reads own transactions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'xp_txn_student_select' AND tablename = 'xp_transactions'
  ) THEN
    CREATE POLICY "xp_txn_student_select" ON xp_transactions
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
    SELECT 1 FROM pg_policies WHERE policyname = 'xp_txn_parent_select' AND tablename = 'xp_transactions'
  ) THEN
    CREATE POLICY "xp_txn_parent_select" ON xp_transactions
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
    SELECT 1 FROM pg_policies WHERE policyname = 'xp_txn_teacher_select' AND tablename = 'xp_transactions'
  ) THEN
    CREATE POLICY "xp_txn_teacher_select" ON xp_transactions
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

-- Server-side insert only (via RPCs using SECURITY DEFINER)
-- No direct client INSERT policy — inserts happen through award_xp() RPC
-- which runs as SECURITY DEFINER. This prevents clients from fabricating XP.

-- ════════════════════════════════════════════════════════════════════════════
-- 4. get_daily_xp_by_category — returns today's XP totals per category
-- ════════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER: called by award_xp() which itself is DEFINER;
-- also useful for server-side cap checks without requiring caller to own rows.
CREATE OR REPLACE FUNCTION get_daily_xp_by_category(
  p_student_id UUID,
  p_category   TEXT DEFAULT NULL
)
RETURNS TABLE(category TEXT, total_today INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.daily_category,
    COALESCE(SUM(t.amount), 0)::INTEGER
  FROM xp_transactions t
  WHERE t.student_id = p_student_id
    AND t.created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')
    AND (p_category IS NULL OR t.daily_category = p_category)
  GROUP BY t.daily_category;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. award_xp — insert XP with daily cap enforcement, update running totals
-- ════════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER: must INSERT into xp_transactions and UPDATE students +
-- student_learning_profiles regardless of caller's RLS context. Only called
-- from server-side code (API routes, Edge Functions, other RPCs).
CREATE OR REPLACE FUNCTION award_xp(
  p_student_id     UUID,
  p_amount         INTEGER,
  p_source         TEXT,
  p_subject        TEXT DEFAULT NULL,
  p_daily_category TEXT DEFAULT NULL,
  p_daily_cap      INTEGER DEFAULT NULL,
  p_metadata       JSONB DEFAULT '{}'
)
RETURNS TABLE(awarded INTEGER, new_total INTEGER, capped BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_total  INTEGER := 0;
  v_actual_award INTEGER;
  v_new_total    INTEGER;
BEGIN
  -- Validate amount is positive (use 'redemption' source for negative)
  IF p_source <> 'redemption' AND p_source <> 'admin_adjustment' AND p_amount < 0 THEN
    RAISE EXCEPTION 'Negative amount only allowed for redemption or admin_adjustment source';
  END IF;

  -- Check daily cap if applicable
  IF p_daily_category IS NOT NULL AND p_daily_cap IS NOT NULL THEN
    SELECT COALESCE(SUM(xt.amount), 0) INTO v_today_total
    FROM xp_transactions xt
    WHERE xt.student_id = p_student_id
      AND xt.daily_category = p_daily_category
      AND xt.created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata');

    IF v_today_total >= p_daily_cap THEN
      -- Cap reached, award nothing
      SELECT COALESCE(s.xp_total, 0) INTO v_new_total
      FROM students s WHERE s.id = p_student_id;
      RETURN QUERY SELECT 0, COALESCE(v_new_total, 0), TRUE;
      RETURN;
    END IF;

    -- Partial award if near cap
    v_actual_award := LEAST(p_amount, p_daily_cap - v_today_total);
  ELSE
    v_actual_award := p_amount;
  END IF;

  -- Skip if nothing to award
  IF v_actual_award = 0 THEN
    SELECT COALESCE(s.xp_total, 0) INTO v_new_total
    FROM students s WHERE s.id = p_student_id;
    RETURN QUERY SELECT 0, COALESCE(v_new_total, 0), FALSE;
    RETURN;
  END IF;

  -- Insert transaction record
  INSERT INTO xp_transactions (student_id, amount, source, subject, daily_category, metadata)
  VALUES (p_student_id, v_actual_award, p_source, p_subject, p_daily_category, p_metadata);

  -- Update running total on students table (for fast reads / leaderboard)
  UPDATE students
  SET xp_total = COALESCE(xp_total, 0) + v_actual_award,
      last_active = now()
  WHERE id = p_student_id
  RETURNING xp_total INTO v_new_total;

  -- Also update subject-specific XP if subject provided
  IF p_subject IS NOT NULL THEN
    UPDATE student_learning_profiles
    SET xp = COALESCE(xp, 0) + v_actual_award
    WHERE student_id = p_student_id AND subject = p_subject;
  END IF;

  RETURN QUERY SELECT v_actual_award, COALESCE(v_new_total, 0), (v_actual_award < p_amount);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. reconcile_xp — recalculate total from ledger (admin/cron use)
-- ════════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER: must read all xp_transactions for a student and update
-- students.xp_total regardless of caller's RLS context. Used by admin
-- reconciliation jobs and the daily-cron Edge Function.
CREATE OR REPLACE FUNCTION reconcile_xp(p_student_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_correct_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_correct_total
  FROM xp_transactions
  WHERE student_id = p_student_id;

  UPDATE students
  SET xp_total = v_correct_total
  WHERE id = p_student_id;

  -- Also reconcile per-subject XP
  UPDATE student_learning_profiles slp
  SET xp = sub.subject_xp
  FROM (
    SELECT xt.subject, COALESCE(SUM(xt.amount), 0)::INTEGER AS subject_xp
    FROM xp_transactions xt
    WHERE xt.student_id = p_student_id
      AND xt.subject IS NOT NULL
    GROUP BY xt.subject
  ) sub
  WHERE slp.student_id = p_student_id
    AND slp.subject = sub.subject;

  RETURN v_correct_total;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Backward compatibility — update existing add_xp to use the ledger
-- ════════════════════════════════════════════════════════════════════════════

-- The existing add_xp(UUID, INT, TEXT) is called by the mobile app.
-- Replace it to route through the ledger while keeping the same signature.
CREATE OR REPLACE FUNCTION add_xp(
  p_student_id UUID,
  p_amount     INT,
  p_source     TEXT DEFAULT 'unknown'
)
RETURNS VOID AS $$
DECLARE
  _awarded  INTEGER;
  _total    INTEGER;
  _capped   BOOLEAN;
BEGIN
  -- Route through award_xp to record in ledger
  SELECT a.awarded, a.new_total, a.capped
  INTO _awarded, _total, _capped
  FROM award_xp(
    p_student_id  := p_student_id,
    p_amount      := p_amount,
    p_source      := CASE
                       WHEN p_source = 'unknown' THEN 'admin_adjustment'
                       WHEN p_source IN (
                         'quiz_correct', 'quiz_high_score', 'quiz_perfect',
                         'foxy_chat', 'foxy_lesson_complete',
                         'streak_daily', 'streak_milestone',
                         'topic_mastered', 'chapter_complete',
                         'study_task', 'study_week',
                         'challenge_win', 'competition_prize',
                         'first_quiz_of_day', 'redemption', 'admin_adjustment'
                       ) THEN p_source
                       ELSE 'admin_adjustment'  -- fallback for unrecognized sources
                     END,
    p_metadata    := jsonb_build_object('legacy_source', p_source)
  ) a;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURITY DEFINER: delegates to award_xp which needs cross-table writes;
-- maintains backward compatibility with existing mobile app calls.
