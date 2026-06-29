-- Migration: 20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql
-- Purpose: SLC-1 — make public.atomic_quiz_profile_update the SOLE XP writer for
--          quiz submissions. Neuter the quiz_sessions completion trigger function
--          public.fn_quiz_session_sync_profile() to its non-duplicate side-effect
--          ONLY (student_learning_profiles streak maintenance), and REMOVE the
--          duplicate, UNCAPPED XP / xp_total / level / counter writes.
--
-- ============================================================================
-- WHY (P2 economy de-duplication — NOT an economy change)
-- ============================================================================
-- The AFTER INSERT/UPDATE trigger trg_quiz_session_sync_profile fires the moment
-- a completed quiz_sessions row is inserted. In every active submit path
-- (submit_quiz_results v1 @ baseline 7409->7549, submit_quiz_results_v2, the
-- client fallback, and all mobile paths) that INSERT happens BEFORE the path's
-- PERFORM atomic_quiz_profile_update(...) call. So the trigger ran first and the
-- capped RPC ran second — BOTH incremented students.xp_total and
-- student_learning_profiles.xp. The trigger's 5-second "already synced" window
-- (baseline 3848-3859) only suppresses when a prior same-subject session wrote
-- last_session_at within 5s, which is the rare back-to-back case; for a normal
-- isolated quiz the window does NOT suppress, so XP was awarded TWICE — and the
-- trigger's half bypassed the 200/day cap and the xp_transactions ledger.
--
-- The authoritative RPC atomic_quiz_profile_update (baseline 794-956) is a strict
-- superset of the trigger's XP work: it caps to 200/day via the ledger
-- (GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp)) @ 821), writes an idempotent
-- ledger row keyed reference_id = 'quiz_<session_id>' ON CONFLICT DO NOTHING (854),
-- and only then increments students.xp_total (862) + student_learning_profiles.xp
-- (869), upserts profile counters/level (907-940), and maintains
-- students.streak_days (946-953). It is invoked on 100% of confirmed completion
-- paths (web v1 + v2, client fallback, mobile online + offline-replay), so it
-- remains the single writer after this change — no under-award.
--
-- This migration removes the duplicate uncapped writer so the capped RPC is the
-- SOLE XP writer. It is a pure de-duplication.
--
-- ============================================================================
-- XP VALUES UNCHANGED
-- ============================================================================
-- The per-correct (10), high-score bonus (20 @ score>=80), perfect bonus
-- (50 @ score=100) literals and the 200/day cap are NOT touched anywhere. They
-- live solely in atomic_quiz_profile_update (cap @ 821) and src/lib/xp-config.ts.
-- Per-quiz user-facing xp_earned (the RPC return value) is unchanged. This
-- migration changes only WHICH writer increments the cached totals (RPC only),
-- not how much XP a quiz is worth.
--
-- ============================================================================
-- REMOVED vs KEPT (line cites into 00000000000000_baseline_from_prod.sql)
-- ============================================================================
-- REMOVED (all duplicated by the capped RPC):
--   * v_xp DECLARE + the XP computation .............. baseline 3835, 3861-3864
--   * profile xp / level / total_sessions /
--     total_questions_asked /
--     total_questions_answered_correctly /
--     total_time_minutes columns from the upsert ...... baseline 3867-3882
--       (RPC owns these: xp @ 869, counters/level @ 907-940)
--   * UPDATE students SET xp_total / last_active ...... baseline 3897-3901
--       (RPC owns these: xp_total @ 862 / last_active @ 863 & 947)
--
-- KEPT (NOT written by the RPC — must keep or the progress stat freezes):
--   * student_learning_profiles.streak_days   day-delta CASE ... baseline 3884-3888
--   * student_learning_profiles.longest_streak GREATEST ........ baseline 3889-3895
--       (the RPC's profile upsert @ 907-940 never touches streak_days/longest_streak;
--        the RPC maintains streak only on students.streak_days @ 946-953)
--   * the is_completed early-return guards .................... baseline 3839-3844
--   * v_subject normalisation ................................ baseline 3846
--   * the 5-second "already synced" window .................. baseline 3848-3859
--       (kept verbatim so the EXACT set of conditions under which the trigger
--        mutates the profile is preserved; it is now a no-op-equivalent for the
--        day-granular streak — back-to-back same-day quizzes leave streak_days
--        unchanged whether or not the window suppresses)
--   * last_session_at = NOW() as the streak anchor write ..... baseline 3883
--       (Q2: trigger runs BEFORE the RPC, so the streak CASE reads the PRE-RPC
--        last_session_at as its day-delta anchor; the RPC then re-stamps
--        last_session_at @ 937. Both write NOW(); final state is identical.)
--   * the error-isolating EXCEPTION WHEN OTHERS ............. baseline 3904-3906
--
-- The brand-new-profile case is preserved exactly: the reduced INSERT sets
-- streak_days = 1 and omits longest_streak (-> column DEFAULT 0), matching the
-- original INSERT's streak outcome (original also omitted longest_streak).
-- All dropped columns have table-level DEFAULTs (xp/streak_days/longest_streak/
-- counters DEFAULT 0, level DEFAULT 1, current_level DEFAULT 'beginner'), so the
-- reduced INSERT is well-formed.
--
-- ============================================================================
-- SAFETY POSTURE
-- ============================================================================
--   * Idempotent: CREATE OR REPLACE FUNCTION. The trigger binding
--     trg_quiz_session_sync_profile is UNCHANGED (NOT dropped, NOT recreated).
--   * No table / column / index / RLS / RBAC change. No DROP. No new SECURITY
--     DEFINER posture: the function keeps the ORIGINAL's SECURITY DEFINER +
--     SET search_path = 'public', 'pg_temp' verbatim. SECURITY DEFINER is
--     required because this AFTER trigger writes student_learning_profiles
--     across RLS boundaries on behalf of the inserting session.
--   * atomic_quiz_profile_update is NOT touched -> P1/P2/P4 formulas, ledger, and
--     the 200/day cap are all unchanged.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Re-run CREATE OR REPLACE FUNCTION public.fn_quiz_session_sync_profile() with
-- the ORIGINAL body verbatim from baseline 3828-3908 (the body that recomputes
-- v_xp and writes xp/level/counters/xp_total). Never DROP in panic. The original
-- body is reproduced as a reference comment at the bottom of this file.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."fn_quiz_session_sync_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_subject TEXT;
  v_today DATE := CURRENT_DATE;
  v_already_synced BOOLEAN;
BEGIN
  -- Only fire when is_completed flips to TRUE
  IF NEW.is_completed IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_completed IS TRUE THEN
    RETURN NEW;
  END IF;

  v_subject := LOWER(COALESCE(NEW.subject, 'math'));

  -- Preserved verbatim from the original: skip if this subject's profile was
  -- touched within the last 5 seconds. Now a no-op-equivalent for the day-granular
  -- streak, kept only to preserve the exact firing conditions of the trigger.
  SELECT EXISTS(
    SELECT 1 FROM student_learning_profiles
    WHERE student_id = NEW.student_id
      AND subject = v_subject
      AND last_session_at > NOW() - INTERVAL '5 seconds'
  ) INTO v_already_synced;

  IF v_already_synced THEN
    RETURN NEW;  -- already handled
  END IF;

  -- SLC-1: STREAK-ONLY maintenance. NO XP, NO level, NO counters, NO
  -- students.xp_total -- those are owned exclusively by the capped RPC
  -- atomic_quiz_profile_update (the single XP writer). This block maintains ONLY
  -- the two profile columns the RPC does not write: streak_days + longest_streak.
  INSERT INTO student_learning_profiles (
    student_id, subject, last_session_at, streak_days
  ) VALUES (
    NEW.student_id, v_subject, NOW(), 1
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    last_session_at = NOW(),
    streak_days = CASE
      WHEN DATE(student_learning_profiles.last_session_at) = v_today THEN student_learning_profiles.streak_days
      WHEN DATE(student_learning_profiles.last_session_at) = v_today - 1 THEN student_learning_profiles.streak_days + 1
      ELSE 1
    END,
    longest_streak = GREATEST(
      student_learning_profiles.longest_streak,
      CASE
        WHEN DATE(student_learning_profiles.last_session_at) = v_today - 1 THEN student_learning_profiles.streak_days + 1
        ELSE student_learning_profiles.streak_days
      END
    );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[profile_sync_trigger] Error for student=% subject=%: %', NEW.student_id, v_subject, SQLERRM;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- ROLLBACK REFERENCE — original body (baseline 3828-3908), verbatim.
-- To revert: uncomment and run.
-- ============================================================================
-- CREATE OR REPLACE FUNCTION "public"."fn_quiz_session_sync_profile"() RETURNS "trigger"
--     LANGUAGE "plpgsql" SECURITY DEFINER
--     SET "search_path" TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_subject TEXT;
--   v_today DATE := CURRENT_DATE;
--   v_xp INTEGER;
--   v_already_synced BOOLEAN;
-- BEGIN
--   IF NEW.is_completed IS NOT TRUE THEN
--     RETURN NEW;
--   END IF;
--   IF TG_OP = 'UPDATE' AND OLD.is_completed IS TRUE THEN
--     RETURN NEW;
--   END IF;
--   v_subject := LOWER(COALESCE(NEW.subject, 'math'));
--   SELECT EXISTS(
--     SELECT 1 FROM student_learning_profiles
--     WHERE student_id = NEW.student_id
--       AND subject = v_subject
--       AND last_session_at > NOW() - INTERVAL '5 seconds'
--   ) INTO v_already_synced;
--   IF v_already_synced THEN
--     RETURN NEW;
--   END IF;
--   v_xp := COALESCE(NEW.correct_answers, 0) * 10;
--   IF COALESCE(NEW.score_percent, 0) >= 80 THEN v_xp := v_xp + 20; END IF;
--   IF COALESCE(NEW.score_percent, 0) = 100 THEN v_xp := v_xp + 50; END IF;
--   INSERT INTO student_learning_profiles (
--     student_id, subject, xp, level, total_sessions,
--     total_questions_asked, total_questions_answered_correctly,
--     total_time_minutes, last_session_at, streak_days
--   ) VALUES (
--     NEW.student_id, v_subject, v_xp, GREATEST(1, v_xp / 500 + 1), 1,
--     COALESCE(NEW.total_questions, 0), COALESCE(NEW.correct_answers, 0),
--     GREATEST(1, COALESCE(NEW.time_taken_seconds, 60) / 60), NOW(), 1
--   )
--   ON CONFLICT (student_id, subject) DO UPDATE SET
--     xp = student_learning_profiles.xp + EXCLUDED.xp,
--     level = GREATEST(1, (student_learning_profiles.xp + EXCLUDED.xp) / 500 + 1),
--     total_sessions = student_learning_profiles.total_sessions + 1,
--     total_questions_asked = student_learning_profiles.total_questions_asked + EXCLUDED.total_questions_asked,
--     total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + EXCLUDED.total_questions_answered_correctly,
--     total_time_minutes = student_learning_profiles.total_time_minutes + EXCLUDED.total_time_minutes,
--     last_session_at = NOW(),
--     streak_days = CASE
--       WHEN DATE(student_learning_profiles.last_session_at) = v_today THEN student_learning_profiles.streak_days
--       WHEN DATE(student_learning_profiles.last_session_at) = v_today - 1 THEN student_learning_profiles.streak_days + 1
--       ELSE 1
--     END,
--     longest_streak = GREATEST(
--       student_learning_profiles.longest_streak,
--       CASE
--         WHEN DATE(student_learning_profiles.last_session_at) = v_today - 1 THEN student_learning_profiles.streak_days + 1
--         ELSE student_learning_profiles.streak_days
--       END
--     );
--   UPDATE students
--   SET xp_total = COALESCE(xp_total, 0) + v_xp,
--       last_active = NOW()
--   WHERE id = NEW.student_id;
--   RETURN NEW;
-- EXCEPTION WHEN OTHERS THEN
--   RAISE WARNING '[profile_sync_trigger] Error for student=% subject=%: %', NEW.student_id, v_subject, SQLERRM;
--   RETURN NEW;
-- END;
-- $$;
