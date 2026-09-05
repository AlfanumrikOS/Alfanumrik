-- Gate-2 G (cleanup), 2026-09-05. CEO-approved DB cleanup, executed only
-- after independent live re-verification found the build plan's own
-- drop list was significantly wrong (7 of ~17 named "superseded" functions
-- and 2 of its "backup tables" turned out to still be live). This
-- migration drops ONLY the subset that survived every check below —
-- nothing else from the plan's original list.
--
-- Verification performed immediately before writing this migration
-- (2026-09-05, against the live production database):
--   1. Zero rows / zero lifetime activity (pg_stat_user_tables /
--      pg_stat_user_functions; stats_reset is NULL on this database, so
--      "0 calls" reflects the function's/table's entire lifetime, not a
--      recent reset window).
--   2. Zero references in live application code (apps/, packages/,
--      supabase/functions/ — excluding __tests__, *.test.*, and the
--      auto-generated database.types.ts, which lists every table/type
--      in the schema regardless of use).
--   3. Not attached to any active trigger (pg_trigger).
--   4. Not called internally by any other function's body (pg_proc.prosrc
--      cross-referenced against every other function in the public schema).
--
-- EXPLICITLY EXCLUDED from this cleanup (found to be live on 2026-09-05,
-- despite the build plan naming them "superseded"/safe):
--   - submit_quiz_results, bkt_update, match_rag_chunks, get_quiz_questions,
--     select_quiz_questions_v2 -- each has a real, live `.rpc()` call site
--     in packages/lib/src/{domains/quiz.ts,supabase.ts,quiz-assembler.ts}
--     or apps/host/src/app/api/{whatsapp/_lib/daily6.ts,concept-engine/route.ts}
--     as an intentional fallback tier in the quiz/RAG serving chain --
--     "0 calls" for these means the primary path has never failed yet,
--     not that the fallback is dead code.
--   - fn_quiz_session_bkt_update, fn_quiz_response_bkt_update -- LIVE
--     triggers on quiz_sessions/quiz_responses (trg_quiz_session_bkt_update,
--     trg_quiz_response_bkt_update). Dropping these would have broken
--     every quiz session/response write immediately.
--   - update_concept_mastery, update_mastery_bkt -- called transitively by
--     update_learner_state_post_quiz (documented in packages/lib/src/
--     supabase.ts:447 as "submit_quiz_results RPC ->
--     update_learner_state_post_quiz()", i.e. the real post-quiz-submission
--     chain), record_learning_event, and bkt_update_personalized.
--   - _feature_flags_dead_flags_backup_20260831 -- 20 rows, 2 recent reads,
--     created only 5 days before this migration; not a stale artifact.
--   - backup_status -- 1,009 seq_scans; a real, actively-queried
--     operational table, not a throwaway "_backup_*" naming match.
--
-- Rollback: none possible for a DROP -- this is why the exclusion list
-- above exists. If any dropped object turns out to be needed, restore
-- from a pre-migration database backup/PITR, not a down-migration.

SET LOCAL lock_timeout = '5s';

-- ── Confirmed-dead tables (0 rows, 0 code refs, only a standard
--    set_updated_at trigger which is dropped automatically with the table) ──
DROP TABLE IF EXISTS public.layer_mastery;
DROP TABLE IF EXISTS public.student_concept_state;
DROP TABLE IF EXISTS public._ao10b_grade_backfill_backup;
DROP TABLE IF EXISTS public._rls_policy_backup_20260818;
DROP TABLE IF EXISTS public._sm_backup_20260427_drift_repair;
DROP TABLE IF EXISTS public._tsb4_isactive_backfill_backup;

-- ── Confirmed-dead functions (0 lifetime calls, 0 code refs, no trigger
--    attachment, no internal caller anywhere in the schema except each
--    other in the first pair, which itself has zero external callers) ──
DROP FUNCTION IF EXISTS public.submit_quiz_results_safe;
DROP FUNCTION IF EXISTS public.submit_quiz_results_rpc;
DROP FUNCTION IF EXISTS public.match_rag_chunks_v3;
DROP FUNCTION IF EXISTS public.fast_rag_search;
DROP FUNCTION IF EXISTS public.fast_rag_search_v2;
DROP FUNCTION IF EXISTS public.hybrid_rag_search;
DROP FUNCTION IF EXISTS public.instant_rag_search;
DROP FUNCTION IF EXISTS public.search_rag_chunks;
