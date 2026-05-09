-- Migration: 20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql
-- Purpose: Schema for Pedagogy v2 Wave 3 (Monthly Synthesis).
--
--   1. monthly_synthesis_runs — one row per (student, month) holding the
--      structured bundle (mastery delta JSONB, weekly artifact ids[],
--      chapter-mock summary JSONB) plus the bilingual parent-share text
--      (EN + HI) and WhatsApp delivery state.
--
--   2. guardians.monthly_synthesis_optin — BOOLEAN, default FALSE.
--      Parent-share to WhatsApp is gated by this column. Audit C1
--      confirmed guardians (per-row id, auth_user_id, preferred_language)
--      is the right table to extend; weekly_report_enabled already
--      exists for the daily/weekly cadence so the new column is the
--      monthly-specific opt-in.
--
--   3. ff_pedagogy_v2_monthly_synthesis flag, default OFF.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1. monthly_synthesis_runs
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_synthesis_runs (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                  UUID         NOT NULL,
  synthesis_month             TEXT         NOT NULL,    -- 'YYYY-MM'
  bundle                      JSONB        NOT NULL,
  summary_text_en             TEXT         NOT NULL,
  summary_text_hi             TEXT         NOT NULL,
  parent_share_status         TEXT         NOT NULL DEFAULT 'pending'
    CHECK (parent_share_status IN ('pending','sent','opted_out','failed','suppressed')),
  parent_share_sent_at        TIMESTAMPTZ,
  parent_share_whatsapp_id    TEXT,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (student_id, synthesis_month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_synthesis_student_month
  ON monthly_synthesis_runs (student_id, synthesis_month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_synthesis_pending_share
  ON monthly_synthesis_runs (parent_share_status, created_at)
  WHERE parent_share_status = 'pending';

ALTER TABLE monthly_synthesis_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "monthly_synthesis_self_select" ON monthly_synthesis_runs
    FOR SELECT TO authenticated
    USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "monthly_synthesis_service_all" ON monthly_synthesis_runs
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE monthly_synthesis_runs IS
  'Pedagogy v2 Wave 3 — auto-aggregated monthly synthesis bundle per (student, month). Bundle JSONB carries mastery_delta, weekly_artifact_ids[], chapter_mock_summary. parent_share_status tracks WhatsApp delivery state.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. guardians.monthly_synthesis_optin
-- ────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE guardians ADD COLUMN monthly_synthesis_optin BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

COMMENT ON COLUMN guardians.monthly_synthesis_optin IS
  'Pedagogy v2 Wave 3 — explicit opt-in for the monthly synthesis WhatsApp delivery. Independent of weekly_report_enabled because the monthly cadence is qualitatively different (longer text, parent-shareable artifact compilation).';

-- ────────────────────────────────────────────────────────────────────────
-- 3. Feature flag
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO feature_flags (flag_name, is_enabled, target_roles, target_environments, target_institutions, rollout_percentage)
VALUES
  ('ff_pedagogy_v2_monthly_synthesis', false, ARRAY['student']::text[], NULL, NULL, NULL)
ON CONFLICT (flag_name) DO NOTHING;

COMMIT;
