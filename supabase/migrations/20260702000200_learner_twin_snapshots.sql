-- Migration: 20260702000200_learner_twin_snapshots.sql
-- Purpose: Digital Twin Slice 1. Create `learner_twin_snapshots`, the student-
--          scoped DAILY rollup of the learner's digital twin (mastery + decay +
--          dominant error types + misconception clusters + cohort percentile).
--          One row per (student, day). Written by the service-role twin builder;
--          read by the student, their linked parent, and assigned teachers.
--
-- ─── No PII (P13) ────────────────────────────────────────────────────────────
-- Columns are IDs + numbers + enum-like tags only. NO name/email/phone/free text.
-- mastery_by_topic / decay_state are jsonb maps of topic_id -> number.
-- misconception_cluster_ids / dominant_error_types reference catalog entities.
--
-- ─── RLS (same migration -- P8) ──────────────────────────────────────────────
-- Four ratified patterns copied from 20260619000200_adaptive_interventions.sql:
--   service role ALL    -- auth.role() = 'service_role' (the only writer)
--   student SELECT own  -- students.auth_user_id = auth.uid()
--   parent SELECT linked-- guardian_student_links dual-status ('active','approved')
--   teacher SELECT      -- class_students x class_teachers x teachers roster join
-- Writes are service-role ONLY (no authenticated INSERT/UPDATE/DELETE policy).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; DROP POLICY IF EXISTS before
-- CREATE POLICY; REVOKE/GRANT are re-runnable. No DROP TABLE/COLUMN. Additive.
-- Grades: this table carries no grade column (P5 N/A).

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.learner_twin_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  snapshot_date           date NOT NULL DEFAULT CURRENT_DATE,
  mastery_by_topic        jsonb NOT NULL DEFAULT '{}'::jsonb,
  decay_state             jsonb NOT NULL DEFAULT '{}'::jsonb,
  dominant_error_types    text[] NOT NULL DEFAULT '{}'::text[],
  misconception_cluster_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  cohort_percentile       numeric,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learner_twin_snapshots_one_per_day UNIQUE (student_id, snapshot_date)
);

COMMENT ON TABLE public.learner_twin_snapshots IS
  'Digital Twin Slice 1: student-scoped daily rollup of the learner digital twin '
  '(mastery + decay + dominant error types + misconception clusters + cohort '
  'percentile). One row per (student, day). IDs + numbers + enum tags only -- no '
  'PII (P13). Written by the service-role twin builder; read-only RLS for student/'
  'parent/teacher.';
COMMENT ON COLUMN public.learner_twin_snapshots.mastery_by_topic IS
  'jsonb map topic_id(uuid as text) -> mastery (numeric 0..1). IDs + numbers only.';
COMMENT ON COLUMN public.learner_twin_snapshots.decay_state IS
  'jsonb map topic_id(uuid as text) -> retention/decay score (numeric). IDs + numbers only.';

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_learner_twin_snapshots_student
  ON public.learner_twin_snapshots (student_id);
-- Latest-snapshot lookup (detect_blocked_dependents reads the most recent day).
CREATE INDEX IF NOT EXISTS idx_learner_twin_snapshots_student_date
  ON public.learner_twin_snapshots (student_id, snapshot_date DESC);

-- ─── 3. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.learner_twin_snapshots ENABLE ROW LEVEL SECURITY;

-- (a) Service role: full access (the twin builder is the only writer).
DROP POLICY IF EXISTS learner_twin_snapshots_service_all ON public.learner_twin_snapshots;
CREATE POLICY learner_twin_snapshots_service_all
  ON public.learner_twin_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- (b) Student reads own snapshots.
DROP POLICY IF EXISTS learner_twin_snapshots_student_select ON public.learner_twin_snapshots;
CREATE POLICY learner_twin_snapshots_student_select
  ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()
    )
  );

-- (c) Linked guardian reads the child's snapshots (dual-status, mirrors baseline).
DROP POLICY IF EXISTS learner_twin_snapshots_parent_select ON public.learner_twin_snapshots;
CREATE POLICY learner_twin_snapshots_parent_select
  ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT gsl.student_id
      FROM public.guardian_student_links gsl
      JOIN public.guardians g ON g.id = gsl.guardian_id
      WHERE g.auth_user_id = auth.uid()
        AND gsl.status IN ('active', 'approved')
    )
  );

-- (d) Roster teacher reads snapshots for students on their roster (canonical
--     class_students x class_teachers x teachers join, copied verbatim).
DROP POLICY IF EXISTS learner_twin_snapshots_teacher_select ON public.learner_twin_snapshots;
CREATE POLICY learner_twin_snapshots_teacher_select
  ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT cs.student_id
      FROM public.class_students cs
      JOIN public.class_teachers ct ON ct.class_id = cs.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- (e) Deliberately NO authenticated INSERT/UPDATE/DELETE policy (service-role writes).

-- ─── 4. Grants (defense in depth under RLS) ──────────────────────────────────
REVOKE ALL ON public.learner_twin_snapshots FROM PUBLIC;
REVOKE ALL ON public.learner_twin_snapshots FROM anon;
REVOKE ALL ON public.learner_twin_snapshots FROM authenticated;

GRANT SELECT ON public.learner_twin_snapshots TO authenticated;
GRANT ALL    ON public.learner_twin_snapshots TO service_role;

COMMIT;
