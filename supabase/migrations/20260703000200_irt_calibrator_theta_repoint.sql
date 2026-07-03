-- Migration: 20260703000200_irt_calibrator_theta_repoint.sql
-- Purpose: Task 0.8 — repoint the per-observation theta source of
--          recalibrate_question_irt_2pl from student_skill_state (DEAD: 0 rows,
--          NO writer anywhere in the codebase) to the LIVE
--          student_learning_profiles.irt_theta, which is maintained
--          per-(student, subject) by the trigger trg_quiz_response_irt_theta
--          (Rasch update, already clamped to ±4 at write time).
--
-- Root cause (verified 2026-07-03): since 20260428000400 shipped, the
-- calibrator built each student's theta as AVG(student_skill_state.theta) with
-- COALESCE(..., 0). student_skill_state has never had a writer, so EVERY
-- student's theta was exactly 0, VAR_POP(theta) was exactly 0 for every
-- question, and the degenerate-input gate `v_theta_var < 1e-6` skipped 100% of
-- questions. The nightly cron /api/cron/irt-calibrate has therefore fit 0
-- items since 2026-04-28 (ff_irt_question_selection remains zeroed in prod, so
-- no student-facing selection was affected).
--
-- Change: ONLY the tmp_obs theta source is replaced —
--
--   OLD: per_student_theta CTE averaging student_skill_state.theta (always 0)
--   NEW: LEFT JOIN student_learning_profiles slp
--          ON slp.student_id = r.student_id AND slp.subject = r.subject
--        theta = GREATEST(-4.0, LEAST(4.0, COALESCE(slp.irt_theta, 0)))::NUMERIC
--
-- Join-key verification (baseline 00000000000000_baseline_from_prod.sql):
--   * quiz_responses HAS a `subject` text column (nullable) — the direct join
--     works with no derivation through question_bank. Rows with NULL subject
--     (or no profile yet) COALESCE to theta 0, matching the old fallback.
--   * student_learning_profiles has UNIQUE (student_id, subject)
--     (student_learning_profiles_student_id_subject_key), so the LEFT JOIN can
--     never fan out observations.
--
-- Everything else is copied EXACTLY from the current live body (baseline lines
-- 6103-6284, byte-identical to _legacy/timestamped/20260428000400_irt_2pl_
-- calibration_impl.sql): signature (p_question_id uuid DEFAULT NULL,
-- p_min_attempts int DEFAULT 30), eligibility gates, IRLS loop, bounds
-- a∈[0.3,3.0] b∈[-4,4], per-question exception isolation, return envelope.
-- The variance gate `v_theta_var < 1e-6` is deliberately KEPT: with a live
-- theta source it becomes a meaningful degenerate-input guard instead of a
-- 100%-skip bug.
--
-- SECURITY DEFINER justification (house rule): unchanged from 20260428000400 —
-- the function reads cross-student quiz_responses/profiles and writes
-- question_bank IRT columns, which no caller role may do under RLS; execution
-- is locked to service_role (cron-only) with search_path pinned to public.
--
-- Rollback: the previous body is preserved VERBATIM in
--   supabase/migrations/_legacy/timestamped/20260428000400_irt_2pl_calibration_impl.sql
--   (and in the baseline at lines 6103-6284). To roll back, re-run that
--   CREATE OR REPLACE FUNCTION statement (plus its REVOKE/GRANT footer).
--   No schema or data change here — CREATE OR REPLACE FUNCTION only.
--
-- Idempotent: CREATE OR REPLACE + re-asserted grants. Safe to re-run.

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
      -- Theta repoint (2026-07-03): live per-(student, subject) ability from
      -- student_learning_profiles.irt_theta (Rasch trigger-maintained),
      -- re-clamped to ±4 defensively. Replaces the dead student_skill_state
      -- average that was constantly 0.
      CREATE TEMP TABLE tmp_obs ON COMMIT DROP AS
      SELECT GREATEST(-4.0, LEAST(4.0, COALESCE(slp.irt_theta, 0)))::NUMERIC AS theta,
             CASE WHEN r.is_correct THEN 1 ELSE 0 END::INT AS y
        FROM quiz_responses r
        LEFT JOIN student_learning_profiles slp
          ON slp.student_id = r.student_id AND slp.subject = r.subject
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
  'Per question: gather (theta, is_correct) with theta from LIVE '
  'student_learning_profiles.irt_theta per (student, subject) — repointed '
  '2026-07-03 from the dead student_skill_state proxy that variance-gated '
  '100% of questions. Fit (alpha, beta) via WLS iteration, recover '
  '(a = alpha, b = -beta/alpha). Bound a in [0.3,3.0], b in [-4.0,4.0]. '
  'Updates question_bank IRT columns. Returns JSON summary. Cron-callable '
  'via /api/cron/irt-calibrate.';

-- Re-assert execution posture: service_role only (CREATE OR REPLACE preserves
-- the existing ACL, but re-asserting keeps the 20260516040000/20260516050000
-- lockdown explicit and makes this file self-contained on fresh DBs).
REVOKE ALL ON FUNCTION recalibrate_question_irt_2pl(UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recalibrate_question_irt_2pl(UUID, INT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION recalibrate_question_irt_2pl(UUID, INT) TO service_role;
