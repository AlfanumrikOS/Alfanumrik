-- Migration: 20260616000100_eic_aggregation_functions.sql
-- Purpose: Track 1 "Education Intelligence Cloud" v1 — nightly aggregation
--          functions that POPULATE the five rollup tables created in
--          20260616000000_education_intelligence_cloud_v1.sql:
--            public.school_health_daily
--            public.mrr_snapshots
--            public.school_mrr_daily
--            public.school_churn_signals
--            public.geographic_metrics
--          DESIGN + PARAMETERS APPROVED BY CEO.
--
-- ─── SAFETY / STYLE CONTRACT ─────────────────────────────────────────────────
--   - SECURITY DEFINER + SET search_path = public, mirroring the baseline
--     analytics writer public.record_platform_health_snapshot() (baseline file
--     line 6472). The nightly cron runs as service_role and invokes these.
--   - EXECUTE granted to service_role ONLY. We REVOKE the default
--     PUBLIC/anon/authenticated EXECUTE that Postgres grants on new functions
--     so a logged-in student/teacher can never trigger an aggregation.
--   - IDEMPOTENT. Every writer is INSERT ... ON CONFLICT (<unique key>) DO
--     UPDATE, so a re-run on the same p_date overwrites the same row(s).
--     Safe to run twice in one night (P-invariant: daily-cron idempotency).
--   - AGGREGATES ONLY, NO PII. Only school_id (uuid), geo text keys, and
--     pre-aggregated counts/scores are written. No student id/name/email/phone.
--     P13 clean by construction.
--   - READ-MODEL ONLY. No source table is mutated. No DROP of anything.
--   - DEPENDENCY ORDER. compute_education_intelligence_rollup(p_date) calls,
--     IN ORDER: (a) school_health_daily, (b) mrr_snapshot + school_mrr_daily,
--     (c) school_churn_signals, (d) geographic_metrics. (d) reads the rows
--     written by (a)/(b)/(c) for the SAME p_date, so order matters.
--
-- ─── DOCUMENTED CHOICES (CEO-confirmed parameters in CAPS) ────────────────────
--   HEALTH COMPOSITE WEIGHTS: adoption 0.20, engagement 0.25, outcomes 0.25,
--     retention 0.20, usage 0.10 (sum = 1.0).
--   HEALTH TIERS: composite >= 80 'elite', >= 60 'healthy',
--     >= 40 'needs_attention', else 'critical'.
--   CHURN BANDS: risk_score >= 75 'critical', >= 50 'high', >= 25 'medium',
--     else 'low'.
--   TARGET_SESSIONS_PER_MONTH = 20. Chosen as the "fully-engaged active student"
--     monthly volume of learning sessions (quiz + foxy). usage_score saturates
--     at 100 when an active student averages >= 20 sessions/month. ~1 session per
--     school-day; documented + tunable in one place (the constant below).
--   ENGAGEMENT BLEND: engagement_score = 0.5 * stickiness + 0.5 * volume_factor,
--     where stickiness = dau/mau*100 (DAU/MAU ratio, 0..100) and volume_factor =
--     min(100, (quiz_count+foxy_count)/active_students / ENGAGEMENT_TARGET * 100)
--     with ENGAGEMENT_TARGET = 30 sessions/active-student/month treated as the
--     "saturated" engagement volume. Both halves clamped, then blended.
--   NULL-OUTCOMES HANDLING: when a school has zero completed quizzes in the
--     trailing 30d, outcomes_score is NULL (avg over no rows). For the COMPOSITE
--     we RENORMALIZE the remaining four weights to sum to 1.0 (drop outcomes,
--     scale adoption/engagement/retention/usage by 1/(1-0.25)) rather than
--     treating outcomes as 0 — a school that simply hasn't run quizzes yet is
--     not "0% outcomes". The outcomes_score column still stores NULL for
--     transparency on the dashboard.
--   MRR new/expansion/churn METHOD: delta vs the immediately-prior
--     mrr_snapshots row (max snapshot_date < p_date). new = max(0, total_mrr -
--     prior_total) attributed to growth; expansion is folded into new for v1
--     (we cannot separate brand-new accounts from upgrades without per-sub
--     lineage — documented as a v2 refinement); churn = max(0, prior_total -
--     total_mrr). If there is no prior snapshot, all three are NULL (no baseline
--     to diff). This is an approximation flagged for the dashboard.
--   CHURN RISK WEIGHTS (heuristic, each driver maps to 0..100 then weighted):
--     renewal_proximity 0.35, seat_utilization 0.25, engagement_trend 0.25,
--     payment_failures 0.15 (sum = 1.0). See per-driver mapping in
--     compute_school_churn_signals below. Final risk_score clamped to [0,100].
--   PAYMENT_FAILURES SOURCE: public.payment_history rows with status = 'failed'
--     in the trailing 90 days, attributed to a school via the failing student's
--     students.school_id. NOTE: B2B school_subscriptions payment failures are
--     NOT modelled in payment_history (that table is per-student / B2C), so this
--     count reflects the school's STUDENTS' B2C payment failures. Documented so
--     the dashboard does not over-read it. If 0 rows match, the driver is 0.
--   GEO 'Unknown' BUCKET: schools.state / schools.city that are NULL or blank
--     (after trim) bucket into geo_key = 'Unknown'.
--   ALL pillar / composite / risk scores are CLAMPED to [0,100] in SQL (not via
--     a DB CHECK) using a local clamp helper.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Local helper: clamp a numeric into [0,100]. IMMUTABLE so the planner can
-- inline it. NULL passes through (so NULL outcomes stay NULL).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eic_clamp_0_100(p_val numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN p_val IS NULL THEN NULL
           WHEN p_val < 0     THEN 0
           WHEN p_val > 100   THEN 100
           ELSE p_val
         END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- (a) compute_school_health_daily — per active school 5-pillar health + composite
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_school_health_daily(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- CEO-confirmed composite weights.
  w_adoption   constant numeric := 0.20;
  w_engagement constant numeric := 0.25;
  w_outcomes   constant numeric := 0.25;
  w_retention  constant numeric := 0.20;
  w_usage      constant numeric := 0.10;
  -- Documented usage / engagement saturation targets.
  target_sessions_per_month   constant numeric := 20;  -- usage_score saturates here
  engagement_volume_target    constant numeric := 30;  -- engagement volume saturates here
  v_window_start timestamptz := (p_date::timestamptz - interval '30 days');
  v_dau_since    timestamptz := (p_date::timestamptz - interval '24 hours');
  v_rows integer := 0;
BEGIN
  WITH active_schools AS (
    SELECT s.id AS school_id,
           COALESCE(s.max_students, 0) AS max_students
    FROM public.schools s
    WHERE s.is_active = true
      AND s.deleted_at IS NULL
  ),
  -- Student population per school (active, non-deleted).
  student_pop AS (
    SELECT st.school_id,
           count(*) FILTER (WHERE st.is_active = true)                                   AS active_students,
           count(*) FILTER (WHERE st.is_active = true AND st.last_active >= v_dau_since)  AS dau,
           count(*) FILTER (WHERE st.is_active = true AND st.last_active >= v_window_start) AS mau
    FROM public.students st
    WHERE st.school_id IS NOT NULL
      AND st.deleted_at IS NULL
    GROUP BY st.school_id
  ),
  -- Quiz activity in the trailing 30d, attributed to a school via the student.
  quiz_act AS (
    SELECT st.school_id,
           count(*) FILTER (WHERE q.is_completed = true)                          AS quiz_count,
           avg(q.score_percent) FILTER (WHERE q.is_completed = true)              AS avg_quiz_score
    FROM public.quiz_sessions q
    JOIN public.students st ON st.id = q.student_id
    WHERE q.created_at >= v_window_start
      AND st.school_id IS NOT NULL
      AND st.deleted_at IS NULL
    GROUP BY st.school_id
  ),
  -- Foxy activity in the trailing 30d (foxy_sessions has no school_id → join students).
  foxy_act AS (
    SELECT st.school_id,
           count(*) AS foxy_count
    FROM public.foxy_sessions f
    JOIN public.students st ON st.id = f.student_id
    WHERE f.created_at >= v_window_start
      AND st.school_id IS NOT NULL
      AND st.deleted_at IS NULL
    GROUP BY st.school_id
  ),
  -- Latest seat-usage snapshot per school (for the seats denominator).
  latest_seats AS (
    SELECT DISTINCT ON (su.school_id)
           su.school_id,
           su.seats_purchased
    FROM public.school_seat_usage su
    WHERE su.snapshot_date <= p_date
    ORDER BY su.school_id, su.snapshot_date DESC
  ),
  -- Active school_subscriptions seats (secondary denominator source).
  sub_seats AS (
    SELECT ss.school_id,
           max(ss.seats_purchased) AS seats_purchased
    FROM public.school_subscriptions ss
    WHERE ss.status = 'active'
    GROUP BY ss.school_id
  ),
  base AS (
    SELECT
      a.school_id,
      COALESCE(sp.active_students, 0) AS active_students,
      COALESCE(sp.dau, 0)             AS dau,
      COALESCE(sp.mau, 0)             AS mau,
      COALESCE(qa.quiz_count, 0)      AS quiz_count,
      qa.avg_quiz_score,
      COALESCE(fa.foxy_count, 0)      AS foxy_count,
      -- seats := latest seat_usage → else active school_subscriptions → else max_students.
      COALESCE(ls.seats_purchased, sus.seats_purchased, NULLIF(a.max_students, 0)) AS seats
    FROM active_schools a
    LEFT JOIN student_pop  sp  ON sp.school_id  = a.school_id
    LEFT JOIN quiz_act     qa  ON qa.school_id  = a.school_id
    LEFT JOIN foxy_act     fa  ON fa.school_id  = a.school_id
    LEFT JOIN latest_seats ls  ON ls.school_id  = a.school_id
    LEFT JOIN sub_seats    sus ON sus.school_id = a.school_id
  ),
  scored AS (
    SELECT
      b.*,
      (b.quiz_count + b.foxy_count) AS total_sessions,
      -- adoption: active students / seats.
      public.eic_clamp_0_100(
        b.active_students::numeric / NULLIF(b.seats, 0) * 100
      ) AS adoption_score,
      -- engagement: 0.5*stickiness(dau/mau) + 0.5*volume(sessions/active / target).
      public.eic_clamp_0_100(
        0.5 * public.eic_clamp_0_100(b.dau::numeric / NULLIF(b.mau, 0) * 100)
        + 0.5 * public.eic_clamp_0_100(
            (b.quiz_count + b.foxy_count)::numeric
              / NULLIF(b.active_students, 0)
              / engagement_volume_target * 100
          )
      ) AS engagement_score,
      -- outcomes: trailing-30d avg quiz score (NULL when no completed quizzes).
      public.eic_clamp_0_100(b.avg_quiz_score) AS outcomes_score,
      -- retention: mau / active_students (capped 100).
      public.eic_clamp_0_100(
        b.mau::numeric / NULLIF(b.active_students, 0) * 100
      ) AS retention_score,
      -- usage: sessions/active / TARGET_SESSIONS_PER_MONTH.
      public.eic_clamp_0_100(
        (b.quiz_count + b.foxy_count)::numeric
          / NULLIF(b.active_students, 0)
          / target_sessions_per_month * 100
      ) AS usage_score
    FROM base b
  ),
  composed AS (
    SELECT
      sc.*,
      CASE
        WHEN sc.outcomes_score IS NULL THEN
          -- Renormalize the remaining four weights to sum to 1.0 (drop outcomes).
          public.eic_clamp_0_100(
            (
              COALESCE(sc.adoption_score, 0)   * w_adoption
            + COALESCE(sc.engagement_score, 0) * w_engagement
            + COALESCE(sc.retention_score, 0)  * w_retention
            + COALESCE(sc.usage_score, 0)      * w_usage
            ) / (w_adoption + w_engagement + w_retention + w_usage)
          )
        ELSE
          public.eic_clamp_0_100(
              COALESCE(sc.adoption_score, 0)   * w_adoption
            + COALESCE(sc.engagement_score, 0) * w_engagement
            + COALESCE(sc.outcomes_score, 0)   * w_outcomes
            + COALESCE(sc.retention_score, 0)  * w_retention
            + COALESCE(sc.usage_score, 0)      * w_usage
          )
      END AS composite_score
    FROM scored sc
  ),
  finalized AS (
    SELECT
      c.*,
      CASE
        WHEN c.composite_score >= 80 THEN 'elite'
        WHEN c.composite_score >= 60 THEN 'healthy'
        WHEN c.composite_score >= 40 THEN 'needs_attention'
        ELSE 'critical'
      END AS tier
    FROM composed c
  ),
  upsert AS (
    INSERT INTO public.school_health_daily AS shd (
      school_id, score_date,
      adoption_score, engagement_score, outcomes_score, retention_score, usage_score,
      composite_score, tier,
      dau, mau, active_students, avg_quiz_score, quiz_count, foxy_count,
      computed_at
    )
    SELECT
      f.school_id, p_date,
      f.adoption_score, f.engagement_score, f.outcomes_score, f.retention_score, f.usage_score,
      f.composite_score, f.tier,
      f.dau, f.mau, f.active_students, f.outcomes_score, f.quiz_count, f.foxy_count,
      now()
    FROM finalized f
    ON CONFLICT (school_id, score_date) DO UPDATE SET
      adoption_score   = EXCLUDED.adoption_score,
      engagement_score = EXCLUDED.engagement_score,
      outcomes_score   = EXCLUDED.outcomes_score,
      retention_score  = EXCLUDED.retention_score,
      usage_score      = EXCLUDED.usage_score,
      composite_score  = EXCLUDED.composite_score,
      tier             = EXCLUDED.tier,
      dau              = EXCLUDED.dau,
      mau              = EXCLUDED.mau,
      active_students  = EXCLUDED.active_students,
      avg_quiz_score   = EXCLUDED.avg_quiz_score,
      quiz_count       = EXCLUDED.quiz_count,
      foxy_count       = EXCLUDED.foxy_count,
      computed_at      = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upsert;

  RETURN v_rows;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- (b1) compute_mrr_snapshot — platform-wide MRR/ARR daily snapshot (one row/day)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_mrr_snapshot(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_mrr   numeric := 0;
  v_school_mrr    numeric := 0;
  v_total_mrr     numeric := 0;
  v_active_subs   integer := 0;
  v_prior_total   numeric;
  v_new_mrr       numeric;
  v_expansion_mrr numeric;
  v_churn_mrr     numeric;
BEGIN
  -- Student (B2C) MRR: monthly-normalized amount_paid over active/past_due subs
  -- whose period has not ended. amount_paid is RUPEES (verified: set from
  -- amount_inr / whole-rupee plan prices — NOT paise), so NO /100 conversion.
  SELECT
    COALESCE(SUM(
      CASE
        WHEN ss.billing_cycle = 'monthly' THEN ss.amount_paid::numeric
        ELSE ss.amount_paid::numeric / 12.0   -- yearly (and any non-monthly) → /12
      END
    ), 0),
    count(*)
  INTO v_student_mrr, v_active_subs
  FROM public.student_subscriptions ss
  WHERE ss.status IN ('active', 'past_due')
    AND ss.current_period_end > now();

  -- School (B2B) MRR: seats × per-seat monthly price over active school subs.
  -- price_per_seat_monthly is already a monthly figure → no normalization.
  SELECT COALESCE(SUM(
           COALESCE(sc.seats_purchased, 0)::numeric
             * COALESCE(sc.price_per_seat_monthly, 0)
         ), 0)
  INTO v_school_mrr
  FROM public.school_subscriptions sc
  WHERE sc.status = 'active';

  v_total_mrr := COALESCE(v_student_mrr, 0) + COALESCE(v_school_mrr, 0);

  -- new / expansion / churn vs the immediately-prior snapshot (see header DOC).
  SELECT m.total_mrr
  INTO v_prior_total
  FROM public.mrr_snapshots m
  WHERE m.snapshot_date < p_date
  ORDER BY m.snapshot_date DESC
  LIMIT 1;

  IF v_prior_total IS NULL THEN
    v_new_mrr       := NULL;
    v_expansion_mrr := NULL;
    v_churn_mrr     := NULL;
  ELSE
    v_new_mrr       := GREATEST(0, v_total_mrr - v_prior_total);
    v_expansion_mrr := 0;  -- folded into new_mrr for v1 (no per-sub lineage yet)
    v_churn_mrr     := GREATEST(0, v_prior_total - v_total_mrr);
  END IF;

  INSERT INTO public.mrr_snapshots AS m (
    snapshot_date, total_mrr, student_mrr, school_mrr,
    new_mrr, expansion_mrr, churn_mrr, arr, active_subscriptions, currency, computed_at
  )
  VALUES (
    p_date, v_total_mrr, v_student_mrr, v_school_mrr,
    v_new_mrr, v_expansion_mrr, v_churn_mrr, v_total_mrr * 12, v_active_subs, 'INR', now()
  )
  ON CONFLICT (snapshot_date) DO UPDATE SET
    total_mrr            = EXCLUDED.total_mrr,
    student_mrr          = EXCLUDED.student_mrr,
    school_mrr           = EXCLUDED.school_mrr,
    new_mrr              = EXCLUDED.new_mrr,
    expansion_mrr        = EXCLUDED.expansion_mrr,
    churn_mrr            = EXCLUDED.churn_mrr,
    arr                  = EXCLUDED.arr,
    active_subscriptions = EXCLUDED.active_subscriptions,
    currency             = EXCLUDED.currency,
    computed_at          = now();

  RETURN 1;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- (b2) compute_school_mrr_daily — per-school MRR variant (separate table)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_school_mrr_daily(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH per_school AS (
    SELECT
      sc.school_id,
      -- One active sub assumed per school; SUM handles the (rare) multi-row case.
      SUM(COALESCE(sc.seats_purchased, 0))                                          AS seats_purchased,
      -- monthly-normalized MRR: seats × per-seat-monthly (already monthly).
      SUM(COALESCE(sc.seats_purchased, 0)::numeric * COALESCE(sc.price_per_seat_monthly, 0)) AS mrr,
      -- representative per-seat price (max over active rows) for the column.
      max(COALESCE(sc.price_per_seat_monthly, 0))                                   AS price_per_seat_monthly,
      count(*)                                                                      AS active_subscriptions
    FROM public.school_subscriptions sc
    JOIN public.schools s ON s.id = sc.school_id
    WHERE sc.status = 'active'
      AND s.deleted_at IS NULL
    GROUP BY sc.school_id
  ),
  upsert AS (
    INSERT INTO public.school_mrr_daily AS smd (
      school_id, snapshot_date, mrr, arr, seats_purchased,
      price_per_seat_monthly, active_subscriptions, currency, computed_at
    )
    SELECT
      ps.school_id, p_date, ps.mrr, ps.mrr * 12, ps.seats_purchased,
      ps.price_per_seat_monthly, ps.active_subscriptions, 'INR', now()
    FROM per_school ps
    ON CONFLICT (school_id, snapshot_date) DO UPDATE SET
      mrr                    = EXCLUDED.mrr,
      arr                    = EXCLUDED.arr,
      seats_purchased        = EXCLUDED.seats_purchased,
      price_per_seat_monthly = EXCLUDED.price_per_seat_monthly,
      active_subscriptions   = EXCLUDED.active_subscriptions,
      currency               = EXCLUDED.currency,
      computed_at            = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upsert;

  RETURN v_rows;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- (c) compute_school_churn_signals — per-school churn risk score + band
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_school_churn_signals(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Heuristic weights (sum = 1.0). See header DOC.
  w_renewal  constant numeric := 0.35;
  w_seat     constant numeric := 0.25;
  w_engage   constant numeric := 0.25;
  w_pay      constant numeric := 0.15;
  v_rows integer := 0;
BEGIN
  WITH active_schools AS (
    SELECT s.id AS school_id
    FROM public.schools s
    WHERE s.is_active = true
      AND s.deleted_at IS NULL
  ),
  -- Days-to-renewal from the active school subscription's current_period_end.
  renewal AS (
    SELECT sc.school_id,
           (min(sc.current_period_end)::date - p_date) AS days_to_renewal
    FROM public.school_subscriptions sc
    WHERE sc.status = 'active'
    GROUP BY sc.school_id
  ),
  -- Seat-utilization slope: latest utilization_pct vs the prior snapshot's.
  seat_trend AS (
    SELECT su.school_id,
           (
             (array_agg(su.utilization_pct ORDER BY su.snapshot_date DESC))[1]
             - (array_agg(su.utilization_pct ORDER BY su.snapshot_date DESC))[2]
           ) AS seat_utilization_trend
    FROM public.school_seat_usage su
    WHERE su.snapshot_date <= p_date
    GROUP BY su.school_id
  ),
  -- Engagement slope: avg health engagement_score last 7d vs the prior 7d.
  eng_trend AS (
    SELECT shd.school_id,
           (
             avg(shd.engagement_score) FILTER (
               WHERE shd.score_date >  p_date - 7 AND shd.score_date <= p_date)
             - avg(shd.engagement_score) FILTER (
               WHERE shd.score_date >  p_date - 14 AND shd.score_date <= p_date - 7)
           ) AS engagement_trend
    FROM public.school_health_daily shd
    WHERE shd.score_date > p_date - 14 AND shd.score_date <= p_date
    GROUP BY shd.school_id
  ),
  -- B2C payment failures in trailing 90d, attributed via the student's school.
  pay_fail AS (
    SELECT st.school_id,
           count(*) AS payment_failures_90d
    FROM public.payment_history ph
    JOIN public.students st ON st.id = ph.student_id
    WHERE ph.status = 'failed'
      AND ph.created_at >= (p_date::timestamptz - interval '90 days')
      AND st.school_id IS NOT NULL
    GROUP BY st.school_id
  ),
  base AS (
    SELECT
      a.school_id,
      r.days_to_renewal,
      stt.seat_utilization_trend,
      et.engagement_trend,
      COALESCE(pf.payment_failures_90d, 0) AS payment_failures_90d
    FROM active_schools a
    LEFT JOIN renewal    r   ON r.school_id   = a.school_id
    LEFT JOIN seat_trend stt ON stt.school_id = a.school_id
    LEFT JOIN eng_trend  et  ON et.school_id  = a.school_id
    LEFT JOIN pay_fail   pf  ON pf.school_id  = a.school_id
  ),
  scored AS (
    SELECT
      b.*,
      -- renewal_proximity driver (0..100): closer renewal = higher risk.
      --   <=0 days (overdue/at renewal) = 100; >=90 days out = 0; linear between.
      CASE
        WHEN b.days_to_renewal IS NULL    THEN 0
        WHEN b.days_to_renewal <= 0       THEN 100
        WHEN b.days_to_renewal >= 90      THEN 0
        ELSE (90 - b.days_to_renewal)::numeric / 90 * 100
      END AS d_renewal,
      -- seat_utilization driver (0..100): a FALLING utilization slope is risky.
      --   slope <= -30 pts = 100; slope >= 0 = 0; linear between.
      CASE
        WHEN b.seat_utilization_trend IS NULL THEN 0
        WHEN b.seat_utilization_trend >= 0    THEN 0
        WHEN b.seat_utilization_trend <= -30  THEN 100
        ELSE (-b.seat_utilization_trend) / 30 * 100
      END AS d_seat,
      -- engagement driver (0..100): a FALLING engagement slope is risky.
      --   slope <= -20 pts = 100; slope >= 0 = 0; linear between.
      CASE
        WHEN b.engagement_trend IS NULL THEN 0
        WHEN b.engagement_trend >= 0    THEN 0
        WHEN b.engagement_trend <= -20  THEN 100
        ELSE (-b.engagement_trend) / 20 * 100
      END AS d_engage,
      -- payment driver (0..100): 25 pts per failure in 90d, capped at 100.
      LEAST(100, b.payment_failures_90d * 25)::numeric AS d_pay
    FROM base b
  ),
  finalized AS (
    SELECT
      sc.*,
      public.eic_clamp_0_100(
          sc.d_renewal * w_renewal
        + sc.d_seat    * w_seat
        + sc.d_engage  * w_engage
        + sc.d_pay     * w_pay
      ) AS risk_score
    FROM scored sc
  ),
  banded AS (
    SELECT
      f.*,
      CASE
        WHEN f.risk_score >= 75 THEN 'critical'
        WHEN f.risk_score >= 50 THEN 'high'
        WHEN f.risk_score >= 25 THEN 'medium'
        ELSE 'low'
      END AS risk_band,
      -- Explainability tags: include a driver only when it crossed its threshold.
      ARRAY_REMOVE(ARRAY[
        CASE WHEN f.d_renewal >= 50 THEN 'renewal_imminent' END,
        CASE WHEN f.d_seat    >= 50 THEN 'seat_util_falling' END,
        CASE WHEN f.d_engage  >= 50 THEN 'engagement_falling' END,
        CASE WHEN f.d_pay     >= 50 THEN 'payment_failures' END
      ], NULL) AS reasons
    FROM finalized f
  ),
  upsert AS (
    INSERT INTO public.school_churn_signals AS scs (
      school_id, score_date, risk_score, risk_band, days_to_renewal,
      seat_utilization_trend, engagement_trend, payment_failures_90d, reasons, computed_at
    )
    SELECT
      bn.school_id, p_date, bn.risk_score, bn.risk_band, bn.days_to_renewal,
      bn.seat_utilization_trend, bn.engagement_trend, bn.payment_failures_90d, bn.reasons, now()
    FROM banded bn
    ON CONFLICT (school_id, score_date) DO UPDATE SET
      risk_score             = EXCLUDED.risk_score,
      risk_band              = EXCLUDED.risk_band,
      days_to_renewal        = EXCLUDED.days_to_renewal,
      seat_utilization_trend = EXCLUDED.seat_utilization_trend,
      engagement_trend       = EXCLUDED.engagement_trend,
      payment_failures_90d   = EXCLUDED.payment_failures_90d,
      reasons                = EXCLUDED.reasons,
      computed_at            = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upsert;

  RETURN v_rows;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- (d) compute_geographic_metrics — state/city distribution rollup.
--     Reads the school_health_daily / school_mrr_daily / school_churn_signals
--     rows written for the SAME p_date by (a)/(b)/(c) above.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_geographic_metrics(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH active_schools AS (
    SELECT
      s.id AS school_id,
      -- NULL/blank state|city → 'Unknown'.
      CASE WHEN NULLIF(btrim(s.state), '') IS NULL THEN 'Unknown' ELSE btrim(s.state) END AS state_key,
      CASE WHEN NULLIF(btrim(s.city),  '') IS NULL THEN 'Unknown' ELSE btrim(s.city)  END AS city_key
    FROM public.schools s
    WHERE s.is_active = true
      AND s.deleted_at IS NULL
  ),
  -- Per-school student counts (total + active) for the geo aggregate.
  school_students AS (
    SELECT st.school_id,
           count(*)                                          AS student_count,
           count(*) FILTER (WHERE st.is_active = true)       AS active_students
    FROM public.students st
    WHERE st.school_id IS NOT NULL
      AND st.deleted_at IS NULL
    GROUP BY st.school_id
  ),
  -- Today's per-school health composite (written by step a).
  school_health AS (
    SELECT shd.school_id, shd.composite_score
    FROM public.school_health_daily shd
    WHERE shd.score_date = p_date
  ),
  -- Today's per-school MRR (written by step b2).
  school_mrr AS (
    SELECT smd.school_id, smd.mrr
    FROM public.school_mrr_daily smd
    WHERE smd.snapshot_date = p_date
  ),
  -- Today's per-school churn band (written by step c).
  school_churn AS (
    SELECT scs.school_id, scs.risk_band
    FROM public.school_churn_signals scs
    WHERE scs.score_date = p_date
  ),
  -- Per-school enriched row, materialized once.
  enriched AS (
    SELECT
      a.school_id, a.state_key, a.city_key,
      COALESCE(ssn.student_count, 0)   AS student_count,
      COALESCE(ssn.active_students, 0) AS active_students,
      sh.composite_score,
      COALESCE(sm.mrr, 0)              AS mrr,
      sch.risk_band
    FROM active_schools a
    LEFT JOIN school_students ssn ON ssn.school_id = a.school_id
    LEFT JOIN school_health   sh  ON sh.school_id  = a.school_id
    LEFT JOIN school_mrr      sm  ON sm.school_id  = a.school_id
    LEFT JOIN school_churn    sch ON sch.school_id = a.school_id
  ),
  -- Two passes (state + city) unioned via a level column.
  leveled AS (
    SELECT 'state'::text AS geo_level, e.state_key AS geo_key, e.* FROM enriched e
    UNION ALL
    SELECT 'city'::text  AS geo_level, e.city_key  AS geo_key, e.* FROM enriched e
  ),
  grouped AS (
    SELECT
      l.geo_level,
      l.geo_key,
      count(DISTINCT l.school_id)                                  AS school_count,
      SUM(l.student_count)                                         AS student_count,
      SUM(l.active_students)                                       AS active_students,
      public.eic_clamp_0_100(avg(l.composite_score))              AS avg_health_score,
      SUM(l.mrr)                                                   AS total_mrr,
      -- churn_rate: share of group schools whose band is high/critical (0..100).
      public.eic_clamp_0_100(
        count(*) FILTER (WHERE l.risk_band IN ('high', 'critical'))::numeric
          / NULLIF(count(*), 0) * 100
      )                                                            AS churn_rate
    FROM leveled l
    GROUP BY l.geo_level, l.geo_key
  ),
  upsert AS (
    INSERT INTO public.geographic_metrics AS gm (
      snapshot_date, geo_level, geo_key, school_count, student_count,
      active_students, avg_health_score, total_mrr, churn_rate, computed_at
    )
    SELECT
      p_date, g.geo_level, g.geo_key, g.school_count, g.student_count,
      g.active_students, g.avg_health_score, g.total_mrr, g.churn_rate, now()
    FROM grouped g
    ON CONFLICT (snapshot_date, geo_level, geo_key) DO UPDATE SET
      school_count     = EXCLUDED.school_count,
      student_count    = EXCLUDED.student_count,
      active_students  = EXCLUDED.active_students,
      avg_health_score = EXCLUDED.avg_health_score,
      total_mrr        = EXCLUDED.total_mrr,
      churn_rate       = EXCLUDED.churn_rate,
      computed_at      = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upsert;

  RETURN v_rows;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- ORCHESTRATOR — compute_education_intelligence_rollup(p_date)
-- Calls a → b1 → b2 → c → d IN ORDER (d depends on a/b2/c for the same date).
-- Returns a JSONB summary of per-step row counts for cron telemetry (keys only,
-- no PII). Idempotent end-to-end (every step is ON CONFLICT DO UPDATE).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_education_intelligence_rollup(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_health    integer;
  v_mrr_snap  integer;
  v_school_mrr integer;
  v_churn     integer;
  v_geo       integer;
BEGIN
  v_health     := public.compute_school_health_daily(p_date);
  v_mrr_snap   := public.compute_mrr_snapshot(p_date);
  v_school_mrr := public.compute_school_mrr_daily(p_date);
  v_churn      := public.compute_school_churn_signals(p_date);
  v_geo        := public.compute_geographic_metrics(p_date);

  RETURN jsonb_build_object(
    'rollup_date',           p_date,
    'school_health_rows',    v_health,
    'mrr_snapshot_rows',     v_mrr_snap,
    'school_mrr_rows',       v_school_mrr,
    'churn_signal_rows',     v_churn,
    'geographic_rows',       v_geo,
    'computed_at',           now()
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- EXECUTE privileges: service_role ONLY. Revoke the implicit PUBLIC grant that
-- Postgres adds on every new function so no anon/authenticated user can call
-- these. The nightly daily-cron runs as service_role.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.eic_clamp_0_100(numeric)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_school_health_daily(date)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_mrr_snapshot(date)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_school_mrr_daily(date)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_school_churn_signals(date)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_geographic_metrics(date)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_education_intelligence_rollup(date)  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.eic_clamp_0_100(numeric)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_school_health_daily(date)            TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_mrr_snapshot(date)                   TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_school_mrr_daily(date)               TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_school_churn_signals(date)           TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_geographic_metrics(date)             TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_education_intelligence_rollup(date)  TO service_role;

COMMENT ON FUNCTION public.compute_education_intelligence_rollup(date) IS
  'Education Intelligence Cloud v1 nightly orchestrator. Calls (a) school health '
  '→ (b) mrr snapshot + per-school mrr → (c) churn signals → (d) geographic '
  'metrics IN ORDER for p_date (d reads a/b/c''s same-day rows). SECURITY '
  'DEFINER, service_role-only EXECUTE, idempotent (every step ON CONFLICT DO '
  'UPDATE). Returns a keys-only JSONB row-count summary for cron telemetry. '
  'Aggregates only — no PII.';

COMMIT;

-- ─── Verify (manual checks AFTER applying — DO NOT RUN AS PART OF THIS TASK) ──
-- 1. Functions exist + are SECURITY DEFINER:
--      SELECT proname, prosecdef FROM pg_proc
--       WHERE proname LIKE 'compute_%' OR proname = 'eic_clamp_0_100';
--    Expected: prosecdef = true for the compute_* writers.
-- 2. EXECUTE is service_role-only (no anon/authenticated/PUBLIC):
--      SELECT proname, proacl FROM pg_proc WHERE proname = 'compute_education_intelligence_rollup';
-- 3. Dry-run one rollup (service_role session):
--      SELECT public.compute_education_intelligence_rollup(CURRENT_DATE);
--    Re-run the same statement → row counts stable, no duplicate-key error
--    (idempotency proven).
