-- Migration: 20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql
-- Purpose: Schema for Pedagogy v2 Wave 2 (Weekly Curiosity Dive).
--
-- Changes from Wave 2 plan (2026-05-09-pedagogy-v2-wave-2-weekly-dive.md):
--   - The plan said "extend lab_notebook_entries" but canonical's
--     /lab-notebook is STEM-experiment-specific (see
--     src/app/api/lab-notebook/list/route.ts header). Polluting it with
--     non-STEM curiosity-dive artifacts would muddle the STEM lab
--     notebook. This migration creates a NEW dive_artifacts table
--     instead. Task 5 (the dive UI) writes here; Task 6 (history surface)
--     reads here.
--
--   - B3 audit confirmed the existing daily streak lives at
--     students.streak_days (per atomic_quiz_profile_update RPC and
--     get_class_dashboard query in baseline_from_prod.sql). The new
--     weekly streak columns extend the same students table.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1. phenomena catalog — curated cross-subject phenomena for the dive picker.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phenomena (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT         NOT NULL UNIQUE,
  title_en            TEXT         NOT NULL,
  title_hi            TEXT         NOT NULL,
  summary_en          TEXT         NOT NULL,
  summary_hi          TEXT         NOT NULL,
  subjects            TEXT[]       NOT NULL,    -- e.g. ARRAY['physics','geography']
  grade_band          TEXT         NOT NULL,    -- '6-8' | '9-10' | '11-12' | '6-12'
  suggested_questions JSONB        NOT NULL DEFAULT '[]'::jsonb,
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phenomena_active_grade
  ON phenomena (is_active, grade_band);

ALTER TABLE phenomena ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "phenomena_authenticated_select" ON phenomena
    FOR SELECT TO authenticated USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "phenomena_service_all" ON phenomena
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE phenomena IS
  'Pedagogy v2 Wave 2 — curated cross-subject phenomena for the weekly Curiosity Dive picker. ~24 rows curated by content team. Service-role writes; authenticated reads.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. dive_artifacts — per-student weekly artifact storage.
--    NOT lab_notebook_entries (which is STEM-experiment-specific on this
--    canonical). Wave 3 monthly synthesis will compile these by ISO week.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dive_artifacts (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          UUID         NOT NULL,
  iso_week            TEXT         NOT NULL,    -- 'YYYY-Www' (e.g. '2026-W19')
  picker_option       TEXT         NOT NULL CHECK (picker_option IN ('phenomenon','weak_topic','own_topic')),
  dive_topic          TEXT         NOT NULL,
  dive_subjects       TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  phenomenon_slug     TEXT,                     -- NULL when picker_option != 'phenomenon'
  title               TEXT         NOT NULL,
  key_concepts        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  worked_example      TEXT,
  student_voice       TEXT         NOT NULL,    -- the "what I figured out" section
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (student_id, iso_week)                 -- one artifact per student per ISO week
);
CREATE INDEX IF NOT EXISTS idx_dive_artifacts_student_iso
  ON dive_artifacts (student_id, iso_week DESC);
CREATE INDEX IF NOT EXISTS idx_dive_artifacts_student_created
  ON dive_artifacts (student_id, created_at DESC);

ALTER TABLE dive_artifacts ENABLE ROW LEVEL SECURITY;

-- Student reads + writes their own rows.
DO $$ BEGIN
  CREATE POLICY "dive_artifacts_self_select" ON dive_artifacts
    FOR SELECT TO authenticated
    USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "dive_artifacts_self_insert" ON dive_artifacts
    FOR INSERT TO authenticated
    WITH CHECK (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "dive_artifacts_self_update" ON dive_artifacts
    FOR UPDATE TO authenticated
    USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role and super-admin: full access.
DO $$ BEGIN
  CREATE POLICY "dive_artifacts_service_all" ON dive_artifacts
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE dive_artifacts IS
  'Pedagogy v2 Wave 2 — student-produced artifacts from the weekly Curiosity Dive. One row per (student, ISO week). Wave 3 monthly synthesis aggregates these.';

-- ────────────────────────────────────────────────────────────────────────
-- 3. Weekly streak columns on the students table.
--    The existing daily streak lives at students.streak_days (confirmed via
--    atomic_quiz_profile_update + get_class_dashboard in baseline). We add
--    parallel columns for the WEEKLY streak with one-week miss tolerance.
-- ────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE students ADD COLUMN weekly_streak_count INT NOT NULL DEFAULT 0
    CHECK (weekly_streak_count >= 0);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE students ADD COLUMN weekly_streak_last_iso_week TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Seed phenomena rows.
--    Three real rows below + ONE intentional trip-wire ('placeholder-replace-me').
--    Content team fills the remaining ~20 before Wave 2 ships at >0% rollout.
--    The trip-wire row's presence in production data is a visible signal that
--    seeding is incomplete.
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO phenomena (slug, title_en, title_hi, summary_en, summary_hi, subjects, grade_band, suggested_questions)
VALUES
  ('monsoon',
   'Monsoon',
   'मानसून',
   'Why does India have such a sharp wet/dry seasonal cycle, and how does it shape life?',
   'भारत में इतना तेज़ बरसाती-सूखा मौसमी चक्र क्यों होता है, और यह जीवन को कैसे आकार देता है?',
   ARRAY['geography','physics','biology'],
   '6-12',
   '["What air-pressure patterns create the southwest monsoon?","How does the rainfall map onto the Western Ghats topography?","What crops align with the monsoon calendar?"]'::jsonb),

  ('cricket-physics',
   'Cricket physics',
   'क्रिकेट का भौतिकी',
   'Why does a leg-spinner''s ball deviate, and why does swing happen with a new ball?',
   'लेग-स्पिनर की गेंद क्यों मुड़ती है, और नई गेंद से स्विंग क्यों होती है?',
   ARRAY['physics','math'],
   '8-12',
   '["What is the Magnus effect?","How does seam orientation affect swing?","Compute spin rate from RPM and trajectory."]'::jsonb),

  ('kirana-store-accounting',
   'Kirana store accounting',
   'किराना दुकान का हिसाब',
   'How does a kirana shop owner know if she is making real profit, and how does GST fit in?',
   'किराना दुकानदार को कैसे पता चले कि असली मुनाफ़ा हो रहा है, और GST कहाँ बैठता है?',
   ARRAY['economics','math','business_studies'],
   '9-12',
   '["What is the difference between gross and net margin?","How does GST input credit work for a retailer?","Set up a simple cash-flow ledger."]'::jsonb),

  ('placeholder-replace-me',
   'TODO — seed gap trip-wire',
   'TODO — सीड गैप ट्रिप-वायर',
   'INTENTIONAL trip-wire: this row exists so that an unfilled seed catalog is visibly broken. Replace with real rows before flag rollout.',
   'जानबूझकर ट्रिप-वायर: यह पंक्ति इसलिए है कि सीड कैटलॉग अधूरा हो तो दिखाई दे। फ़्लैग रोलआउट से पहले असली पंक्तियों से बदलो।',
   ARRAY['math'],
   '6-12',
   '[]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- 5. Feature flag — default OFF.
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO feature_flags (flag_name, is_enabled, target_roles, target_environments, target_institutions, rollout_percentage)
VALUES
  ('ff_pedagogy_v2_weekly_dive', false, ARRAY['student']::text[], NULL, NULL, NULL)
ON CONFLICT (flag_name) DO NOTHING;

COMMIT;
