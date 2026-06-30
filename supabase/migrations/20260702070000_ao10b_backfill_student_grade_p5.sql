-- Migration: 20260702070000_ao10b_backfill_student_grade_p5.sql
-- Purpose: AO-10b — one-time, fail-safe historical row-backfill of public.students.grade
--          to the bare CBSE grade-string contract (P5: grades are "6".."12", never
--          "Grade N"), PLUS write-path default fixes that stop re-accrual of "Grade N".
--
-- WHAT THIS DOES
--   PART A (data backfill): rewrites legacy/prefixed students.grade values ("Grade 9",
--           "Class 11", "Grade-7", "11th", " 8 ", …) to the bare in-range digit string.
--   PART B (write-path fix): flips the grade DEFAULT literal in create_student_profile
--           ('Grade 9' -> '9') and get_or_create_student ('Grade 6' -> '6') so new rows
--           never re-introduce the "Grade N" shape. (bootstrap_user_profile / handle_new_user
--           already write bare; nothing to change there.)
--
-- EXTRACTION SEMANTICS — mirrors the TypeScript `normalizeGrade`
-- (src/lib/identity/constants.ts:170-191), NOT the SQL public.normalize_grade()
-- (which normalizes the OPPOSITE direction, bare -> "Grade N", for content joins and
-- must NOT be used here). The rule, applied inline:
--   * Already-bare valid string ("6".."12")            -> left untouched (UPDATE skips it).
--   * Embedded grade number, first 1-2 digit run in [6,12] -> set to that digit (int-cast
--     strips any leading zero, e.g. "Grade 06" -> "6", matching parseInt/String in TS).
--   * Ambiguous / out-of-range / no-digit ("Grade 5", "Grade 13", "Grade", NULL-ish)
--     -> LEFT UNTOUCHED. We never corrupt a real value and never invent the TS '9' safe
--     default at the data layer; that default only ever applies at read time (PR D / AO-10).
--
-- SAFETY PROPERTIES
--   * IDEMPOTENT: only non-bare-but-parseable rows match; a second run (or a fresh/clean
--     DB) updates zero rows. All DDL uses IF NOT EXISTS / CREATE OR REPLACE / DROP..IF EXISTS.
--   * FAIL-SAFE: only clearly-parseable [6,12] rows are touched; out-of-range/ambiguous
--     rows are reported (RAISE NOTICE) and left exactly as-is.
--   * REVERSIBLE: every changed row is snapshotted (id, old_grade, new_grade) into
--     public._ao10b_grade_backfill_backup BEFORE the UPDATE. To roll back:
--       UPDATE public.students s SET grade = b.old_grade
--       FROM public._ao10b_grade_backfill_backup b WHERE b.id = s.id;
--   * NO DROP TABLE / DROP COLUMN. No CHECK constraint added (a CHECK would reject the
--     still-possible-elsewhere "Grade N" and is a separate, gated decision).
--
-- PRODUCTION IMPACT: this MUTATES production student grade data on deploy. It is a
-- one-time, fail-safe, reversible correction and is NO-USER-VISIBLE-CHANGE because the
-- read layer (PR D / AO-10) already coerces grades at read time; this aligns the stored
-- value with what the app already displays.
--
-- DOWNSTREAM REVIEW: assessment (P5 extraction parity with TS normalizeGrade),
-- backend (write-path RPCs touched in Part B), testing (REG-209 source pins), quality.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — historical row-backfill
-- ─────────────────────────────────────────────────────────────────────────────

-- A.1 Read-only pre-flight report: how many rows are dirty, split into fixable vs left-as-is.
DO $$
DECLARE
  v_parseable int;
  v_ambiguous int;
BEGIN
  SELECT count(*) INTO v_parseable
  FROM public.students
  WHERE grade NOT IN ('6','7','8','9','10','11','12')
    AND substring(grade from '\d{1,2}') IS NOT NULL
    AND substring(grade from '\d{1,2}')::int BETWEEN 6 AND 12;

  SELECT count(*) INTO v_ambiguous
  FROM public.students
  WHERE grade NOT IN ('6','7','8','9','10','11','12')
    AND (
      substring(grade from '\d{1,2}') IS NULL
      OR substring(grade from '\d{1,2}')::int NOT BETWEEN 6 AND 12
    );

  RAISE NOTICE 'AO-10b pre-flight: % non-bare student grade rows parseable to [6,12] (WILL FIX); % ambiguous/out-of-range (WILL LEAVE UNTOUCHED).',
    v_parseable, v_ambiguous;
END;
$$;

-- A.2 Reversibility backup table (id is a UUID — no PII). RLS + service-role-only policy.
CREATE TABLE IF NOT EXISTS public._ao10b_grade_backfill_backup (
  id            uuid,
  old_grade     text,
  new_grade     text,
  backfilled_at timestamptz DEFAULT now()
);

ALTER TABLE public._ao10b_grade_backfill_backup ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS; this explicit policy makes the intent unambiguous and keeps
-- the table fully closed to anon/authenticated (no policy for them => deny-by-default).
DROP POLICY IF EXISTS "_ao10b_backup_service_role_all" ON public._ao10b_grade_backfill_backup;
CREATE POLICY "_ao10b_backup_service_role_all"
  ON public._ao10b_grade_backfill_backup
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- A.3 Snapshot the rows about to change (guarded so replay does not duplicate the same change).
INSERT INTO public._ao10b_grade_backfill_backup (id, old_grade, new_grade)
SELECT
  s.id,
  s.grade,
  (substring(s.grade from '\d{1,2}'))::int::text
FROM public.students s
WHERE s.grade NOT IN ('6','7','8','9','10','11','12')
  AND substring(s.grade from '\d{1,2}') IS NOT NULL
  AND substring(s.grade from '\d{1,2}')::int BETWEEN 6 AND 12
  AND NOT EXISTS (
    SELECT 1
    FROM public._ao10b_grade_backfill_backup b
    WHERE b.id = s.id
      AND b.old_grade = s.grade
  );

-- A.4 The backfill UPDATE — touches ONLY non-bare rows whose embedded number is in [6,12].
DO $$
DECLARE
  v_fixed int;
BEGIN
  UPDATE public.students s
  SET grade = (substring(s.grade from '\d{1,2}'))::int::text
  WHERE s.grade NOT IN ('6','7','8','9','10','11','12')
    AND substring(s.grade from '\d{1,2}') IS NOT NULL
    AND substring(s.grade from '\d{1,2}')::int BETWEEN 6 AND 12;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'AO-10b backfill: rewrote % student grade row(s) to the bare contract.', v_fixed;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — write-path default fix (stop re-accrual of "Grade N")
-- Bodies reproduced EXACTLY from baseline (00000000000000_baseline_from_prod.sql),
-- changing ONLY the p_grade DEFAULT literal. No other logic/security/search_path change.
-- ─────────────────────────────────────────────────────────────────────────────

-- B.1 create_student_profile — baseline default 'Grade 9' -> '9'. (SECURITY DEFINER, search_path public.)
CREATE OR REPLACE FUNCTION "public"."create_student_profile"("p_auth_user_id" "uuid", "p_name" "text", "p_email" "text", "p_grade" "text" DEFAULT '9'::"text", "p_board" "text" DEFAULT 'CBSE'::"text", "p_language" "text" DEFAULT 'en'::"text", "p_subject" "text" DEFAULT 'math'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_student_id uuid;
BEGIN
  INSERT INTO students (auth_user_id, name, email, grade, board, preferred_language, preferred_subject, onboarding_completed, is_active, account_status)
  VALUES (p_auth_user_id, p_name, p_email, p_grade, p_board, p_language, p_subject, false, true, 'active')
  ON CONFLICT (auth_user_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, grade = EXCLUDED.grade, board = EXCLUDED.board, preferred_language = EXCLUDED.preferred_language, preferred_subject = EXCLUDED.preferred_subject, updated_at = now()
  RETURNING id INTO v_student_id;
  INSERT INTO student_learning_profiles (student_id, subject, xp, level) VALUES (v_student_id, 'math', 0, 1), (v_student_id, 'science', 0, 1), (v_student_id, 'english', 0, 1), (v_student_id, 'hindi', 0, 1), (v_student_id, 'physics', 0, 1), (v_student_id, 'chemistry', 0, 1), (v_student_id, 'biology', 0, 1)
  ON CONFLICT (student_id, subject) DO NOTHING;
  RETURN jsonb_build_object('success', true, 'student_id', v_student_id, 'name', p_name, 'grade', p_grade);
END;
$$;

-- B.2 get_or_create_student — baseline default 'Grade 6' -> '6'. (SECURITY INVOKER, search_path public.)
CREATE OR REPLACE FUNCTION "public"."get_or_create_student"("p_auth_user_id" "uuid", "p_name" "text" DEFAULT 'Student'::"text", "p_grade" "text" DEFAULT '6'::"text", "p_subject" "text" DEFAULT 'Mathematics'::"text", "p_language" "text" DEFAULT 'en'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$ DECLARE v_student_id uuid; BEGIN SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1; IF v_student_id IS NOT NULL THEN RETURN v_student_id; END IF; INSERT INTO students (auth_user_id, name, grade, preferred_language, preferred_subject, onboarding_completed, is_active) VALUES (p_auth_user_id, p_name, p_grade, p_language, p_subject, false, true) RETURNING id INTO v_student_id; RETURN v_student_id; EXCEPTION WHEN unique_violation THEN SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1; RETURN v_student_id; END; $$;
