-- Migration: 20260814000008_grade_subject_map_restrict_and_destream.sql
-- Phase 3 / M2 — Server-authoritative allowed-subject policy: grade map layer.
--
-- Purpose
--   1. Archive, then remove, every grade_subject_map row outside the KEEP-SET.
--   2. De-stream grades 11-12: replace the stream-scoped rows
--      (science / commerce / humanities) with stream-NULL rows for
--      math + physics + chemistry + biology, per (grade, board) pair that
--      actually exists today.
--
-- Resulting reachable map
--   Grades 6-10  → math, science          (stream IS NULL, as it already was)
--   Grades 11-12 → math, physics, chemistry, biology  (stream IS NULL)
--                  There is deliberately NO `science` row at 11-12; the UI
--                  presents physics+chemistry+biology as ONE "Science" choice
--                  grouped alongside Mathematics.
--
-- WHY "NOT IN (keep-set)" AND NEVER "IN (removal-list)"
--   public.subjects / grade_subject_map hold MORE codes than seed.sql declares
--   (see 20260528000010 header: informatics_practices, health_fitness,
--   psychology, fine_arts, sociology, home_science were inserted out of band).
--   An enumerated removal list silently leaves 6+ subjects reachable. The
--   keep-set is declared exactly ONCE in this file — in the `keep` CTE that
--   seeds the _keep_subject_codes temp table — and every subsequent statement
--   reads that table, so it cannot drift within the file. (A plain CTE is
--   statement-scoped and this migration needs several statements; the
--   ON COMMIT DROP temp table is the multi-statement equivalent of one CTE.)
--
-- WHY stream-NULL rows are ADDED rather than the stream column UPDATEd
--   The unique index is
--     grade_subject_map_uniq (grade, subject_code, stream, board) NULLS NOT DISTINCT
--   (20260605000000). Under NULLS NOT DISTINCT a stream=NULL row is a DISTINCT
--   key from the stream='science' row it replaces, so INSERT-then-DELETE is
--   collision-free and leaves no window in which a (grade, board) pair has
--   zero rows. students.stream is intentionally NOT touched anywhere in this
--   migration set: get_available_subjects / enforce_subject_enrollment both
--   match with `(gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)`,
--   so a stream-NULL row matches EVERY student, including students whose
--   stream is 'commerce', 'humanities' or NULL.
--
-- Non-destructive: no DROP TABLE / DROP COLUMN. Deleted rows are copied to a
-- durable archive table first. No content row (question_bank, cbse_syllabus,
-- rag_content_chunks) is read or written here.
--
-- Idempotency — per statement, see the inline notes below each block.

BEGIN;

-- ─── 0. KEEP-SET, declared exactly once for this file ───────────────────────
-- Idempotent: ON COMMIT DROP means the temp table never survives the
-- transaction, so every run (re-run included) starts from a clean create.
CREATE TEMP TABLE _keep_subject_codes ON COMMIT DROP AS
WITH keep(code) AS (
  VALUES ('math'), ('science'), ('physics'), ('chemistry'), ('biology')
)
SELECT k.code FROM keep k;

-- ─── 1. Archive table (P8: RLS in the same migration) ───────────────────────
-- Idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- ENABLE ROW LEVEL SECURITY (a no-op when already enabled) /
-- DROP POLICY IF EXISTS before CREATE POLICY.
CREATE TABLE IF NOT EXISTS public.grade_subject_map_archive_20260814 (
  LIKE public.grade_subject_map INCLUDING DEFAULTS
);

ALTER TABLE public.grade_subject_map_archive_20260814
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON TABLE public.grade_subject_map_archive_20260814 IS
  'Phase 3 M2 rollback source: every grade_subject_map row deleted by '
  'migration 20260814000008 (out-of-keep-set rows + all grade 11/12 '
  'stream-scoped rows). Service-role read only. Curriculum metadata, no PII.';

-- RLS: this table holds no student data, but P8 requires RLS on every new
-- table. It is service-role-only — no student, parent or teacher read path
-- exists for it, so the four-pattern policy set collapses to the admin
-- pattern alone (service_role additionally bypasses RLS by design; the
-- explicit policy below documents the intended reach and keeps the table
-- deny-by-default for every other role).
ALTER TABLE public.grade_subject_map_archive_20260814 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.grade_subject_map_archive_20260814 FROM PUBLIC;
REVOKE ALL ON TABLE public.grade_subject_map_archive_20260814 FROM anon, authenticated;
GRANT SELECT ON TABLE public.grade_subject_map_archive_20260814 TO service_role;

DROP POLICY IF EXISTS gsm_archive_20260814_service_role_select
  ON public.grade_subject_map_archive_20260814;
CREATE POLICY gsm_archive_20260814_service_role_select
  ON public.grade_subject_map_archive_20260814
  FOR SELECT TO service_role USING (true);

-- ─── 2. Snapshot of (grade, board) pairs BEFORE any change ──────────────────
-- Feeds both the grade 11-12 re-insert (step 4) and the assertion (step 6).
-- Idempotent: ON COMMIT DROP, same as step 0.
CREATE TEMP TABLE _gsm_pairs_before ON COMMIT DROP AS
SELECT DISTINCT gsm.grade, gsm.board
  FROM public.grade_subject_map gsm;

-- ─── 3. Archive every row that step 5 will delete ───────────────────────────
-- Idempotent: guarded by NOT EXISTS on the archive's copy of the source
-- primary key (grade_subject_map.id), so re-running copies nothing twice.
INSERT INTO public.grade_subject_map_archive_20260814 (
  id, grade, subject_code, stream, is_core, min_questions_seeded,
  created_at, updated_at, board, archived_at
)
SELECT
  gsm.id, gsm.grade, gsm.subject_code, gsm.stream, gsm.is_core,
  gsm.min_questions_seeded, gsm.created_at, gsm.updated_at, gsm.board, now()
FROM public.grade_subject_map gsm
WHERE (
        gsm.subject_code NOT IN (SELECT k.code FROM _keep_subject_codes k)
        OR (gsm.grade IN ('11', '12') AND gsm.stream IS NOT NULL)
      )
  AND NOT EXISTS (
        SELECT 1
          FROM public.grade_subject_map_archive_20260814 a
         WHERE a.id = gsm.id
      );

-- ─── 4. Insert stream-NULL grade 11-12 rows ─────────────────────────────────
-- One row per (grade, board) pair that actually exists, crossed with the
-- keep-set MINUS 'science' (there is no `science` subject at grades 11-12 —
-- physics+chemistry+biology ARE the "Science" choice). Deriving the 11-12 set
-- from _keep_subject_codes rather than re-typing four codes keeps the single
-- declaration authoritative.
--
-- Grades are STRINGS (P5): '11' / '12', never 11 / 12.
--
-- is_core = TRUE for all four: after the restriction these four ARE the entire
-- grade 11-12 offering, so none of them is an elective. (Pre-restriction
-- biology carried is_core=false under stream='science'; that distinction is
-- meaningless once the four are presented as one grouped choice.)
--
-- board is copied verbatim from the pre-change pair, INCLUDING NULL — the
-- unique index is NULLS NOT DISTINCT and get_available_subjects() has an
-- explicit `gsm.board IS NULL` fallback branch, so preserving NULL preserves
-- current matching behaviour.
--
-- Idempotent: bare ON CONFLICT DO NOTHING resolves against
-- grade_subject_map_uniq, so a re-run inserts nothing.
INSERT INTO public.grade_subject_map (grade, subject_code, stream, board, is_core)
SELECT p.grade, k.code, NULL::TEXT, p.board, TRUE
  FROM _gsm_pairs_before p
  CROSS JOIN (
    SELECT code FROM _keep_subject_codes WHERE code <> 'science'
  ) AS k
 WHERE p.grade IN ('11', '12')
ON CONFLICT DO NOTHING;

-- ─── 5. Delete out-of-keep-set rows + all grade 11/12 stream-scoped rows ────
-- Runs AFTER step 4 so no (grade, board) pair is ever momentarily empty.
-- The rows inserted by step 4 are all keep-set and stream IS NULL, so this
-- DELETE cannot touch them.
-- Idempotent: after the first run no row satisfies either predicate, so a
-- re-run deletes 0 rows. Nothing references grade_subject_map by foreign key.
DELETE FROM public.grade_subject_map gsm
 WHERE gsm.subject_code NOT IN (SELECT k.code FROM _keep_subject_codes k)
    OR (gsm.grade IN ('11', '12') AND gsm.stream IS NOT NULL);

-- ─── 6. ASSERTION: no (grade, board) pair may be left with zero subjects ────
-- Step 4 only re-seeds grades 11-12. A board whose ONLY mapped subjects for a
-- grade were outside the keep-set — e.g. an ICSE or State-board grade 6 row
-- set of english/hindi/social_studies with no math/science row — would be
-- silently wiped to zero, and every student on that (grade, board) would see
-- an empty subject list with no error anywhere. Fail the whole transaction
-- instead: BEGIN/COMMIT means the RAISE rolls back steps 1-5 in full.
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(
           format('(grade=%s, board=%s)', p.grade, COALESCE(p.board, '<null>')),
           ', ' ORDER BY p.grade, p.board
         )
    INTO v_missing
    FROM _gsm_pairs_before p
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.grade_subject_map g
            WHERE g.grade = p.grade
              AND g.board IS NOT DISTINCT FROM p.board
         );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'grade_subject_map restriction would strand grade/board pair(s) with zero mapped subjects: %',
      v_missing
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Seed math (grades 6-12) and science (grades 6-10) rows for the listed (grade, board) pairs, then re-run this migration. Do NOT weaken the keep-set to make this pass.';
  END IF;
END;
$$;

-- ─── 7. Operational audit trail ─────────────────────────────────────────────
-- The archive table is the rollback source of truth; this row is the ops
-- breadcrumb pointing at it.
-- Idempotent: guarded by NOT EXISTS on the action code, so exactly one row
-- ever exists for this migration.
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'subject.grade_map.restricted_and_destreamed',
  'system',
  NULL,
  jsonb_build_object(
    'archive_table',  'public.grade_subject_map_archive_20260814',
    'archived_rows',  (SELECT count(*) FROM public.grade_subject_map_archive_20260814),
    'remaining_rows', (SELECT count(*) FROM public.grade_subject_map),
    'kept',           (SELECT array_agg(k.code ORDER BY k.code) FROM _keep_subject_codes k),
    'migration',      '20260814000008_grade_subject_map_restrict_and_destream',
    'applied_at',     now()
  ),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_audit_log l
   WHERE l.action = 'subject.grade_map.restricted_and_destreamed'
);

COMMIT;
