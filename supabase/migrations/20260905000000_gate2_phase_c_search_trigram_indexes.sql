-- Gate-2 Phase C (global search) — trigram indexes for fuzzy name search on
-- students/teachers/schools. pg_trgm is already enabled (baseline migration).
-- These three columns had no trigram index before this migration (verified
-- against the baseline + every migration under supabase/migrations/ — the
-- only existing trigram indexes in the schema are on rag_content_chunks
-- concept/topic/question_text columns, unrelated to people/org search).
--
-- Powers /api/search's name search (question_bank/curriculum_topics already
-- have GIN full-text indexes on search_vector from the baseline; students/
-- teachers/schools have no search_vector column, so a trigram similarity
-- index is the equivalent for short human/org names — matches the plan's
-- own choice of trigram over full-text here).
--
-- CONCURRENTLY deliberately NOT used: the Supabase CLI wraps each migration
-- file in a transaction, and CREATE INDEX CONCURRENTLY cannot run inside one
-- (hard Postgres constraint, not a style choice). Established repo precedent:
-- supabase/migrations/20260729130300_audit_logs_created_at_desc_index.sql's
-- own header documents this at length and lists three prior migrations that
-- hit the same constraint. Following the same plain CREATE INDEX + lock_timeout
-- pattern here.
--
-- Lock risk: LOW. Verified live row counts before writing this (2026-09-05):
-- schools=9 rows/16kB, students=68 rows/80kB, teachers=8 rows/16kB — all
-- trivially small, an index build is near-instantaneous. The lock_timeout
-- below is still applied on principle (per the audit_logs precedent: a small
-- table does not eliminate lock-QUEUEING risk if another session happens to
-- hold a conflicting lock at apply time, even briefly) — cheap insurance, not
-- because these three tables are individually risky.
--
-- Idempotent: IF NOT EXISTS, additive only — no table/column change, no
-- existing index touched.
-- Rollback: DROP INDEX IF EXISTS public.idx_students_name_trgm;
--           DROP INDEX IF EXISTS public.idx_teachers_name_trgm;
--           DROP INDEX IF EXISTS public.idx_schools_name_trgm;
--           (safe — nothing depends on these for correctness, only for
--           /api/search's fuzzy-name-match performance.)

SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_students_name_trgm
  ON public.students USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_teachers_name_trgm
  ON public.teachers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_schools_name_trgm
  ON public.schools USING gin (name gin_trgm_ops);
