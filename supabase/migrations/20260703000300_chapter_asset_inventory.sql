-- Migration: 20260703000300_chapter_asset_inventory.sql
-- Purpose: Substrate for the Knowledge Intelligence coverage loop — one row per
--          (cbse_syllabus chapter × educational-completeness dimension), recording
--          how much of that dimension we have found/verified for the chapter.
--
-- Wave 1 Task 1.1 (Knowledge Intelligence). The chapter axis is the existing
-- `public.cbse_syllabus` Layer-2 SSoT (PK: id uuid — verified against the
-- baseline, `cbse_syllabus_pkey PRIMARY KEY ("id")`); the dimension axis is the
-- 31-dimension educational-completeness model below. Rows are written only by
-- audit workers running with the service role (chunk passes, question-bank
-- scans, PDF verification, manual curation) — there is NO end-user surface.
--
-- P13 note: `evidence` and `suspected_missing` carry chunk IDs / question IDs /
-- structural pointers ONLY — never chapter content, question text, or any PII.
--
-- Idempotent: IF NOT EXISTS / DO-block policy create. Strictly additive —
-- no DROP / DELETE / UPDATE / TRUNCATE anywhere in this file.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Table
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chapter_asset_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_id uuid NOT NULL REFERENCES public.cbse_syllabus(id) ON DELETE CASCADE,
  dimension text NOT NULL CONSTRAINT chapter_asset_inventory_dimension_check CHECK (dimension IN (
    'pages','headings','topics','subtopics','concepts','learning_objectives','definitions','formulae',
    'examples','solved_examples','exercises','activities','hots_questions','case_based_questions',
    'assertion_reason_questions','competency_questions','common_mistakes','prerequisites',
    'concept_graph_links','real_world_applications','tables','diagrams','image_explanations',
    'captions','summary','keywords','revision_notes','mind_maps','flashcards','pyqs',
    'difficulty_mapping')),
  expected_count integer,
  found_count integer NOT NULL DEFAULT 0,
  coverage_pct numeric(5,2) CONSTRAINT chapter_asset_inventory_coverage_pct_check
    CHECK (coverage_pct IS NULL OR (coverage_pct >= 0 AND coverage_pct <= 100)),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_method text NOT NULL CONSTRAINT chapter_asset_inventory_audit_method_check
    CHECK (audit_method IN ('chunk_pass','pdf_verified','manual','question_bank_scan','generated_content_scan')),
  suspected_missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  audited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chapter_asset_inventory_syllabus_dimension_key UNIQUE (syllabus_id, dimension)
);

COMMENT ON TABLE public.chapter_asset_inventory IS
  'Knowledge Intelligence coverage loop substrate (Wave 1). One row per (cbse_syllabus chapter x dimension) across the 31-dimension educational-completeness model: what the platform HAS for a chapter (found_count vs expected_count, coverage_pct) per dimension, how it was audited (audit_method), and evidence/suspected_missing as ID-only jsonb. Written exclusively by service-role audit workers; deny-all RLS for anon/authenticated (P8). No content or PII is ever stored here (P13).';

COMMENT ON COLUMN public.chapter_asset_inventory.dimension IS
  '31-dimension educational-completeness model: structural (pages, headings, topics, subtopics), conceptual (concepts, learning_objectives, definitions, formulae, prerequisites, concept_graph_links, common_mistakes, difficulty_mapping), worked material (examples, solved_examples, exercises, activities, real_world_applications), assessment (hots_questions, case_based_questions, assertion_reason_questions, competency_questions, pyqs), visual (tables, diagrams, image_explanations, captions), and revision (summary, keywords, revision_notes, mind_maps, flashcards). Each row measures coverage of ONE dimension for ONE cbse_syllabus chapter.';

COMMENT ON COLUMN public.chapter_asset_inventory.evidence IS
  'jsonb array of chunk IDs / question IDs / structural pointers backing found_count. IDs ONLY — never chunk text, question text, or any student/teacher PII (P13).';

COMMENT ON COLUMN public.chapter_asset_inventory.suspected_missing IS
  'jsonb array of ID-only / label-only pointers to assets the audit believes exist in the source but were not found on-platform. Same P13 rule as evidence: no content payloads.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. Indexes
-- ──────────────────────────────────────────────────────────────────────
-- (syllabus_id) lookups are covered by the UNIQUE (syllabus_id, dimension)
-- constraint's backing index — no separate FK index needed.
-- Gap queries scan "worst-covered chapters for dimension X":
--   WHERE dimension = $1 ORDER BY coverage_pct ASC NULLS FIRST

CREATE INDEX IF NOT EXISTS idx_chapter_asset_inventory_dimension_coverage
  ON public.chapter_asset_inventory (dimension, coverage_pct);

-- ──────────────────────────────────────────────────────────────────────
-- 3. RLS — service-role-only (P8: enabled in the SAME migration)
-- ──────────────────────────────────────────────────────────────────────
-- This is audit/telemetry data about content coverage, not learner data —
-- no student/parent/teacher read pattern applies. service_role bypasses RLS
-- entirely, so the audit workers keep writing; anon/authenticated get an
-- explicit deny-all policy (house posture: synthetic_monitor_results,
-- alfabot_* tables). If a super-admin coverage dashboard later needs a
-- browser-side read, add a narrow SELECT policy then — not a blanket grant.

ALTER TABLE public.chapter_asset_inventory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "chapter_asset_inventory_deny_all"
    ON public.chapter_asset_inventory
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN
  NULL; -- policy already exists; migration is re-runnable
END $$;
