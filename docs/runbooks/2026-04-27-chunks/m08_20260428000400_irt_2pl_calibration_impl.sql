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
