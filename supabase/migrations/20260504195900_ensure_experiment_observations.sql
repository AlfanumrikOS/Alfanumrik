-- ────────────────────────────────────────────────────────────────
-- Migration: 20260504195900_ensure_experiment_observations.sql
-- Purpose:   HOTFIX — guarantee public.experiment_observations exists on all
--            environments before 20260504200000_stem_lab_engagement_tier1.sql
--            runs ALTER TABLE ... ADD COLUMN IF NOT EXISTS against it.
--
-- Background:
--   Production deploy run 25350678677 (PR #530) failed at `supabase db push`
--   with: ERROR: relation "public.experiment_observations" does not exist
--         (SQLSTATE 42P01)
--
--   Root cause: the legacy migration
--     supabase/migrations/_legacy/timestamped/20260401170000_create_experiment_observations.sql
--   was archived during the Section 10 baseline cleanup (2026-05-03) but its
--   schema was NEVER captured into 00000000000000_baseline_from_prod.sql
--   (verified: zero matches for 'experiment_observations' in the baseline).
--   The table existed only on staging / individual dev DBs, not on prod.
--
-- Fix approach:
--   Re-create the table and its 5 RLS policies idempotently. This is a
--   pure no-op on staging/dev (table + policies already present) and a
--   restorative create on prod.
--
-- Idempotency contract:
--   * CREATE TABLE IF NOT EXISTS         — safe on existing table
--   * ALTER TABLE ... ENABLE RLS         — safe to re-run; RLS is a flag
--   * Each CREATE POLICY wrapped in DO $$ ... EXCEPTION WHEN duplicate_object
--     (PostgreSQL has no CREATE POLICY IF NOT EXISTS as of v15)
--   * CREATE INDEX IF NOT EXISTS         — safe on existing index
--
-- Sort order verification:
--   '20260504195900' < '20260504200000' lexicographically (positions 9-14:
--   195900 < 200000), so Supabase's migration runner applies this BEFORE
--   the Tier 1 STEM Lab migration. Confirmed against `ls supabase/migrations/`.
--
-- Refs: PR #530, deploy run 25350678677
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.experiment_observations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  simulation_id           TEXT NOT NULL,
  experiment_id           TEXT,
  observation_type        TEXT NOT NULL DEFAULT 'simple'
                          CHECK (observation_type IN ('simple', 'guided')),
  observation_text        TEXT,
  structured_observations JSONB,
  data_entries            JSONB,
  conclusion              TEXT,
  quiz_score              INTEGER,
  total_questions         INTEGER,
  time_spent_seconds      INTEGER DEFAULT 0,
  grade                   TEXT NOT NULL,
  subject                 TEXT NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.experiment_observations ENABLE ROW LEVEL SECURITY;

-- Students insert their own observations
DO $$ BEGIN
  CREATE POLICY "students_insert_own_observations"
    ON public.experiment_observations FOR INSERT
    WITH CHECK (student_id = public.get_student_id_for_auth());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Students read their own observations
DO $$ BEGIN
  CREATE POLICY "students_read_own_observations"
    ON public.experiment_observations FOR SELECT
    USING (student_id = public.get_student_id_for_auth());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Parents read linked child observations
DO $$ BEGIN
  CREATE POLICY "guardians_read_linked_observations"
    ON public.experiment_observations FOR SELECT
    USING (public.is_guardian_of(student_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teachers read observations of students in their classes
DO $$ BEGIN
  CREATE POLICY "teachers_read_class_observations"
    ON public.experiment_observations FOR SELECT
    USING (public.is_teacher_of(student_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Super-admins read all
DO $$ BEGIN
  CREATE POLICY "admin_read_all_observations"
    ON public.experiment_observations FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.admin_users
         WHERE auth_user_id = auth.uid() AND is_active = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes (mirror legacy file exactly)
CREATE INDEX IF NOT EXISTS idx_experiment_obs_student
  ON public.experiment_observations(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_experiment_obs_simulation
  ON public.experiment_observations(simulation_id);

COMMENT ON TABLE public.experiment_observations IS
  'STEM Lab observation records (simple free-text + guided structured). Re-created via hotfix 20260504195900 after legacy migration 20260401170000 was archived without being captured in baseline_from_prod.sql.';
