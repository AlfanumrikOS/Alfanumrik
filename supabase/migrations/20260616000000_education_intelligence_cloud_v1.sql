-- Migration: 20260616000000_education_intelligence_cloud_v1.sql
-- Purpose: Track 1 "Education Intelligence Cloud" v1 — nightly-precomputed
--          platform-analytics ROLLUP tables that power the super-admin
--          Education Intelligence dashboards (school health, MRR, churn risk,
--          geographic distribution). DESIGN APPROVED BY CEO.
--
--          Ships FOUR rollup tables (all service-role-written by the nightly
--          daily-cron; super-admin/admin read-only; deny everyone else):
--            1. school_health_daily   — per-school 5-pillar health + composite.
--            2. mrr_snapshots         — platform-wide MRR/ARR daily snapshot.
--               + school_mrr_daily    — per-school MRR variant (see DECISION 1).
--            3. school_churn_signals  — per-school churn risk score + band.
--            4. geographic_metrics    — state/city distribution rollup.
--
-- ─── SCOPE / SAFETY CONTRACT ─────────────────────────────────────────────────
--   - AGGREGATES ONLY, NO PII. Every table keys off school_id (uuid) or a geo
--     key (text state/city) plus pre-aggregated numbers. No student name/email/
--     phone, no auth_user_id, no per-student rows. P13 clean by construction.
--   - SERVICE-ROLE / SUPER-ADMIN ONLY. The nightly cron (service_role) is the
--     ONLY writer. Reads are limited to authenticated super_admin/admin via the
--     canonical user_roles → roles gate. Public/anon/student/teacher: implicit
--     deny (RLS on, no matching policy). This mirrors the existing analytics
--     rollup RLS pattern on public.platform_health_snapshots,
--     public.platform_health_scores, public.domain_events and
--     public.school_seat_usage in 00000000000000_baseline_from_prod.sql.
--   - READ-MODEL ONLY. No source table is modified. No DROP of anything. No new
--     RBAC permission codes (reads gate on the existing super_admin/admin roles,
--     not a new permission — so NO CEO RBAC-addition gate is triggered).
--   - IDEMPOTENT. CREATE TABLE/INDEX IF NOT EXISTS; ALTER TABLE ... ENABLE RLS
--     is a no-op when already enabled; DROP POLICY IF EXISTS before each
--     CREATE POLICY. Safe to replay on a fresh Preview branch.
--   - SELF-CONTAINED. References only public.schools(id), present in the
--     reproducible baseline. No forward-reference to _legacy/.
--
-- ─── RLS PATTERN (verbatim shape from the baseline analytics rollups) ─────────
-- Two policies per table:
--   a) <table>_service_all  — FOR ALL, USING/ WITH CHECK auth.role()='service_role'.
--      Mirrors school_seat_usage "seat_usage_service_role" and
--      teacher_remediation_assignments_service_all (the nightly writer).
--   b) <table>_admin_select — FOR SELECT TO authenticated, USING the canonical
--      super_admin/admin EXISTS(user_roles ur JOIN roles r ...) gate copied
--      verbatim from the baseline policy "domain_events_super_admin_select"
--      (00000000000000_baseline_from_prod.sql) incl. the is_active +
--      expires_at freshness checks. No write policy for authenticated → admins
--      can READ the rollups but never mutate them; only the cron (service_role)
--      writes.
--
-- ─── SCHEMA FACTS RELIED ON (verified against the baseline) ──────────────────
--   schools(id uuid, city text, state text, pin_code text, subscription_plan
--           text, is_active boolean, deleted_at timestamptz)
--   user_roles(auth_user_id uuid, role_id uuid, is_active boolean,
--              expires_at timestamptz)
--   roles(id uuid, name text)   -- 'super_admin' / 'admin'
-- Source tables the NIGHTLY CRON (separate, not in this migration) will read to
-- POPULATE these rollups are documented in the PR's AGGREGATION SPEC, not here.
--
-- ─── DECISIONS FOR CEO TO CONFIRM (also in the PR report) ────────────────────
--   DECISION 1: per-school MRR is shipped as a SEPARATE table school_mrr_daily
--     rather than adding a nullable school_id to mrr_snapshots. Rationale: keeps
--     the platform-wide snapshot exactly one-row-per-day (clean UNIQUE
--     (snapshot_date)) and avoids a "school_id IS NULL means platform total"
--     sentinel that complicates every query and index. Both are 100% additive.
--   DECISION 2: geographic_metrics keys off schools.state / schools.city TEXT
--     only (geo_level IN ('state','city')). No lat/long, no district — deferred
--     to v2 per the approved blueprint.
--   DECISION 3: all score/rate columns are numeric(5,2) (0.00–999.99 headroom;
--     scores live 0–100) to match platform_health_scores' numeric(5,2)
--     convention; money columns are plain numeric (matches school_subscriptions
--     .price_per_seat_monthly / student_subscriptions money handling). risk_score
--     is numeric(5,2) bounded 0–100 by a CHECK.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. school_health_daily — per-school 5-pillar health + composite (nightly)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.school_health_daily (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  score_date        date NOT NULL DEFAULT CURRENT_DATE,
  -- Five pillars, each 0–100 (computed by the nightly cron; see AGGREGATION SPEC).
  adoption_score    numeric(5,2),
  engagement_score  numeric(5,2),
  outcomes_score    numeric(5,2),
  retention_score   numeric(5,2),
  usage_score       numeric(5,2),
  -- Weighted composite of the five pillars, 0–100.
  composite_score   numeric(5,2),
  -- Health tier bucketed off composite_score.
  tier              text CHECK (tier IN ('elite','healthy','needs_attention','critical')),
  -- Supporting raw aggregates surfaced on the dashboard cards.
  dau               integer DEFAULT 0,
  mau               integer DEFAULT 0,
  active_students   integer DEFAULT 0,
  avg_quiz_score    numeric(5,2),
  quiz_count        integer DEFAULT 0,
  foxy_count        integer DEFAULT 0,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_health_daily_school_date_key UNIQUE (school_id, score_date)
);

COMMENT ON TABLE public.school_health_daily IS
  'Education Intelligence Cloud v1: nightly per-school health rollup. Five 0–100 '
  'pillars (adoption/engagement/outcomes/retention/usage), a weighted '
  'composite_score, a tier bucket, and supporting raw aggregates (dau/mau/'
  'active_students/avg_quiz_score/quiz_count/foxy_count). One row per '
  '(school_id, score_date). Service-role written by daily-cron; super-admin '
  'read-only. Aggregates only — no PII.';

-- Dashboard query: latest row(s) per school, newest first.
CREATE INDEX IF NOT EXISTS idx_school_health_daily_school_date
  ON public.school_health_daily (school_id, score_date DESC);
-- Dashboard query: "all schools on date D" / time-series scans.
CREATE INDEX IF NOT EXISTS idx_school_health_daily_date
  ON public.school_health_daily (score_date DESC);
-- Dashboard filter: "show me critical / needs_attention schools".
CREATE INDEX IF NOT EXISTS idx_school_health_daily_tier
  ON public.school_health_daily (tier);

ALTER TABLE public.school_health_daily ENABLE ROW LEVEL SECURITY;

-- (a) Nightly cron (service_role) — full access.
DROP POLICY IF EXISTS school_health_daily_service_all ON public.school_health_daily;
CREATE POLICY school_health_daily_service_all
  ON public.school_health_daily
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- (b) Super-admin / admin — read-only (canonical baseline gate).
DROP POLICY IF EXISTS school_health_daily_admin_select ON public.school_health_daily;
CREATE POLICY school_health_daily_admin_select
  ON public.school_health_daily
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.auth_user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.name = ANY (ARRAY['super_admin'::text, 'admin'::text])
  ));

-- ═════════════════════════════════════════════════════════════════════════════
-- 2a. mrr_snapshots — platform-wide MRR/ARR daily snapshot (one row/day)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mrr_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date         date NOT NULL DEFAULT CURRENT_DATE,
  total_mrr             numeric,            -- student_mrr + school_mrr
  student_mrr           numeric,            -- B2C student_subscriptions, monthly-normalized
  school_mrr            numeric,            -- B2B school_subscriptions seats×price, monthly-normalized
  new_mrr               numeric,            -- MRR from subs that started in the period
  expansion_mrr         numeric,            -- net upgrade MRR within existing accounts
  churn_mrr             numeric,            -- MRR lost to cancellations/expiries in the period
  arr                   numeric,            -- total_mrr × 12
  active_subscriptions  integer DEFAULT 0,
  currency              text NOT NULL DEFAULT 'INR',
  computed_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mrr_snapshots_date_key UNIQUE (snapshot_date)
);

COMMENT ON TABLE public.mrr_snapshots IS
  'Education Intelligence Cloud v1: platform-wide MRR/ARR daily snapshot, one '
  'row per snapshot_date. total_mrr = student_mrr + school_mrr (both '
  'monthly-normalized); arr = total_mrr × 12. new/expansion/churn MRR track '
  'movement vs the prior snapshot. Service-role written by daily-cron; '
  'super-admin read-only. No PII.';

-- Dashboard query: MRR time-series, newest first.
CREATE INDEX IF NOT EXISTS idx_mrr_snapshots_date
  ON public.mrr_snapshots (snapshot_date DESC);

ALTER TABLE public.mrr_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mrr_snapshots_service_all ON public.mrr_snapshots;
CREATE POLICY mrr_snapshots_service_all
  ON public.mrr_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS mrr_snapshots_admin_select ON public.mrr_snapshots;
CREATE POLICY mrr_snapshots_admin_select
  ON public.mrr_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.auth_user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.name = ANY (ARRAY['super_admin'::text, 'admin'::text])
  ));

-- ═════════════════════════════════════════════════════════════════════════════
-- 2b. school_mrr_daily — per-school MRR variant (DECISION 1: separate table)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.school_mrr_daily (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  snapshot_date         date NOT NULL DEFAULT CURRENT_DATE,
  mrr                   numeric,            -- this school's monthly-normalized MRR
  arr                   numeric,            -- mrr × 12
  seats_purchased       integer DEFAULT 0,
  price_per_seat_monthly numeric,
  active_subscriptions  integer DEFAULT 0,
  currency              text NOT NULL DEFAULT 'INR',
  computed_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_mrr_daily_school_date_key UNIQUE (school_id, snapshot_date)
);

COMMENT ON TABLE public.school_mrr_daily IS
  'Education Intelligence Cloud v1: per-school MRR rollup (DECISION 1 — a '
  'separate table rather than a nullable school_id on mrr_snapshots, so the '
  'platform snapshot stays exactly one row/day). mrr = school_subscriptions '
  'seats_purchased × price_per_seat_monthly, monthly-normalized; arr = mrr × 12. '
  'Service-role written by daily-cron; super-admin read-only. No PII.';

CREATE INDEX IF NOT EXISTS idx_school_mrr_daily_school_date
  ON public.school_mrr_daily (school_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_school_mrr_daily_date
  ON public.school_mrr_daily (snapshot_date DESC);

ALTER TABLE public.school_mrr_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_mrr_daily_service_all ON public.school_mrr_daily;
CREATE POLICY school_mrr_daily_service_all
  ON public.school_mrr_daily
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS school_mrr_daily_admin_select ON public.school_mrr_daily;
CREATE POLICY school_mrr_daily_admin_select
  ON public.school_mrr_daily
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.auth_user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.name = ANY (ARRAY['super_admin'::text, 'admin'::text])
  ));

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. school_churn_signals — per-school churn risk score + band (nightly)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.school_churn_signals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id               uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  score_date              date NOT NULL DEFAULT CURRENT_DATE,
  -- 0 (no risk) .. 100 (certain churn), bounded by CHECK.
  risk_score              numeric(5,2)
                            CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  risk_band               text CHECK (risk_band IN ('low','medium','high','critical')),
  days_to_renewal         integer,
  -- Slope/delta inputs the heuristic consumed (kept for explainability).
  seat_utilization_trend  numeric,
  engagement_trend        numeric,
  payment_failures_90d    integer DEFAULT 0,
  -- Human-readable drivers, e.g. {'seat_util_falling','no_logins_14d'}.
  reasons                 text[] DEFAULT '{}'::text[],
  computed_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_churn_signals_school_date_key UNIQUE (school_id, score_date)
);

COMMENT ON TABLE public.school_churn_signals IS
  'Education Intelligence Cloud v1: nightly per-school churn risk. risk_score '
  '0–100, bucketed into risk_band (low/medium/high/critical). days_to_renewal, '
  'seat/engagement trends and payment_failures_90d are the heuristic inputs; '
  'reasons[] carries the human-readable drivers for the dashboard. One row per '
  '(school_id, score_date). Service-role written; super-admin read-only. No PII.';

CREATE INDEX IF NOT EXISTS idx_school_churn_signals_school_date
  ON public.school_churn_signals (school_id, score_date DESC);
CREATE INDEX IF NOT EXISTS idx_school_churn_signals_date
  ON public.school_churn_signals (score_date DESC);
-- Dashboard filter: "show me high / critical churn-risk schools".
CREATE INDEX IF NOT EXISTS idx_school_churn_signals_band
  ON public.school_churn_signals (risk_band);

ALTER TABLE public.school_churn_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_churn_signals_service_all ON public.school_churn_signals;
CREATE POLICY school_churn_signals_service_all
  ON public.school_churn_signals
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS school_churn_signals_admin_select ON public.school_churn_signals;
CREATE POLICY school_churn_signals_admin_select
  ON public.school_churn_signals
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.auth_user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.name = ANY (ARRAY['super_admin'::text, 'admin'::text])
  ));

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. geographic_metrics — state/city distribution rollup (nightly)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.geographic_metrics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date     date NOT NULL DEFAULT CURRENT_DATE,
  geo_level         text NOT NULL CHECK (geo_level IN ('state','city')),
  -- The state name or city name (schools.state / schools.city TEXT) — DECISION 2.
  geo_key           text NOT NULL,
  school_count      integer DEFAULT 0,
  student_count     integer DEFAULT 0,
  active_students   integer DEFAULT 0,
  avg_health_score  numeric(5,2),
  total_mrr         numeric,
  churn_rate        numeric(5,2),
  computed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geographic_metrics_date_level_key_key UNIQUE (snapshot_date, geo_level, geo_key)
);

COMMENT ON TABLE public.geographic_metrics IS
  'Education Intelligence Cloud v1: nightly state/city distribution rollup '
  '(DECISION 2 — keys off schools.state / schools.city TEXT; no lat/long, no '
  'district until v2). One row per (snapshot_date, geo_level, geo_key). '
  'Service-role written; super-admin read-only. No PII.';

-- Dashboard query: "the whole map on date D, grouped by level".
CREATE INDEX IF NOT EXISTS idx_geographic_metrics_date_level
  ON public.geographic_metrics (snapshot_date DESC, geo_level);
-- Dashboard query: a single region's time-series.
CREATE INDEX IF NOT EXISTS idx_geographic_metrics_level_key
  ON public.geographic_metrics (geo_level, geo_key);

ALTER TABLE public.geographic_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geographic_metrics_service_all ON public.geographic_metrics;
CREATE POLICY geographic_metrics_service_all
  ON public.geographic_metrics
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS geographic_metrics_admin_select ON public.geographic_metrics;
CREATE POLICY geographic_metrics_admin_select
  ON public.geographic_metrics
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.auth_user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.name = ANY (ARRAY['super_admin'::text, 'admin'::text])
  ));

COMMIT;

-- ─── Verify (manual checks after applying — DO NOT RUN AS PART OF THIS TASK) ──
-- 1. RLS enabled on all 5 tables:
--      SELECT relname, relrowsecurity FROM pg_class
--       WHERE relname IN ('school_health_daily','mrr_snapshots','school_mrr_daily',
--                         'school_churn_signals','geographic_metrics');
--    Expected: relrowsecurity = true for every row.
-- 2. Two policies per table (service_all + admin_select):
--      SELECT tablename, policyname, cmd FROM pg_policies
--       WHERE tablename IN ('school_health_daily','mrr_snapshots','school_mrr_daily',
--                          'school_churn_signals','geographic_metrics')
--       ORDER BY tablename, policyname;
-- 3. As an anon/student session: SELECT * FROM public.mrr_snapshots; → 0 rows
--    (implicit deny). As service_role or super_admin: rows visible.
