-- PRODUCTION SCHEMA RECONCILIATION - 2026-04-27 (rev 2)
-- Project: shktyoxqhundlvkiwguu
-- Patches: teacher_id->class_teachers junction, defensive EXCEPTION handlers
-- Backup: 2026-04-27T02:23:40Z physical snapshot

SELECT (SELECT to_regclass('public.xp_transactions') IS NOT NULL) AS pre_xp_tx, (SELECT to_regclass('public.misconceptions') IS NOT NULL) AS pre_misc, (SELECT to_regclass('public.student_skill_state') IS NOT NULL) AS pre_skill_state, (SELECT to_regprocedure('public.atomic_quiz_profile_update(uuid,text,int,int,int,int,uuid)')::text) AS pre_7arg;


-- =====================================================
-- MIGRATION: 20260405300000_xp_transaction_ledger
-- =====================================================
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
EXCEPTION
  WHEN undefined_table  THEN RAISE NOTICE 'reconciliation: undefined table - skipped';
  WHEN undefined_column THEN RAISE NOTICE 'reconciliation: undefined column - skipped';
  WHEN duplicate_object THEN NULL;
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
EXCEPTION
  WHEN undefined_table  THEN RAISE NOTICE 'reconciliation: undefined table - skipped';
  WHEN undefined_column THEN RAISE NOTICE 'reconciliation: undefined column - skipped';
  WHEN duplicate_object THEN NULL;
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
            SELECT ct.class_id FROM class_teachers ct JOIN teachers t ON t.id = ct.teacher_id WHERE t.auth_user_id = auth.uid() AND ct.is_active = true
          )
        )
      );
  END IF;
EXCEPTION
  WHEN undefined_table  THEN RAISE NOTICE 'reconciliation: undefined table - skipped';
  WHEN undefined_column THEN RAISE NOTICE 'reconciliation: undefined column - skipped';
  WHEN duplicate_object THEN NULL;
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



-- =====================================================
-- MIGRATION: 20260408000004_link_quiz_xp_to_ledger
-- =====================================================
-- Migration: 20260408000004_link_quiz_xp_to_ledger.sql
-- Purpose: Close the HIGH-RISK gap where atomic_quiz_profile_update() writes
--          students.xp_total directly but never writes to xp_transactions.
--          This migration wires atomic_quiz_profile_update to the xp_transactions
--          ledger, enabling:
--            1. Full XP audit trail in xp_transactions for all quiz awards
--            2. Server-side daily 200 XP quiz cap enforcement (P2 invariant)
--            3. Safe reconcile_xp() runs without zeroing quiz XP
--            4. Idempotent re-submission guard via reference_id unique index
--
-- Depends on: 20260405300000_xp_transaction_ledger.sql (award_xp, xp_transactions)
-- Calling convention of submit_quiz_results: UNCHANGED
-- Calling convention of atomic_quiz_profile_update: extended with optional 7th
--   param p_session_id UUID DEFAULT NULL — all existing 6-arg callers unaffected.

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Pre-flight guard — fail fast if the ledger migration has not been applied
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'award_xp'
      AND pronargs = 7
  ) THEN
    RAISE EXCEPTION
      'MIGRATION BLOCKED: award_xp(UUID,INT,TEXT,TEXT,TEXT,INT,JSONB) not found. '
      'Migration 20260405300000_xp_transaction_ledger.sql must be applied first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'xp_transactions'
  ) THEN
    RAISE EXCEPTION
      'MIGRATION BLOCKED: table xp_transactions not found. '
      'Migration 20260405300000_xp_transaction_ledger.sql must be applied first.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Add 'quiz' to the xp_transactions source CHECK constraint
--
--    'quiz' is the session-level composite source written by
--    atomic_quiz_profile_update. The granular sources ('quiz_correct',
--    'quiz_high_score', 'quiz_perfect') are retained for future per-component
--    ledger entries.
--
--    Pattern: drop-and-recreate is idempotent when wrapped in DO $$.
--    The DROP uses IF EXISTS so a re-run after partial failure is safe.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER TABLE xp_transactions
    DROP CONSTRAINT IF EXISTS xp_transactions_source_check;

  ALTER TABLE xp_transactions
    ADD CONSTRAINT xp_transactions_source_check
    CHECK (source IN (
      'quiz',                   -- session-level composite (added here)
      'quiz_correct', 'quiz_high_score', 'quiz_perfect',
      'foxy_chat', 'foxy_lesson_complete',
      'streak_daily', 'streak_milestone',
      'topic_mastered', 'chapter_complete',
      'study_task', 'study_week',
      'challenge_win', 'competition_prize',
      'first_quiz_of_day',
      'redemption',
      'admin_adjustment'
    ));
EXCEPTION
  WHEN undefined_table  THEN RAISE NOTICE 'reconciliation: undefined table - skipped';
  WHEN undefined_column THEN RAISE NOTICE 'reconciliation: undefined column - skipped';
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Add reference_id column for deduplication / idempotency
--
--    Stores 'quiz_<session_id>' so a re-submitted session cannot double-award
--    XP even if submit_quiz_results is called twice with the same session.
--    Nullable: non-quiz sources written by award_xp() don't supply a reference.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE xp_transactions
  ADD COLUMN IF NOT EXISTS reference_id TEXT DEFAULT NULL;

-- Unique partial index: enforces uniqueness only where reference_id IS NOT NULL.
-- Existing NULL rows are unaffected; new quiz rows are idempotent via
-- INSERT ... ON CONFLICT (reference_id) DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_txn_reference_id
  ON xp_transactions(reference_id)
  WHERE reference_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Replace atomic_quiz_profile_update (canonical 6/7-param version)
--
--    Changes from 20260325160000_atomic_quiz_profile_update.sql:
--
--    a. New optional 7th parameter: p_session_id UUID DEFAULT NULL
--       Backward compatible — all existing 6-arg PERFORM callers unchanged.
--
--    b. P2 daily cap enforced BEFORE any award:
--       SUM xp_transactions WHERE daily_category='quiz' AND today (IST).
--       Cap v_xp_to_award = MAX(0, MIN(p_xp, 200 - today_total)).
--
--    c. Ledger write path (two cases):
--       CASE A — p_session_id supplied: INSERT directly into xp_transactions
--         with reference_id = 'quiz_' || session_id and
--         ON CONFLICT (reference_id) DO NOTHING for strict idempotency.
--         Then UPDATE students.xp_total and student_learning_profiles.xp
--         directly (same as before) only when the INSERT changed a row.
--       CASE B — p_session_id NULL (legacy 4-param callers): delegate to
--         award_xp() which writes the ledger row without a reference_id.
--
--    Rationale for two-path approach vs. always using award_xp():
--       award_xp() does not return the inserted row's id, so backfilling
--       reference_id after the fact requires a fragile time-window UPDATE.
--       Inserting directly with ON CONFLICT is safe, deterministic, and
--       keeps the function atomic within a single plpgsql BEGIN...END block.
--
--    d. student_learning_profiles UPSERT: XP column incremented only on the
--       first INSERT (new profile). On UPDATE the XP increment is omitted from
--       the SET clause — award_xp (CASE B) or the direct UPDATE below (CASE A)
--       already handles it to avoid double-counting.
--       Level recalculation uses the post-award total read from students.
--
--    e. streak_days UPDATE on students is preserved verbatim. award_xp sets
--       last_active = now() but does not compute streaks.
--
--    Preserved invariants:
--      P1  — score formula lives in submit_quiz_results; not touched here
--      P2  — daily 200 XP quiz cap now enforced server-side (NEW)
--      P3  — anti-cheat lives in submit_quiz_results; not touched here
--      P4  — all writes within a single plpgsql transaction block
--      P8  — SECURITY DEFINER justified below
--
-- SECURITY DEFINER: must INSERT into xp_transactions (no direct-client INSERT
-- policy — clients cannot fabricate XP), UPDATE students.xp_total, and upsert
-- student_learning_profiles regardless of the caller's RLS context. This
-- function is only invoked from submit_quiz_results (itself SECURITY DEFINER)
-- or server-side API routes; it is never called directly from client code.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION atomic_quiz_profile_update(
  p_student_id    UUID,
  p_subject       TEXT,
  p_xp            INT,
  p_total         INT,
  p_correct       INT,
  p_time_seconds  INT,
  p_session_id    UUID DEFAULT NULL  -- optional; used as dedup reference_id
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_time_minutes    INT     := GREATEST(1, ROUND(p_time_seconds / 60.0));
  v_today_quiz_xp   INTEGER := 0;
  v_xp_to_award     INTEGER := 0;
  v_reference_id    TEXT    := NULL;
  v_rows_inserted   INTEGER := 0;
  v_subject_clean   TEXT;
BEGIN
  -- ── Normalise subject ──────────────────────────────────────────────────────
  v_subject_clean := CASE WHEN p_subject IS NULL OR p_subject = 'unknown'
                          THEN NULL ELSE p_subject END;

  -- ── Step 1: Compute today's already-awarded quiz XP (IST date boundary) ───
  -- P2: daily quiz XP cap = 200. Uses the ledger as the authoritative source.
  SELECT COALESCE(SUM(amount), 0)
    INTO v_today_quiz_xp
  FROM xp_transactions
  WHERE student_id    = p_student_id
    AND daily_category = 'quiz'
    AND created_at    >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata');

  -- Cap the award so total daily quiz XP never exceeds 200.
  -- If p_xp is 0 (flagged submission) or cap already reached, v_xp_to_award = 0.
  v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp));

  -- ── Step 2: Build reference_id for CASE A idempotency ────────────────────
  IF p_session_id IS NOT NULL THEN
    v_reference_id := 'quiz_' || p_session_id::TEXT;
  END IF;

  -- ── Step 3: Write ledger row and update XP totals ────────────────────────
  IF v_xp_to_award > 0 THEN

    IF v_reference_id IS NOT NULL THEN
      -- CASE A: session_id known — use direct INSERT with ON CONFLICT for strict
      -- idempotency. The unique partial index on reference_id guarantees that a
      -- re-submitted session is silently ignored.
      INSERT INTO xp_transactions (
        student_id, amount, source, subject,
        daily_category, reference_id, metadata, created_at
      ) VALUES (
        p_student_id,
        v_xp_to_award,
        'quiz',
        v_subject_clean,
        'quiz',
        v_reference_id,
        jsonb_build_object(
          'session_id',   p_session_id,
          'total_q',      p_total,
          'correct_q',    p_correct,
          'time_seconds', p_time_seconds,
          'original_xp',  p_xp           -- amount before daily cap
        ),
        NOW()
      )
      ON CONFLICT (reference_id) DO NOTHING;

      GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

      -- Only increment students.xp_total when a new ledger row was actually
      -- inserted (i.e. this is not a re-submission).
      IF v_rows_inserted > 0 THEN
        UPDATE students SET
          xp_total    = COALESCE(xp_total, 0) + v_xp_to_award,
          last_active = NOW()
        WHERE id = p_student_id;

        -- Increment subject-specific XP in learning profiles if subject known.
        IF v_subject_clean IS NOT NULL THEN
          UPDATE student_learning_profiles SET
            xp = COALESCE(xp, 0) + v_xp_to_award
          WHERE student_id = p_student_id
            AND subject    = v_subject_clean;
        END IF;
      END IF;

    ELSE
      -- CASE B: no session_id (legacy 4-param callers) — delegate to award_xp.
      -- award_xp writes the ledger row and updates students.xp_total and
      -- student_learning_profiles.xp. We pass p_daily_cap = NULL because the
      -- cap has already been applied above (v_xp_to_award is already capped).
      PERFORM award_xp(
        p_student_id     := p_student_id,
        p_amount         := v_xp_to_award,
        p_source         := 'quiz',
        p_subject        := v_subject_clean,
        p_daily_category := 'quiz',
        p_daily_cap      := NULL,
        p_metadata       := jsonb_build_object(
                              'total_q',      p_total,
                              'correct_q',    p_correct,
                              'time_seconds', p_time_seconds,
                              'original_xp',  p_xp
                            )
      );
      -- award_xp sets last_active = now() on students, so the streak UPDATE
      -- below will read the correct last_active value.
    END IF;

  END IF;
  -- v_xp_to_award = 0: ledger and students.xp_total intentionally untouched.

  -- ── Step 4: Upsert student_learning_profiles for session counters ─────────
  -- XP column:
  --   On first INSERT — set to v_xp_to_award (the capped amount).
  --   On UPDATE — XP is NOT incremented here; Steps 3A/3B already handled it.
  -- Level recalculation reads the XP value already in the row plus what we
  -- just added, using EXCLUDED.xp to reference the first-insert value safely.
  INSERT INTO student_learning_profiles (
    student_id,
    subject,
    xp,
    total_sessions,
    total_questions_asked,
    total_questions_answered_correctly,
    total_time_minutes,
    last_session_at,
    streak_days,
    level,
    current_level
  ) VALUES (
    p_student_id,
    COALESCE(v_subject_clean, 'general'),
    v_xp_to_award,
    1,
    p_total,
    p_correct,
    v_time_minutes,
    NOW(),
    1,
    1,
    'beginner'
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    total_sessions                     = student_learning_profiles.total_sessions + 1,
    total_questions_asked              = student_learning_profiles.total_questions_asked + p_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + p_correct,
    total_time_minutes                 = student_learning_profiles.total_time_minutes + v_time_minutes,
    last_session_at                    = NOW(),
    -- Level uses the already-updated xp column (Step 3 incremented it before
    -- this upsert runs). FLOOR division by 500 matches the original formula.
    level = GREATEST(1, FLOOR(student_learning_profiles.xp / 500.0) + 1);

  -- ── Step 5: Update streak_days on students ────────────────────────────────
  -- award_xp/direct UPDATE above set last_active = NOW() but do not compute
  -- streaks. We read the pre-NOW() last_active via a CASE on last_active::date.
  -- This UPDATE also sets last_active so it is always refreshed.
  UPDATE students SET
    last_active = NOW(),
    streak_days = CASE
      WHEN last_active::date = CURRENT_DATE     THEN COALESCE(streak_days, 1)
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

END;
$$;

COMMENT ON FUNCTION atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT, UUID) IS
  'Atomically records a quiz session: enforces the P2 daily 200 XP quiz cap '
  '(200 XP/day from daily_category=''quiz'' in xp_transactions), writes the '
  'ledger row, updates students.xp_total, upserts session counters in '
  'student_learning_profiles, and updates streak_days. '
  'The optional 7th parameter p_session_id (DEFAULT NULL) supplies a dedup key '
  '(reference_id = ''quiz_'' || session_id); ON CONFLICT DO NOTHING prevents '
  'double-award on re-submission. When p_session_id is NULL (legacy callers), '
  'delegates ledger write to award_xp(). '
  'SECURITY DEFINER: writes to xp_transactions (no client INSERT policy), '
  'students, and student_learning_profiles across RLS boundaries. '
  'Ledger wiring + daily cap added in migration 20260408000004.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Replace 4-param overload (backward compatibility for legacy callers)
--
--    Origin: 20260329210000_fix_rpc_signatures_and_add_xp.sql created this
--    overload for older functions that call atomic_quiz_profile_update with
--    only 4 positional arguments (student_id, xp, correct, total).
--    Delegates unchanged to the 7-param version with safe defaults.
--
-- SECURITY DEFINER: delegates to a SECURITY DEFINER function; cross-table
-- writes still require elevated privileges from the delegation chain.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION atomic_quiz_profile_update(
  p_student_id UUID,
  p_xp         INT,
  p_correct    INT,
  p_total      INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM atomic_quiz_profile_update(
    p_student_id,
    'unknown'::TEXT,  -- p_subject  → normalised to NULL inside 7-param version
    p_xp,
    p_total,
    p_correct,
    0,                -- p_time_seconds
    NULL::UUID        -- p_session_id → CASE B path (no dedup reference_id)
  );
END;
$$;

COMMENT ON FUNCTION atomic_quiz_profile_update(UUID, INT, INT, INT) IS
  'Backward-compatible 4-param overload. Delegates to the canonical 7-param '
  'version with p_subject=''unknown'', p_time_seconds=0, p_session_id=NULL. '
  'p_session_id=NULL triggers the award_xp() delegation path (no reference_id). '
  'SECURITY DEFINER: delegates to a SECURITY DEFINER function.';

-- End of migration: 20260408000004_link_quiz_xp_to_ledger.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Tables altered:
--   xp_transactions — CHECK constraint updated (added 'quiz' source value)
--   xp_transactions — reference_id TEXT column added (nullable, DEFAULT NULL)
-- Indexes created:
--   idx_xp_txn_reference_id  UNIQUE partial ON xp_transactions(reference_id)
--                             WHERE reference_id IS NOT NULL
-- Functions replaced:
--   atomic_quiz_profile_update(UUID,TEXT,INT,INT,INT,INT,UUID) — 7-param canonical
--   atomic_quiz_profile_update(UUID,INT,INT,INT)               — 4-param overload
-- ─────────────────────────────────────────────────────────────────────────────
-- Review chain notifications required (P14):
--   - mobile   : xp_transactions schema changed (reference_id column added);
--                students.xp_total write path changed. Verify mobile XP models.
--   - testing  : new daily-cap logic and dedup path need unit + integration tests.
--   - backend  : award_xp() delegation path unchanged; no API route changes needed.
--   - assessment: P2 daily cap is now enforced server-side; quiz XP values
--                 unchanged. Verify regression catalog covers cap boundary tests.



-- =====================================================
-- MIGRATION: 20260425120000_domain_events_outbox
-- =====================================================
-- Migration: 20260425120000_domain_events_outbox.sql
-- Phase 0d.1: outbox pattern foundation
-- Per docs/architecture/EVENT_CATALOG.md and MIGRATION_AND_ROLLBACK_PLAN.md
-- Owner: B12/B13 (analytics + ops read; service-role writes via enqueue_event)
--
-- Purpose:
--   Establish the `public.domain_events` outbox table that all bounded
--   contexts will use to publish cross-context domain events. Producers
--   call `enqueue_event(...)` inside the same transaction as the source
--   state change. A future polling worker (Phase 0d.2/0d.3, repurposing
--   the existing `queue-consumer` Edge Function) will dispatch events to
--   consumers and mark them processed.
--
-- Scope of this phase:
--   - Migration-only. No callers of `enqueue_event` are added here.
--   - No Edge Function or queue-consumer wiring. That is Phase 0d.2/0d.3.
--   - No schema changes to existing tables.
--
-- Safety:
--   - Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--     CREATE OR REPLACE FUNCTION.
--   - RLS enabled with no permissive policies — only the service role
--     (which bypasses RLS) can read/write directly. Application code
--     publishes via the SECURITY DEFINER `enqueue_event` RPC.
--   - SECURITY DEFINER functions follow the project convention of
--     `SET search_path = public` (per migration 20260408000009 to
--     guard against search_path injection).
--   - Aggregate-and-status indexes support the planned polling worker
--     query patterns without full scans.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. domain_events table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.domain_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,           -- e.g. 'content.request_submitted', 'quiz.completed'
  aggregate_type  text NOT NULL,           -- e.g. 'content_request', 'quiz_session'
  aggregate_id    uuid,                    -- nullable: some events are not tied to a single aggregate
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','processed','failed','dead_letter')),
  retry_count     integer NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  CONSTRAINT domain_events_event_type_format CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$')
);

COMMENT ON TABLE public.domain_events IS
  'Outbox table for cross-context domain events. Producers insert via enqueue_event RPC inside the source transaction; a polling worker dispatches to consumers. See docs/architecture/EVENT_CATALOG.md.';

COMMENT ON COLUMN public.domain_events.event_type IS
  'Dotted lower_snake event name, e.g. quiz.completed (matches ^[a-z_]+\.[a-z_]+$).';
COMMENT ON COLUMN public.domain_events.aggregate_type IS
  'The bounded-context aggregate this event belongs to (e.g. quiz_session, content_request).';
COMMENT ON COLUMN public.domain_events.aggregate_id IS
  'Optional aggregate primary key; null for events not tied to a single row.';
COMMENT ON COLUMN public.domain_events.status IS
  'Lifecycle: pending -> processing -> processed | failed -> dead_letter (after max retries).';

-- ────────────────────────────────────────────────────────────
-- 2. Indexes
-- ────────────────────────────────────────────────────────────
-- Polling-worker hot path: oldest pending events first.
CREATE INDEX IF NOT EXISTS idx_domain_events_pending
  ON public.domain_events (created_at)
  WHERE status = 'pending';

-- Recent events by type (for ops/analytics queries).
CREATE INDEX IF NOT EXISTS idx_domain_events_event_type
  ON public.domain_events (event_type, created_at DESC);

-- Lookups by aggregate (debugging, replay, audit).
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate
  ON public.domain_events (aggregate_type, aggregate_id);

-- ────────────────────────────────────────────────────────────
-- 3. RLS — service-role-only access
-- ────────────────────────────────────────────────────────────
-- Enable RLS without granting any policies to authenticated/anon. The
-- service role bypasses RLS by design, so server code (and the
-- enqueue_event SECURITY DEFINER RPC) can read/write while client code
-- cannot. This matches the outbox security posture: events are an
-- internal infrastructure concern, never directly exposed to end users.
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

-- Defensive grants. Service role already has full access via its
-- bypass; explicit grants make the intent visible. We REVOKE from
-- authenticated/anon to remove any default privileges.
GRANT SELECT, INSERT, UPDATE ON public.domain_events TO service_role;
REVOKE ALL ON public.domain_events FROM authenticated;
REVOKE ALL ON public.domain_events FROM anon;

-- ────────────────────────────────────────────────────────────
-- 4. enqueue_event RPC
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so producers can publish events without needing
-- direct INSERT privileges on domain_events. The function validates
-- event_type format and aggregate_type presence to prevent malformed
-- events from polluting the outbox.
--
-- search_path is pinned to `public` per project convention (migration
-- 20260408000009 fixed this for all postgres-owned SECDEF functions).
CREATE OR REPLACE FUNCTION public.enqueue_event(
  p_event_type      text,
  p_aggregate_type  text,
  p_aggregate_id    uuid DEFAULT NULL,
  p_payload         jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF p_event_type IS NULL OR p_event_type !~ '^[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION 'invalid event_type: must match ^[a-z_]+\.[a-z_]+$';
  END IF;
  IF p_aggregate_type IS NULL OR length(p_aggregate_type) = 0 THEN
    RAISE EXCEPTION 'aggregate_type required';
  END IF;

  INSERT INTO public.domain_events (
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_event_type,
    p_aggregate_type,
    p_aggregate_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION public.enqueue_event(text, text, uuid, jsonb) IS
  'Insert a domain event into the outbox. Call inside the producer transaction so the event is committed atomically with the source state change. SECURITY DEFINER; service-role-only EXECUTE.';

REVOKE EXECUTE ON FUNCTION public.enqueue_event(text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_event(text, text, uuid, jsonb) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. archive_processed_events maintenance RPC
-- ────────────────────────────────────────────────────────────
-- Service-role-only cleanup. Deletes events whose status is 'processed'
-- and whose processed_at is older than the supplied interval (default
-- 30 days). Returns the number of rows deleted.
CREATE OR REPLACE FUNCTION public.archive_processed_events(
  p_older_than interval DEFAULT '30 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.domain_events
  WHERE status = 'processed'
    AND processed_at IS NOT NULL
    AND processed_at < now() - p_older_than;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.archive_processed_events(interval) IS
  'Delete processed events older than the supplied interval (default 30 days). Service-role-only maintenance RPC.';

REVOKE EXECUTE ON FUNCTION public.archive_processed_events(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_processed_events(interval) TO service_role;

COMMIT;



-- =====================================================
-- MIGRATION: 20260425150000_payment_webhook_events
-- =====================================================
-- Migration: 20260425150000_payment_webhook_events.sql
-- Purpose: Event-level idempotency for the Razorpay webhook handler.
--
-- Why this exists:
--   The webhook route currently dedupes via payment_history.razorpay_payment_id.
--   That works for payment.captured / payment.failed but NOT for re-fired
--   subscription.cancelled / subscription.pending / subscription.expired
--   events that carry no payment entity. A re-fire could double-process
--   downgrades or status flips.
--
--   This table records every webhook event by its Razorpay-assigned
--   account_id + event_id. The route inserts on receipt; ON CONFLICT
--   means duplicate → ACK and skip. Race-safe by relying on the unique
--   constraint, not a SELECT-then-INSERT.
--
-- Safety:
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   - RLS enabled, service-role-only access (matches domain_events pattern)
--   - SECURITY DEFINER RPC pinned to search_path = public

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_account_id text NOT NULL,
  razorpay_event_id   text NOT NULL,
  event_type      text NOT NULL,
  raw_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  outcome         text CHECK (outcome IN ('ack','dedupe','activated','downgraded','failed','unresolved') OR outcome IS NULL),
  CONSTRAINT payment_webhook_events_unique_event UNIQUE (razorpay_account_id, razorpay_event_id)
);

COMMENT ON TABLE public.payment_webhook_events IS
  'Event-level idempotency for Razorpay webhook. Unique on (account_id, event_id); ON CONFLICT means duplicate event delivery.';

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_received
  ON public.payment_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_event_type
  ON public.payment_webhook_events (event_type, received_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.payment_webhook_events TO service_role;
REVOKE ALL ON public.payment_webhook_events FROM authenticated;
REVOKE ALL ON public.payment_webhook_events FROM anon;

-- RPC: insert and return is_new=true; on conflict return is_new=false.
CREATE OR REPLACE FUNCTION public.record_webhook_event(
  p_account_id text,
  p_event_id   text,
  p_event_type text,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(is_new boolean, id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_account_id IS NULL OR length(p_account_id) = 0 THEN
    RAISE EXCEPTION 'account_id required';
  END IF;
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'event_id required';
  END IF;

  INSERT INTO public.payment_webhook_events (razorpay_account_id, razorpay_event_id, event_type, raw_payload)
  VALUES (p_account_id, p_event_id, p_event_type, COALESCE(p_raw_payload, '{}'::jsonb))
  ON CONFLICT (razorpay_account_id, razorpay_event_id) DO NOTHING
  RETURNING payment_webhook_events.id INTO v_id;

  IF v_id IS NULL THEN
    -- Conflict path: fetch existing row id, return is_new=false.
    SELECT pwe.id INTO v_id
    FROM public.payment_webhook_events pwe
    WHERE pwe.razorpay_account_id = p_account_id
      AND pwe.razorpay_event_id = p_event_id;
    RETURN QUERY SELECT false AS is_new, v_id AS id;
  ELSE
    RETURN QUERY SELECT true AS is_new, v_id AS id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, jsonb) TO service_role;

-- RPC: mark a webhook event as processed with outcome.
CREATE OR REPLACE FUNCTION public.mark_webhook_event_processed(
  p_id uuid,
  p_outcome text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_outcome NOT IN ('ack','dedupe','activated','downgraded','failed','unresolved') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome;
  END IF;
  UPDATE public.payment_webhook_events
  SET processed_at = now(), outcome = p_outcome
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_webhook_event_processed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_webhook_event_processed(uuid, text) TO service_role;

COMMIT;



-- =====================================================
-- MIGRATION: 20260427000001_rls_policies_domain_events_webhook_events
-- =====================================================
-- Migration: 20260427000001_rls_policies_domain_events_webhook_events.sql
-- Purpose: Add explicit RLS policies for two recently-added append-only
--          infrastructure tables that enabled RLS without writing
--          permissive policies. With RLS on and no policies, every
--          non-service-role caller is denied — which is fine for client
--          isolation but means even the super-admin console (which calls
--          via authenticated Supabase clients, not service_role) cannot
--          read these tables. This migration closes that gap by adding:
--
--          - SELECT policies scoped to super_admin/admin via the
--            user_roles + roles join pattern used elsewhere
--            (see 20260428000500_misconception_candidate_view.sql).
--          - INSERT policies scoped to service_role only (defense in
--            depth on top of the existing GRANT).
--          - No UPDATE/DELETE policies — both tables are append-only
--            event logs and the application writes status updates
--            exclusively via SECURITY DEFINER RPCs running as service_role.
--
-- Audit findings closed:
--   - Red #1: domain_events RLS-enabled-without-policies
--             (20260425120000_domain_events_outbox.sql)
--   - Red #2: payment_webhook_events RLS-enabled-without-policies
--             (20260425150000_payment_webhook_events.sql)
--
-- Source of truth for the super_admin RLS pattern:
--   supabase/migrations/20260428000500_misconception_candidate_view.sql
--
-- Safety:
--   - Idempotent: policies guarded by DO $$ ... EXCEPTION WHEN duplicate_object
--   - Additive only: no DROP TABLE / DROP COLUMN / ALTER on existing tables
--     beyond policy DDL
--   - No P-invariant change: this enforces P8 (RLS Boundary) and P9 (RBAC
--     Enforcement) more tightly; does not relax anything

BEGIN;

-- ─── 1. domain_events policies ─────────────────────────────────────────────
-- Super-admin / admin SELECT for ops dashboards and event-replay tooling.
-- The service_role bypasses RLS and continues to read/write directly via
-- the existing GRANT in 20260425120000.

DO $$ BEGIN
  CREATE POLICY "domain_events_super_admin_select"
    ON public.domain_events
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN
    RAISE NOTICE 'domain_events_super_admin_select: user_roles/roles missing — skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'domain_events_super_admin_select: column shape mismatch — skipping';
END $$;

-- Explicit service_role INSERT policy. The service_role normally bypasses
-- RLS, so this is defense in depth: if a future migration ever flips the
-- role's BYPASSRLS attribute, the outbox still accepts inserts only from
-- the service role.
DO $$ BEGIN
  CREATE POLICY "domain_events_service_role_insert"
    ON public.domain_events
    FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- No UPDATE/DELETE policies. Status transitions (pending -> processing ->
-- processed) happen via SECURITY DEFINER functions that execute as the
-- function owner (postgres) and bypass RLS by design. End users — even
-- super-admins — must never mutate event rows directly.

-- ─── 2. payment_webhook_events policies ────────────────────────────────────
-- Super-admin / admin SELECT for webhook-trace audit views in the
-- super-admin console. Service_role bypasses RLS via the existing GRANT
-- in 20260425150000.

DO $$ BEGIN
  CREATE POLICY "payment_webhook_events_super_admin_select"
    ON public.payment_webhook_events
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN
    RAISE NOTICE 'payment_webhook_events_super_admin_select: user_roles/roles missing — skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'payment_webhook_events_super_admin_select: column shape mismatch — skipping';
END $$;

DO $$ BEGIN
  CREATE POLICY "payment_webhook_events_service_role_insert"
    ON public.payment_webhook_events
    FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- No UPDATE/DELETE policies. The webhook handler updates processed_at /
-- outcome via the mark_webhook_event_processed SECURITY DEFINER RPC
-- (running as postgres), which bypasses RLS. P11 (Payment Integrity)
-- requires that nothing else can mutate webhook event rows — particularly
-- not authenticated end users.

COMMIT;



-- =====================================================
-- MIGRATION: 20260427000100_misconception_ontology
-- =====================================================
-- Migration: 20260427000100_misconception_ontology.sql
-- Purpose: Phase 3 of Foxy moat plan — introduce the misconception ontology and
--          per-student skill state tables that back BKT/IRT calibration and
--          targeted remediation. Adds 3 tables, all RLS-enabled.
--
-- Note: wrong_answer_remediations table is defined in 20260428000100_wrong_answer_remediations.sql (separate migration to align with /api/foxy/remediation API contract).
--
-- Tables created:
--   1. learning_objectives          — fine-grained CBSE skills/LOs per chapter
--   2. question_misconceptions      — distractor → misconception code mapping
--   3. student_skill_state          — per-student BKT/IRT state per LO
--
-- Idempotent (IF NOT EXISTS, EXCEPTION blocks for re-runs).
-- P8 invariant: every new table has RLS enabled in the same migration.
-- P5 invariant: no integer grades.
-- P9 invariant: server-side enforcement via RLS; clients never bypass.
--
-- Reference: docs/foxy-moat-plan.md Phase 3 (Misconception ontology schema).

-- ============================================================================
-- 1. learning_objectives
-- ============================================================================
CREATE TABLE IF NOT EXISTS learning_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  statement TEXT NOT NULL,
  statement_hi TEXT,
  bloom_level SMALLINT NOT NULL CHECK (bloom_level BETWEEN 1 AND 6),
  prereq_objective_ids UUID[] NOT NULL DEFAULT '{}',
  skill_tags TEXT[] NOT NULL DEFAULT '{}',
  bkt_p_learn NUMERIC(4,3) NOT NULL DEFAULT 0.20,
  bkt_p_slip NUMERIC(4,3) NOT NULL DEFAULT 0.10,
  bkt_p_guess NUMERIC(4,3) NOT NULL DEFAULT 0.25,
  bkt_calibrated_at TIMESTAMPTZ,
  bkt_sample_n INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE learning_objectives IS
  'Fine-grained CBSE learning objectives per chapter. Drives BKT priors, RAG '
  'retrieval grounding, and adaptive selection. Phase 3 of Foxy moat plan.';
COMMENT ON COLUMN learning_objectives.code IS
  'Stable human-readable code, e.g. "PHY-7-MOTION-LO-01". Used as join key '
  'across content pipeline.';
COMMENT ON COLUMN learning_objectives.bkt_calibrated_at IS
  'Set by nightly calibration job (Phase 4) when bkt_sample_n >= 30 across '
  'student responses tied to this LO.';
COMMENT ON COLUMN learning_objectives.bkt_p_learn IS
  'BKT P(T) — probability of transitioning from unknown to known on a practice opportunity. Default 0.20 (Pardos & Heffernan 2010 high-guess MCQ band); recalibrated nightly when bkt_sample_n >= 200.';
COMMENT ON COLUMN learning_objectives.bkt_p_slip IS
  'BKT P(slip) — probability student knows the skill but answers wrong. Default 0.10 per Corbett & Anderson (1995); recalibrated.';
COMMENT ON COLUMN learning_objectives.bkt_p_guess IS
  'BKT P(guess) — probability student does not know but answers right. Default 0.25 (4-option MCQ chance floor); recalibrated.';

CREATE INDEX IF NOT EXISTS idx_learning_objectives_chapter
  ON learning_objectives(chapter_id);
CREATE INDEX IF NOT EXISTS idx_learning_objectives_skill_tags
  ON learning_objectives USING GIN (skill_tags);
CREATE INDEX IF NOT EXISTS idx_learning_objectives_prereqs
  ON learning_objectives USING GIN (prereq_objective_ids);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_learning_objectives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_learning_objectives_updated_at ON learning_objectives;
CREATE TRIGGER trg_learning_objectives_updated_at
  BEFORE UPDATE ON learning_objectives
  FOR EACH ROW EXECUTE FUNCTION update_learning_objectives_updated_at();

-- RLS
ALTER TABLE learning_objectives ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "learning_objectives_authenticated_read"
    ON learning_objectives FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Writes are reserved for service_role (bypasses RLS by default). No INSERT/
-- UPDATE/DELETE policies are created, which means non-service-role clients
-- cannot mutate this table.

-- ============================================================================
-- 2. question_misconceptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS question_misconceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  distractor_index SMALLINT NOT NULL CHECK (distractor_index BETWEEN 0 AND 3),
  misconception_code TEXT NOT NULL,
  misconception_label TEXT NOT NULL,
  misconception_label_hi TEXT,
  remediation_chunk_id UUID REFERENCES rag_content_chunks(id) ON DELETE SET NULL,
  remediation_concept_id UUID REFERENCES chapter_concepts(id) ON DELETE SET NULL,
  curator_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, distractor_index)
);

COMMENT ON TABLE question_misconceptions IS
  'Maps each MCQ distractor to a named misconception and a remediation '
  'pointer. Curated by content team; consumed by Foxy and quiz feedback. '
  'Phase 3 of Foxy moat plan.';
COMMENT ON COLUMN question_misconceptions.misconception_code IS
  'Stable code, e.g. "confuses_mass_with_weight". Aggregates across questions.';

CREATE INDEX IF NOT EXISTS idx_question_misconceptions_question
  ON question_misconceptions(question_id);
CREATE INDEX IF NOT EXISTS idx_question_misconceptions_code
  ON question_misconceptions(misconception_code);

-- RLS
ALTER TABLE question_misconceptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "question_misconceptions_authenticated_read"
    ON question_misconceptions FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Writes reserved for service_role.

-- ============================================================================
-- 3. student_skill_state
-- ============================================================================
CREATE TABLE IF NOT EXISTS student_skill_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  learning_objective_id UUID NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
  p_know NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  p_learn NUMERIC(4,3) NOT NULL DEFAULT 0.20,
  p_slip NUMERIC(4,3) NOT NULL DEFAULT 0.10,
  p_guess NUMERIC(4,3) NOT NULL DEFAULT 0.25,
  theta NUMERIC(5,3) NOT NULL DEFAULT 0,
  theta_se NUMERIC(5,3) NOT NULL DEFAULT 1.5,
  last_n_responses JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_attempts INT NOT NULL DEFAULT 0,
  total_correct INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, learning_objective_id)
);

COMMENT ON TABLE student_skill_state IS
  'Per-student, per-LO BKT/IRT state. last_n_responses is a ring buffer of '
  'the most recent 20 responses (oldest dropped on the application side). '
  'Phase 3 of Foxy moat plan.';
COMMENT ON COLUMN student_skill_state.theta IS
  'IRT theta (ability) on N(0,1) scale. Bounded [-4, 4] in update functions. Cold-start 0.';
COMMENT ON COLUMN student_skill_state.theta_se IS
  'IRT ability standard error. Cold-start default 1.5 per Wainer (2000) and van der Linden (2010); tighter values commit early and starve item-information gain. Calibration job updates this from response data.';
COMMENT ON COLUMN student_skill_state.p_know IS
  'BKT prior P(L0) — probability student knows the skill before any practice. Cold-start 0.10 per Corbett & Anderson (1995); calibrated per-skill in Phase 4.';

CREATE INDEX IF NOT EXISTS idx_student_skill_state_student
  ON student_skill_state(student_id);
CREATE INDEX IF NOT EXISTS idx_student_skill_state_lo
  ON student_skill_state(learning_objective_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_student_skill_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_student_skill_state_updated_at ON student_skill_state;
CREATE TRIGGER trg_student_skill_state_updated_at
  BEFORE UPDATE ON student_skill_state
  FOR EACH ROW EXECUTE FUNCTION update_student_skill_state_updated_at();

-- RLS
ALTER TABLE student_skill_state ENABLE ROW LEVEL SECURITY;

-- Student reads their own skill state only
DO $$ BEGIN
  CREATE POLICY "student_skill_state_student_select"
    ON student_skill_state FOR SELECT
    TO authenticated
    USING (
      student_id IN (
        SELECT id FROM students WHERE auth_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Parent reads linked child skill state (approved links only)
DO $$ BEGIN
  CREATE POLICY "student_skill_state_parent_select"
    ON student_skill_state FOR SELECT
    TO authenticated
    USING (
      student_id IN (
        SELECT student_id FROM guardian_student_links
        WHERE guardian_id IN (
          SELECT id FROM guardians WHERE auth_user_id = auth.uid()
        )
        AND status = 'approved'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher reads assigned-class students' skill state
DO $$ BEGIN
  CREATE POLICY "student_skill_state_teacher_select"
    ON student_skill_state FOR SELECT
    TO authenticated
    USING (
      student_id IN (
        SELECT student_id FROM class_enrollments
        WHERE class_id IN (
          SELECT ct.class_id FROM class_teachers ct JOIN teachers t ON t.id = ct.teacher_id WHERE t.auth_user_id = auth.uid() AND ct.is_active = true
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Writes reserved for service_role (BKT update RPC will use service-role context).



-- =====================================================
-- MIGRATION: 20260428000300_skill_state_teacher_rls_and_retrieval_trace_redaction
-- =====================================================
-- Migration: 20260428000300_skill_state_teacher_rls_and_retrieval_trace_redaction.sql
-- Purpose: Two follow-up gaps from the Foxy moat plan rollout:
--   1) Teacher RLS for student_skill_state via class_teachers junction.
--      The original misconception-ontology migration deferred this because
--      its draft assumed a `classes.teacher_id` column that does not exist
--      in production — the actual schema uses a `class_teachers` join
--      table (one teacher → many classes, one class → many teachers).
--   2) P13 redaction of retrieval_traces.query_text. Phase 1 retrieval-
--      trace logging stores the raw student query so debugging can see
--      what was asked. P13 (no PII in logs) requires query persistence
--      to be (a) a redacted preview and (b) keyed by sha256 hash so
--      identical queries collide for analytics without leaking content.
--
-- Both changes are additive and idempotent.

-- ─── Part 1: Teacher RLS for student_skill_state ──────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='class_teachers'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='class_enrollments'
  ) THEN
    BEGIN
      CREATE POLICY "skill_state_teacher_select"
        ON student_skill_state FOR SELECT
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM class_enrollments ce
            JOIN class_teachers   ct ON ct.class_id  = ce.class_id
            JOIN teachers          t ON t.id          = ct.teacher_id
            WHERE ce.student_id    = student_skill_state.student_id
              AND t.auth_user_id   = auth.uid()
              AND COALESCE(ce.is_active, true) = true
              AND COALESCE(ct.is_active, true) = true
          )
        );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_table  THEN
        RAISE NOTICE 'skill_state_teacher_select: supporting tables missing — skipping';
      WHEN undefined_column THEN
        RAISE NOTICE 'skill_state_teacher_select: column shape mismatch — skipping';
    END;
  ELSE
    RAISE NOTICE 'student_skill_state teacher policy: junction tables missing, skipping';
  END IF;
END $$;

-- ─── Part 2: retrieval_traces.query_text redaction (P13) ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='retrieval_traces'
  ) THEN
    RAISE NOTICE 'retrieval_traces table missing — skipping P13 redaction';
    RETURN;
  END IF;

  -- 2a) Add hash column.
  BEGIN
    ALTER TABLE retrieval_traces ADD COLUMN query_sha256 TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END;

  -- 2b) Backfill hash from existing rows.
  BEGIN
    UPDATE retrieval_traces
    SET    query_sha256 = encode(digest(query_text, 'sha256'), 'hex')
    WHERE  query_sha256 IS NULL AND query_text IS NOT NULL;
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'pgcrypto.digest unavailable — hash will populate app-side';
  END;

  -- 2c) Truncate any existing long query_text to a 80-char preview.
  UPDATE retrieval_traces
  SET    query_text = substring(query_text from 1 for 79) || U&'\2026'
  WHERE  length(query_text) > 100;

  -- 2d) Length constraint for new writers.
  BEGIN
    ALTER TABLE retrieval_traces
      ADD CONSTRAINT retrieval_traces_query_text_redacted_chk
      CHECK (query_text IS NULL OR length(query_text) <= 100);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- 2e) Hash index for analytics dedup.
  CREATE INDEX IF NOT EXISTS idx_retrieval_traces_query_sha256
    ON retrieval_traces (query_sha256);
END $$;

COMMENT ON COLUMN retrieval_traces.query_text IS
  'REDACTED PREVIEW (max 100 chars). Per P13: full original query never '
  'persisted. Join analytics on query_sha256.';

COMMENT ON COLUMN retrieval_traces.query_sha256 IS
  'SHA-256 hex of original full query text. Stable analytics identifier '
  'without leaking content.';



-- =====================================================
-- MIGRATION: 20260428000400_irt_2pl_calibration_impl
-- =====================================================
-- Migration: 20260428000400_irt_2pl_calibration_impl.sql
-- Purpose: Phase 4 of Foxy moat plan — replace the not-implemented stub
--          recalibrate_question_irt_2pl from 20260427000200 with a real
--          2-parameter logistic IRT fit using Iteratively Reweighted
--          Least Squares (IRLS), the standard numerical method for MLE
--          logistic regression.
--
-- Algorithm (IRLS / Fisher scoring):
--   For each calibration-eligible question, gather (theta_i, y_i) pairs
--   where theta_i is the responding student's average ability across
--   their student_skill_state rows (proxy until per-LO question linkage
--   lands) and y_i in {0,1} is whether the response was correct.
--
--   Reparameterize 2PL:  P(y=1 | theta) = sigmoid(a*(theta - b))
--   with z = a*theta - a*b.  Let alpha = a, beta = -a*b -> ordinary
--   logistic regression on (theta, intercept). IRLS solves it via WLS
--   with weights W_i = p_i(1-p_i):
--     z_i_working = (alpha*theta_i + beta) + (y_i - p_i) / W_i
--     [alpha, beta] = WLS regression of z_i_working on (theta_i, 1)
--   Recover a = alpha, b = -beta / alpha.
--
-- Bounds: a in [0.3, 3.0]; b in [-4.0, 4.0]. Items that fail to converge
-- or have degenerate input leave irt_a / irt_b NULL so the selector
-- falls back to the proxy from migration 20260408000007.
--
-- Convergence: stop when max(|delta_alpha|, |delta_beta|) < 1e-4 or 50 iter.
-- Privacy: SECURITY DEFINER + locked search_path. service_role only.

CREATE OR REPLACE FUNCTION recalibrate_question_irt_2pl(
  p_question_id   UUID DEFAULT NULL,
  p_min_attempts  INT  DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_started_at      TIMESTAMPTZ := clock_timestamp();
  v_questions_fit   INT := 0;
  v_questions_skip  INT := 0;
  v_errors          JSONB := '[]'::jsonb;
  v_qid             UUID;
  v_n               INT;
  v_alpha           NUMERIC;
  v_beta            NUMERIC;
  v_alpha_new       NUMERIC;
  v_beta_new        NUMERIC;
  v_iter            INT;
  v_converged       BOOLEAN;
  v_a               NUMERIC;
  v_b               NUMERIC;
  v_theta_var       NUMERIC;
  v_correct_rate    NUMERIC;
  v_S_w             NUMERIC;
  v_S_wt            NUMERIC;
  v_S_wtt           NUMERIC;
  v_S_wz            NUMERIC;
  v_S_wzt           NUMERIC;
  v_det             NUMERIC;
  v_max_delta       NUMERIC;
BEGIN
  CREATE TEMP TABLE tmp_calibrate_qs (
    question_id UUID PRIMARY KEY
  ) ON COMMIT DROP;

  IF p_question_id IS NOT NULL THEN
    INSERT INTO tmp_calibrate_qs (question_id)
    SELECT id FROM question_bank
     WHERE id = p_question_id AND is_active = true;
  ELSE
    INSERT INTO tmp_calibrate_qs (question_id)
    SELECT q.id
      FROM question_bank q
     WHERE q.is_active = true
       AND (q.irt_calibrated_at IS NULL
            OR q.irt_calibrated_at < now() - interval '7 days')
       AND EXISTS (
         SELECT 1 FROM quiz_responses r WHERE r.question_id = q.id
       );
  END IF;

  FOR v_qid IN SELECT question_id FROM tmp_calibrate_qs LOOP
    BEGIN
      CREATE TEMP TABLE tmp_obs ON COMMIT DROP AS
      WITH per_student_theta AS (
        SELECT s.id AS student_id,
               COALESCE(AVG(sss.theta), 0)::NUMERIC AS theta
          FROM students s
     LEFT JOIN student_skill_state sss ON sss.student_id = s.id
         GROUP BY s.id
      )
      SELECT pst.theta::NUMERIC AS theta,
             CASE WHEN r.is_correct THEN 1 ELSE 0 END::INT AS y
        FROM quiz_responses r
        JOIN per_student_theta pst ON pst.student_id = r.student_id
       WHERE r.question_id = v_qid
         AND r.is_correct IS NOT NULL;

      SELECT COUNT(*),
             COALESCE(VAR_POP(theta), 0),
             COALESCE(AVG(y), 0)
        INTO v_n, v_theta_var, v_correct_rate
        FROM tmp_obs;

      IF v_n < p_min_attempts THEN
        v_questions_skip := v_questions_skip + 1;
        DROP TABLE IF EXISTS tmp_obs;
        CONTINUE;
      END IF;

      IF v_correct_rate <= 0.02 OR v_correct_rate >= 0.98
         OR v_theta_var < 1e-6 THEN
        v_questions_skip := v_questions_skip + 1;
        DROP TABLE IF EXISTS tmp_obs;
        CONTINUE;
      END IF;

      v_alpha := 1.0;
      v_beta  := 0.0;
      v_converged := false;

      FOR v_iter IN 1..50 LOOP
        WITH preds AS (
          SELECT theta, y,
                 GREATEST(LEAST(
                   1.0 / (1.0 + exp(- (v_alpha * theta + v_beta))),
                   0.999
                 ), 0.001) AS p
            FROM tmp_obs
        ),
        working AS (
          SELECT theta,
                 p * (1 - p) AS w,
                 (v_alpha * theta + v_beta) + (y - p) / (p * (1 - p)) AS z
            FROM preds
        )
        SELECT SUM(w), SUM(w * theta), SUM(w * theta * theta),
               SUM(w * z), SUM(w * z * theta)
          INTO v_S_w, v_S_wt, v_S_wtt, v_S_wz, v_S_wzt
          FROM working;

        v_det := v_S_w * v_S_wtt - v_S_wt * v_S_wt;
        IF abs(v_det) < 1e-12 THEN EXIT; END IF;

        v_alpha_new := (v_S_w   * v_S_wzt - v_S_wt * v_S_wz)  / v_det;
        v_beta_new  := (v_S_wtt * v_S_wz  - v_S_wt * v_S_wzt) / v_det;

        v_max_delta := GREATEST(abs(v_alpha_new - v_alpha),
                                abs(v_beta_new  - v_beta));
        v_alpha := v_alpha_new;
        v_beta  := v_beta_new;

        IF v_max_delta < 1e-4 THEN
          v_converged := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT v_converged THEN
        v_questions_skip := v_questions_skip + 1;
        v_errors := v_errors || jsonb_build_object(
          'question_id', v_qid,
          'reason',      'no_convergence_50_iter',
          'final_alpha', v_alpha,
          'final_beta',  v_beta
        );
        DROP TABLE IF EXISTS tmp_obs;
        CONTINUE;
      END IF;

      v_a := v_alpha;
      IF abs(v_a) < 1e-6 THEN
        v_questions_skip := v_questions_skip + 1;
        DROP TABLE IF EXISTS tmp_obs;
        CONTINUE;
      END IF;
      v_b := -v_beta / v_a;

      v_a := GREATEST(LEAST(v_a, 3.0), 0.3);
      v_b := GREATEST(LEAST(v_b, 4.0), -4.0);

      UPDATE question_bank
         SET irt_a              = round(v_a, 3),
             irt_b              = round(v_b, 3),
             irt_calibration_n  = v_n,
             irt_calibrated_at  = now()
       WHERE id = v_qid;

      v_questions_fit := v_questions_fit + 1;
      DROP TABLE IF EXISTS tmp_obs;

    EXCEPTION WHEN OTHERS THEN
      v_questions_skip := v_questions_skip + 1;
      v_errors := v_errors || jsonb_build_object(
        'question_id', v_qid,
        'reason',      'exception',
        'sqlstate',    SQLSTATE,
        'message',     SQLERRM
      );
      BEGIN DROP TABLE IF EXISTS tmp_obs; EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status',            'ok',
    'questions_fit',     v_questions_fit,
    'questions_skipped', v_questions_skip,
    'errors',            v_errors,
    'duration_ms',       EXTRACT(MILLISECOND FROM clock_timestamp() - v_started_at)::INT,
    'min_attempts',      p_min_attempts,
    'phase',             'foxy-moat-phase-4'
  );
END;
$func$;

COMMENT ON FUNCTION recalibrate_question_irt_2pl(UUID, INT) IS
  'Phase 4 IRT 2PL fit. IRLS / Fisher scoring on logistic regression. '
  'Per question: gather (student_mean_theta, is_correct), fit (alpha, beta) '
  'via WLS iteration, recover (a = alpha, b = -beta/alpha). Bound '
  'a in [0.3,3.0], b in [-4.0,4.0]. Updates question_bank IRT columns. '
  'Returns JSON summary. Cron-callable via /api/cron/irt-calibrate.';

REVOKE ALL ON FUNCTION recalibrate_question_irt_2pl(UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION recalibrate_question_irt_2pl(UUID, INT) TO service_role;



-- =====================================================
-- MIGRATION: 20260428000500_misconception_candidate_view
-- =====================================================
-- Migration: 20260428000500_misconception_candidate_view.sql
-- Purpose: Phase 3 of Foxy moat plan — editorial substrate for the
--          ~6,000 misconception annotations. Rather than try to author
--          all annotations programmatically (which would be low-quality
--          and unaccountable), we ship two pieces of editorial scaffold:
--
--          1) A read-only view `misconception_candidates` that surfaces
--             each (question_id, distractor_index) where the wrong-pick
--             rate among real student responses is high enough that the
--             distractor likely encodes a real misconception (not noise).
--
--          2) A curator-only RLS policy on `question_misconceptions` so
--             content editors with the `super_admin` role can write
--             curated rows; everyone else only reads (existing policy).
--
--          The view is the primary editorial input: editors sort by
--          `wrong_rate desc`, write a `misconception_code` + `label`,
--          and INSERT into `question_misconceptions`. A future Edge
--          Function (foxy-tutor-misconception-author) can pre-fill
--          drafts from Claude Sonnet and stage them for editor approval,
--          but no rows go live without curator review.
--
-- Idempotent. P5 grade strings preserved. No schema mutation outside
-- adding the view + the curator policy.

-- ─── 1. misconception_candidates view ─────────────────────────────────────
CREATE OR REPLACE VIEW misconception_candidates AS
WITH per_qd AS (
  SELECT
    qr.question_id,
    qr.student_answer_index              AS distractor_index,
    COUNT(*)                        AS times_picked,
    COUNT(*) FILTER (WHERE qr.is_correct = false) AS times_wrong
  FROM quiz_responses qr
  WHERE qr.student_answer_index IS NOT NULL
    AND qr.student_answer_index BETWEEN 0 AND 3
  GROUP BY qr.question_id, qr.student_answer_index
),
totals AS (
  SELECT question_id, SUM(times_picked) AS total_responses
    FROM per_qd
   GROUP BY question_id
)
SELECT
  pq.question_id,
  pq.distractor_index,
  pq.times_picked,
  pq.times_wrong,
  t.total_responses,
  ROUND(pq.times_wrong::NUMERIC / NULLIF(t.total_responses, 0), 4) AS wrong_rate,
  qb.question_text,
  qb.options,
  qb.correct_answer_index,
  qb.subject,
  qb.grade,
  qb.chapter_number,
  EXISTS (
    SELECT 1 FROM question_misconceptions qm
     WHERE qm.question_id = pq.question_id
       AND qm.distractor_index = pq.distractor_index
  ) AS has_curated_misconception
FROM per_qd pq
JOIN totals t ON t.question_id = pq.question_id
JOIN question_bank qb ON qb.id = pq.question_id
WHERE qb.is_active = true
  AND pq.distractor_index <> qb.correct_answer_index   -- only WRONG picks
  AND t.total_responses >= 10                          -- noise floor
  AND pq.times_wrong >= 3
  AND (pq.times_wrong::NUMERIC / NULLIF(t.total_responses, 0)) >= 0.10;

COMMENT ON VIEW misconception_candidates IS
  'Phase 3 editorial input. Surfaces (question_id, distractor_index) '
  'pairs where the distractor is picked by >=10% of responders to a '
  'question with >=10 total responses. Editors curate '
  'question_misconceptions rows by sorting wrong_rate DESC and writing '
  'a misconception_code + label. has_curated_misconception flags pairs '
  'already done so editors can skip them.';

-- ─── 2. Curator write policy on question_misconceptions ───────────────────
-- The base table has authenticated read but no write policy, so writes
-- are service-role-only. Add an explicit super_admin path so editors
-- working through the super-admin console can INSERT/UPDATE without the
-- service-role key being shipped to the client.

DO $$ BEGIN
  CREATE POLICY "qm_super_admin_write"
    ON question_misconceptions
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN
    RAISE NOTICE 'qm_super_admin_write: user_roles/roles missing — skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'qm_super_admin_write: column shape mismatch — skipping';
END $$;

-- View grants: authenticated reads (matches existing question_misconceptions
-- read pattern; the view itself joins question_bank + quiz_responses both
-- of which already gate read access at row level).
GRANT SELECT ON misconception_candidates TO authenticated;
GRANT SELECT ON misconception_candidates TO service_role;



-- =====================================================
-- MIGRATION: 20260428000600_select_questions_by_irt_info
-- =====================================================
-- Migration: 20260428000600_select_questions_by_irt_info.sql
-- Purpose: Phase 4 closure of Foxy moat plan — give selectors a way to
--          actually USE the (irt_a, irt_b) values that the nightly
--          calibration cron is now writing. Adds:
--            (a) RPC select_questions_by_irt_info(...) ranking candidates
--                by Fisher information at the student's current theta
--                when irt_calibration_n >= 30, falling back to the
--                irt_difficulty proxy distance otherwise.
--            (b) Feature flag ff_irt_question_selection (default off) so
--                the new path can be A/B tested before flipping on
--                platform-wide.
--
-- Algorithm — 2PL Fisher information:
--   I(theta) = a^2 * P * (1 - P)
--   where P  = 1 / (1 + exp(-a*(theta - b)))
--
--   Higher I(theta) = item is more discriminating at the student's level.
--   In adaptive testing, picking the highest-Fisher item per turn is the
--   standard maximally-informative selection (Lord 1980, ch. 9).
--
-- Privacy / safety:
--   - SECURITY INVOKER (callers must already have RLS-permitted access to
--     question_bank + student_skill_state). The Edge Function calls under
--     service_role anyway, so RLS is bypassed and the function just
--     returns rows; client callers are gated by their own RLS scope.
--   - search_path locked to public.
--
-- Idempotent. Re-runnable (CREATE OR REPLACE FUNCTION + INSERT IF NOT
-- EXISTS for the flag).

-- ─── 1. RPC: select_questions_by_irt_info ──────────────────────────────────
-- Returns the most informative candidate questions for a given student
-- and scope. Two-stage ranking:
--   Stage A (preferred): for questions with irt_calibration_n >= 30,
--     compute Fisher info at the student's current theta. Higher = better.
--   Stage B (fallback): for uncalibrated questions, use 1 / (1 + |theta - irt_difficulty|)
--     so questions whose proxy difficulty is closest to theta sort first.
--
-- The two stages are unioned and ranked together. Calibrated items get
-- a small bonus (+0.5 added to their score) so when both paths return
-- comparable numeric scores, the calibrated path wins ties — but a much
-- better proxy match still beats a marginal calibrated fit.

CREATE OR REPLACE FUNCTION select_questions_by_irt_info(
  p_student_id      UUID,
  p_subject         TEXT,
  p_grade           TEXT,
  p_chapter_number  INT  DEFAULT NULL,
  p_match_count     INT  DEFAULT 5,
  p_exclude_ids     UUID[] DEFAULT '{}'::UUID[]
)
RETURNS TABLE (
  question_id        UUID,
  question_text      TEXT,
  options            JSONB,
  correct_answer_index INT,
  explanation        TEXT,
  difficulty         INT,
  bloom_level        TEXT,
  chapter_number     INT,
  irt_a              NUMERIC,
  irt_b              NUMERIC,
  irt_calibration_n  INT,
  irt_difficulty     NUMERIC,
  selection_score    NUMERIC,
  selection_path     TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $func$
DECLARE
  v_theta NUMERIC;
BEGIN
  -- Compute the student's mean theta. A student with no skill_state rows
  -- gets the N(0,1) prior mean of 0 (cold-start neutral).
  SELECT COALESCE(AVG(theta), 0)
    INTO v_theta
    FROM student_skill_state
   WHERE student_id = p_student_id;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      qb.id,
      qb.question_text,
      qb.options,
      qb.correct_answer_index,
      qb.explanation,
      qb.difficulty,
      qb.bloom_level,
      qb.chapter_number,
      qb.irt_a,
      qb.irt_b,
      qb.irt_calibration_n,
      qb.irt_difficulty
    FROM question_bank qb
    WHERE qb.is_active = true
      AND qb.subject  = p_subject
      AND qb.grade    = p_grade
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (p_exclude_ids IS NULL OR NOT (qb.id = ANY(p_exclude_ids)))
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN c.irt_calibration_n >= 30 AND c.irt_a IS NOT NULL AND c.irt_b IS NOT NULL THEN
          -- Fisher information at theta: a^2 * P * (1 - P), with sigmoid clipped
          -- away from 0/1 to avoid information collapse on very-easy or
          -- very-hard items relative to theta.
          (c.irt_a * c.irt_a) *
          GREATEST(LEAST(1.0 / (1.0 + exp(- (c.irt_a * (v_theta - c.irt_b)))), 0.999), 0.001) *
          (1.0 - GREATEST(LEAST(1.0 / (1.0 + exp(- (c.irt_a * (v_theta - c.irt_b)))), 0.999), 0.001))
          + 0.5  -- calibrated-item bonus (see header)
        WHEN c.irt_difficulty IS NOT NULL THEN
          -- Proxy: prefer items whose difficulty is closest to theta.
          1.0 / (1.0 + abs(v_theta - c.irt_difficulty))
        ELSE
          -- Last-resort: small constant so totally uncalibrated items still
          -- have a chance to be picked at random when nothing better exists.
          0.1
      END AS selection_score,
      CASE
        WHEN c.irt_calibration_n >= 30 AND c.irt_a IS NOT NULL AND c.irt_b IS NOT NULL
          THEN 'fisher_info'
        WHEN c.irt_difficulty IS NOT NULL
          THEN 'proxy_distance'
        ELSE 'uncalibrated'
      END AS selection_path
    FROM candidates c
  )
  SELECT
    s.id,
    s.question_text,
    s.options,
    s.correct_answer_index,
    s.explanation,
    s.difficulty,
    s.bloom_level,
    s.chapter_number,
    s.irt_a,
    s.irt_b,
    s.irt_calibration_n,
    s.irt_difficulty,
    s.selection_score,
    s.selection_path
  FROM scored s
  ORDER BY s.selection_score DESC, random()
  LIMIT p_match_count;
END;
$func$;

REVOKE ALL ON FUNCTION select_questions_by_irt_info(UUID, TEXT, TEXT, INT, INT, UUID[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION select_questions_by_irt_info(UUID, TEXT, TEXT, INT, INT, UUID[]) TO service_role;
GRANT  EXECUTE ON FUNCTION select_questions_by_irt_info(UUID, TEXT, TEXT, INT, INT, UUID[]) TO authenticated;

COMMENT ON FUNCTION select_questions_by_irt_info(UUID, TEXT, TEXT, INT, INT, UUID[]) IS
  'Phase 4 of Foxy moat plan: maximally-informative item selection. Ranks '
  'candidates by Fisher information at the student''s current theta when '
  'irt_calibration_n >= 30; falls back to proxy-distance when not calibrated. '
  'Returns top p_match_count rows with selection_score and selection_path '
  'so callers can audit how each item was selected.';

-- ─── 2. Feature flag: ff_irt_question_selection ────────────────────────────
-- Default OFF until ops confirms calibration data has accumulated and
-- the selector RPC is producing useful rankings. Flip via super-admin
-- console after spot-checking selection_path counts via:
--
--   SELECT selection_path, COUNT(*)
--     FROM (SELECT * FROM select_questions_by_irt_info(some_student_id,
--             'math', '7', NULL, 50)) t
--    GROUP BY selection_path;
--
-- When 'fisher_info' rows dominate and the proxy fallback is exercised
-- only at corpus edges, flip is_enabled = true.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_irt_question_selection'
  ) THEN
    INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, description)
    VALUES (
      'ff_irt_question_selection',
      false,
      100,
      'Phase 4 IRT-info question selection. When enabled, the quiz-generator '
      || 'Edge Function calls select_questions_by_irt_info() instead of the '
      || 'legacy difficulty-bucket flow. Default OFF — flip after the nightly '
      || 'IRT calibration cron has populated (irt_a, irt_b) on enough items '
      || 'that selection_path = ''fisher_info'' is the dominant code.'
    );
  END IF;
EXCEPTION
  WHEN undefined_table  THEN RAISE NOTICE 'reconciliation: undefined table - skipped';
  WHEN undefined_column THEN RAISE NOTICE 'reconciliation: undefined column - skipped';
  WHEN duplicate_object THEN NULL;
END $$;



-- =====================================================
-- MIGRATION: 20260428000700_fix_irt_info_rpc_type
-- =====================================================
-- Migration: 20260428000700_fix_irt_info_rpc_type.sql
-- Purpose: Fix select_questions_by_irt_info column type mismatch.
--
-- The original migration 20260428000600 declared `irt_difficulty NUMERIC`
-- in the RETURNS TABLE clause, but `question_bank.irt_difficulty` is
-- DOUBLE PRECISION (added in 20260408000007). PostgreSQL refuses to
-- coerce DOUBLE PRECISION → NUMERIC implicitly in RETURN QUERY rows,
-- so the RPC was failing on first call with SQLSTATE 42804.
--
-- Fix: cast irt_difficulty::NUMERIC inside the SELECT so the row shape
-- matches the declared return type. Keeping the RETURNS TABLE
-- declaration as NUMERIC means callers (TypeScript types) see a stable
-- numeric type; the cast is a no-op for the values we actually store.

CREATE OR REPLACE FUNCTION select_questions_by_irt_info(
  p_student_id      UUID,
  p_subject         TEXT,
  p_grade           TEXT,
  p_chapter_number  INT  DEFAULT NULL,
  p_match_count     INT  DEFAULT 5,
  p_exclude_ids     UUID[] DEFAULT '{}'::UUID[]
)
RETURNS TABLE (
  question_id        UUID,
  question_text      TEXT,
  options            JSONB,
  correct_answer_index INT,
  explanation        TEXT,
  difficulty         INT,
  bloom_level        TEXT,
  chapter_number     INT,
  irt_a              NUMERIC,
  irt_b              NUMERIC,
  irt_calibration_n  INT,
  irt_difficulty     NUMERIC,
  selection_score    NUMERIC,
  selection_path     TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $func$
DECLARE
  v_theta NUMERIC;
BEGIN
  SELECT COALESCE(AVG(theta), 0)
    INTO v_theta
    FROM student_skill_state
   WHERE student_id = p_student_id;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      qb.id,
      qb.question_text,
      qb.options,
      qb.correct_answer_index,
      qb.explanation,
      qb.difficulty,
      qb.bloom_level,
      qb.chapter_number,
      qb.irt_a,
      qb.irt_b,
      qb.irt_calibration_n,
      qb.irt_difficulty::NUMERIC AS irt_difficulty
    FROM question_bank qb
    WHERE qb.is_active = true
      AND qb.subject  = p_subject
      AND qb.grade    = p_grade
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (p_exclude_ids IS NULL OR NOT (qb.id = ANY(p_exclude_ids)))
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN c.irt_calibration_n >= 30 AND c.irt_a IS NOT NULL AND c.irt_b IS NOT NULL THEN
          (c.irt_a * c.irt_a) *
          GREATEST(LEAST(1.0 / (1.0 + exp(- (c.irt_a * (v_theta - c.irt_b)))), 0.999), 0.001) *
          (1.0 - GREATEST(LEAST(1.0 / (1.0 + exp(- (c.irt_a * (v_theta - c.irt_b)))), 0.999), 0.001))
          + 0.5
        WHEN c.irt_difficulty IS NOT NULL THEN
          1.0 / (1.0 + abs(v_theta - c.irt_difficulty))
        ELSE
          0.1
      END AS selection_score,
      CASE
        WHEN c.irt_calibration_n >= 30 AND c.irt_a IS NOT NULL AND c.irt_b IS NOT NULL
          THEN 'fisher_info'
        WHEN c.irt_difficulty IS NOT NULL
          THEN 'proxy_distance'
        ELSE 'uncalibrated'
      END AS selection_path
    FROM candidates c
  )
  SELECT
    s.id,
    s.question_text,
    s.options,
    s.correct_answer_index,
    s.explanation,
    s.difficulty,
    s.bloom_level,
    s.chapter_number,
    s.irt_a,
    s.irt_b,
    s.irt_calibration_n,
    s.irt_difficulty,
    s.selection_score,
    s.selection_path
  FROM scored s
  ORDER BY s.selection_score DESC, random()
  LIMIT p_match_count;
END;
$func$;



-- =====================================================
-- FINAL: schema_migrations SYNC (339 rows)
-- =====================================================
BEGIN;
DROP TABLE IF EXISTS supabase_migrations._sm_backup_20260427_drift_repair;
CREATE TABLE supabase_migrations._sm_backup_20260427_drift_repair AS SELECT *, now() AS backed_up_at FROM supabase_migrations.schema_migrations;
DELETE FROM supabase_migrations.schema_migrations WHERE version NOT IN ('20260307074838','20260307074905','20260307074933','20260307074951','20260307075028','20260307075711','20260307075750','20260307075831','20260307085022','20260307091906','20260307091937','20260307092034','20260307092138','20260307110804','20260307110827','20260307110931','20260307111024','20260313023223','20260314091050','20260314101914','20260314103049','20260314110904','20260314114730','20260314120514','20260314155505','20260315164931','20260315174438','20260315174651','20260315175317','20260315175407','20260315180305','20260316102630','20260316111555','20260316114211','20260318060623','20260318061359','20260318065338','20260318070437','20260318071040','20260318071737','20260318072452','20260318073203','20260318073715','20260318095119','20260318101734','20260318110600','20260318111812','20260318122613','20260318122629','20260318122640','20260318122938','20260318123017','20260318123037','20260318135222','20260318152814','20260318170816','20260318175233','20260318193823','20260318211207','20260318213120','20260318213153','20260318221303','20260318223912','20260319035429','20260319040137','20260319063308','20260319063900','20260319064856','20260319071616','20260319072549','20260319072718','20260319074014','20260319075420','20260319075614','20260319080526','20260319080747','20260319081213','20260319100338','20260319162602','20260320135221','20260320140601','20260320140705','20260320144758','20260320144850','20260320144933','20260320145032','20260320172909','20260320174248','20260320174657','20260320174852','20260320212215','20260320212808','20260320212855','20260320212946','20260320213234','20260320214227','20260320215808','20260320222627','20260320235126','20260321074745','20260321084056','20260321084338','20260321084945','20260321085944','20260321091308','20260321092003','20260321094308','20260321103812','20260321111553','20260321111948','20260321122827','20260321152805','20260321160021','20260321160134','20260321160306','20260321162353','20260321162734','20260321163256','20260321164438','20260321164524','20260321164600','20260321165943','20260321171326','20260321181508','20260322070714','20260322105523','20260322113401','20260322183018','20260322183042','20260322183108','20260322190511','20260322200645','20260322200702','20260322201220','20260323113357','20260323113420','20260323113441','20260323113729','20260323114620','20260324021448','20260324023556','20260324023559','20260324024011','20260324043526','20260324051000','20260324051100','20260324052000','20260324060000','20260324070000','20260325070000','20260325080000','20260325090000','20260325100000','20260325110000','20260325120000','20260325130000','20260325140000','20260325150000','20260325160000','20260327210000','20260328010000','20260328020000','20260328030000','20260328040000','20260328050000','20260328060000','20260328070000','20260328080000','20260328090000','20260328100000','20260328110000','20260328120000','20260328130000','20260328160000','20260329120000','20260329130000','20260329140000','20260329150000','20260329160000','20260329170000','20260329210000','20260329220000','20260330160000','20260330200000','20260401100000','20260401140000','20260401150000','20260401160000','20260401170000','20260401180000','20260402090000','20260402100000','20260402110000','20260402120000','20260402130000','20260402130001','20260403000001','20260403000002','20260403100000','20260403100001','20260403200000','20260403300000','20260403400000','20260403500000','20260403600000','20260403700000','20260403710000','20260403720000','20260404000000','20260404000001','20260404000002','20260404000003','20260404140000','20260405000001','20260405000002','20260405100000','20260405100001','20260405300000','20260406000001','20260406000002','20260406100000','20260406200000','20260408000001','20260408000002','20260408000003','20260408000004','20260408000005','20260408000006','20260408000007','20260408000008','20260408000009','20260408000010','20260408000011','20260408000012','20260408000013','20260408000014','20260408000015','20260408000016','20260408000017','20260408000018','20260408000019','20260408000020','20260408000021','20260408000022','20260409000001','20260409000002','20260409000003','20260409000004','20260409000005','20260411000001','20260411120000','20260412120000','20260412150000','20260413120000','20260413130000','20260413140000','20260413160000','20260413170000','20260414120000','20260415000001','20260415000002','20260415000003','20260415000004','20260415000005','20260415000006','20260415000007','20260415000008','20260415000009','20260415000010','20260415000011','20260415000012','20260415000013','20260415000014','20260415000015','20260415000016','20260415000017','20260416000001','20260416200000','20260416200100','20260416210000','20260416220000','20260416230000','20260416240000','20260417000001','20260417100000','20260417200000','20260417300000','20260417400000','20260417500000','20260417600000','20260417700000','20260418100000','20260418100100','20260418100200','20260418100300','20260418100400','20260418100500','20260418100600','20260418100700','20260418100800','20260418100900','20260418101000','20260418101100','20260418101200','20260418110000','20260418120000','20260418130000','20260418140000','20260424120000','20260425120000','20260425130000','20260425140000','20260425140100','20260425140200','20260425140300','20260425140400','20260425140500','20260425150000','20260425150100','20260425150200','20260425150300','20260425160000','20260426150000','20260427000000','20260427000001','20260427000002','20260427000003','20260427000004','20260427000100','20260427000200','20260427000300','20260428000000','20260428000100','20260428000200','20260428000300','20260428000400','20260428000500','20260428000600','20260428000700');
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260307074838','20260307074838_create_core_student_tables'),
  ('20260307074905','20260307074905_create_session_and_conversation_tables'),
  ('20260307074933','20260307074933_create_gamification_analytics_tables'),
  ('20260307074951','20260307074951_create_rls_policies'),
  ('20260307075028','20260307075028_create_functions_and_seed_data'),
  ('20260307075711','20260307075711_seed_ncert_class6_math_knowledge_graph'),
  ('20260307075750','20260307075750_seed_ncert_class6_science_knowledge_graph'),
  ('20260307075831','20260307075831_create_spaced_repetition_and_diagnostic_functions'),
  ('20260307085022','20260307085022_create_waitlist_table'),
  ('20260307091906','20260307091906_seed_class7_math_science'),
  ('20260307091937','20260307091937_seed_class8_math_science'),
  ('20260307092034','20260307092034_seed_class9_10_math_science'),
  ('20260307092138','20260307092138_seed_assessment_questions_multi_grade'),
  ('20260307110804','20260307110804_fix_security_function_search_paths'),
  ('20260307110827','20260307110827_fix_performance_rls_indexes'),
  ('20260307110931','20260307110931_add_robust_learning_engine_tables'),
  ('20260307111024','20260307111024_seed_expanded_question_bank'),
  ('20260313023223','20260313023223_auto_create_student_profiles_and_xp_system'),
  ('20260314091050','20260314091050_add_student_tracking_policies'),
  ('20260314101914','20260314101914_add_cbse_question_structure'),
  ('20260314103049','20260314103049_add_quiz_session_tracking'),
  ('20260314110904','20260314110904_add_senior_subjects_journey_cognitive'),
  ('20260314114730','20260314114730_add_scalability_infrastructure'),
  ('20260314120514','20260314120514_add_textbook_content_tables'),
  ('20260314155505','20260314155505_fix_textbook_storage_policies'),
  ('20260315164931','20260315164931_production_readiness_fixes'),
  ('20260315174438','20260315174438_fix_quiz_sessions_columns'),
  ('20260315174651','20260315174651_create_student_stats_view'),
  ('20260315175317','20260315175317_fix_security_scale_v2'),
  ('20260315175407','20260315175407_training_export_views'),
  ('20260315180305','20260315180305_add_student_notes_system'),
  ('20260316102630','20260316102630_nipun_alignment_schema'),
  ('20260316111555','20260316111555_pedagogy_stack_tarl_formative_tutoring'),
  ('20260316114211','20260316114211_add_preferred_subject_to_students'),
  ('20260318060623','20260318060623_cognitive_learner_model_v2'),
  ('20260318061359','20260318061359_learning_graph_6_level'),
  ('20260318065338','20260318065338_cognitive_learning_loop_8_step'),
  ('20260318070437','20260318070437_misconception_remediation_tables'),
  ('20260318071040','20260318071040_adaptive_difficulty_engine'),
  ('20260318071737','20260318071737_unified_3_layer_depth_model'),
  ('20260318072452','20260318072452_diagnostic_assessment_system_v2'),
  ('20260318073203','20260318073203_ai_role_governance'),
  ('20260318073715','20260318073715_student_experience_tables_v2'),
  ('20260318095119','20260318095119_add_teachers_admins_enhanced_students'),
  ('20260318101734','20260318101734_devops_agent_v2_tables'),
  ('20260318110600','20260318110600_super_admin_setup'),
  ('20260318111812','20260318111812_parent_portal_and_roles'),
  ('20260318122613','20260318122613_extend_guardian_student_links_approval_flow'),
  ('20260318122629','20260318122629_extend_students_add_invite_codes'),
  ('20260318122640','20260318122640_add_onboarding_responses'),
  ('20260318122938','20260318122938_handle_new_user_trigger_and_role_detection'),
  ('20260318123017','20260318123017_guardian_link_stored_procedures'),
  ('20260318123037','20260318123037_fix_rls_guardian_links_and_admin'),
  ('20260318135222','20260318135222_add_admin_auth_functions'),
  ('20260318152814','20260318152814_rls_hardening_p0'),
  ('20260318170816','20260318170816_rag_pipeline_schema'),
  ('20260318175233','20260318175233_rag_syllabus_2025_26'),
  ('20260318193823','20260318193823_voice_avatar_system'),
  ('20260318211207','20260318211207_study_plan_spaced_repetition_v2'),
  ('20260318213120','20260318213120_production_scale_indexes_v3'),
  ('20260318213153','20260318213153_rate_limiting_table'),
  ('20260318221303','20260318221303_fix_students_rls_infinite_recursion'),
  ('20260318223912','20260318223912_tighten_rls_critical_tables'),
  ('20260319035429','20260319035429_launch_production_hardening'),
  ('20260319040137','20260319040137_pilot_analytics_investor_reporting'),
  ('20260319063308','20260319063308_perf_fix_rls_duplicate_indexes_v2'),
  ('20260319063900','20260319063900_scale_50k_hardening_v3'),
  ('20260319064856','20260319064856_payment_plans_razorpay'),
  ('20260319071616','20260319071616_fix_student_id_integrity_v2'),
  ('20260319072549','20260319072549_ultimate_50k_hardening'),
  ('20260319072718','20260319072718_final_50k_cleanup_v2'),
  ('20260319074014','20260319074014_prevent_duplicates_final'),
  ('20260319075420','20260319075420_fix_signup_constraints'),
  ('20260319075614','20260319075614_enable_pgcrypto'),
  ('20260319080526','20260319080526_production_defense_layer'),
  ('20260319080747','20260319080747_cleanup_duplicate_indexes'),
  ('20260319081213','20260319081213_fix_student_overall_stats_security'),
  ('20260319100338','20260319100338_auto_create_student_on_signup'),
  ('20260319162602','20260319162602_create_chapter_progress_tracking'),
  ('20260320135221','20260320135221_fix_feature_flags_rls_and_student_data'),
  ('20260320140601','20260320140601_permanent_fix_auth_rls_triggers_v2'),
  ('20260320140705','20260320140705_fix_sanitize_trigger_grade_format'),
  ('20260320144758','20260320144758_scale_50k_rpcs_and_indexes'),
  ('20260320144850','20260320144850_fix_dashboard_rpc_achievement_column'),
  ('20260320144933','20260320144933_fix_dashboard_rpc_final'),
  ('20260320145032','20260320145032_fix_question_bank_grade_format_and_rpc'),
  ('20260320172909','20260320172909_adaptive_learning_tables'),
  ('20260320174248','20260320174248_adaptive_learning_rpcs'),
  ('20260320174657','20260320174657_production_user_role_architecture'),
  ('20260320174852','20260320174852_role_rpcs_teacher_parent'),
  ('20260320212215','20260320212215_auto_generate_review_cards_from_quiz'),
  ('20260320212808','20260320212808_intelligent_study_plan_generator'),
  ('20260320212855','20260320212855_fix_study_plan_generator_column_name'),
  ('20260320212946','20260320212946_fix_study_plan_task_types'),
  ('20260320213234','20260320213234_study_plan_generator_v3_with_topics'),
  ('20260320214227','20260320214227_competitions_and_advanced_leaderboard'),
  ('20260320215808','20260320215808_duolingo_notification_engine'),
  ('20260320222627','20260320222627_rbac_enforcement_and_guardian_linking'),
  ('20260320235126','20260320235126_add_selected_subjects_to_students'),
  ('20260321074745','20260321074745_fix_get_user_role_with_onboarding'),
  ('20260321084056','20260321084056_adaptive_orchestrator_schema'),
  ('20260321084338','20260321084338_fix_grade_format_in_orchestrator_rpcs'),
  ('20260321084945','20260321084945_fix_practice_queue_new_concept_filter'),
  ('20260321085944','20260321085944_teacher_dashboard_v2_and_classroom_response'),
  ('20260321091308','20260321091308_nep_compliance_hpc_and_competency_layer'),
  ('20260321092003','20260321092003_offline_sync_infrastructure'),
  ('20260321094308','20260321094308_gamification_burst_engine_and_narrative'),
  ('20260321103812','20260321103812_interleaving_engine_and_narrative_bursts_grades_6_10'),
  ('20260321111553','20260321111553_production_audit_fix_p1_concept_codes_indexes_soft_delete'),
  ('20260321111948','20260321111948_fix_p1b_create_missing_graph_nodes_remap_questions'),
  ('20260321122827','20260321122827_fix_p7_updated_at_hot_path_tables_and_auto_trigger'),
  ('20260321152805','20260321152805_fix_rls_classes_schools_and_remaining_tables'),
  ('20260321160021','20260321160021_grade10_math_graph_nodes_and_questions_batch1'),
  ('20260321160134','20260321160134_grade10_math_questions_batch2_ch6_7_9'),
  ('20260321160306','20260321160306_grade10_math_questions_batch3_ch10_12_13_14_15'),
  ('20260321162353','20260321162353_grade9_10_remaining_core_questions'),
  ('20260321162734','20260321162734_bulk_generate_starter_questions_for_all_missing_chapters'),
  ('20260321163256','20260321163256_create_missing_graph_nodes_and_fix_rls'),
  ('20260321164438','20260321164438_fix_remaining_indexes_and_verify'),
  ('20260321164524','20260321164524_recreate_plan_limits_rpc_clean'),
  ('20260321164600','20260321164600_create_student_daily_usage_table'),
  ('20260321165943','20260321165943_fix_drop_broken_archives_and_recreate'),
  ('20260321171326','20260321171326_pro_plan_connection_optimization'),
  ('20260321181508','20260321181508_create_interactive_simulations_table'),
  ('20260322070714','20260322070714_create_support_tickets_table'),
  ('20260322105523','20260322105523_create_ai_response_verification_system'),
  ('20260322113401','20260322113401_add_math_grade_11_12_chapters'),
  ('20260322183018','20260322183018_create_generate_parent_link_code_function'),
  ('20260322183042','20260322183042_fix_generate_parent_link_code_column_names'),
  ('20260322183108','20260322183108_make_guardian_id_nullable_for_pending_invites'),
  ('20260322190511','20260322190511_add_scalability_indexes'),
  ('20260322200645','20260322200645_add_task_queue_and_helper_functions'),
  ('20260322200702','20260322200702_add_missing_indexes_and_triggers'),
  ('20260322201220','20260322201220_strengthen_rls_multi_role_access'),
  ('20260323113357','20260323113357_alfanumrik_v2_cognitive_learning_system_corrected'),
  ('20260323113420','20260323113420_alfanumrik_v2_cognitive_metrics_and_tracking'),
  ('20260323113441','20260323113441_alfanumrik_v2_question_responses_and_enhancements'),
  ('20260323113729','20260323113729_alfanumrik_v2_cognitive_functions_and_views'),
  ('20260323114620','20260323114620_seed_real_cbse_questions'),
  ('20260324021448','20260324021448_fix_snapshot_rpc_and_rls_policies'),
  ('20260324023556','20260324023556_drop_redundant_service_notifications_policy'),
  ('20260324023559','20260324023559_add_name_change_count_to_students'),
  ('20260324024011','20260324024011_add_delete_student_account_rpc'),
  ('20260324043526','20260324043526_dashboard_rpcs_submit_quiz_and_ddl'),
  ('20260324051000','20260324051000_launch_readiness_missing_indexes'),
  ('20260324051100','20260324051100_create_missing_frontend_rpcs'),
  ('20260324052000','20260324052000_create_teacher_student_notes_table'),
  ('20260324060000','20260324060000_exam_centric_personalization_engine'),
  ('20260324070000','20260324070000_production_rbac_system'),
  ('20260325070000','20260325070000_student_daily_usage'),
  ('20260325080000','20260325080000_ai_tutor_logs'),
  ('20260325090000','20260325090000_production_scale_5k_optimization'),
  ('20260325100000','20260325100000_enforce_unique_auth_user_id'),
  ('20260325110000','20260325110000_atomic_bkt_mastery_update'),
  ('20260325120000','20260325120000_fix_cascade_deletes'),
  ('20260325130000','20260325130000_add_statement_timeout'),
  ('20260325140000','20260325140000_add_missing_performance_indexes'),
  ('20260325150000','20260325150000_optimize_student_snapshot_rpc'),
  ('20260325160000','20260325160000_atomic_quiz_profile_update'),
  ('20260327210000','20260327210000_extended_rbac_roles'),
  ('20260328010000','20260328010000_cms_foundation_actual'),
  ('20260328020000','20260328020000_cms_scalability'),
  ('20260328030000','20260328030000_feature_flag_scoping'),
  ('20260328040000','20260328040000_platform_ops_tables'),
  ('20260328050000','20260328050000_fix_admin_rls_circular'),
  ('20260328060000','20260328060000_fix_admin_rls_disable'),
  ('20260328070000','20260328070000_scale_readiness'),
  ('20260328080000','20260328080000_cms_storage_bucket'),
  ('20260328090000','20260328090000_fix_rbac_rls_service_role'),
  ('20260328100000','20260328100000_cme_foundation'),
  ('20260328110000','20260328110000_scan_ocr_pipeline'),
  ('20260328120000','20260328120000_identity_integrity'),
  ('20260328130000','20260328130000_remove_launch_pricing'),
  ('20260328160000','20260328160000_recurring_billing'),
  ('20260329120000','20260329120000_question_bank_cleanup'),
  ('20260329130000','20260329130000_ncert_solver'),
  ('20260329140000','20260329140000_server_side_quiz_verification'),
  ('20260329150000','20260329150000_fix_rag_retrieval'),
  ('20260329160000','20260329160000_cbse_syllabus_graph'),
  ('20260329170000','20260329170000_unified_cme'),
  ('20260329210000','20260329210000_fix_rpc_signatures_and_add_xp'),
  ('20260329220000','20260329220000_add_bloom_level_constraint'),
  ('20260330160000','20260330160000_curriculum_versioning'),
  ('20260330200000','20260330200000_fix_critical_rls_and_functions'),
  ('20260401100000','20260401100000_enforce_p5_grade_format_check'),
  ('20260401140000','20260401140000_add_performance_indexes'),
  ('20260401150000','20260401150000_add_chapter_to_rag_match'),
  ('20260401160000','20260401160000_fix_quiz_rpc_columns'),
  ('20260401170000','20260401170000_create_experiment_observations'),
  ('20260401180000','20260401180000_demo_account_system'),
  ('20260402090000','20260402090000_fix_p2_xp_bonus_no_min_questions'),
  ('20260402100000','20260402100000_robust_auth_onboarding_system'),
  ('20260402110000','20260402110000_demo_accounts_tables_and_rpc'),
  ('20260402120000','20260402120000_demo_accounts_onboarding_state'),
  ('20260402130000','20260402130000_quiz_qa_redesign'),
  ('20260402130001','20260402130001_quiz_qa_rpcs'),
  ('20260403000001','20260403000001_fix_rag_vector_search'),
  ('20260403000002','20260403000002_add_content_gap_tracking'),
  ('20260403100000','20260403100000_educational_content_rebuild'),
  ('20260403100001','20260403100001_diagram_extraction_helpers'),
  ('20260403200000','20260403200000_chapter_concepts'),
  ('20260403300000','20260403300000_embed_diagrams_in_rag'),
  ('20260403400000','20260403400000_rag_three_categories'),
  ('20260403500000','20260403500000_fix_submit_quiz_the_one_fix'),
  ('20260403600000','20260403600000_quiz_rag_retrieval'),
  ('20260403700000','20260403700000_ncert_voyage_retrieval_architecture'),
  ('20260403710000','20260403710000_backfill_concept_ids'),
  ('20260403720000','20260403720000_backfill_diagram_registry'),
  ('20260404000000','20260404000000_check_and_record_usage'),
  ('20260404000001','20260404000001_rag_quality_score'),
  ('20260404000002','20260404000002_pg_cron_daily'),
  ('20260404000003','20260404000003_rag_board_filter'),
  ('20260404140000','20260404140000_fix_usage_unique_constraint'),
  ('20260405000001','20260405000001_unified_learner_state'),
  ('20260405000002','20260405000002_post_quiz_cme_action'),
  ('20260405100000','20260405100000_improvement_command_center'),
  ('20260405100001','20260405100001_improvement_mode_flag'),
  ('20260405300000','20260405300000_xp_transaction_ledger'),
  ('20260406000001','20260406000001_wire_unified_learner_update'),
  ('20260406000002','20260406000002_exam_prophecy'),
  ('20260406100000','20260406100000_scale_10k_optimization'),
  ('20260406200000','20260406200000_bulk_upload_and_analytics'),
  ('20260408000001','20260408000001_add_p3_anticheat_checks_2_3'),
  ('20260408000002','20260408000002_foxy_sessions_and_messages'),
  ('20260408000003','20260408000003_rag_board_quality_v2'),
  ('20260408000004','20260408000004_link_quiz_xp_to_ledger'),
  ('20260408000005','20260408000005_wire_session_id_dedup'),
  ('20260408000006','20260408000006_enforce_p5_grade_quiz_sessions'),
  ('20260408000007','20260408000007_irt_proxy_calibration_from_difficulty_bloom'),
  ('20260408000008','20260408000008_fix_security_definer_view_and_rls_initplan'),
  ('20260408000009','20260408000009_fix_search_path_on_secdef_functions'),
  ('20260408000010','20260408000010_fix_service_role_rls_policies'),
  ('20260408000011','20260408000011_drop_redundant_unused_indexes'),
  ('20260408000012','20260408000012_irt_theta_estimation_rpc_and_trigger'),
  ('20260408000013','20260408000013_covering_indexes_for_unindexed_foreign_keys'),
  ('20260408000014','20260408000014_affective_state_computation_pipeline'),
  ('20260408000015','20260408000015_drop_old_check_and_record_usage_overload'),
  ('20260408000016','20260408000016_create_leaderboard_snapshots'),
  ('20260408000017','20260408000017_daily_cron_secret_secdef_function'),
  ('20260408000018','20260408000018_p5_wave_rollout_feature_flags'),
  ('20260408000019','20260408000019_p5_platform_monitoring_alerts'),
  ('20260408000020','20260408000020_fix_multiple_permissive_policies_consolidation'),
  ('20260408000021','20260408000021_fix_remaining_multiple_permissive_policies'),
  ('20260408000022','20260408000022_phase_c_missing_indexes'),
  ('20260409000001','20260409000001_add_hint_to_questions'),
  ('20260409000002','20260409000002_auto_free_subscription_on_signup'),
  ('20260409000003','20260409000003_diagnostic_assessment_tables'),
  ('20260409000004','20260409000004_monitoring_helper_rpcs'),
  ('20260409000005','20260409000005_add_diagnostic_permissions'),
  ('20260411000001','20260411000001_teacher_assignments_and_submissions'),
  ('20260411120000','20260411120000_observability_console_1a'),
  ('20260412120000','20260412120000_student_impersonation'),
  ('20260412150000','20260412150000_white_label_schools'),
  ('20260413120000','20260413120000_observability_console_1b'),
  ('20260413130000','20260413130000_quiz_responses_written_answer_columns'),
  ('20260413140000','20260413140000_rag_match_return_media'),
  ('20260413160000','20260413160000_foxy_cognitive_columns'),
  ('20260413170000','20260413170000_kill_switch_flags'),
  ('20260414120000','20260414120000_payment_subscribe_atomic_fix'),
  ('20260415000001','20260415000001_subject_governance_schema'),
  ('20260415000002','20260415000002_subject_governance_rpcs'),
  ('20260415000003','20260415000003_subject_enrollment_trigger'),
  ('20260415000004','20260415000004_subject_governance_seed'),
  ('20260415000005','20260415000005_subject_violations_detect'),
  ('20260415000006','20260415000006_subject_violations_repair'),
  ('20260415000007','20260415000007_subject_governance_enable'),
  ('20260415000008','20260415000008_legacy_subjects_archive_rls'),
  ('20260415000009','20260415000009_subject_governance_rpc_dedup'),
  ('20260415000010','20260415000010_subject_violations_rpc'),
  ('20260415000011','20260415000011_subject_governance_rbac_permission'),
  ('20260415000012','20260415000012_subject_rpcs_accept_auth_user_id'),
  ('20260415000013','20260415000013_subject_content_readiness'),
  ('20260415000014','20260415000014_chapters_canonical_master'),
  ('20260415000015','20260415000015_validate_academic_scope'),
  ('20260415000016','20260415000016_match_rag_chunks_ncert_only'),
  ('20260415000017','20260415000017_archive_dead_subject_enrollments'),
  ('20260416000001','20260416000001_performance_score_system'),
  ('20260416200000','20260416200000_tenant_session_var_rls'),
  ('20260416200100','20260416200100_school_admin_extra_permissions'),
  ('20260416210000','20260416210000_phase2_classes_reports'),
  ('20260416220000','20260416220000_school_api_keys'),
  ('20260416230000','20260416230000_phase3_audit_invoices_usage'),
  ('20260416240000','20260416240000_school_admins_table'),
  ('20260417000001','20260417000001_daily_challenge_system'),
  ('20260417100000','20260417100000_rbac_phase1_security_hardening'),
  ('20260417200000','20260417200000_rbac_phase2a_tenant_scoped_schema'),
  ('20260417300000','20260417300000_rbac_phase2b_temporary_access'),
  ('20260417400000','20260417400000_rbac_phase3_cascading_delegation'),
  ('20260417500000','20260417500000_rbac_phase4a_oauth2_platform'),
  ('20260417600000','20260417600000_rbac_b2b_relationship_sync'),
  ('20260417700000','20260417700000_fix_student_id_rls_policies'),
  ('20260418100000','20260418100000_create_cbse_syllabus'),
  ('20260418100100','20260418100100_rag_chunks_constraints'),
  ('20260418100200','20260418100200_question_bank_verification'),
  ('20260418100300','20260418100300_grounded_ai_traces'),
  ('20260418100400','20260418100400_feedback_and_failures'),
  ('20260418100500','20260418100500_syllabus_status_triggers'),
  ('20260418100600','20260418100600_ingestion_gaps_view'),
  ('20260418100700','20260418100700_backfill_helper_rpcs'),
  ('20260418100800','20260418100800_feature_flags'),
  ('20260418100900','20260418100900_content_requests_ist_day'),
  ('20260418101000','20260418101000_subjects_chapters_rpcs_v2'),
  ('20260418101100','20260418101100_claim_verification_batch_rpc'),
  ('20260418101200','20260418101200_coverage_audit_helpers'),
  ('20260418110000','20260418110000_fix_quiz_shuffle_scoring'),
  ('20260418120000','20260418120000_super_admin_access_permission_seed'),
  ('20260418130000','20260418130000_v2_rpcs_include_partial'),
  ('20260418140000','20260418140000_study_path_integrity_guards'),
  ('20260424120000','20260424120000_atomic_subscription_activation_rpc'),
  ('20260425120000','20260425120000_domain_events_outbox'),
  ('20260425130000','20260425130000_first_domain_event_publication'),
  ('20260425140000','20260425140000_e1_quiz_completed_event'),
  ('20260425140100','20260425140100_e2_e3_payment_events'),
  ('20260425140200','20260425140200_e4_subscription_cancelled_event'),
  ('20260425140300','20260425140300_e8_practice_completed_event'),
  ('20260425140400','20260425140400_e5_e6_notification_events'),
  ('20260425140500','20260425140500_ff_atomic_subscription_activation'),
  ('20260425150000','20260425150000_payment_webhook_events'),
  ('20260425150100','20260425150100_pin_search_path_activate_subscription'),
  ('20260425150200','20260425150200_atomic_downgrade_subscription_rpc'),
  ('20260425150300','20260425150300_activate_with_advisory_lock'),
  ('20260425160000','20260425160000_p0_launch_kill_switches_and_expiry_rpc'),
  ('20260426150000','20260426150000_add_ff_welcome_v2'),
  ('20260427000000','20260427000000_rag_chunks_hnsw_index'),
  ('20260427000001','20260427000001_rls_policies_domain_events_webhook_events'),
  ('20260427000002','20260427000002_atomic_plan_change_rpc'),
  ('20260427000003','20260427000003_enforce_daily_xp_cap'),
  ('20260427000004','20260427000004_support_tickets_user_facing_api'),
  ('20260427000100','20260427000100_misconception_ontology'),
  ('20260427000200','20260427000200_irt_calibration_columns'),
  ('20260427000300','20260427000300_retrieval_traces_apply'),
  ('20260428000000','20260428000000_match_rag_chunks_ncert_rrf'),
  ('20260428000100','20260428000100_wrong_answer_remediations'),
  ('20260428000200','20260428000200_fix_kill_switch_rollout_percentage'),
  ('20260428000300','20260428000300_skill_state_teacher_rls_and_retrieval_trace_redaction'),
  ('20260428000400','20260428000400_irt_2pl_calibration_impl'),
  ('20260428000500','20260428000500_misconception_candidate_view'),
  ('20260428000600','20260428000600_select_questions_by_irt_info'),
  ('20260428000700','20260428000700_fix_irt_info_rpc_type')
ON CONFLICT (version) DO NOTHING;
COMMIT;

SELECT (SELECT to_regclass('public.xp_transactions') IS NOT NULL) AS post_xp_tx, (SELECT to_regclass('public.misconceptions') IS NOT NULL) AS post_misc, (SELECT to_regclass('public.student_skill_state') IS NOT NULL) AS post_skill_state, (SELECT to_regprocedure('public.atomic_quiz_profile_update(uuid,text,int,int,int,int,uuid)')::text) AS post_7arg, (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) AS sm_final_count;
