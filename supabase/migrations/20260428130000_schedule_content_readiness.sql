-- Migration: 20260428130000_schedule_content_readiness.sql
-- Purpose: Schedule daily computation of subject content readiness and persist
--          per-day snapshots so the super-admin panel reads truthful, fresh
--          numbers (Phase 3.2 — truthful content-readiness measurement).
--
-- Background:
--   `compute_subject_content_readiness()` was added in
--   supabase/migrations/20260415000013_subject_content_readiness.sql.
--   It updates `subjects.is_content_ready` from live counts of `chapters`
--   and `question_bank` rows, but is not called on any schedule. As a
--   result, the super-admin dashboard cannot show "Class 9 Math is X% ready"
--   over time, only the latest boolean flag.
--
-- This migration:
--   1. Creates `subject_content_readiness_daily` — a per-day snapshot table
--      with subject_code, grade (string per P5), ready_score (0..1),
--      chunks_count, questions_count, last_computed_at.
--      grade is intentionally TEXT, not INT, to comply with P5 (Grade Format).
--   2. Adds `recompute_subject_content_readiness_daily()` — a
--      SECURITY DEFINER function that (a) calls the existing
--      compute_subject_content_readiness(), then (b) writes a per-(subject,
--      grade) row into the daily table by joining chapters + question_bank
--      against subjects + grade_subject_map. Idempotent for the day:
--      ON CONFLICT (subject_code, grade, computed_on) DO UPDATE.
--   3. Schedules a pg_cron job `alfanumrik-content-readiness-daily` at
--      03:30 UTC = 09:00 IST (after IST-evening student bedtime, before
--      IST-morning teacher arrival).
--   4. Enables RLS on the daily table with: service_role full access,
--      super_admin/admin SELECT. No INSERT/UPDATE/DELETE for end users.
--
-- Idempotent. Safe to re-run. No DROP TABLE / DROP COLUMN. No P-invariant
-- change beyond reinforcing P5 (Grade Format) and P8 (RLS Boundary).
--
-- Rollback:
--   SELECT cron.unschedule('alfanumrik-content-readiness-daily');
--   DROP FUNCTION IF EXISTS recompute_subject_content_readiness_daily();
--   DROP TABLE IF EXISTS subject_content_readiness_daily;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── 1. Snapshot table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subject_content_readiness_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_code    TEXT NOT NULL,
  -- Grade is TEXT per P5 (Grade Format). Values: '6'..'12'. Never integer.
  grade           TEXT NOT NULL,
  -- Score in [0, 1]. Currently computed as a coarse readiness signal:
  --   0   if no chapters AND no questions
  --   0.5 if chapters present OR questions present but not both
  --   1   if both chapters >= 1 AND questions >= MIN_QUESTIONS_FLOOR
  -- ai-engineer / assessment can replace the formula; column shape stable.
  ready_score     NUMERIC(4,3) NOT NULL DEFAULT 0,
  chunks_count    INT NOT NULL DEFAULT 0,
  questions_count INT NOT NULL DEFAULT 0,
  computed_on     DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subject_content_readiness_daily_grade_format
    CHECK (grade ~ '^(6|7|8|9|10|11|12)$'),
  CONSTRAINT subject_content_readiness_daily_score_range
    CHECK (ready_score >= 0 AND ready_score <= 1),
  CONSTRAINT subject_content_readiness_daily_unique
    UNIQUE (subject_code, grade, computed_on)
);

CREATE INDEX IF NOT EXISTS idx_scrd_subject_grade_date
  ON subject_content_readiness_daily (subject_code, grade, computed_on DESC);

CREATE INDEX IF NOT EXISTS idx_scrd_computed_on
  ON subject_content_readiness_daily (computed_on DESC);

COMMENT ON TABLE subject_content_readiness_daily IS
  'Daily snapshot of per-(subject, grade) content readiness. Written by '
  'recompute_subject_content_readiness_daily() via pg_cron at 03:30 UTC. '
  'Read by super-admin reporting endpoints to show readiness trend.';

COMMENT ON COLUMN subject_content_readiness_daily.grade IS
  'CBSE grade as TEXT (P5: never integer). Values 6..12.';

-- ─── 2. RLS ───────────────────────────────────────────────────────────────
ALTER TABLE subject_content_readiness_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "scrd_super_admin_select"
    ON public.subject_content_readiness_daily
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN
    RAISE NOTICE 'scrd_super_admin_select: user_roles/roles missing — skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'scrd_super_admin_select: column shape mismatch — skipping';
END $$;

-- service_role bypasses RLS; explicit policy is defense-in-depth.
DO $$ BEGIN
  CREATE POLICY "scrd_service_role_all"
    ON public.subject_content_readiness_daily
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON subject_content_readiness_daily TO authenticated;
GRANT ALL    ON subject_content_readiness_daily TO service_role;

-- ─── 3. Recompute function ────────────────────────────────────────────────
-- Joins subjects + grade_subject_map to enumerate every valid
-- (subject_code, grade) pair, counts chapters and question_bank rows for
-- that pair, computes a readiness score, and upserts a row for today.
--
-- Floor for "fully ready" questions count is hard-coded to 40 to match
-- P3 quiz-readiness floor (CLAUDE.md). Edit here if the floor changes.

CREATE OR REPLACE FUNCTION recompute_subject_content_readiness_daily()
RETURNS TABLE (
  subject_code     TEXT,
  grade            TEXT,
  ready_score      NUMERIC,
  chunks_count     INT,
  questions_count  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_min_questions_floor CONSTANT INT := 40;
BEGIN
  -- Refresh the boolean flag on `subjects` first (idempotent).
  PERFORM compute_subject_content_readiness();

  RETURN QUERY
  WITH valid_pairs AS (
    SELECT DISTINCT
           gsm.subject_code,
           gsm.grade::TEXT AS grade
      FROM grade_subject_map gsm
     WHERE gsm.subject_code IS NOT NULL
       AND gsm.grade IS NOT NULL
  ),
  chap AS (
    SELECT c.subject_code,
           c.grade::TEXT AS grade,
           COUNT(*)::INT AS chunks
      FROM chapters c
     WHERE c.is_active
     GROUP BY c.subject_code, c.grade
  ),
  qs AS (
    SELECT LOWER(q.subject) AS subject_code,
           -- question_bank.grade is sometimes 'Grade 10' or '10' historically;
           -- normalise to bare digits so it matches grade_subject_map.
           regexp_replace(q.grade::TEXT, '\D', '', 'g') AS grade,
           COUNT(*)::INT AS questions
      FROM question_bank q
     WHERE q.is_active = true
     GROUP BY LOWER(q.subject), regexp_replace(q.grade::TEXT, '\D', '', 'g')
  ),
  joined AS (
    SELECT vp.subject_code,
           vp.grade,
           COALESCE(chap.chunks, 0)    AS chunks,
           COALESCE(qs.questions, 0)   AS questions
      FROM valid_pairs vp
      LEFT JOIN chap ON chap.subject_code = vp.subject_code AND chap.grade = vp.grade
      LEFT JOIN qs   ON qs.subject_code   = vp.subject_code AND qs.grade   = vp.grade
  ),
  scored AS (
    SELECT j.subject_code,
           j.grade,
           CASE
             WHEN j.chunks <= 0 AND j.questions <= 0 THEN 0::NUMERIC
             WHEN j.chunks >= 1 AND j.questions >= v_min_questions_floor THEN 1::NUMERIC
             WHEN j.chunks >= 1 OR j.questions >= 1 THEN 0.5::NUMERIC
             ELSE 0::NUMERIC
           END AS ready_score,
           j.chunks    AS chunks_count,
           j.questions AS questions_count
      FROM joined j
     WHERE j.grade ~ '^(6|7|8|9|10|11|12)$'
  ),
  upserted AS (
    INSERT INTO subject_content_readiness_daily AS t (
      subject_code, grade, ready_score, chunks_count, questions_count,
      computed_on, last_computed_at
    )
    SELECT s.subject_code, s.grade, s.ready_score, s.chunks_count,
           s.questions_count, v_today, now()
      FROM scored s
    ON CONFLICT (subject_code, grade, computed_on) DO UPDATE
      SET ready_score      = EXCLUDED.ready_score,
          chunks_count     = EXCLUDED.chunks_count,
          questions_count  = EXCLUDED.questions_count,
          last_computed_at = now()
    RETURNING t.subject_code, t.grade, t.ready_score,
              t.chunks_count, t.questions_count
  )
  SELECT u.subject_code,
         u.grade,
         u.ready_score::NUMERIC,
         u.chunks_count::INT,
         u.questions_count::INT
    FROM upserted u;
END;
$$;

REVOKE ALL ON FUNCTION recompute_subject_content_readiness_daily() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recompute_subject_content_readiness_daily() TO service_role;

COMMENT ON FUNCTION recompute_subject_content_readiness_daily() IS
  'Phase 3.2: writes per-(subject, grade) readiness snapshots into '
  'subject_content_readiness_daily. Called by pg_cron daily at 03:30 UTC. '
  'Also refreshes subjects.is_content_ready via compute_subject_content_readiness().';

-- Run once on apply so today has data immediately.
DO $$ BEGIN
  PERFORM recompute_subject_content_readiness_daily();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'initial recompute skipped: % (will run on next cron tick)', SQLERRM;
END $$;

-- ─── 4. pg_cron schedule ──────────────────────────────────────────────────
-- 03:30 UTC = 09:00 IST. Between IST-evening (no traffic) and IST-morning
-- (teachers arrive). Co-located with daily-cron at 18:30 UTC so they run on
-- different sides of the IST day and don't compete for connections.
SELECT cron.unschedule('alfanumrik-content-readiness-daily')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'alfanumrik-content-readiness-daily'
);

SELECT cron.schedule(
  'alfanumrik-content-readiness-daily',
  '30 3 * * *', -- 03:30 UTC = 09:00 IST
  $$ SELECT recompute_subject_content_readiness_daily(); $$
);

COMMIT;
