-- Migration: 20260814000012_plan_subject_access_restrict.sql
-- Phase 3 / M3 — Server-authoritative allowed-subject policy: plan layer.
--
-- ============================================================================
-- ⚠️  THIS IS A PRICING-SURFACE CHANGE.  CEO-APPROVED (approval on file).  ⚠️
-- ============================================================================
--   This migration changes WHAT EVERY PAYING AND NON-PAYING PLAN UNLOCKS. It
--   removes subject COUNT as a monetisation lever entirely:
--     * every plan (free, starter, pro, unlimited) is granted all five
--       keep-set subjects, and
--     * subscription_plans.max_subjects is set to NULL (= unlimited) on every
--       plan.
--   After this migration, NO subject and NO subject count is behind a paywall.
--
--   WRITING this file changes nothing. APPLYING it is the customer-facing
--   gate — the moment `supabase db push` runs this on prod, free-tier users
--   gain physics/chemistry/biology and lose their 2-subject cap, and the
--   pricing page's subject-count claims become false. Marketing/pricing copy
--   (`subscription_plans.tagline` / `price_display`, the pricing page, and the
--   super-admin plan-access console at /super-admin/subjects/plan-access) is
--   NOT updated by this migration and must be reconciled in the same release.
-- ============================================================================
--
-- Purpose
--   Grant the CEO-locked KEEP-SET — math, science, physics, chemistry,
--   biology — to EVERY plan, and remove the per-plan subject-count cap.
--
-- WHY (record of rationale)
--   With only Mathematics and Science remaining in the catalogue after M1
--   (20260814000007) and M2 (20260814000008), subject COUNT can no longer be
--   the paywall lever — there is not enough breadth left to meter.
--
--   Concretely, the PRE-CHANGE state is:
--     plan_subject_access, restricted to the keep-set
--       free      → math, science                     (no physics/chem/bio)
--       starter   → math, science                     (no physics/chem/bio)
--       pro       → math, science, physics, chemistry, biology
--       unlimited → math, science, physics, chemistry, biology
--     subscription_plans.max_subjects
--       free = 2, starter = 4, pro/unlimited = NULL
--
--   M2 removed `science` from grades 11-12 (there is deliberately no `science`
--   row at 11-12 — the UI presents physics+chemistry+biology as ONE "Science"
--   choice). So a grade 11-12 student on free or starter would be left with
--   EXACTLY ONE unlocked subject: math. A single-subject product is not a
--   funnel, it is a dead end.
--
--   Monetisation therefore moves from BREADTH to DEPTH: mock exams, Foxy
--   chat quota, PYQ access, board-score prediction reports. Those levers live
--   in subscription_plans' own feature columns (foxy_chats_per_day,
--   quizzes_per_day, study_plan_access, notes_access, parent_dashboard,
--   voice_tutor, download_notes, priority_support) and in feature flags —
--   NONE of which this migration touches. Only the two subject-breadth levers
--   (plan_subject_access rows, max_subjects) are neutralised here.
--
-- WHY "NOT IN (keep-set)" AND NEVER "IN (removal-list)"
--   public.subjects / plan_subject_access hold MORE codes than seed.sql
--   declares (see the 20260528000010 header: informatics_practices,
--   health_fitness, psychology, fine_arts, sociology, home_science were
--   inserted out of band and are absent from seed.sql). An enumerated removal
--   list would silently leave 6+ grants live, and a plan would then end with
--   more than five grant rows — which the step-5 assertion would (correctly)
--   fail on. The keep-set is declared exactly ONCE in this file, in the `keep`
--   CTE that seeds the _keep_subject_codes temp table; every subsequent
--   statement reads that table, so it cannot drift within the file.
--
-- WHAT "5 accessible subjects" DOES AND DOES NOT MEAN
--   The step-5 assertion is about GRANT ROWS in plan_subject_access, i.e. the
--   plan layer only. It is NOT a claim that a student sees five subjects in
--   the picker. get_available_subjects() intersects the plan grant with
--   grade_subject_map AND requires `sub.is_active AND sub.is_content_ready`,
--   so after this migration:
--     grades 6-10  → math, science          (physics/chem/bio are not mapped
--                                            at those grades; the new grants
--                                            are simply unreachable there)
--     grades 11-12 → math, physics, chemistry, biology
--   The grants for physics/chemistry/biology at grades 6-10 are inert, not a
--   curriculum change. Nothing in this migration touches grade_subject_map.
--
-- ROLLBACK SOURCE OF TRUTH
--   The single admin_audit_log row written by step 1, action
--   'subject.plan_access.restricted_to_math_science', is written BEFORE any
--   mutation and carries the complete pre-change state:
--     details->'plan_subject_access_before' — every (plan_code, subject_code)
--       grant row that existed, as a JSONB array;
--     details->'max_subjects_before' — a JSONB object mapping every
--       subscription_plans.plan_code to its pre-change max_subjects (JSON null
--       where it was SQL NULL).
--   To roll back: DELETE FROM plan_subject_access, re-INSERT the rows in
--   'plan_subject_access_before', and restore each plan's max_subjects from
--   'max_subjects_before'. No other artifact records the pre-change state.
--   (Same discipline as M1 20260814000007, which is likewise audit-row-keyed.)
--
-- Non-destructive: no DROP TABLE / DROP COLUMN, no schema change of any kind.
-- plan_subject_access rows are deleted, but nothing references that table by
-- foreign key and its full pre-change contents are captured in step 1 first.
-- No content row (question_bank / cbse_syllabus / rag_content_chunks) and no
-- student, teacher or subscription row is read or written here.
--
-- Ordering: apply AFTER 20260814000007 (M1) — plan_subject_access.subject_code
-- carries FK plan_subject_access_subject_code_fkey → subjects(code), so if a
-- keep-set code is missing from public.subjects entirely the step-3 INSERT
-- aborts the whole transaction with a foreign-key violation. That is the
-- intended loud failure; do NOT resolve it by shrinking the keep-set.
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

-- ─── 0b. Plan-code universe, declared exactly once for this file ────────────
-- The CEO-approved shape is "every plan in subscription_plans". This temp
-- table is that set UNION the plan codes already present in
-- plan_subject_access. The union matters: if a plan_code has grant rows but no
-- subscription_plans row (an out-of-band grant, exactly the class of drift the
-- keep-set rule exists for), sourcing only from subscription_plans would leave
-- it holding a partial grant set that the step-5 assertion could never fix —
-- the migration would abort on a condition it had refused to repair. Both
-- CHECK constraints (subscription_plans.chk_valid_plan_code and
-- plan_subject_access_plan_code_check) restrict plan_code to
-- free/starter/pro/unlimited, so this union is at most those four codes.
--
-- is_active is deliberately NOT filtered: an inactive plan row still has a
-- plan_code that student_subscriptions can point at, and enforce_subject_
-- enrollment() resolves grants by plan_code alone.
--
-- Idempotent: ON COMMIT DROP, same as step 0.
CREATE TEMP TABLE _plan_codes ON COMMIT DROP AS
SELECT sp.plan_code FROM public.subscription_plans sp
UNION
SELECT psa.plan_code FROM public.plan_subject_access psa;

-- ─── 1. PRE-CHANGE SNAPSHOT — the rollback source of truth ──────────────────
-- MUST run before steps 2-4. Captures both levers this migration neutralises:
-- the full grant table and every plan's max_subjects.
--
-- Idempotent: guarded by NOT EXISTS on the action code, so exactly one row
-- ever exists for this migration. That guard is load-bearing, not cosmetic —
-- on a re-run the table is already mutated, so an unguarded INSERT would write
-- a second "snapshot" showing the POST-change state and destroy the rollback
-- signal by making it ambiguous which row is authoritative.
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'subject.plan_access.restricted_to_math_science',
  'system',
  NULL,
  jsonb_build_object(
    'plan_subject_access_before',
      COALESCE(
        (SELECT jsonb_agg(
                  jsonb_build_object('plan_code', psa.plan_code, 'subject_code', psa.subject_code)
                  ORDER BY psa.plan_code, psa.subject_code)
           FROM public.plan_subject_access psa),
        '[]'::jsonb
      ),
    'max_subjects_before',
      COALESCE(
        (SELECT jsonb_object_agg(sp.plan_code, sp.max_subjects)
           FROM public.subscription_plans sp),
        '{}'::jsonb
      ),
    'plan_codes',   COALESCE((SELECT array_agg(p.plan_code ORDER BY p.plan_code) FROM _plan_codes p), ARRAY[]::TEXT[]),
    'kept',         (SELECT array_agg(k.code ORDER BY k.code) FROM _keep_subject_codes k),
    'pricing_change', TRUE,
    'migration',    '20260814000012_plan_subject_access_restrict',
    'applied_at',   now()
  ),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_audit_log l
   WHERE l.action = 'subject.plan_access.restricted_to_math_science'
);

-- ─── 2. Drop every grant outside the keep-set ───────────────────────────────
-- Idempotent: after the first run no row satisfies the predicate, so a re-run
-- deletes 0 rows. Nothing references plan_subject_access by foreign key, and
-- its pre-change contents are already captured in step 1.
DELETE FROM public.plan_subject_access psa
 WHERE psa.subject_code NOT IN (SELECT k.code FROM _keep_subject_codes k);

-- ─── 3. Grant the whole keep-set to every plan ──────────────────────────────
-- The CROSS JOIN reads both single declarations (step 0 and step 0b) rather
-- than re-typing plan codes or subject codes, so neither set can drift here.
--
-- Idempotent: bare ON CONFLICT DO NOTHING resolves against the primary key
-- plan_subject_access_pkey (plan_code, subject_code), so a re-run inserts
-- nothing and existing created_at values are preserved (DO NOTHING, not
-- DO UPDATE).
INSERT INTO public.plan_subject_access (plan_code, subject_code)
SELECT p.plan_code, k.code
  FROM _plan_codes p
  CROSS JOIN _keep_subject_codes k
ON CONFLICT DO NOTHING;

-- ─── 4. Remove the subject-count cap on every plan ──────────────────────────
-- NULL is the "unlimited" sentinel the enforcement path already understands:
-- the set_student_subjects RPC gates on `IF v_max IS NOT NULL AND v_count >
-- v_max`, and the super-admin console renders NULL as "unlimited". So this is
-- a value change on an existing nullable column, not a semantic invention.
--
-- The legacy `subjects_allowed` column is deliberately NOT touched — no SQL
-- function and no API route reads it (grep: only the column definition in the
-- baseline). Changing a dead column would add rollback surface for no effect.
--
-- Idempotent: `WHERE max_subjects IS NOT NULL` means a re-run matches zero
-- rows. (Plain `SET max_subjects = NULL` with no WHERE would also converge to
-- the same value, but would dirty every row and fire set_updated_at on each
-- re-run; the guard keeps the re-run a true no-op.)
UPDATE public.subscription_plans sp
   SET max_subjects = NULL
 WHERE sp.max_subjects IS NOT NULL;

-- ─── 5. ASSERTION: every plan ends with exactly 5 accessible subjects ───────
-- Step 2 guarantees every surviving grant row is a keep-set code, and the
-- primary key guarantees (plan_code, subject_code) uniqueness. So for a given
-- plan, "exactly 5 grant rows" is equivalent to "exactly the keep-set" — the
-- count alone is a sufficient check, no set-comparison needed.
--
-- What this catches: a plan whose step-3 INSERT was partially blocked (e.g. a
-- BEFORE trigger or a future CHECK rejecting one code), a plan_code present in
-- _plan_codes for which the CROSS JOIN produced fewer rows than expected, or
-- a keep-set code silently absent from public.subjects (though that fails
-- louder and earlier, at the step-3 foreign key).
--
-- BEGIN/COMMIT means the RAISE rolls back steps 1-4 in full: a failed run
-- leaves the pricing surface exactly as it was, including no audit row.
--
-- Vacuous-pass note: if _plan_codes is empty (a fresh database where neither
-- subscription_plans nor plan_subject_access has been seeded) this assertion
-- passes with nothing to check. That is correct — there is no plan to strand —
-- and steps 2-4 are likewise no-ops on such a database.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(
           format('%s=%s', x.plan_code, x.n),
           ', ' ORDER BY x.plan_code
         )
    INTO v_bad
    FROM (
      SELECT p.plan_code,
             (SELECT count(*)
                FROM public.plan_subject_access psa
               WHERE psa.plan_code = p.plan_code) AS n
        FROM _plan_codes p
    ) x
   WHERE x.n <> 5;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'plan_subject_access restriction left plan(s) without exactly 5 keep-set grants: %',
      v_bad
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Every plan must grant all of math, science, physics, chemistry, biology. Confirm all five codes exist in public.subjects (migration 20260814000007 must be applied first). Do NOT weaken the keep-set or the assertion to make this pass.';
  END IF;
END;
$$;

COMMIT;
