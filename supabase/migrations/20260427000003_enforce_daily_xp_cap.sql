-- Migration: 20260427000003_enforce_daily_xp_cap.sql
-- Purpose: Enforce the P2 daily XP cap (200 XP/day) inside the
--          atomic_quiz_profile_update RPC. Today the RPC adds the full
--          p_xp argument to students.xp_total without checking the daily
--          aggregate, allowing client-side or server-side callers to
--          award unbounded XP per day.
--
-- Audit finding closed:
--   Red (assessment domain): atomic_quiz_profile_update
--   (supabase/migrations/20260325160000_atomic_quiz_profile_update.sql)
--   does not enforce XP_RULES.quiz_daily_cap declared in
--   src/lib/xp-rules.ts:59 (= 200). Exploitable via repeated submissions.
--
-- Source of truth:
--   Daily cap = src/lib/xp-rules.ts XP_RULES.quiz_daily_cap (200).
--   Keep these in sync. Score formula and XP formula remain unchanged
--   (P1, P2): only the daily aggregate cap is enforced.
--
-- Daily-XP source table assumption:
--   Per the legacy schema (supabase/migrations/_legacy/000_core_schema.sql)
--   and the submit-quiz writers (e.g.
--   supabase/migrations/20260324043526_dashboard_rpcs_submit_quiz_and_ddl.sql),
--   quiz_sessions has columns:
--     - xp_earned   INTEGER
--     - completed_at TIMESTAMPTZ
--     - student_id  UUID
--   We sum xp_earned over completed_at >= CURRENT_DATE for the student.
--   The RPC also writes to student_learning_profiles.xp; that is per
--   (student, subject) and not used for the daily cap.
--
-- Behavior:
--   - Compute today_earned = sum(quiz_sessions.xp_earned) for student
--     where completed_at >= CURRENT_DATE.
--   - effective_xp = LEAST(p_xp, GREATEST(0, 200 - today_earned)).
--     i.e. clamp to whatever headroom remains under 200 today.
--   - effective_xp is used everywhere downstream (students.xp_total,
--     student_learning_profiles.xp, level recompute).
--   - If effective_xp < p_xp, we set xp_capped = true and report the
--     excess via the new return JSONB. Existing void-return callers
--     keep working because we change the return type to JSONB but
--     plpgsql callers that ignored the return value are unaffected.
--     Application code that needs the cap-status reads the JSON.
--
-- Safety:
--   - CREATE OR REPLACE FUNCTION: idempotent
--   - Return type changes from VOID to JSONB. plpgsql callers using
--     PERFORM remain compatible. There are no in-tree SQL callers that
--     bind the previous void return; application calls go via supabase-js
--     .rpc() which treats both shapes the same. If a caller ever did
--     `SELECT atomic_quiz_profile_update(...)` expecting void, the new
--     JSONB return is still readable as a single column.
--   - SECURITY DEFINER preserved (existing semantics).
--   - search_path pinned to public, pg_temp.
--   - No DROP / no ALTER on existing tables.

BEGIN;

-- Daily cap source of truth: src/lib/xp-rules.ts XP_RULES.quiz_daily_cap (200).
-- Keep these in sync.
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
AS $function$
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
  -- Source table assumption (documented in header). If the schema ever
  -- moves the per-session XP elsewhere, this query must move with it.
  SELECT COALESCE(SUM(xp_earned), 0)::INT
    INTO v_today_earned
    FROM quiz_sessions
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
  -- (atomic increments — no read-modify-write race).
  INSERT INTO student_learning_profiles (
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
    -- Level recompute uses the post-add XP (clamped).
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_effective_xp) / 500) + 1)
  RETURNING xp INTO v_new_profile_xp;

  -- ── 4. Update student totals + streak with the CLAMPED value ───────
  UPDATE students SET
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
$function$;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT) IS
  'Atomic quiz profile + student XP update with the P2 daily XP cap (200) enforced. Daily cap source of truth: src/lib/xp-rules.ts XP_RULES.quiz_daily_cap. Returns JSONB with effective_xp / xp_capped / today_earned for the caller to surface to the learner.';

COMMIT;
