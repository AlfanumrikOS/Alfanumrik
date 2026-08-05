-- Migration: 20260807000300_student_misconceptions_writer_support.sql
-- Purpose: Foxy North-Star Phase 2 (spec §1.3) — make student_misconceptions
--   safe for the automated writer added to submit_quiz_results_v2
--   (20260807000500). The writer upserts ONE open row per
--   (student_id, pattern_code, concept_code) and resolves it on a later
--   correct answer. That upsert needs a partial unique index to target with
--   ON CONFLICT.
--
-- ─── RLS AUDIT (P8, performed 2026-08-05 against the baseline) ───────────────
-- student_misconceptions ALREADY has RLS enabled with policies in
-- 00000000000000_baseline_from_prod.sql:
--   * L22203: ALTER TABLE "public"."student_misconceptions" ENABLE ROW LEVEL SECURITY;
--   * L22097: POLICY "sm_own_read"  FOR SELECT USING (student_id = get_my_student_id())
--   * L22100: POLICY "sm_service"   TO service_role USING (true) WITH CHECK (true)
-- Posture: student-own-read + service-role ALL. Parent/teacher lanes are
-- intentionally absent (misconception rows are remediation-internal; any
-- guardian/teacher surface reads aggregates via server routes on the service
-- role). NO RLS DDL needed in this migration — audit documented here per P8.
--
-- ─── Pre-index hygiene ────────────────────────────────────────────────────────
-- 1. is_resolved is nullable (baseline DEFAULT false, no NOT NULL). A NULL
--    is_resolved row would silently escape the partial-index predicate
--    (WHERE is_resolved = false) and therefore escape both dedupe and
--    ON CONFLICT inference. Normalize NULL -> false and pin DEFAULT false.
--    (NOT NULL is deliberately NOT added — out of scope, and would risk
--    breaking any legacy writer that passes explicit NULL.)
-- 2. Dedupe existing OPEN duplicates so the unique index can build: for each
--    (student_id, pattern_code, concept_code) keep the most recent open row
--    (latest detected_at, id as tiebreak) and mark the older ones resolved
--    with resolution_method 'dedupe_20260807000300' (audit-traceable; no rows
--    deleted — no DROP/DELETE of student data).
--
-- Idempotent: guarded UPDATEs + CREATE UNIQUE INDEX IF NOT EXISTS. Re-running
-- finds nothing left to normalize/dedupe. No DROP.
-- Owner: architect. Added: 2026-08-05. Reviewers: assessment, testing.

-- (1) Normalize NULL is_resolved and pin the default.
UPDATE public.student_misconceptions
   SET is_resolved = false
 WHERE is_resolved IS NULL;

ALTER TABLE public.student_misconceptions
  ALTER COLUMN is_resolved SET DEFAULT false;

-- (2) Dedupe open rows: keep the newest open row per key, resolve the rest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY student_id, pattern_code, concept_code
           ORDER BY detected_at DESC NULLS LAST, id DESC
         ) AS rn
    FROM public.student_misconceptions
   WHERE is_resolved = false
)
UPDATE public.student_misconceptions sm
   SET is_resolved       = true,
       resolved_at       = now(),
       resolution_method = 'dedupe_20260807000300'
  FROM ranked r
 WHERE sm.id = r.id
   AND r.rn > 1;

-- (3) The partial unique index the 20260807000500 writer targets with
--     ON CONFLICT (student_id, pattern_code, concept_code) WHERE is_resolved = false.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_misconceptions_open
  ON public.student_misconceptions (student_id, pattern_code, concept_code)
  WHERE is_resolved = false;

COMMENT ON INDEX public.uq_student_misconceptions_open IS
  'At most ONE open (is_resolved = false) misconception row per student + '
  'pattern_code + concept_code. ON CONFLICT target for the automated writer '
  'in submit_quiz_results_v2 (20260807000500). Foxy North-Star Phase 2.';
