-- Migration: 20260702140000_p3w2_9_orphan_fk_hardening.sql
-- Purpose: Phase 3 Wave 2 #9 (S2). Additive schema hardening — add the missing
--          FOREIGN KEY constraints identified by the Phase 2 data-integrity audit
--          (docs/audit/2026-07-02-validation/13-data-integrity.md, section D-1,
--          Phase 3 queue items #2, #5, #6):
--
--   1. quiz_responses.question_id            -> question_bank(id)      [HIGH]
--   2. monthly_synthesis_runs.student_id      -> students(id)          [MEDIUM]
--   3. dive_artifacts.student_id              -> students(id)          [MEDIUM]
--   4. dive_artifacts.phenomenon_slug         -> phenomena(slug)       [MEDIUM]
--   5. learner_twin_memory.concept_topic_id   -> curriculum_topics(id) [MEDIUM]
--   6. learner_twin_memory.misconception_id   -> misconception_patterns(id) [MEDIUM]
--
-- ─── Why these 6 and not more ────────────────────────────────────────────────
-- D-1 was exhaustive for 15 named hot tables; every *_id-shaped column on those
-- 15 was checked against the full migration chain's FOREIGN KEY set. 11/15 were
-- already fully constrained. These are the remaining 4 tables / 6 columns.
-- `notifications.recipient_id`/`sender_id` and
-- `guardian_student_links.approved_by`/`revoked_by` were explicitly EXCLUDED by
-- the audit (polymorphic association / audit-trail "who acted" columns — see
-- D-1 "Intentionally-unconstrained" section) and are NOT touched here.
--
-- ─── ON DELETE convention per target (matches existing sibling FKs) ──────────
-- * quiz_responses.question_id -> question_bank(id) ON DELETE SET NULL.
--   question_id is already nullable (no NOT NULL on the column). Of the 6
--   sibling tables that already FK the identical column name to
--   question_bank(id), content_reports uses ON DELETE SET NULL while
--   question_misconceptions/question_responses/user_question_history/
--   mock_test_attempts use ON DELETE CASCADE (learning_events specifies
--   neither, i.e. NO ACTION). quiz_responses is the platform's audit trail of
--   every live quiz answer (P1/P4-critical) — CASCADE would silently destroy a
--   student's already-scored answer history if a question_bank row is ever
--   deleted. SET NULL preserves the response row (score/XP were already
--   computed and persisted elsewhere) and just nulls the now-dangling
--   reference, mirroring content_reports' identical audit-preservation
--   reasoning. This is the fix shape the audit's own Phase 3 queue item #2
--   recommended.
-- * monthly_synthesis_runs.student_id / dive_artifacts.student_id ->
--   students(id) ON DELETE CASCADE. Matches every sibling pedagogy-v2 table
--   that already constrains the identical student_id NOT NULL shape:
--   adaptive_interventions, learner_twin_snapshots, learner_twin_memory (all
--   REFERENCES public.students(id) ON DELETE CASCADE).
-- * dive_artifacts.phenomenon_slug -> phenomena(slug) ON DELETE SET NULL.
--   phenomenon_slug is nullable (NULL when picker_option != 'phenomenon') and
--   phenomena.slug is UNIQUE (declared in the same migration,
--   20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql:27). SET NULL
--   because a phenomenon catalog entry being retired/renamed should not
--   destroy the student's already-written dive artifact.
-- * learner_twin_memory.concept_topic_id -> curriculum_topics(id) ON DELETE
--   SET NULL. Matches the dominant convention for topic_id-shaped columns
--   referencing curriculum_topics across the chain (question_bank_topic_id_fkey,
--   assessment_questions_topic_id_fkey, assessments_topic_id_fkey,
--   tutoring_sessions_topic_id_fkey, vernacular_content_topic_id_fkey all use
--   ON DELETE SET NULL). Column is already nullable.
-- * learner_twin_memory.misconception_id -> misconception_patterns(id) ON
--   DELETE SET NULL. misconception_patterns is the only misconception-related
--   table in the chain with a surrogate uuid PRIMARY KEY "id" suitable as an
--   FK target (question_misconceptions/student_misconceptions key off text
--   pattern_code/misconception_code, not uuid). Column is already nullable and
--   has no live writer yet (learner_twin_memory's "twin builder" producer has
--   not shipped — grep across supabase/functions/ and src/ finds zero INSERT
--   call sites as of this migration), so there is zero orphan-row risk today.
--
-- ─── Orphan-row pre-flight caveat (READ BEFORE APPLYING TO PROD) ─────────────
-- This migration has NO live DB access (static-audit-derived, per the Phase 2
-- validation doc's own scope note). Every ADD CONSTRAINT below follows the
-- established fk_question_bank_chapter precedent
-- (00000000000000_baseline_from_prod.sql:19044-19045 — "FOREIGN KEY (chapter_id)
-- REFERENCES chapters(id) ON DELETE SET NULL NOT VALID") and is added
-- `NOT VALID`. This is standard PostgreSQL FK syntax (contrary to a common
-- misconception): `NOT VALID` makes the constraint enforced for all NEW/
-- UPDATEd rows immediately, but skips scanning existing rows at ADD time, so
-- the migration can never fail or block on legacy orphan data. Existing
-- orphans (if any) remain silently unvalidated until an operator runs
-- `ALTER TABLE ... VALIDATE CONSTRAINT ...` by hand after confirming/backfilling
-- clean data. Before running that manual VALIDATE step in prod, run the
-- pre-flight orphan-check queries in the "Verify" block at the bottom of this
-- file for each of the 6 constraints.
--
-- ─── Idempotency ──────────────────────────────────────────────────────────────
-- Each ADD CONSTRAINT is wrapped in a pg_constraint existence guard (DO block),
-- matching the convention in 20260519000001_mol_shadow_routing.sql and
-- 20260520000004_jee_neet_schema_unblock.sql. Safe to re-run on any environment.
--
-- ─── Safety properties ────────────────────────────────────────────────────────
--   * Purely additive: no DROP TABLE / DROP COLUMN / DROP CONSTRAINT.
--   * No RLS change, no new table, no new column, no data mutation.
--   * NOT VALID means zero risk of migration failure due to legacy orphan rows
--     and zero downtime lock escalation (no full-table scan at ADD time).
--   * Rollback: DROP CONSTRAINT <name> on any of the 6, in any order.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. quiz_responses.question_id -> question_bank(id) ON DELETE SET NULL
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quiz_responses_question_id_fkey'
      AND conrelid = 'public.quiz_responses'::regclass
  ) THEN
    ALTER TABLE public.quiz_responses
      ADD CONSTRAINT quiz_responses_question_id_fkey
      FOREIGN KEY (question_id) REFERENCES public.question_bank(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. monthly_synthesis_runs.student_id -> students(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'monthly_synthesis_runs_student_id_fkey'
      AND conrelid = 'public.monthly_synthesis_runs'::regclass
  ) THEN
    ALTER TABLE public.monthly_synthesis_runs
      ADD CONSTRAINT monthly_synthesis_runs_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES public.students(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. dive_artifacts.student_id -> students(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dive_artifacts_student_id_fkey'
      AND conrelid = 'public.dive_artifacts'::regclass
  ) THEN
    ALTER TABLE public.dive_artifacts
      ADD CONSTRAINT dive_artifacts_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES public.students(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. dive_artifacts.phenomenon_slug -> phenomena(slug) ON DELETE SET NULL
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dive_artifacts_phenomenon_slug_fkey'
      AND conrelid = 'public.dive_artifacts'::regclass
  ) THEN
    ALTER TABLE public.dive_artifacts
      ADD CONSTRAINT dive_artifacts_phenomenon_slug_fkey
      FOREIGN KEY (phenomenon_slug) REFERENCES public.phenomena(slug)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. learner_twin_memory.concept_topic_id -> curriculum_topics(id) ON DELETE SET NULL
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learner_twin_memory_concept_topic_id_fkey'
      AND conrelid = 'public.learner_twin_memory'::regclass
  ) THEN
    ALTER TABLE public.learner_twin_memory
      ADD CONSTRAINT learner_twin_memory_concept_topic_id_fkey
      FOREIGN KEY (concept_topic_id) REFERENCES public.curriculum_topics(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. learner_twin_memory.misconception_id -> misconception_patterns(id) ON DELETE SET NULL
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learner_twin_memory_misconception_id_fkey'
      AND conrelid = 'public.learner_twin_memory'::regclass
  ) THEN
    ALTER TABLE public.learner_twin_memory
      ADD CONSTRAINT learner_twin_memory_misconception_id_fkey
      FOREIGN KEY (misconception_id) REFERENCES public.misconception_patterns(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

COMMIT;

-- ─── Verify (manual pre-flight, run BEFORE `VALIDATE CONSTRAINT` in prod) ────
-- Run each of these on prod before validating the matching constraint. Zero
-- rows returned = safe to validate; any rows = backfill/null out first.
--
-- 1. SELECT count(*) FROM public.quiz_responses qr
--      WHERE qr.question_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.question_bank qb WHERE qb.id = qr.question_id);
--
-- 2. SELECT count(*) FROM public.monthly_synthesis_runs msr
--      WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id = msr.student_id);
--
-- 3. SELECT count(*) FROM public.dive_artifacts da
--      WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id = da.student_id);
--
-- 4. SELECT count(*) FROM public.dive_artifacts da
--      WHERE da.phenomenon_slug IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.phenomena p WHERE p.slug = da.phenomenon_slug);
--
-- 5. SELECT count(*) FROM public.learner_twin_memory ltm
--      WHERE ltm.concept_topic_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.curriculum_topics ct WHERE ct.id = ltm.concept_topic_id);
--
-- 6. SELECT count(*) FROM public.learner_twin_memory ltm
--      WHERE ltm.misconception_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.misconception_patterns mp WHERE mp.id = ltm.misconception_id);
--
-- Then validate each (does a lock-light scan, no long AccessExclusiveLock):
--   ALTER TABLE public.quiz_responses            VALIDATE CONSTRAINT quiz_responses_question_id_fkey;
--   ALTER TABLE public.monthly_synthesis_runs     VALIDATE CONSTRAINT monthly_synthesis_runs_student_id_fkey;
--   ALTER TABLE public.dive_artifacts             VALIDATE CONSTRAINT dive_artifacts_student_id_fkey;
--   ALTER TABLE public.dive_artifacts             VALIDATE CONSTRAINT dive_artifacts_phenomenon_slug_fkey;
--   ALTER TABLE public.learner_twin_memory        VALIDATE CONSTRAINT learner_twin_memory_concept_topic_id_fkey;
--   ALTER TABLE public.learner_twin_memory        VALIDATE CONSTRAINT learner_twin_memory_misconception_id_fkey;
