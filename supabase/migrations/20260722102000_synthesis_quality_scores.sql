-- Migration: 20260722102000_synthesis_quality_scores.sql
-- Purpose: Phase 8 item 8.6 — Monthly-Synthesis AI-quality sampling data target.
--
-- Clones the SHAPE + RLS posture of foxy_quality_scores
-- (20260508240000_foxy_quality_scores.sql). Where that table scores sampled
-- Foxy assistant turns with an LLM-as-judge, this one scores sampled
-- monthly_synthesis_runs — the ~300-word Claude-authored parent-facing
-- summary — before/while it goes out on the Phase 5 rollout of Monthly
-- Synthesis (ff_pedagogy_v2_monthly_synthesis, still OFF).
--
-- A nightly cron (apps/host/src/app/api/cron/synthesis-quality-sample) samples
-- N synthesis runs, runs the deterministic fabrication oracle
-- (packages/lib/src/ai/validation/synthesis-oracle.ts) + a Sonnet judge
-- (packages/lib/src/ai/validation/synthesis-quality-eval.ts), and INSERTs one
-- row here per scored run. The super-admin dashboard
-- (/super-admin/synthesis-quality) reads 7-day rolling averages, weekly drift,
-- and the lowest-10 for human triage.
--
-- Rubric columns are 0..100 numerics so the judge can express partial credit.
-- rubric_version lets the rubric evolve without contaminating historical
-- signal. Deliberately internal-audit data: service-role writes, admin reads
-- ONLY — a student/parent must never see a "low quality" tag on their summary.
--
-- P13: this table stores SCORES + judge notes ONLY. It never stores the
-- summary body, the parent's phone, or the student's name. The judge/oracle
-- read those server-side but persist neither.
--
-- Idempotent. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.synthesis_quality_scores (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subject of the eval. Cascades on run delete because the score is
  -- meaningless without the run it was computed against.
  synthesis_run_id        uuid NOT NULL REFERENCES public.monthly_synthesis_runs(id) ON DELETE CASCADE,
  student_id              uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  -- ── Rubric scores (0..100) ──
  -- Factual grounding: does the summary agree with the SynthesisBundle it was
  -- generated from (mastery delta / chapter mock / artifact counts)?
  grounding_score         int NOT NULL CHECK (grounding_score BETWEEN 0 AND 100),
  -- Age-appropriate, warm, parent-readable tone (no jargon, no adult framing).
  tone_score              int NOT NULL CHECK (tone_score BETWEEN 0 AND 100),
  -- No fabricated numbers / topic names. Clamped to 0 by the caller when the
  -- deterministic synthesis-oracle finds any unbacked number or topic — a hard
  -- fabrication is a hard fail regardless of the judge's softer read (P11).
  no_fabrication_score    int NOT NULL CHECK (no_fabrication_score BETWEEN 0 AND 100),
  -- CBSE-scope: stays inside the curriculum boundary (grades 6-12).
  cbse_scope_score        int NOT NULL CHECK (cbse_scope_score BETWEEN 0 AND 100),

  -- Composite computed by the lib (default weights: 0.35 grounding +
  -- 0.35 no_fabrication + 0.20 tone + 0.10 scope). Stored alongside so
  -- analytics doesn't have to re-blend.
  overall_score           int NOT NULL CHECK (overall_score BETWEEN 0 AND 100),

  -- ── Provenance ──
  judge_model             text NOT NULL,                 -- e.g. 'claude-sonnet-4-20250514'
  rubric_version          text NOT NULL DEFAULT 'v1',    -- bump when the rubric prompt changes
  -- Deterministic-oracle findings for this run, COUNTS/CATEGORY ONLY (P13) —
  -- e.g. {"unbacked_number_count":2,"unbacked_topic_count":0}. Never the raw
  -- numbers/phrases verbatim.
  oracle_findings         jsonb,
  -- Raw judge response retained for human spot-check. NULL on a judge miss.
  raw_judge_response      jsonb,

  -- Optional judge free-text on the lowest-scoring dimension. Describes the
  -- score, not the summary body — safe to surface to super-admin.
  notes                   text,

  scored_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.synthesis_quality_scores IS
  'Phase 8 item 8.6: LLM-as-judge + deterministic-oracle quality scores for '
  'sampled monthly_synthesis_runs (the Claude-authored parent summary). '
  'Populated nightly by /api/cron/synthesis-quality-sample. Rubric: 4 '
  'dimensions (grounding, tone, no-fabrication, CBSE scope) + composite. '
  'Internal-audit data: admin-read / service-role-write only. Stores scores + '
  'notes ONLY — never the summary body, phone, or student name (P13).';

-- Read-path indexes (mirror foxy_quality_scores):
CREATE INDEX IF NOT EXISTS idx_synthesis_quality_scores_student_recent
  ON public.synthesis_quality_scores (student_id, scored_at DESC);
CREATE INDEX IF NOT EXISTS idx_synthesis_quality_scores_scored_at
  ON public.synthesis_quality_scores (scored_at DESC, rubric_version);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_synthesis_quality_scores_run_rubric
  ON public.synthesis_quality_scores (synthesis_run_id, rubric_version);

-- ── RLS (mirrors foxy_quality_scores exactly: admin-read, service-write) ────
ALTER TABLE public.synthesis_quality_scores ENABLE ROW LEVEL SECURITY;

-- Read: super-admin only. Quality scores are internal ops data; surfacing them
-- to students/parents would be confusing and potentially harmful.
DROP POLICY IF EXISTS synthesis_quality_scores_read_admin ON public.synthesis_quality_scores;
CREATE POLICY synthesis_quality_scores_read_admin ON public.synthesis_quality_scores
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR auth.uid() IN (SELECT auth_user_id FROM public.admin_users WHERE is_active = true)
  );

-- Write: service-role only (the eval cron / lib runs server-side).
DROP POLICY IF EXISTS synthesis_quality_scores_write_service ON public.synthesis_quality_scores;
CREATE POLICY synthesis_quality_scores_write_service ON public.synthesis_quality_scores
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;
