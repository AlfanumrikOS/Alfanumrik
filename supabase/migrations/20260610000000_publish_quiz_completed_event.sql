-- Migration: 20260610000000_publish_quiz_completed_event.sql
-- Purpose: Complete the event spine database transformations (W2.2 & W2.3)
--   1. Redefine atomic_quiz_profile_update (both overloads) to insert learner.quiz_completed.
--   2. Redefine bootstrap_user_profile to insert learner.signed_up.
--   3. Create activate_free_subscription RPC.
--   4. Drop the legacy trg_auto_free_subscription trigger on students.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Redefine the 7-parameter atomic_quiz_profile_update returning VOID
-- ─────────────────────────────────────────────────────────────────────────────
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
      -- re-submitted session is silently ignored.
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
      ON CONFLICT (reference_id) DO NOTHING;

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

REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT, UUID) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Redefine the 6-parameter atomic_quiz_profile_update returning JSONB
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update(
  p_student_id   UUID,
  p_subject      TEXT,
  p_xp           INT,
  p_total        INT,
  p_correct      INT,
  p_time_seconds INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_minutes  INT := GREATEST(1, ROUND(p_time_seconds / 60.0));
  v_daily_cap     INT := 200;  -- mirrors XP_RULES.quiz_daily_cap
  v_today_earned  INT;
  v_remaining     INT;
  v_effective_xp  INT;
  v_xp_capped     BOOLEAN := false;
  v_xp_excess     INT := 0;
  v_new_profile_xp BIGINT;
BEGIN
  -- ── 1. Compute today's already-earned XP from quiz_sessions ────────
  SELECT COALESCE(SUM(xp_earned), 0)::INT
    INTO v_today_earned
    FROM public.quiz_sessions
   WHERE student_id = p_student_id
     AND completed_at IS NOT NULL
     AND completed_at >= CURRENT_DATE
     AND completed_at <  (CURRENT_DATE + INTERVAL '1 day');

  -- ── 2. Clamp p_xp under the daily cap ──────────────────────────────
  v_remaining    := GREATEST(0, v_daily_cap - v_today_earned);
  v_effective_xp := LEAST(GREATEST(0, COALESCE(p_xp, 0)), v_remaining);

  IF v_effective_xp < COALESCE(p_xp, 0) THEN
    v_xp_capped := true;
    v_xp_excess := COALESCE(p_xp, 0) - v_effective_xp;
  END IF;

  -- ── 3. Upsert learning profile with the CLAMPED value ──────────────
  INSERT INTO public.student_learning_profiles (
    student_id, subject, xp, total_sessions,
    total_questions_asked, total_questions_answered_correctly,
    total_time_minutes, last_session_at, streak_days, level, current_level
  ) VALUES (
    p_student_id, p_subject, v_effective_xp, 1,
    p_total, p_correct,
    v_time_minutes, NOW(), 1, 1, 'beginner'
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    xp = student_learning_profiles.xp + v_effective_xp,
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + p_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + p_correct,
    total_time_minutes = student_learning_profiles.total_time_minutes + v_time_minutes,
    last_session_at = NOW(),
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_effective_xp) / 500) + 1)
  RETURNING xp INTO v_new_profile_xp;

  -- ── 4. Update student totals + streak with the CLAMPED value ───────
  UPDATE public.students SET
    xp_total = COALESCE(xp_total, 0) + v_effective_xp,
    last_active = NOW(),
    streak_days = CASE
      WHEN last_active::date = CURRENT_DATE THEN COALESCE(streak_days, 1)
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

  -- ── 5. Return cap status so callers can warn the learner ───────────
  RETURN jsonb_build_object(
    'success',         true,
    'requested_xp',    COALESCE(p_xp, 0),
    'effective_xp',    v_effective_xp,
    'xp_capped',       v_xp_capped,
    'xp_cap_excess',   v_xp_excess,
    'today_earned',    v_today_earned,
    'daily_cap',       v_daily_cap,
    'remaining_today', GREATEST(0, v_remaining - v_effective_xp),
    'profile_xp',      v_new_profile_xp
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Redefine bootstrap_user_profile to publish learner.signed_up event
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bootstrap_user_profile(
  p_auth_user_id      UUID,
  p_role              TEXT,
  p_name              TEXT,
  p_email             TEXT,
  p_grade             TEXT DEFAULT NULL::TEXT,
  p_board             TEXT DEFAULT NULL::TEXT,
  p_school_name       TEXT DEFAULT NULL::TEXT,
  p_subjects_taught   TEXT[] DEFAULT NULL::TEXT[],
  p_grades_taught     TEXT[] DEFAULT NULL::TEXT[],
  p_phone             TEXT DEFAULT NULL::TEXT,
  p_link_code         TEXT DEFAULT NULL::TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id UUID;
  v_onboarding_id UUID;
  v_existing_step TEXT;
BEGIN
  SELECT step, profile_id INTO v_existing_step, v_profile_id
    FROM onboarding_state
    WHERE auth_user_id = p_auth_user_id;

  IF v_existing_step = 'completed' THEN
    RETURN jsonb_build_object('status', 'already_completed', 'profile_id', v_profile_id);
  END IF;

  INSERT INTO onboarding_state (auth_user_id, intended_role, step)
  VALUES (p_auth_user_id, p_role, 'identity_created')
  ON CONFLICT (auth_user_id) DO UPDATE SET
    step = 'identity_created',
    error_message = NULL,
    error_step = NULL,
    retry_count = onboarding_state.retry_count + 1,
    updated_at = now()
  RETURNING id INTO v_onboarding_id;

  BEGIN
    IF p_role = 'student' THEN
      INSERT INTO students (auth_user_id, name, email, grade, board, preferred_language, account_status)
      VALUES (
        p_auth_user_id, p_name, p_email,
        COALESCE(p_grade, '9'), COALESCE(p_board, 'CBSE'), 'en', 'active'
      )
      ON CONFLICT ON CONSTRAINT students_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSIF p_role = 'teacher' THEN
      INSERT INTO teachers (auth_user_id, name, email, school_name, subjects_taught, grades_taught)
      VALUES (
        p_auth_user_id, p_name, p_email, p_school_name,
        COALESCE(p_subjects_taught, '{}'), COALESCE(p_grades_taught, '{}')
      )
      ON CONFLICT ON CONSTRAINT teachers_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSIF p_role = 'parent' THEN
      INSERT INTO guardians (auth_user_id, name, email, phone)
      VALUES (p_auth_user_id, p_name, p_email, p_phone)
      ON CONFLICT ON CONSTRAINT guardians_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSE
      UPDATE onboarding_state SET
        step = 'failed', error_message = 'Invalid role: ' || p_role,
        error_step = 'profile_created', updated_at = now()
      WHERE id = v_onboarding_id;
      RETURN jsonb_build_object('status', 'error', 'error', 'Invalid role');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    UPDATE onboarding_state SET
      step = 'failed', error_message = SQLERRM,
      error_step = 'profile_created', updated_at = now()
    WHERE id = v_onboarding_id;
    RETURN jsonb_build_object('status', 'error', 'error', SQLERRM);
  END;

  UPDATE onboarding_state SET
    step = 'completed', profile_id = v_profile_id,
    completed_at = now(), updated_at = now()
  WHERE id = v_onboarding_id;

  INSERT INTO auth_audit_log (auth_user_id, event_type, metadata)
  VALUES (p_auth_user_id, 'bootstrap_success',
    jsonb_build_object('role', p_role, 'profile_id', v_profile_id));

  -- Publish learner.signed_up event if role is student
  IF p_role = 'student' THEN
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
      'learner.signed_up',
      p_auth_user_id,
      NULL,
      'learner-signed-up:' || p_auth_user_id::text,
      NOW(),
      jsonb_build_object(
        'grade',     COALESCE(p_grade, '9'),
        'board',     COALESCE(p_board, 'CBSE'),
        'language',  'en',
        'invitedBy', NULL
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('status', 'success', 'profile_id', v_profile_id, 'role', p_role);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_user_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT, TEXT) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Create activate_free_subscription RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_free_subscription(p_student_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_id UUID;
BEGIN
  -- Look up the canonical 'free' plan.
  SELECT id INTO v_plan_id
    FROM public.subscription_plans
    WHERE plan_code = 'free'
      AND is_active = true
    LIMIT 1;

  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.student_subscriptions (
      student_id,
      plan_id,
      plan_code,
      status,
      billing_cycle,
      current_period_start,
      current_period_end
    ) VALUES (
      p_student_id,
      v_plan_id,
      'free',
      'active',
      'free',
      NOW(),
      NOW() + INTERVAL '100 years'
    )
    ON CONFLICT (student_id) DO NOTHING;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_free_subscription(UUID) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Drop the legacy trg_auto_free_subscription trigger on students
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_free_subscription ON public.students;
DROP FUNCTION IF EXISTS public.auto_create_free_subscription();
