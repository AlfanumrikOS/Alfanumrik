-- Migration: 20260428000300_skill_state_teacher_rls_and_retrieval_trace_redaction.sql
-- Purpose: Two follow-up gaps from the Foxy moat plan rollout:
--   1) Teacher RLS for student_skill_state via class_teachers junction.
--      The original misconception-ontology migration deferred this because
--      its draft assumed a `classes.teacher_id` column that does not exist
--      in production — the actual schema uses a `class_teachers` join
--      table (one teacher → many classes, one class → many teachers).
--   2) P13 redaction of retrieval_traces.query_text. Phase 1 retrieval-
--      trace logging stores the raw student query so debugging can see
--      what was asked. P13 (no PII in logs) requires query persistence
--      to be (a) a redacted preview and (b) keyed by sha256 hash so
--      identical queries collide for analytics without leaking content.
--
-- Both changes are additive and idempotent.

-- ─── Part 1: Teacher RLS for student_skill_state ──────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='class_teachers'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='class_enrollments'
  ) THEN
    BEGIN
      CREATE POLICY "skill_state_teacher_select"
        ON student_skill_state FOR SELECT
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM class_enrollments ce
            JOIN class_teachers   ct ON ct.class_id  = ce.class_id
            JOIN teachers          t ON t.id          = ct.teacher_id
            WHERE ce.student_id    = student_skill_state.student_id
              AND t.auth_user_id   = auth.uid()
              AND COALESCE(ce.is_active, true) = true
              AND COALESCE(ct.is_active, true) = true
          )
        );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_table  THEN
        RAISE NOTICE 'skill_state_teacher_select: supporting tables missing — skipping';
      WHEN undefined_column THEN
        RAISE NOTICE 'skill_state_teacher_select: column shape mismatch — skipping';
    END;
  ELSE
    RAISE NOTICE 'student_skill_state teacher policy: junction tables missing, skipping';
  END IF;
END $$;

-- ─── Part 2: retrieval_traces.query_text redaction (P13) ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='retrieval_traces'
  ) THEN
    RAISE NOTICE 'retrieval_traces table missing — skipping P13 redaction';
    RETURN;
  END IF;

  -- 2a) Add hash column.
  BEGIN
    ALTER TABLE retrieval_traces ADD COLUMN query_sha256 TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END;

  -- 2b) Backfill hash from existing rows.
  BEGIN
    UPDATE retrieval_traces
    SET    query_sha256 = encode(digest(query_text, 'sha256'), 'hex')
    WHERE  query_sha256 IS NULL AND query_text IS NOT NULL;
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'pgcrypto.digest unavailable — hash will populate app-side';
  END;

  -- 2c) Truncate any existing long query_text to a 80-char preview.
  UPDATE retrieval_traces
  SET    query_text = substring(query_text from 1 for 79) || U&'\2026'
  WHERE  length(query_text) > 100;

  -- 2d) Length constraint for new writers.
  BEGIN
    ALTER TABLE retrieval_traces
      ADD CONSTRAINT retrieval_traces_query_text_redacted_chk
      CHECK (query_text IS NULL OR length(query_text) <= 100);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- 2e) Hash index for analytics dedup.
  CREATE INDEX IF NOT EXISTS idx_retrieval_traces_query_sha256
    ON retrieval_traces (query_sha256);
END $$;

COMMENT ON COLUMN retrieval_traces.query_text IS
  'REDACTED PREVIEW (max 100 chars). Per P13: full original query never '
  'persisted. Join analytics on query_sha256.';

COMMENT ON COLUMN retrieval_traces.query_sha256 IS
  'SHA-256 hex of original full query text. Stable analytics identifier '
  'without leaking content.';
