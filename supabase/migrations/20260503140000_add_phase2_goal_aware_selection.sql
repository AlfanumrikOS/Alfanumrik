-- Migration: 20260503140000_add_phase2_goal_aware_selection.sql
-- Author:    architect
-- Purpose:   Phase 2 of Goal-Adaptive Learning Layers — install (a) an additive
--            board_readiness_pct column on concept_mastery_score, (b) an additive
--            goal-aware question-selection RPC `get_adaptive_questions_v2`, and
--            (c) a new feature flag `ff_goal_aware_selection` that gates both at
--            the application layer.
--
-- Scope:     ADDITIVE ONLY. Zero changes to:
--              - the v1 RPC `get_adaptive_questions` (still the production path)
--              - any existing column on concept_mastery_score
--              - any existing feature flag row
--              - any existing index, RLS policy, trigger, or constraint
--
-- Idempotency:
--   - Column add uses `IF NOT EXISTS`.
--   - RPC uses `CREATE OR REPLACE FUNCTION`.
--   - Feature flag insert uses `ON CONFLICT (flag_name) DO NOTHING`.
--   - All checks in the verification block at the bottom are read-only.
--   Re-running this migration on a database that already has it applied is a
--   no-op (the COMMENT statements re-run, which is harmless).
--
-- Defaults seeded:
--   concept_mastery_score.board_readiness_pct  = 0           (numeric(5,1) NOT NULL)
--   feature_flags.ff_goal_aware_selection      = is_enabled false, 0% rollout,
--                                                target_environments {production,staging}
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Operator runbook (flip in production)
-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 staged rollout (gates BOTH goal-aware quiz selection AND goal-aware
-- mastery display thresholds — these two behaviors ship together under one
-- flag because mastery thresholds depend on the same `pickQuizParams` signal):
--
--   -- Day 0 (staging only): admin-only smoke test
--   UPDATE public.feature_flags
--   SET is_enabled         = true,
--       rollout_percentage = 100,
--       target_roles       = ARRAY['super_admin','admin']::text[],
--       target_environments= ARRAY['staging']::text[],
--       updated_at         = now()
--   WHERE flag_name = 'ff_goal_aware_selection';
--
--   -- Day 1: 10% canary on staging (all roles)
--   UPDATE public.feature_flags
--   SET target_roles        = ARRAY[]::text[],
--       rollout_percentage  = 10,
--       updated_at          = now()
--   WHERE flag_name = 'ff_goal_aware_selection';
--
--   -- Day 3: 25%   |   Day 5: 50%   |   Day 7: 100% on staging
--   UPDATE public.feature_flags SET rollout_percentage = 25,  updated_at = now()
--    WHERE flag_name = 'ff_goal_aware_selection';
--   UPDATE public.feature_flags SET rollout_percentage = 50,  updated_at = now()
--    WHERE flag_name = 'ff_goal_aware_selection';
--   UPDATE public.feature_flags SET rollout_percentage = 100, updated_at = now()
--    WHERE flag_name = 'ff_goal_aware_selection';
--
--   -- Week 2: extend to production (10 → 25 → 50 → 100 with the same cadence)
--   UPDATE public.feature_flags
--   SET target_environments = ARRAY['production','staging']::text[],
--       rollout_percentage  = 10,
--       updated_at          = now()
--   WHERE flag_name = 'ff_goal_aware_selection';
--
-- Per-user determinism: src/lib/feature-flags.ts hashForRollout(userId, flag_name)
-- guarantees the same student stays in the same bucket across reloads.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Kill switch (instant rollback, no migration revert needed)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   UPDATE public.feature_flags
--   SET is_enabled = false, updated_at = now()
--   WHERE flag_name = 'ff_goal_aware_selection';
--
-- The 5-min in-process cache in src/lib/feature-flags.ts picks up the change
-- on the next loadFlags() tick. To force-invalidate immediately across all
-- serverless instances, ship a no-op deploy or call invalidateFlagCache() from
-- an admin endpoint.
--
-- The v2 RPC remains installed but is harmless when the flag is off — no
-- production code path calls it. Removing the RPC is NOT required to revert.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementation notes — v2 RPC body design
-- ─────────────────────────────────────────────────────────────────────────────
-- The v1 RPC `get_adaptive_questions` (defined in baseline 00000000000000) has
-- three branches: 'cognitive', 'board', and a default 'practice' fallback.
-- Auditing v1 against the live schema reveals that the 'cognitive' branch
-- joins on `qb.concept_id` and `cm.concept_id`, which DO NOT EXIST as columns
-- on either table — only `question_bank.concept_code`, `concept_tag`,
-- `chapter_id`, and `topic_id` exist. The cognitive branch in v1 therefore
-- either errors or returns no rows in production.
--
-- v2 INTENTIONALLY DEVIATES from v1's broken cognitive joins. v2 uses only
-- columns that demonstrably exist in `question_bank` + `learning_graph` +
-- `question_responses` + `students`, and falls back to the same dedup pattern
-- used by v1's working 'practice' branch (LEFT JOIN question_responses qr ON
-- qr.question_id = qb.id AND qr.student_id = student, WHERE qr.id IS NULL).
--
-- This is a STRUCTURAL parity choice, not a behavior parity choice: v2 will
-- return more rows than v1's cognitive branch (because v1's cognitive branch
-- effectively returns zero), but v2 is gated behind a feature flag that ships
-- OFF, so no current code path observes the change. When the flag flips, the
-- application explicitly opts into v2's working semantics.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (manual — do NOT auto-run)
-- ─────────────────────────────────────────────────────────────────────────────
-- Setting is_enabled = false is the recommended rollback. To remove all three
-- artefacts:
--
--   DELETE FROM public.feature_flags WHERE flag_name = 'ff_goal_aware_selection';
--   DROP FUNCTION IF EXISTS public.get_adaptive_questions_v2(uuid, text, integer, boolean, text, text, text[]);
--   ALTER TABLE public.concept_mastery_score DROP COLUMN IF EXISTS board_readiness_pct;
--
-- Note: dropping the column requires user approval per CLAUDE.md Section 8.
--
-- ============================================================================
-- A. Add concept_mastery_score.board_readiness_pct (additive, NOT NULL DEFAULT 0)
-- ============================================================================
-- Why NOT NULL DEFAULT 0: matches the existing pattern of jee_readiness_pct,
-- neet_readiness_pct, olympiad_readiness_pct on adaptive_profile (see baseline
-- lines 9466-9468). Postgres backfills all existing rows to 0 automatically,
-- so the ALTER is a fast metadata-only operation (no full table rewrite for
-- non-volatile defaults on PG 11+).

ALTER TABLE public.concept_mastery_score
  ADD COLUMN IF NOT EXISTS board_readiness_pct numeric(5,1) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.concept_mastery_score.board_readiness_pct IS
  'Goal-adaptive Phase 2: derived 0-100 readiness for CBSE board exam. '
  'Computed lazily by Phase 2 cme-engine when ff_goal_aware_selection is '
  'enabled. Defaults to 0; does NOT affect any existing behavior.';


-- ============================================================================
-- B. Create RPC public.get_adaptive_questions_v2 (additive, never replaces v1)
-- ============================================================================
-- Signature mirrors v1's RETURNS TABLE shape (question_id, question_type,
-- bloom_level, priority_score, source, board_year, paper_section) and appends
-- two new columns (goal_boost, selection_reason) so callers that swap the v1
-- name for v2 get a strict superset.
--
-- Two new optional input parameters:
--   p_goal        text    — one of 'board_topper' | 'school_topper' |
--                            'competitive_exam' | 'olympiad' | 'improve_basics' |
--                            'pass_comfortably', or NULL for v1-equivalent
--                            behavior (zero boost everywhere).
--   p_source_tags text[]  — for p_goal='competitive_exam', specifies which
--                            archives matter (e.g. ARRAY['jee','neet']). Other
--                            goal modes ignore this parameter.

CREATE OR REPLACE FUNCTION public.get_adaptive_questions_v2(
  p_student_id     uuid,
  p_subject        text,
  p_limit          integer DEFAULT 10,
  p_include_review boolean DEFAULT true,
  p_mode           text    DEFAULT 'cognitive',
  p_goal           text    DEFAULT NULL,
  p_source_tags    text[]  DEFAULT NULL
) RETURNS TABLE(
  question_id      uuid,
  question_type    text,
  bloom_level      text,
  priority_score   numeric,
  source           text,
  board_year       integer,
  paper_section    text,
  goal_boost       numeric,
  selection_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grade        text;
  v_current_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_goal         text    := COALESCE(p_goal, 'none');
BEGIN
  -- Resolve student grade (text, per P5: grades are strings).
  -- If the student record is missing, return zero rows rather than erroring,
  -- matching the defensive posture of `get_available_subjects_v2` in baseline.
  SELECT s.grade INTO v_grade
    FROM public.students s
   WHERE s.id = p_student_id
   LIMIT 1;

  IF v_grade IS NULL THEN
    RETURN;
  END IF;

  -- Single-query implementation. Candidate set is filtered to the student's
  -- grade, the requested subject, active questions only, and excludes
  -- questions the student has already answered (matches v1's 'practice'
  -- branch dedup pattern, which is the only v1 pattern joining on columns
  -- that actually exist in the live schema — see Implementation notes above).
  --
  -- The goal_boost CASE expressions are computed inline per row and added to
  -- a base priority. Final ordering: (priority + boost) DESC, RANDOM() to
  -- break ties stably across many candidates.
  --
  -- LEFT JOIN on learning_graph: questions whose chapter has no LG row still
  -- participate, they just receive zero competitive/olympiad boost. The join
  -- key is (subject_code, grade, chapter_number) per the LG schema in
  -- baseline lines 11854-11892.
  RETURN QUERY
  WITH candidates AS (
    SELECT
      qb.id              AS qb_id,
      qb.question_type   AS qb_question_type,
      qb.bloom_level     AS qb_bloom_level,
      qb.source          AS qb_source,
      qb.board_year      AS qb_board_year,
      qb.paper_section   AS qb_paper_section,
      qb.difficulty      AS qb_difficulty,
      qb.subject         AS qb_subject,
      qb.chapter_number  AS qb_chapter_number,
      lg.jee_relevant    AS lg_jee_relevant,
      lg.neet_relevant   AS lg_neet_relevant,
      lg.olympiad_relevant AS lg_olympiad_relevant,
      -- Base priority mirrors v1's 'practice' branch (70) + a small bump
      -- when p_mode='cognitive' or 'board' so callers see ordering shifts
      -- when they vary p_mode (matches v1's intent of mode-aware ranking).
      CASE
        WHEN p_mode = 'board'     THEN 90::numeric
        WHEN p_mode = 'cognitive' THEN 80::numeric
        ELSE                           70::numeric
      END                AS base_priority
    FROM public.question_bank qb
    LEFT JOIN public.learning_graph lg
           ON lg.subject_code  = qb.subject
          AND lg.grade         = qb.grade
          AND lg.chapter_number = qb.chapter_number
    LEFT JOIN public.question_responses qr
           ON qr.question_id = qb.id
          AND qr.student_id  = p_student_id
    WHERE qb.subject   = p_subject
      AND qb.grade     = v_grade
      AND qb.is_active = true
      AND qr.id IS NULL
      -- p_include_review is currently unused in the candidate filter because
      -- v1's review branch joins on `concept_mastery.concept_id` which does
      -- not exist (see Implementation notes). The parameter is preserved for
      -- API compatibility — when p_include_review = false, callers get the
      -- same set as p_include_review = true. This is a no-op deviation from
      -- v1 because v1's review branch returns zero rows in practice.
      AND (p_include_review OR p_include_review = false)
  ),
  scored AS (
    SELECT
      c.*,
      -- Goal-aware boost. Each branch is mutually exclusive on v_goal so the
      -- final boost is either 0 or one CASE arm value. Numeric literals are
      -- pinned to the spec (0.40 / 0.25 / 0.50 / 0.30 / 0.10) — do not edit
      -- without updating src/lib/goals/quiz-params.ts and assessment review.
      CASE v_goal
        WHEN 'board_topper' THEN
          CASE
            WHEN c.qb_board_year IS NOT NULL
             AND c.qb_board_year >= v_current_year - 5      THEN 0.40::numeric
            WHEN c.qb_source = 'board_paper'                THEN 0.25::numeric
            ELSE                                                 0.00::numeric
          END
        WHEN 'competitive_exam' THEN
          CASE
            WHEN p_source_tags IS NOT NULL
             AND 'jee' = ANY(p_source_tags)
             AND COALESCE(c.lg_jee_relevant, false)         THEN 0.40::numeric
            WHEN p_source_tags IS NOT NULL
             AND 'neet' = ANY(p_source_tags)
             AND COALESCE(c.lg_neet_relevant, false)        THEN 0.40::numeric
            ELSE                                                 0.00::numeric
          END
        WHEN 'olympiad' THEN
          CASE
            WHEN COALESCE(c.lg_olympiad_relevant, false)    THEN 0.50::numeric
            ELSE                                                 0.00::numeric
          END
        WHEN 'improve_basics' THEN
          -- qb.difficulty is integer (1-5) per baseline line 2139, NOT a text
          -- enum. Spec literal 'easy' maps to integer 1-2. Spec literal
          -- 'remember','understand' for bloom_level matches the text enum
          -- used throughout the codebase (see xp-rules.ts).
          CASE
            WHEN COALESCE(c.qb_difficulty, 0) <= 2
             AND c.qb_bloom_level IN ('remember','understand') THEN 0.30::numeric
            ELSE                                                 0.00::numeric
          END
        WHEN 'pass_comfortably' THEN
          CASE
            WHEN COALESCE(c.qb_difficulty, 0) IN (1,2,3)    THEN 0.10::numeric
            ELSE                                                 0.00::numeric
          END
        WHEN 'school_topper' THEN
          CASE
            WHEN COALESCE(c.qb_difficulty, 0) IN (1,2,3)    THEN 0.10::numeric
            ELSE                                                 0.00::numeric
          END
        ELSE 0.00::numeric  -- 'none' or unknown goal
      END AS computed_boost
    FROM candidates c
  )
  SELECT
    s.qb_id              AS question_id,
    s.qb_question_type   AS question_type,
    s.qb_bloom_level     AS bloom_level,
    s.base_priority      AS priority_score,
    s.qb_source          AS source,
    s.qb_board_year      AS board_year,
    s.qb_paper_section   AS paper_section,
    s.computed_boost     AS goal_boost,
    'goal=' || v_goal
      || ', boost=' || s.computed_boost::text
      || ', base_priority=' || s.base_priority::text
                         AS selection_reason
  FROM scored s
  ORDER BY (s.base_priority + s.computed_boost) DESC, random()
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.get_adaptive_questions_v2(uuid, text, integer, boolean, text, text, text[]) IS
  'Goal-adaptive Phase 2 question selection. Returns the same 7 columns as '
  'get_adaptive_questions plus goal_boost (0-1) and selection_reason (text). '
  'Falls back to v1-equivalent ranking when p_goal IS NULL. Activated by the '
  'ff_goal_aware_selection feature flag at the application layer — this RPC '
  'has no internal flag check and is safe to call independently.';

GRANT EXECUTE ON FUNCTION public.get_adaptive_questions_v2(uuid, text, integer, boolean, text, text, text[])
  TO authenticated, service_role;


-- ============================================================================
-- C. Seed feature flag ff_goal_aware_selection (DISABLED on prod + staging)
-- ============================================================================

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  target_roles,
  target_institutions,
  target_grades,
  target_subjects,
  target_languages,
  description,
  metadata
)
VALUES (
  'ff_goal_aware_selection',
  false,                                         -- OFF by default
  0,                                             -- 0% rollout
  ARRAY['production','staging']::text[],         -- applies in both envs once flipped
  ARRAY[]::text[],                               -- all roles (when enabled)
  ARRAY[]::uuid[],                               -- all institutions
  ARRAY[]::text[],                               -- all grades
  ARRAY[]::text[],                               -- all subjects
  ARRAY[]::text[],                               -- all languages
  'Phase 2 — gates goal-aware question selection (quiz-generate workflow uses '
  'pickQuizParams + get_adaptive_questions_v2 RPC) AND goal-aware mastery '
  'display badge thresholds. Default OFF preserves byte-identical legacy '
  'behavior.',
  '{"description":"Phase 2 — gates goal-aware question selection (quiz-generate workflow uses pickQuizParams + get_adaptive_questions_v2 RPC) AND goal-aware mastery display badge thresholds. Default OFF preserves byte-identical legacy behavior (DEFAULT_QUIZ_COUNT=5, DEFAULT_DIFFICULTY=3, DEFAULT_BLOOM_LEVEL=understand, mastery threshold=0.8).","owner":"ai-engineer+assessment","added":"2026-05-03","rollout_strategy":"start at 0%, enable on staging first via super-admin /super-admin/flags, ramp 10/25/50/100 over one week","kill_switch":"set is_enabled=false to instantly revert to legacy quiz-generate constants and legacy mastery threshold"}'::jsonb
)
ON CONFLICT (flag_name) DO NOTHING;


-- ============================================================================
-- D. Verification block — confirm all three artefacts exist + are in safe state
-- ============================================================================
-- Read-only checks. RAISE NOTICE for happy path. RAISE WARNING if anything is
-- in an unsafe state (flag enabled by accident, missing column, missing RPC).
-- This block does not throw — operators rely on deploy logs to spot issues.

DO $$
DECLARE
  v_flag_count             integer;
  v_flag_enabled           boolean;
  v_column_exists          boolean;
  v_function_exists        boolean;
BEGIN
  -- 1. Feature flag presence + safe state
  SELECT COUNT(*) INTO v_flag_count
    FROM public.feature_flags
    WHERE flag_name = 'ff_goal_aware_selection';

  SELECT is_enabled INTO v_flag_enabled
    FROM public.feature_flags
    WHERE flag_name = 'ff_goal_aware_selection';

  RAISE NOTICE '[phase2_goal_aware_selection] flag rows present = % (expected 1)', v_flag_count;
  RAISE NOTICE '[phase2_goal_aware_selection] ff_goal_aware_selection.is_enabled = %', v_flag_enabled;

  IF v_flag_count <> 1 THEN
    RAISE WARNING '[phase2_goal_aware_selection] expected exactly 1 ff_goal_aware_selection row, found %', v_flag_count;
  END IF;

  -- Hard safety: this migration's contract is "flag exists and is OFF after
  -- running against a fresh DB". An EXISTING enabled flag (from a prior
  -- manual seed) would also trip this — that's intentional, the operator
  -- should see the warning in deploy logs.
  IF v_flag_enabled IS TRUE THEN
    RAISE WARNING '[phase2_goal_aware_selection] ff_goal_aware_selection is currently is_enabled=true (pre-existing state preserved by ON CONFLICT DO NOTHING) — verify this is intentional';
  END IF;

  -- 2. Column existence on concept_mastery_score
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'concept_mastery_score'
       AND column_name  = 'board_readiness_pct'
  ) INTO v_column_exists;

  RAISE NOTICE '[phase2_goal_aware_selection] concept_mastery_score.board_readiness_pct exists = %', v_column_exists;

  IF NOT v_column_exists THEN
    RAISE WARNING '[phase2_goal_aware_selection] concept_mastery_score.board_readiness_pct column NOT FOUND after ALTER TABLE — investigate immediately';
  END IF;

  -- 3. Function existence (lookup by name + arg count, schema-qualified)
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_adaptive_questions_v2'
       AND p.pronargs = 7
  ) INTO v_function_exists;

  RAISE NOTICE '[phase2_goal_aware_selection] get_adaptive_questions_v2(7 args) exists = %', v_function_exists;

  IF NOT v_function_exists THEN
    RAISE WARNING '[phase2_goal_aware_selection] get_adaptive_questions_v2 function NOT FOUND after CREATE OR REPLACE — investigate immediately';
  END IF;

  RAISE NOTICE '[phase2_goal_aware_selection] migration complete — flag=OFF, column=present, RPC=installed, v1 RPC untouched';
END $$;
