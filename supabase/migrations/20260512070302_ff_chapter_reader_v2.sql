-- Migration: 20260512070302_ff_chapter_reader_v2.sql
-- Purpose:    Seed feature flag for Chapter Reader v2 — swap chapter learn-page
--             data source from RAG chunks (raw textbook excerpts) to the
--             curated `chapter_concepts` table.
--
-- Phantom-timestamp reconcile (2026-05-12, post PR #749):
--   This file was originally committed as
--   supabase/migrations/20260512065502_ff_chapter_reader_v2.sql in PR #749.
--   The Supabase MCP applied it to prod with its own generated timestamp
--   (20260512070302), so the next `supabase db push --linked` saw a remote
--   version with no matching local file and refused to push — same pattern
--   as PR #748. Renamed here to the prod-resident timestamp so the CLI
--   sees "already applied" on its next run. DO NOT delete this file.
--
-- When ON: src/app/learn/[subject]/[chapter]/page.tsx prefers
--          getChapterTopicsFromConcepts() over getChapterTopics() if the
--          chapter has >= MIN_CONCEPTS rich-content rows.
-- When OFF or no usable rows: legacy RAG-chunk grouping renders (unchanged).
--
-- Idempotent: INSERT … ON CONFLICT (flag_name) DO NOTHING. Safe to run on any
-- environment regardless of whether the row already exists.
--
-- Spec: docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md

INSERT INTO public.feature_flags
  (flag_name, is_enabled, target_roles, target_environments,
   target_institutions, rollout_percentage, metadata)
VALUES
  ('ff_chapter_reader_v2',
   false,                              -- ships OFF
   ARRAY['student'],                   -- when flipped, only affects student-role users
   NULL, NULL,
   0,
   jsonb_build_object(
     'description', 'Chapter learn-page reads chapter_concepts (curated) instead of RAG chunks (raw). Per-chapter quality gate falls back when concept rows are sparse or too short.',
     'spec',        'docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md',
     'target_user_ids', jsonb_build_array()  -- staff dogfooding override; see isUserTargeted helper
   ))
ON CONFLICT (flag_name) DO NOTHING;
