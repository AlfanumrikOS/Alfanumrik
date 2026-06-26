-- Migration: 20260702000300_learner_twin_memory.sql
-- Purpose: Digital Twin Slice 1. Create `learner_twin_memory`, the APPEND-ONLY
--          episodic memory of the learner digital twin -- one row per noteworthy
--          learning event (a concept touched, optionally a misconception hit),
--          tagged with an enum-like `summary_code` and an embedding for semantic
--          recall. Written by the service-role twin builder; read by the student,
--          their linked parent, and assigned teachers.
--
-- ─── No PII (P13) ────────────────────────────────────────────────────────────
-- summary_code is a CODE / enum-like tag (e.g. 'mastered_concept',
-- 'misconception_repeated') -- NOT free text and NOT student-identifiable. No
-- name/email/phone columns. concept_topic_id / misconception_id are catalog IDs.
--
-- ─── pgvector ────────────────────────────────────────────────────────────────
-- embedding vector(1024) (Voyage dimensionality, matching rag_content_chunks /
-- question_bank). HNSW cosine index mirrors the established baseline pattern
-- (idx_rag_chunks_embedding_hnsw): USING hnsw (embedding vector_cosine_ops)
-- WITH (m=16, ef_construction=64), partial WHERE embedding IS NOT NULL.
--
-- ─── RLS (same migration -- P8) ──────────────────────────────────────────────
-- Same four ratified patterns as learner_twin_snapshots. Append-only: service
-- role inserts; student/parent/teacher read; NO authenticated write/update/delete
-- policy and no UPDATE/DELETE grant.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; DROP POLICY IF EXISTS; re-runnable
-- REVOKE/GRANT. No DROP TABLE/COLUMN. Additive. No grade column (P5 N/A).

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.learner_twin_memory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  concept_topic_id uuid,
  misconception_id uuid,
  summary_code    text NOT NULL,
  embedding       public.vector(1024)
);

COMMENT ON TABLE public.learner_twin_memory IS
  'Digital Twin Slice 1: append-only episodic memory of the learner digital twin. '
  'One row per noteworthy learning event. summary_code is an enum-like tag (NOT '
  'free text, NOT PII -- P13); embedding is vector(1024) for semantic recall. '
  'Service-role writes; read-only RLS for student/parent/teacher.';
COMMENT ON COLUMN public.learner_twin_memory.summary_code IS
  'Enum-like code for the memory (e.g. mastered_concept, misconception_repeated, '
  'recovered_after_remediation). Never free text / never student-identifiable.';

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_learner_twin_memory_student
  ON public.learner_twin_memory (student_id);
CREATE INDEX IF NOT EXISTS idx_learner_twin_memory_student_time
  ON public.learner_twin_memory (student_id, occurred_at DESC);

-- pgvector semantic index (mirrors idx_rag_chunks_embedding_hnsw).
CREATE INDEX IF NOT EXISTS idx_learner_twin_memory_embedding_hnsw
  ON public.learner_twin_memory
  USING hnsw (embedding public.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── 3. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.learner_twin_memory ENABLE ROW LEVEL SECURITY;

-- (a) Service role: full access (the twin builder is the only writer).
DROP POLICY IF EXISTS learner_twin_memory_service_all ON public.learner_twin_memory;
CREATE POLICY learner_twin_memory_service_all
  ON public.learner_twin_memory
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- (b) Student reads own memory rows.
DROP POLICY IF EXISTS learner_twin_memory_student_select ON public.learner_twin_memory;
CREATE POLICY learner_twin_memory_student_select
  ON public.learner_twin_memory
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()
    )
  );

-- (c) Linked guardian reads the child's memory rows.
DROP POLICY IF EXISTS learner_twin_memory_parent_select ON public.learner_twin_memory;
CREATE POLICY learner_twin_memory_parent_select
  ON public.learner_twin_memory
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

-- (d) Roster teacher reads memory rows for students on their roster.
DROP POLICY IF EXISTS learner_twin_memory_teacher_select ON public.learner_twin_memory;
CREATE POLICY learner_twin_memory_teacher_select
  ON public.learner_twin_memory
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

-- (e) Deliberately NO authenticated INSERT/UPDATE/DELETE policy (append-only,
--     service-role writes).

-- ─── 4. Grants (defense in depth under RLS) ──────────────────────────────────
REVOKE ALL ON public.learner_twin_memory FROM PUBLIC;
REVOKE ALL ON public.learner_twin_memory FROM anon;
REVOKE ALL ON public.learner_twin_memory FROM authenticated;

GRANT SELECT ON public.learner_twin_memory TO authenticated;
GRANT ALL    ON public.learner_twin_memory TO service_role;

COMMIT;
