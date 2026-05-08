-- ─── B'-1 Phase 1: foxy_quality_scores — LLM-as-judge eval foundation ─────
--
-- Pre-fix: there is no automated measurement of whether Foxy answers are
-- (a) factually accurate vs the cited NCERT chunks, (b) age-appropriate
-- for grades 6-12, (c) within CBSE scope, or (d) following the scaffolding
-- directive that was injected into the prompt for the student's mastery
-- tier. Quality drift is invisible until students complain.
--
-- This migration ships the data target. A nightly cron (Phase 2, separate
-- PR) will sample N assistant turns/day, call `scoreFoxyAnswer()` (lib at
-- src/lib/foxy/quality-eval.ts), and INSERT a row here per scored turn.
--
-- Deliberate non-goals for Phase 1:
--   - No cron yet — caller can be a manual super-admin trigger.
--   - No super-admin dashboard yet — that's Phase 3 once we have data.
--   - No automatic flag-flip on quality drop yet — humans review first.
--
-- Rubric columns are 0..100 numerics (not booleans) so the judge can
-- express partial credit. Overall score is a weighted blend documented in
-- the lib file. `rubric_version` lets us evolve the rubric without
-- contaminating the historical signal.

BEGIN;

CREATE TABLE IF NOT EXISTS public.foxy_quality_scores (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subject of the eval. Cascades on message delete because the score is
  -- meaningless without the message it was computed against.
  message_id               uuid NOT NULL REFERENCES public.foxy_chat_messages(id) ON DELETE CASCADE,
  session_id               uuid NOT NULL REFERENCES public.foxy_sessions(id) ON DELETE CASCADE,
  student_id               uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  -- ── Rubric scores (0..100) ──
  -- Factual accuracy: does the answer agree with the cited NCERT chunks?
  accuracy_score           int NOT NULL CHECK (accuracy_score BETWEEN 0 AND 100),
  -- Scaffolding fidelity: did the model follow the COACH_MODE_INSTRUCTIONS
  -- directive (socratic vs answer vs review) for the resolved coach mode?
  scaffold_fidelity_score  int NOT NULL CHECK (scaffold_fidelity_score BETWEEN 0 AND 100),
  -- Age-appropriateness for grades 6-12 (P12 invariant).
  age_appropriateness_score int NOT NULL CHECK (age_appropriateness_score BETWEEN 0 AND 100),
  -- CBSE-scope: stays inside the curriculum boundary.
  cbse_scope_score         int NOT NULL CHECK (cbse_scope_score BETWEEN 0 AND 100),

  -- Composite computed by the lib (default weights: 0.40 accuracy +
  -- 0.30 scaffold + 0.20 age + 0.10 scope). Stored alongside so analytics
  -- doesn't have to re-blend.
  overall_score            int NOT NULL CHECK (overall_score BETWEEN 0 AND 100),

  -- ── Provenance ──
  judge_model              text NOT NULL,                  -- e.g. 'claude-sonnet-4-20250514'
  rubric_version           text NOT NULL DEFAULT 'v1',     -- bump when the rubric prompt changes
  -- Raw judge response retained for human spot-check. NULL when caller
  -- requested a redacted score (e.g. compliance run that strips PII).
  raw_judge_response       jsonb,

  -- Optional human-readable notes from the judge for the lowest-score
  -- dimension. Helps super-admin triage which answers to actually inspect.
  notes                    text,

  scored_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.foxy_quality_scores IS
  'B''-1 Phase 1: LLM-as-judge quality scores for sampled Foxy assistant '
  'turns. Populated by a future nightly cron via scoreFoxyAnswer() in '
  'src/lib/foxy/quality-eval.ts. Rubric: 4 dimensions (accuracy, scaffold '
  'fidelity, age-appropriateness, CBSE scope) + composite. rubric_version '
  'lets the rubric evolve without contaminating historical signal.';

-- Read-path indexes:
-- 1. Recent scores per student (super-admin "this student has been seeing
--    low-quality answers" investigation).
CREATE INDEX IF NOT EXISTS idx_foxy_quality_scores_student_recent
  ON public.foxy_quality_scores (student_id, scored_at DESC);
-- 2. Daily aggregates by rubric_version (super-admin trend dashboard).
CREATE INDEX IF NOT EXISTS idx_foxy_quality_scores_scored_at
  ON public.foxy_quality_scores (scored_at DESC, rubric_version);
-- 3. Single-row lookup by message_id (UPSERT pattern when re-scoring).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_foxy_quality_scores_message_rubric
  ON public.foxy_quality_scores (message_id, rubric_version);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.foxy_quality_scores ENABLE ROW LEVEL SECURITY;

-- Read: super-admin only. Quality scores are internal ops data; surfacing
-- them to students would be confusing and potentially harmful (a student
-- shouldn't see a "low quality" tag on the answer they just got).
DROP POLICY IF EXISTS foxy_quality_scores_read_admin ON public.foxy_quality_scores;
CREATE POLICY foxy_quality_scores_read_admin ON public.foxy_quality_scores
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR auth.uid() IN (SELECT auth_user_id FROM public.admin_users WHERE is_active = true)
  );

-- Write: service-role only (the eval cron / lib runs server-side).
DROP POLICY IF EXISTS foxy_quality_scores_write_service ON public.foxy_quality_scores;
CREATE POLICY foxy_quality_scores_write_service ON public.foxy_quality_scores
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;
