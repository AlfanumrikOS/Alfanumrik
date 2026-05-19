-- Migration: 20260520000005_exam_papers_and_pyq_import.sql
-- Purpose:    PR-2 of the JEE/NEET/Olympiad scaling roadmap. Creates the
--             `exam_papers` catalog table that PR-1 forward-referenced and
--             installs the real FK on `question_bank.exam_paper_id` that
--             PR-1 left as a nullable uuid without referential integrity.
--
-- Predecessor: supabase/migrations/20260520000004_jee_neet_schema_unblock.sql
--             (PR-1) added 6 nullable PYQ columns to question_bank, including
--             `exam_paper_id uuid` with the comment "forward reference; FK
--             added later". This migration is the "later".
--
-- Why this matters (architect's roadmap, 2026-05-19):
--   - PR-1 unblocked row-level ingestion (question_bank now accepts
--     source_type='jee_archive', exam_session, marks_correct, marks_wrong,
--     paper_pattern), but there is still no canonical record of WHICH paper
--     a question belongs to. Today an importer can stamp
--     `exam_session = 'jee_main_jan_2024'` on a row, but two importers
--     can disagree on the canonical spelling of that session, and there is
--     no place to record paper-level metadata (total_marks, duration,
--     official source URL, marking scheme).
--   - The `bulk-jee-neet-import` Edge Function (PR-3 of this roadmap) needs
--     a parent table to UPSERT into so a paper is registered exactly once
--     and every question in that paper gets a stable FK to it. Without this
--     table, the importer would have to fabricate per-row metadata and the
--     super-admin Marking Integrity dashboard could not group by paper.
--   - Once this FK is in place, downstream readers (PYQ practice mode,
--     "previous-year drill" UI, paper-wise analytics) can JOIN
--     question_bank → exam_papers and trust the linkage at the DB layer.
--
-- What this migration does:
--   1. Creates public.exam_papers (24 columns + 7 CHECK constraints + PK +
--      UNIQUE on paper_code). All columns idempotent via IF NOT EXISTS at
--      the table level (CREATE TABLE IF NOT EXISTS).
--   2. Adds the deferred FK `fk_question_bank_exam_paper` linking
--      question_bank.exam_paper_id → exam_papers(id) ON DELETE SET NULL.
--      Guarded by a pg_constraint existence check so re-runs are no-ops.
--   3. Installs 4 indexes (3 on exam_papers, 1 partial on question_bank)
--      to keep the FK lookup and family-by-year queries index-backed.
--   4. Installs an updated_at BEFORE UPDATE trigger so the column tracks
--      mutations without application-layer effort.
--   5. Enables RLS and adds 2 policies:
--        - SELECT to authenticated (catalog metadata is non-sensitive).
--        - ALL (INSERT/UPDATE/DELETE) to admin_users with
--          admin_level IN ('admin','super_admin') and is_active=true.
--      Service role bypasses RLS automatically per Supabase contract.
--   6. Grants SELECT,INSERT,UPDATE,DELETE on exam_papers to authenticated
--      (RLS still gates writes to admins only).
--   7. Adds column comments on non-obvious fields.
--
-- What this migration does NOT do:
--   - No rows are inserted into exam_papers. The table is empty on first
--     run; the bulk importer (PR-3) seeds it.
--   - No existing question_bank rows are modified. The new FK is
--     `ON DELETE SET NULL`, so today's 14k rows (all with NULL
--     exam_paper_id) remain perfectly valid.
--   - No change to PR-1's 6 PYQ columns or their constraints.
--   - No change to rag_content_chunks.
--
-- Idempotent: yes. CREATE TABLE IF NOT EXISTS, ADD CONSTRAINT guarded by
--   pg_constraint, indexes IF NOT EXISTS, trigger DROP-IF-EXISTS then
--   CREATE, policies guarded by pg_policy. Re-running on a DB that already
--   has this migration applied is a no-op (the COMMENT statements re-run,
--   which is harmless).
--
-- Owner: architect (schema/RLS). Downstream reviewers per P14:
--   quality (review-chain), testing (E2E for any code that joins), and
--   assessment (since content ingestion downstream affects question
--   coverage and Marking Integrity).
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   1. Verify no rows reference exam_papers:
--        SELECT count(*) FROM question_bank WHERE exam_paper_id IS NOT NULL;
--      If non-zero, the importer has run — coordinate with ops before drop.
--   2. ALTER TABLE question_bank DROP CONSTRAINT fk_question_bank_exam_paper;
--   3. DROP INDEX IF EXISTS idx_question_bank_exam_paper_id;
--   4. DROP TABLE public.exam_papers;       -- requires user approval
--   5. DROP FUNCTION public.exam_papers_set_updated_at();
--   DROP TABLE/COLUMN requires user approval per CLAUDE.md — additive only
--   by default.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Create public.exam_papers table
-- ───────────────────────────────────────────────────────────────────────
-- All columns are defined inline. CHECK constraints are added in a
-- separate DO block below so each constraint can be guarded independently
-- by pg_constraint and stay idempotent on re-run. CREATE TABLE IF NOT
-- EXISTS guarantees the table-create itself is a no-op the second time.
-- ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exam_papers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_code           text NOT NULL UNIQUE,
  exam_family          text NOT NULL,
  exam_session         text,
  paper_pattern        text NOT NULL,
  exam_year            integer NOT NULL,
  exam_month           integer,
  shift                text,
  subject_scope        text[] NOT NULL DEFAULT '{}'::text[],
  total_questions      integer,
  total_marks          integer,
  duration_minutes     integer,
  marking_scheme       jsonb,
  source_url           text,
  source_attribution   text,
  notes                text,
  imported_at          timestamptz NOT NULL DEFAULT now(),
  imported_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────────────
-- 1a. CHECK constraints (each in its own DO block, guarded by pg_constraint)
-- ───────────────────────────────────────────────────────────────────────
-- Pattern mirrors PR-1's $paper_pattern_check$ block exactly: only ADD if
-- the named constraint does not already exist. This keeps re-runs safe
-- and avoids "constraint already exists" errors after a successful first
-- application.
-- ───────────────────────────────────────────────────────────────────────

DO $chk_family$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_family'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_family
      CHECK (exam_family = ANY (ARRAY[
        'jee_main'::text,
        'jee_advanced'::text,
        'neet'::text,
        'olympiad_phy'::text,
        'olympiad_chem'::text,
        'olympiad_math'::text,
        'olympiad_bio'::text,
        'olympiad_astro'::text,
        'olympiad_info'::text,
        'cbse_board'::text,
        'kvpy'::text,
        'nsep'::text,
        'nsec'::text,
        'nsejs'::text,
        'nstse'::text,
        'nso'::text,
        'imo'::text,
        'ntse'::text
      ]));
  END IF;
END $chk_family$;

DO $chk_pattern$
BEGIN
  -- Mirror the 8 values from question_bank.chk_paper_pattern (PR-1) so
  -- the parent paper's pattern is exactly one of the patterns a child
  -- question may carry. Diverging these two enums would let an importer
  -- create a paper whose pattern no question_bank row could ever match.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_pattern'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_pattern
      CHECK (paper_pattern = ANY (ARRAY[
        'mcq_single'::text,
        'mcq_multi'::text,
        'integer'::text,
        'numerical'::text,
        'matching'::text,
        'comprehension'::text,
        'assertion_reason'::text,
        'subjective_proof'::text
      ]));
  END IF;
END $chk_pattern$;

DO $chk_year$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_year'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_year
      CHECK (exam_year BETWEEN 1990 AND 2100);
  END IF;
END $chk_year$;

DO $chk_month$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_month'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_month
      CHECK (exam_month IS NULL OR (exam_month BETWEEN 1 AND 12));
  END IF;
END $chk_month$;

DO $chk_paper_code_len$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_paper_code_len'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_paper_code_len
      CHECK (char_length(paper_code) BETWEEN 1 AND 100);
  END IF;
END $chk_paper_code_len$;

DO $chk_totals$
BEGIN
  -- Single named constraint covers both total_questions and total_marks
  -- positivity. Nullable columns: NULL is allowed (paper metadata may be
  -- incomplete at import time).
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_totals_positive'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_totals_positive
      CHECK (
        (total_questions IS NULL OR total_questions > 0)
        AND
        (total_marks IS NULL OR total_marks > 0)
      );
  END IF;
END $chk_totals$;

DO $chk_duration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_duration_positive'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_duration_positive
      CHECK (duration_minutes IS NULL OR duration_minutes > 0);
  END IF;
END $chk_duration$;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Add the deferred FK on question_bank.exam_paper_id
-- ───────────────────────────────────────────────────────────────────────
-- PR-1 added the column as nullable uuid with no FK because exam_papers
-- did not exist yet. Now that the parent table is created above, we can
-- safely add the FK. ON DELETE SET NULL preserves the question row when
-- a paper is removed — the question still exists as content, it just
-- loses its paper attribution. This is the same defensive posture used
-- for imported_by (admin may be deleted without cascading).
-- Guarded by pg_constraint so the second run is a no-op.
-- ───────────────────────────────────────────────────────────────────────

DO $add_qb_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'fk_question_bank_exam_paper'
       AND pg_class.relname = 'question_bank'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.question_bank
      ADD CONSTRAINT fk_question_bank_exam_paper
      FOREIGN KEY (exam_paper_id)
      REFERENCES public.exam_papers(id)
      ON DELETE SET NULL;
  END IF;
END $add_qb_fk$;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Indexes
-- ───────────────────────────────────────────────────────────────────────
-- idx_exam_papers_family_year: family-by-year browse ("show me all JEE
--   Main papers, most recent first") — descending on year matches the
--   default UI sort. Used by PYQ practice picker.
-- idx_exam_papers_active: partial filter to support fast "active papers
--   only" queries from the catalog. is_active=true is the hot path; the
--   index is a small partial because deactivated papers are rare.
-- idx_exam_papers_session: partial because exam_session is nullable;
--   skipping NULL rows keeps the index compact. Used when the importer
--   reconciles question_bank.exam_session ↔ exam_papers.exam_session.
-- idx_question_bank_exam_paper_id: partial because today 100% of
--   question_bank rows have NULL exam_paper_id; we don't want a 14k-row
--   all-NULL index. Required to keep the new FK's reverse lookup
--   (UPDATE/DELETE on exam_papers, paper→questions join in analytics)
--   index-backed.
-- ───────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_exam_papers_family_year
  ON public.exam_papers (exam_family, exam_year DESC);

CREATE INDEX IF NOT EXISTS idx_exam_papers_active
  ON public.exam_papers (is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_exam_papers_session
  ON public.exam_papers (exam_session)
  WHERE exam_session IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_question_bank_exam_paper_id
  ON public.question_bank (exam_paper_id)
  WHERE exam_paper_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger
-- ───────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE on the function (idempotent). Trigger is dropped if
-- present and recreated so re-runs converge to a single trigger row.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.exam_papers_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exam_papers_set_updated_at ON public.exam_papers;
CREATE TRIGGER trg_exam_papers_set_updated_at
  BEFORE UPDATE ON public.exam_papers
  FOR EACH ROW EXECUTE FUNCTION public.exam_papers_set_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 5. Row Level Security
-- ───────────────────────────────────────────────────────────────────────
-- Two-policy model:
--   - All authenticated users may SELECT (the catalog is non-sensitive
--     metadata: which papers exist, when, by whom).
--   - Only admin_users with admin_level IN ('admin','super_admin') and
--     is_active=true may INSERT/UPDATE/DELETE. This matches the standard
--     admin-write pattern used elsewhere in the schema (see PR-1's
--     downstream importer plan).
--   - Service role bypasses RLS automatically per Supabase contract;
--     no explicit policy needed for the bulk importer Edge Function.
-- Both CREATE POLICY statements are guarded by pg_policy so re-runs are
-- no-ops (CREATE POLICY would otherwise error on the second run).
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.exam_papers ENABLE ROW LEVEL SECURITY;

DO $policy_select$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polname = 'exam_papers_select_authenticated'
       AND c.relname = 'exam_papers'
       AND c.relnamespace = 'public'::regnamespace
  ) THEN
    CREATE POLICY exam_papers_select_authenticated
      ON public.exam_papers
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $policy_select$;

DO $policy_admin_write$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polname = 'exam_papers_admin_write'
       AND c.relname = 'exam_papers'
       AND c.relnamespace = 'public'::regnamespace
  ) THEN
    CREATE POLICY exam_papers_admin_write
      ON public.exam_papers
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.admin_users au
           WHERE au.auth_user_id = auth.uid()
             AND au.is_active = true
             AND au.admin_level IN ('admin', 'super_admin')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.admin_users au
           WHERE au.auth_user_id = auth.uid()
             AND au.is_active = true
             AND au.admin_level IN ('admin', 'super_admin')
        )
      );
  END IF;
END $policy_admin_write$;

-- ───────────────────────────────────────────────────────────────────────
-- 6. Grants
-- ───────────────────────────────────────────────────────────────────────
-- INSERT/UPDATE/DELETE are still gated by the admin-only RLS policy
-- above; the grant just permits Postgres to even evaluate the policy.
-- Without these grants, non-admin authenticated users would get a
-- permission-denied error before RLS even ran.
-- ───────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_papers TO authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- 7. Column comments (self-documentation)
-- ───────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.exam_papers IS
  'JEE/NEET roadmap PR-2 (2026-05-20): canonical catalog of past exam papers (JEE Main/Advanced, NEET, Olympiads, CBSE board). Parent table for question_bank.exam_paper_id. Populated by the bulk-jee-neet-import Edge Function (PR-3). RLS: all authenticated may SELECT; only admin_users (admin/super_admin) may write.';

COMMENT ON COLUMN public.exam_papers.paper_code IS
  'Canonical short code, e.g. ''jee_main_2024_jan_shift1''. UNIQUE. Used as the natural key by the bulk importer for idempotent UPSERTs. Length 1-100 (chk_exam_papers_paper_code_len).';
COMMENT ON COLUMN public.exam_papers.exam_family IS
  'Exam family bucket. One of 18 values: jee_main, jee_advanced, neet, olympiad_phy/chem/math/bio/astro/info, cbse_board, kvpy, nsep, nsec, nsejs, nstse, nso, imo, ntse (chk_exam_papers_family).';
COMMENT ON COLUMN public.exam_papers.exam_session IS
  'Free-form short label matching question_bank.exam_session (e.g. ''jee_main_jan_2024''). Nullable. The importer should keep this in sync with the child rows so analytics can group either way.';
COMMENT ON COLUMN public.exam_papers.paper_pattern IS
  'One of the 8 patterns from question_bank.chk_paper_pattern: mcq_single, mcq_multi, integer, numerical, matching, comprehension, assertion_reason, subjective_proof. Diverging this enum from question_bank would let a paper exist that no child question could match.';
COMMENT ON COLUMN public.exam_papers.exam_year IS
  'Year the paper was administered. Bounded 1990-2100 (chk_exam_papers_year).';
COMMENT ON COLUMN public.exam_papers.exam_month IS
  'Month the paper was administered (1-12) or NULL if only the year is known (chk_exam_papers_month).';
COMMENT ON COLUMN public.exam_papers.shift IS
  'Free-form shift identifier, e.g. ''morning'', ''evening'', ''shift_1''. NULL for single-shift papers.';
COMMENT ON COLUMN public.exam_papers.subject_scope IS
  'Subjects covered by this paper, e.g. ARRAY[''physics'',''chemistry'',''math''] for JEE. Empty array on initial create; populated by the importer.';
COMMENT ON COLUMN public.exam_papers.total_questions IS
  'Total questions in the official paper (sanity check vs ingested count). NULL when metadata is incomplete (chk_exam_papers_totals_positive).';
COMMENT ON COLUMN public.exam_papers.total_marks IS
  'Total marks for the official paper. NULL when unknown (chk_exam_papers_totals_positive).';
COMMENT ON COLUMN public.exam_papers.duration_minutes IS
  'Official duration in minutes. NULL when unknown (chk_exam_papers_duration_positive).';
COMMENT ON COLUMN public.exam_papers.marking_scheme IS
  'Per-paper marking scheme as jsonb: {correct: number, wrong: number, unanswered: number}. e.g. {"correct":4,"wrong":-1,"unanswered":0} for JEE/NEET. Nullable.';
COMMENT ON COLUMN public.exam_papers.source_url IS
  'Provenance URL (NTA, NCERT, official board PDF, etc.). Nullable.';
COMMENT ON COLUMN public.exam_papers.source_attribution IS
  'Human-readable attribution, e.g. ''NTA official'', ''CBSE Sample Paper 2024''. Nullable.';
COMMENT ON COLUMN public.exam_papers.notes IS
  'Free-form admin notes (errata, ingestion caveats). Not user-facing.';
COMMENT ON COLUMN public.exam_papers.imported_at IS
  'Timestamp of first INSERT into this catalog. Distinct from created_at semantically (they coincide in practice on first import) but kept separate for future re-import-tracking workflows.';
COMMENT ON COLUMN public.exam_papers.imported_by IS
  'auth.users.id of the admin who triggered the import. ON DELETE SET NULL — admins may leave without cascading the paper out of the catalog.';
COMMENT ON COLUMN public.exam_papers.is_active IS
  'Soft-delete flag. Hot-path queries filter on is_active=true (backed by partial index idx_exam_papers_active).';

-- ───────────────────────────────────────────────────────────────────────
-- 8. Verification block — RAISE NOTICE counts so the migration log
--    self-documents whether the changes landed.
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_table_exists        boolean;
  v_fk_exists           boolean;
  v_idx_family_year     boolean;
  v_idx_active          boolean;
  v_idx_session         boolean;
  v_idx_qb_paper        boolean;
  v_rls_enabled         boolean;
  v_policy_select       boolean;
  v_policy_admin        boolean;
  v_row_count           integer;
  v_trigger_present     boolean;
  v_all_ok              boolean;
BEGIN
  -- 1. Table existence
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'exam_papers'
  ) INTO v_table_exists;

  -- 2. FK existence
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'fk_question_bank_exam_paper'
       AND t.relname = 'question_bank'
       AND t.relnamespace = 'public'::regnamespace
       AND c.contype = 'f'
  ) INTO v_fk_exists;

  -- 3. Indexes (all 4)
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_exam_papers_family_year')
    INTO v_idx_family_year;
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_exam_papers_active')
    INTO v_idx_active;
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_exam_papers_session')
    INTO v_idx_session;
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_question_bank_exam_paper_id')
    INTO v_idx_qb_paper;

  -- 4. RLS enabled flag (pg_class.relrowsecurity)
  SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'exam_papers';

  -- 5. Policy existence (2 policies)
  SELECT EXISTS (
    SELECT 1 FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polname = 'exam_papers_select_authenticated'
       AND c.relname = 'exam_papers'
       AND c.relnamespace = 'public'::regnamespace
  ) INTO v_policy_select;

  SELECT EXISTS (
    SELECT 1 FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polname = 'exam_papers_admin_write'
       AND c.relname = 'exam_papers'
       AND c.relnamespace = 'public'::regnamespace
  ) INTO v_policy_admin;

  -- 6. Trigger present
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_exam_papers_set_updated_at'
       AND tgrelid = 'public.exam_papers'::regclass
  ) INTO v_trigger_present;

  -- 7. Row count (should be 0 on first run)
  IF v_table_exists THEN
    EXECUTE 'SELECT count(*) FROM public.exam_papers' INTO v_row_count;
  ELSE
    v_row_count := -1;
  END IF;

  RAISE NOTICE 'JEE/NEET PR-2: exam_papers table exists: %', v_table_exists;
  RAISE NOTICE 'JEE/NEET PR-2: fk_question_bank_exam_paper FK exists: %', v_fk_exists;
  RAISE NOTICE 'JEE/NEET PR-2: idx_exam_papers_family_year present: %', v_idx_family_year;
  RAISE NOTICE 'JEE/NEET PR-2: idx_exam_papers_active present: %', v_idx_active;
  RAISE NOTICE 'JEE/NEET PR-2: idx_exam_papers_session present: %', v_idx_session;
  RAISE NOTICE 'JEE/NEET PR-2: idx_question_bank_exam_paper_id present: %', v_idx_qb_paper;
  RAISE NOTICE 'JEE/NEET PR-2: RLS enabled on exam_papers: %', v_rls_enabled;
  RAISE NOTICE 'JEE/NEET PR-2: policy exam_papers_select_authenticated exists: %', v_policy_select;
  RAISE NOTICE 'JEE/NEET PR-2: policy exam_papers_admin_write exists: %', v_policy_admin;
  RAISE NOTICE 'JEE/NEET PR-2: trigger trg_exam_papers_set_updated_at present: %', v_trigger_present;
  RAISE NOTICE 'JEE/NEET PR-2: exam_papers row count: % (expected 0 on first run)', v_row_count;

  v_all_ok := v_table_exists
          AND v_fk_exists
          AND v_idx_family_year
          AND v_idx_active
          AND v_idx_session
          AND v_idx_qb_paper
          AND COALESCE(v_rls_enabled, false)
          AND v_policy_select
          AND v_policy_admin
          AND v_trigger_present;

  IF NOT v_all_ok THEN
    RAISE WARNING 'JEE/NEET PR-2: migration did NOT land cleanly — see flags above';
  ELSE
    RAISE NOTICE 'PR-2 MIGRATION COMPLETE — exam_papers table installed + question_bank FK linked';
  END IF;
END $verify$;

COMMIT;
