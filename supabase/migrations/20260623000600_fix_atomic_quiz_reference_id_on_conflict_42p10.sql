-- Migration: 20260623000600_fix_atomic_quiz_reference_id_on_conflict_42p10.sql
-- Purpose: Fix 42P10 on the XP-granting path of atomic_quiz_profile_update.
--
-- RCA
-- ====
-- The 7-arg overload public.atomic_quiz_profile_update(
--   p_student_id, p_subject, p_xp, p_total, p_correct, p_time_seconds, p_session_id)
-- (last redefined in 20260610000000_publish_quiz_completed_event.sql) writes the
-- XP ledger row via:
--     INSERT INTO public.xp_transactions (...) VALUES (...)
--     ON CONFLICT (reference_id) DO NOTHING;        -- <-- line 84 of 20260610000000
-- This branch (CASE A) runs whenever a quiz is submitted with a session_id and
-- v_xp_to_award > 0 — i.e. the normal correct-answer / high-XP path for the
-- server-shuffle (v2) submit funnel.
--
-- xp_transactions.reference_id is backed ONLY by a PARTIAL unique index:
--     CREATE UNIQUE INDEX idx_xp_txn_reference_id
--       ON public.xp_transactions (reference_id) WHERE (reference_id IS NOT NULL);
-- PostgreSQL cannot use a partial index for ON CONFLICT inference unless the
-- ON CONFLICT clause carries a WHERE predicate that matches the index predicate.
-- Bare `ON CONFLICT (reference_id)` therefore raises:
--     42P10  there is no unique or exclusion constraint matching the ON CONFLICT specification
-- Reproduced live on prod (project shktyoxqhundlvkiwguu) against a throwaway
-- student: CASE A (session_id set, xp > 0) -> 42P10.
--
-- FIX (Option B — match the EXISTING partial unique index; no schema/data change)
-- ===============================================================================
-- Change the conflict target to include the matching predicate:
--     ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING
-- This is safe because the INSERT only runs inside `IF v_reference_id IS NOT NULL`,
-- so the inserted reference_id is always non-NULL and the partial index always
-- applies. We deliberately do NOT add a full UNIQUE constraint on reference_id:
-- legacy rows (CASE B / award_xp path) carry reference_id = NULL and a full
-- UNIQUE would reject the second NULL... it would not, NULLs are distinct, but a
-- full unique index would still needlessly duplicate the existing partial index.
-- Matching the existing partial index is the minimal correct fix.
--
-- INVARIANTS PRESERVED (byte-for-byte vs 20260610000000):
--   * P1 score: untouched (this function never computes score).
--   * P2 XP economy: daily 200-cap math (v_xp_to_award = GREATEST(0, LEAST(p_xp,
--     200 - v_today_quiz_xp))) is byte-identical; only the ON CONFLICT predicate
--     changed. The increment to students.xp_total / student_learning_profiles.xp
--     is unchanged and still gated on a NEW ledger row (v_rows_inserted > 0).
--   * P4 atomicity: single plpgsql function body = single transaction; unchanged.
--   * SECURITY DEFINER + SET search_path retained; anon EXECUTE re-revoked.
-- Only the 7-arg overload is touched. The 6-arg JSONB overload, 4-arg overload,
-- RLS, and every other ON CONFLICT target are left exactly as deployed.

CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update(
  p_student_id    UUID,
  p_subject       TEXT,
  p_xp            INT,
  p_total         INT,
  p_correct       INT,
  p_time_seconds  INT,
  p_session_id    UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_minutes    INT     := GREATEST(1, ROUND(p_time_seconds / 60.0));
  v_today_quiz_xp   INTEGER := 0;
  v_xp_to_award     INTEGER := 0;
  v_reference_id    TEXT    := NULL;
  v_rows_inserted   INTEGER := 0;
  v_subject_clean   TEXT;
  v_auth_user_id    UUID;
  v_school_id       UUID;
  v_chapter_number  INT;
BEGIN
  -- ── Normalise subject ──────────────────────────────────────────────────────
  v_subject_clean := CASE WHEN p_subject IS NULL OR p_subject = 'unknown'
                          THEN NULL ELSE p_subject END;

  -- ── Step 1: Compute today's already-awarded quiz XP (IST date boundary) ───
  -- P2: daily quiz XP cap = 200. Uses the ledger as the authoritative source.
  SELECT COALESCE(SUM(amount), 0)
    INTO v_today_quiz_xp
  FROM public.xp_transactions
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
      -- re-submitted session is silently ignored. The ON CONFLICT clause carries
      -- the matching WHERE predicate so Postgres can infer the partial index
      -- (without it: 42P10). v_reference_id is always non-NULL inside this branch.
      INSERT INTO public.xp_transactions (
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
      ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

      GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

      -- Only increment students.xp_total when a new ledger row was actually
      -- inserted (i.e. this is not a re-submission).
      IF v_rows_inserted > 0 THEN
        UPDATE public.students SET
          xp_total    = COALESCE(xp_total, 0) + v_xp_to_award,
          last_active = NOW()
        WHERE id = p_student_id;

        -- Increment subject-specific XP in learning profiles if subject known.
        IF v_subject_clean IS NOT NULL THEN
          UPDATE public.student_learning_profiles SET
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
      PERFORM public.award_xp(
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
  INSERT INTO public.student_learning_profiles (
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
  UPDATE public.students SET
    last_active = NOW(),
    streak_days = CASE
      WHEN last_active::date = CURRENT_DATE     THEN COALESCE(streak_days, 1)
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

  -- ── Step 6: Publish state event ──────────────────────────────────────────
  IF p_session_id IS NOT NULL THEN
    -- Resolve auth_user_id and school_id
    SELECT auth_user_id, school_id
      INTO v_auth_user_id, v_school_id
      FROM public.students
     WHERE id = p_student_id;

    IF v_auth_user_id IS NOT NULL THEN
      -- Resolve chapter number from quiz_sessions (inserted by submit_quiz_results_v2)
      SELECT chapter_number INTO v_chapter_number
        FROM public.quiz_sessions
       WHERE id = p_session_id;

      INSERT INTO public.state_events (
        event_id,
        kind,
        actor_auth_user_id,
        tenant_id,
        idempotency_key,
        occurred_at,
        payload
      ) VALUES (
        gen_random_uuid(),
        'learner.quiz_completed',
        v_auth_user_id,
        v_school_id,
        'quiz-completed:' || p_session_id::text,
        NOW(),
        jsonb_build_object(
          'quizSessionId', p_session_id,
          'subjectCode',   COALESCE(v_subject_clean, 'unknown'),
          'chapterNumber', COALESCE(v_chapter_number, 1),
          'questionCount', p_total,
          'correctCount',  p_correct,
          'durationSec',   p_time_seconds,
          'xpEarned',      v_xp_to_award
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;

END;
$$;

-- Re-assert least-privilege: anon must not call the XP-granting overload directly.
REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT, UUID) FROM anon;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT, UUID) IS
  'Atomically records a quiz session: P2 daily 200 XP quiz cap, ledger row, '
  'students.xp_total, student_learning_profiles upsert, streak, and the '
  'learner.quiz_completed state event. 42P10 fix (20260623000600): the '
  'ON CONFLICT (reference_id) clause now carries the matching '
  'WHERE reference_id IS NOT NULL predicate so it can infer the partial unique '
  'index idx_xp_txn_reference_id. SECURITY DEFINER; search_path pinned.';

-- End of migration: 20260623000600_fix_atomic_quiz_reference_id_on_conflict_42p10.sql
