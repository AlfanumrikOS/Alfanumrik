-- DOWN migration for: supabase/migrations/20260821061915_revoke_public_execute_quiz_serving_rpcs.sql
--
-- Restores the EXECUTE privileges on the five SECURITY DEFINER quiz-serving RPCs to the exact
-- state captured read-only from production `shktyoxqhundlvkiwguu` on 2026-08-21, before the UP
-- migration removed the PUBLIC grant.
--
-- LEDGER RECONCILIATION (RESOLVED 2026-08-21): the UP migration was applied to production
-- `shktyoxqhundlvkiwguu` and the ledger stamped version 20260821061915. Both the UP file and this
-- DOWN partner were renamed from their authored 20260821000100 prefix to that ledger version, so
-- the pair is discoverable under one version matching `supabase_migrations.schema_migrations`.
--
-- ============================================================================
-- *** THIS FILE RESTORES THE ANONYMOUS PATH TO THE QUIZ ANSWER KEY ***
-- ============================================================================
-- Do not run this casually. Read this section in full first.
--
-- The UP migration's whole effect was to remove one aclitem per function: the PUBLIC grant, the
-- `=X/postgres` entry with an empty grantee. That entry was `anon`'s SOLE source of EXECUTE —
-- `anon` is not a member of `authenticated` and held no explicit aclitem of its own, which is
-- why `has_function_privilege` under `SET LOCAL ROLE anon` returned TRUE for all five before the
-- UP and FALSE after.
--
-- The first statement in each block below is `GRANT EXECUTE ... TO PUBLIC`. THAT IS THE
-- STATEMENT THAT RE-OPENS THE HOLE. Once it runs, any holder of the public anon key — which
-- ships in the browser bundle and in the Flutter app, and requires no login — can again call
-- these RPCs. Four of the five emit `correct_answer_index` in their payload, and all five are
-- SECURITY DEFINER, so they execute as `postgres` and are RLS-EXEMPT: no row-level rule limits
-- what comes back.
--
-- Running this file makes the quiz answer key anonymously readable again.
--
-- ============================================================================
-- WHY THIS FILE IS NOT IN supabase/migrations/
-- ============================================================================
-- `supabase db push` applies EVERY file in `supabase/migrations/` in version order. A
-- down-migration living there would be applied automatically on the next deploy and would
-- SILENTLY RE-OPEN THE ANONYMOUS PATH TO THE ANSWER KEY — with no operator decision, no
-- incident, and no signal that anything had changed.
--
-- It therefore lives in `docs/runbooks/` and is NEVER auto-applied. Rolling back is a conscious,
-- hand-run act:
--
--     psql "$DATABASE_URL" -f docs/runbooks/20260821061915_revoke_public_execute_quiz_serving_rpcs.DOWN.sql
--
-- Do not move this file into `supabase/migrations/`.
--
-- ============================================================================
-- LIMITS OF THIS ROLLBACK
-- ============================================================================
-- 1. IT RESTORES GRANTS, NOT BEHAVIOUR. Everything here is privilege-layer. It does not touch a
--    single function body, and it neither adds nor removes `correct_answer_index` from any
--    payload. The UP migration changed no behaviour either, so there is no behaviour to undo —
--    if a caller is failing, a privilege restore is the only thing this file can possibly fix,
--    and if the failure is not a privilege failure, this file will not fix it. Diagnose before
--    running.
-- 2. IT DOES NOT UNDO ANYTHING A CALLER DID IN THE INTERIM. No quiz session, response, score, XP
--    award, or audit row written while the UP migration was in effect is replayed, reversed, or
--    reconciled. Rows written stay written. If data remediation is needed, that is separate,
--    explicit work.
-- 3. IT RESTORES A KNOWN-VULNERABLE STATE. BREAK-GLASS ARTIFACT ONLY — for the case where the UP
--    migration is found to break a legitimate caller that could not be enumerated beforehand.
--    PREFER THE NARROWER REMEDY: route the broken caller through the service-role client (which
--    is BYPASSRLS and needs no grant at all) or, if the caller genuinely is a logged-in user,
--    confirm it is presenting a JWT — `authenticated` keeps EXECUTE under the UP migration, so a
--    correctly-authenticated caller is not what broke. Restoring PUBLIC should be the last
--    option, not the first.
-- 4. IT ASSUMES ALL FIVE OVERLOADS STILL EXIST WITH THESE EXACT SIGNATURES. If any has since
--    been dropped, renamed, or had its argument list changed, the corresponding statement will
--    FAIL. That is intentional: a privilege statement that cannot resolve its target must raise,
--    not be silently skipped. The whole reason the UP migration was needed is that a previous
--    hardening migration failed silently.
--
-- ============================================================================
-- SOURCE OF TRUTH FOR THE STATEMENTS BELOW
-- ============================================================================
-- These statements were DERIVED FROM `aclexplode`, not hand-written. The captured ACL was
-- BYTE-IDENTICAL on all five overloads:
--
--     {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- which decodes, per overload, to exactly four grantees holding EXECUTE:
--
--     PUBLIC          yes   (the `=X/postgres` entry — empty grantee)
--     postgres        yes
--     authenticated   yes   (EXPLICIT — its own aclitem, independent of PUBLIC)
--     service_role    yes
--     anon            NO EXPLICIT ENTRY
--
-- Each block below reproduces those four grantees as four grants, in that order.
--
-- ABOUT THE FIFTH LINE IN EACH BLOCK — `REVOKE EXECUTE ... FROM anon`. It is DELIBERATE and it
-- is CORRECT, even though `anon` had no explicit entry in the captured state:
--   * Against the captured state it is a NO-OP. Nothing to remove, nothing removed.
--   * If an `anon` grant has been introduced in the interim — for instance by a drop-then-create
--     of one of these functions as `postgres`, which picks up the `pg_default_acl` entry that
--     grants EXECUTE to `anon` (see the UP migration's LATENT RE-OPENING HAZARD section) — this
--     line correctly removes it, so the restore lands on the CAPTURED state rather than on
--     "captured state plus whatever drifted in".
-- A restore must reproduce the capture exactly, including the ABSENCE of an entry. That is what
-- these five lines encode.
--
-- ABOUT WHAT IS DELIBERATELY ABSENT: there is NO statement anywhere below that removes EXECUTE
-- from `authenticated`, and none that removes it from `service_role`. Both roles DID hold
-- explicit aclitems in the captured state. Removing either would UNDER-RESTORE — it would leave
-- the database in a state that never existed, and it would break every logged-in caller and
-- every server-side caller respectively. The asymmetry between how `anon` and how
-- `authenticated`/`service_role` are treated here is the whole point of deriving from
-- `aclexplode` instead of writing the file by hand.
--
-- `public.vector` is spelled schema-qualified throughout, matching the UP migration, so every
-- signature resolves regardless of session search_path.
--
-- ============================================================================
-- WHAT IS NOT TOUCHED
-- ============================================================================
-- No function body. No table. No row-level rule. No row. No other function, and no other
-- privilege on these five beyond EXECUTE.
--
-- UP migration: supabase/migrations/20260821061915_revoke_public_execute_quiz_serving_rpcs.sql
-- Ledger:       docs/audits/FIX-LEDGER.md
-- Audit:        docs/audits/2026-08-20-answer-key-serving-chain-risk.md

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. select_quiz_questions_rag — restore captured grantees.
--    The TO PUBLIC line is the one that re-opens anonymous access.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[], p_query_embedding public.vector) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[], p_query_embedding public.vector) TO postgres;
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[], p_query_embedding public.vector) TO authenticated;
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[], p_query_embedding public.vector) TO service_role;
REVOKE EXECUTE ON FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[], p_query_embedding public.vector) FROM anon;

-- ---------------------------------------------------------------------------
-- 2. select_quiz_questions_v2 — restore captured grantees.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_v2(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_v2(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_v2(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.select_quiz_questions_v2(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.select_quiz_questions_v2(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[]) FROM anon;

-- ---------------------------------------------------------------------------
-- 3. get_quiz_questions — 4-ARG OVERLOAD. A DISTINCT OBJECT from block 4;
--    each signature carries its own ACL and must be restored separately.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer) FROM anon;

-- ---------------------------------------------------------------------------
-- 4. get_quiz_questions — 5-ARG OVERLOAD (trailing p_chapter_number integer).
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer, p_chapter_number integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer, p_chapter_number integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer, p_chapter_number integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer, p_chapter_number integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer, p_chapter_number integer) FROM anon;

-- ---------------------------------------------------------------------------
-- 5. start_quiz_session — restore captured grantees.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.start_quiz_session(p_student_id uuid, p_question_ids uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_quiz_session(p_student_id uuid, p_question_ids uuid[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.start_quiz_session(p_student_id uuid, p_question_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_quiz_session(p_student_id uuid, p_question_ids uuid[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.start_quiz_session(p_student_id uuid, p_question_ids uuid[]) FROM anon;

COMMIT;
