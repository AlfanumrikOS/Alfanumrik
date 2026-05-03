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
END $$;
