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
