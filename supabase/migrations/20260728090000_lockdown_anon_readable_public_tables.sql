-- Migration: 20260728090000_lockdown_anon_readable_public_tables.sql
-- Purpose: revoke unauthenticated (anon) SELECT on 50 public tables that carry a
--          permissive PUBLIC/true SELECT policy, including the question answer key.
--
-- ===========================================================================
-- THE EXPOSURE
-- ===========================================================================
-- A forensic probe run inside a rolled-back transaction on production found:
--
--   BEGIN; SET LOCAL ROLE anon;
--    acting_role | qb_visible_to_anon | qb_with_answer_key_visible
--    anon        |              18765 |                      12826
--   ROLLBACK;
--
-- The anon (unauthenticated) Postgres role could SELECT 18,765 rows from
-- public.question_bank, 12,826 of them carrying a populated answer key
-- (correct_answer_index, correct_answer_text, explanation, solution_steps,
-- expected_answer, answer_rubric).
--
-- ROOT CAUSE: policy "questions_read_all" has polroles = PUBLIC (no TO clause)
-- and USING (true). RLS is ENABLED on the table, so dashboards and linters
-- report it as protected. Supabase advisor rls_policy_always_true deliberately
-- excludes SELECT policies of exactly this shape, so it never fired. The guard
-- reported success while protecting nothing.
--
-- In PostgreSQL, GRANT TO PUBLIC means every role including anon. Because
-- permissive policies are OR-ed, a single PUBLIC/true SELECT policy makes every
-- other policy on the table irrelevant for reads.
--
-- ===========================================================================
-- HOW THE TABLE LIST WAS DERIVED  (method, so it can be re-run)
-- ===========================================================================
-- Static replay of all 469 files in supabase/migrations/ in filename order
-- (baseline_from_prod.sql + 468 timestamped), applying every CREATE/DROP/ALTER
-- POLICY and ALTER TABLE ... ROW LEVEL SECURITY to a modelled catalog.
-- Final modelled state: 721 policies across 351 tables, RLS enabled on 388.
-- Selecting PERMISSIVE policies where cmd IN (SELECT, ALL), roles include
-- public or anon, and qual is true/absent yields exactly 50 tables (50 policies,
-- one per table). This independently reproduces the audit "~50" figure.
--
-- NOTE ON PROVENANCE: this list is derived from the repo migration chain, not
-- from a live production catalog read (the authoring environment had no
-- production credentials). The chain's baseline IS a pg_dump of production
-- (2026-05-03), so the list is expected to match, but production may carry
-- additional policies that exist nowhere in this repo -- see DRIFT SWEEP below,
-- which handles exactly that case at apply time.
--
-- The equivalent live query, for post-deploy verification:
--   SELECT tablename, policyname, roles, qual FROM pg_policies
--    WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
--      AND cmd IN ('SELECT','ALL')
--      AND roles && ARRAY['public','anon']::name[]
--      AND (qual IS NULL OR btrim(qual) = 'true');
--   -- expected after this migration: 0 rows
--
-- ===========================================================================
-- ANONYMOUS-READ-PATH VERIFICATION (why this does not break the product)
-- ===========================================================================
-- question_bank is read client-side through the anon-KEY browser client
-- (packages/lib/src/supabase.ts), which selects correct_answer_index and
-- explanation in getChapterQuestions() and the getQuizQuestionsV2 fallback.
-- Every consumer of those helpers is behind an auth gate:
--   web  : (student)/learn/[subject]/[chapter], (student)/quiz, (student)/pyq,
--          (student)/mock-exam, teacher/worksheets  -- all client auth-guarded
--   api  : /api/quiz/ncert-questions and /api/diagnostic/start both call
--          authorizeRequest() first and then read via supabaseAdmin
--   mobile: lib/data/repositories/{quiz,pyq}_repository.dart, behind the GoRouter
--          global gate  if (!isAuth && !isLoginRoute) return '/login';
-- Anon KEY is not the same as anon ROLE: once a user signs in, the same client
-- sends a JWT and Postgres evaluates policies as authenticated. Scoping these
-- policies TO authenticated therefore preserves every logged-in read path and
-- removes only the unauthenticated one.
--
-- Public/marketing surfaces were checked for DB reads and have none:
--   packages/ui/src/landing/** imports no Supabase client (PricingV3 hardcodes
--   prices); /demo writes only demo_requests; /challenge, /diagnostic and /join
--   redirect to /login; sitemap.ts and /api/school-config read no tables.
-- Bucket (a) "genuinely public" is therefore EMPTY: no unauthenticated surface
-- in web or mobile reads any of these 50 tables.
--
-- For the bucket (d) tables below, SECURITY INVOKER functions were also checked
-- (a SECURITY INVOKER RPC called from the browser would break when the policy is
-- removed). The invoker-rights functions over these tables -- search_rag_chunks,
-- cbse_syllabus_rag_ready, distinct_chapter_tuples_from_chunks,
-- count_mojibake_rows -- have zero callers in web, mobile or Edge Function code.
-- Every RPC the product actually calls over these tables (match_rag_chunks,
-- match_rag_chunks_ncert, hybrid_rag_search, fast_rag_search, get_ncert_questions,
-- get_chapter_rag_content, ...) is SECURITY DEFINER and so bypasses RLS.
--
-- ===========================================================================
-- BUCKET DECISION FOR EVERY TABLE TOUCHED
-- ===========================================================================
-- (a) genuinely public   :  0 tables  -- none; see evidence above
-- (b) authenticated-only : 30 tables  -- policy re-scoped TO authenticated
-- (c) owner-scoped       :  1 table   -- real USING predicate
-- (d) service-role-only  : 19 tables  -- policy dropped, not replaced
--
-- (b) achievements                reference/curriculum content; no unauthenticated consumer
-- (b) admin_announcements         reference/curriculum content; no unauthenticated consumer
-- (b) cbse_board_papers           reference/curriculum content; no unauthenticated consumer
-- (b) cbse_chapter_weights        reference/curriculum content; no unauthenticated consumer
-- (b) cbse_competency_map         reference/curriculum content; no unauthenticated consumer
-- (b) cbse_question_config        reference/curriculum content; no unauthenticated consumer
-- (b) cbse_syllabus_graph         reference/curriculum content; no unauthenticated consumer
-- (b) concept_graph               reference/curriculum content; no unauthenticated consumer
-- (b) curriculum_topics           authenticated student/teacher + Flutter (global auth gate)
-- (b) gamification_bursts         reference/curriculum content; no unauthenticated consumer
-- (b) grade_subject_map           reference/curriculum content; no unauthenticated consumer
-- (b) interleave_config           reference/curriculum content; no unauthenticated consumer
-- (b) learning_graph              reference/curriculum content; no unauthenticated consumer
-- (b) misconception_patterns      reference/curriculum content; no unauthenticated consumer
-- (b) narrative_templates         reference/curriculum content; no unauthenticated consumer
-- (b) ncert_exercises             reference/curriculum content; no unauthenticated consumer
-- (b) ncert_formulas              reference/curriculum content; no unauthenticated consumer
-- (b) nipun_competencies          reference/curriculum content; no unauthenticated consumer
-- (b) nipun_diagnostic_items      reference/curriculum content; no unauthenticated consumer
-- (b) nipun_instructional_tasks   reference/curriculum content; no unauthenticated consumer
-- (b) nipun_levels                reference/curriculum content; no unauthenticated consumer
-- (b) parent_tips                 reference/curriculum content; no unauthenticated consumer
-- (b) plan_subject_access         reference/curriculum content; no unauthenticated consumer
-- (b) question_bank               LIVE anon-key reader (quiz) - authenticated preserved, 12826 answer keys closed
-- (b) subjects                    authenticated surfaces + server routes
-- (b) subscription_plans          /pricing hardcodes prices; no landing-page DB read
-- (b) topic_diagrams              reference/curriculum content; no unauthenticated consumer
-- (b) tutor_avatars               reference/curriculum content; no unauthenticated consumer
-- (b) tutor_personas              reference/curriculum content; no unauthenticated consumer
-- (b) vernacular_content          reference/curriculum content; no unauthenticated consumer
-- (c) leaderboard                 per-student rows; zero client refs; prod already owner-scoped
-- (d) rag_content_chunks          proprietary NCERT corpus; all readers verified service-role
-- (d) rag_content_documents       RAG sibling; zero client refs
-- (d) rag_content_sources         RAG sibling; zero client refs
-- (d) rag_syllabus_map            RAG sibling; zero client refs
-- (d) textbooks                   licensed textbook metadata; zero client refs
-- (d) textbook_chunks             licensed textbook body text; zero client refs
-- (d) assessments                 answer-bearing; zero client refs
-- (d) assessment_questions        answer-bearing; zero client refs
-- (d) invite_codes                credential-like, was anon-enumerable; validated server-side
-- (d) response_cache              cached AI output, may hold other learners content
-- (d) ai_usage_stats              internal cost telemetry; server-only readers
-- (d) ai_quality_metrics          internal telemetry; zero client refs
-- (d) solver_accuracy             internal telemetry; zero client refs
-- (d) model_pricing               commercially sensitive cost data; zero client refs
-- (d) mol_routing_weights         internal routing config; zero client refs
-- (d) ai_role_rules               internal AI guardrail config; zero client refs
-- (d) readiness_rubric_config     super-admin route only; policy was NAMED _read_authenticated but granted TO PUBLIC
-- (d) pilot_cohorts               internal pilot config; zero client refs
-- (d) content_versions            internal versioning metadata; zero client refs
--
-- NOT DROPPING ANY TABLE OR COLUMN. Idempotent: DROP POLICY IF EXISTS +
-- CREATE POLICY, and ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op when
-- already enabled. Safe to re-run.
--
-- RESIDUAL RISK, DELIBERATELY NOT CLOSED HERE (needs an application change):
-- question_bank answer keys remain readable by ANY authenticated user, because
-- the quiz renders them client-side. Closing that requires moving question
-- delivery behind a server RPC that withholds the key until submission. Tracked
-- as a follow-up; it is out of scope for a policy-only migration.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BUCKET (b) AUTHENTICATED-ONLY (30 tables)
-- None of these holds per-user rows, so a permissive TO authenticated policy
-- cannot OR-widen an owner-scoped policy that may exist only in production.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."achievements" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "achievements_read_all" ON "public"."achievements";
DROP POLICY IF EXISTS "achievements_authenticated_read" ON "public"."achievements";
CREATE POLICY "achievements_authenticated_read" ON "public"."achievements"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."admin_announcements" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "announce_read" ON "public"."admin_announcements";
DROP POLICY IF EXISTS "admin_announcements_authenticated_read" ON "public"."admin_announcements";
CREATE POLICY "admin_announcements_authenticated_read" ON "public"."admin_announcements"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."cbse_board_papers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view board papers" ON "public"."cbse_board_papers";
DROP POLICY IF EXISTS "cbse_board_papers_authenticated_read" ON "public"."cbse_board_papers";
CREATE POLICY "cbse_board_papers_authenticated_read" ON "public"."cbse_board_papers"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."cbse_chapter_weights" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cbse_chapter_weights_anon_select" ON "public"."cbse_chapter_weights";
DROP POLICY IF EXISTS "cbse_chapter_weights_authenticated_read" ON "public"."cbse_chapter_weights";
CREATE POLICY "cbse_chapter_weights_authenticated_read" ON "public"."cbse_chapter_weights"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."cbse_competency_map" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads competency map" ON "public"."cbse_competency_map";
DROP POLICY IF EXISTS "cbse_competency_map_authenticated_read" ON "public"."cbse_competency_map";
CREATE POLICY "cbse_competency_map_authenticated_read" ON "public"."cbse_competency_map"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."cbse_question_config" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cbse_config_read_all" ON "public"."cbse_question_config";
DROP POLICY IF EXISTS "cbse_question_config_authenticated_read" ON "public"."cbse_question_config";
CREATE POLICY "cbse_question_config_authenticated_read" ON "public"."cbse_question_config"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."cbse_syllabus_graph" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "syllabus_read" ON "public"."cbse_syllabus_graph";
DROP POLICY IF EXISTS "cbse_syllabus_graph_authenticated_read" ON "public"."cbse_syllabus_graph";
CREATE POLICY "cbse_syllabus_graph_authenticated_read" ON "public"."cbse_syllabus_graph"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."concept_graph" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cg_read" ON "public"."concept_graph";
DROP POLICY IF EXISTS "concept_graph_authenticated_read" ON "public"."concept_graph";
CREATE POLICY "concept_graph_authenticated_read" ON "public"."concept_graph"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."curriculum_topics" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "topics_read_all" ON "public"."curriculum_topics";
DROP POLICY IF EXISTS "curriculum_topics_authenticated_read" ON "public"."curriculum_topics";
CREATE POLICY "curriculum_topics_authenticated_read" ON "public"."curriculum_topics"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."gamification_bursts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone reads bursts" ON "public"."gamification_bursts";
DROP POLICY IF EXISTS "gamification_bursts_authenticated_read" ON "public"."gamification_bursts";
CREATE POLICY "gamification_bursts_authenticated_read" ON "public"."gamification_bursts"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."grade_subject_map" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gsm_read_all" ON "public"."grade_subject_map";
DROP POLICY IF EXISTS "grade_subject_map_authenticated_read" ON "public"."grade_subject_map";
CREATE POLICY "grade_subject_map_authenticated_read" ON "public"."grade_subject_map"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."interleave_config" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone reads interleave config" ON "public"."interleave_config";
DROP POLICY IF EXISTS "interleave_config_authenticated_read" ON "public"."interleave_config";
CREATE POLICY "interleave_config_authenticated_read" ON "public"."interleave_config"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."learning_graph" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lg_read" ON "public"."learning_graph";
DROP POLICY IF EXISTS "learning_graph_authenticated_read" ON "public"."learning_graph";
CREATE POLICY "learning_graph_authenticated_read" ON "public"."learning_graph"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."misconception_patterns" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mp_read" ON "public"."misconception_patterns";
DROP POLICY IF EXISTS "misconception_patterns_authenticated_read" ON "public"."misconception_patterns";
CREATE POLICY "misconception_patterns_authenticated_read" ON "public"."misconception_patterns"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."narrative_templates" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone reads narrative templates" ON "public"."narrative_templates";
DROP POLICY IF EXISTS "narrative_templates_authenticated_read" ON "public"."narrative_templates";
CREATE POLICY "narrative_templates_authenticated_read" ON "public"."narrative_templates"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."ncert_exercises" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "exercises_read_all" ON "public"."ncert_exercises";
DROP POLICY IF EXISTS "ncert_exercises_authenticated_read" ON "public"."ncert_exercises";
CREATE POLICY "ncert_exercises_authenticated_read" ON "public"."ncert_exercises"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."ncert_formulas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "formulas_read" ON "public"."ncert_formulas";
DROP POLICY IF EXISTS "ncert_formulas_authenticated_read" ON "public"."ncert_formulas";
CREATE POLICY "ncert_formulas_authenticated_read" ON "public"."ncert_formulas"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."nipun_competencies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nipun_comp_read" ON "public"."nipun_competencies";
DROP POLICY IF EXISTS "nipun_competencies_authenticated_read" ON "public"."nipun_competencies";
CREATE POLICY "nipun_competencies_authenticated_read" ON "public"."nipun_competencies"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."nipun_diagnostic_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nipun_diag_read" ON "public"."nipun_diagnostic_items";
DROP POLICY IF EXISTS "nipun_diagnostic_items_authenticated_read" ON "public"."nipun_diagnostic_items";
CREATE POLICY "nipun_diagnostic_items_authenticated_read" ON "public"."nipun_diagnostic_items"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."nipun_instructional_tasks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nipun_tasks_read" ON "public"."nipun_instructional_tasks";
DROP POLICY IF EXISTS "nipun_instructional_tasks_authenticated_read" ON "public"."nipun_instructional_tasks";
CREATE POLICY "nipun_instructional_tasks_authenticated_read" ON "public"."nipun_instructional_tasks"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."nipun_levels" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nipun_levels_read" ON "public"."nipun_levels";
DROP POLICY IF EXISTS "nipun_levels_authenticated_read" ON "public"."nipun_levels";
CREATE POLICY "nipun_levels_authenticated_read" ON "public"."nipun_levels"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."parent_tips" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parent_tips_read" ON "public"."parent_tips";
DROP POLICY IF EXISTS "parent_tips_authenticated_read" ON "public"."parent_tips";
CREATE POLICY "parent_tips_authenticated_read" ON "public"."parent_tips"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."plan_subject_access" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "psa_read_all" ON "public"."plan_subject_access";
DROP POLICY IF EXISTS "plan_subject_access_authenticated_read" ON "public"."plan_subject_access";
CREATE POLICY "plan_subject_access_authenticated_read" ON "public"."plan_subject_access"
  FOR SELECT TO "authenticated" USING (true);

-- THE HEADLINE FIX. "questions_read_all" is the policy that made 12,826 answer
-- keys readable by the anon role. Re-scoped, not removed: the quiz reads this
-- table from the browser with the anon KEY but an authenticated JWT.
ALTER TABLE "public"."question_bank" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "questions_read_all" ON "public"."question_bank";
DROP POLICY IF EXISTS "question_bank_authenticated_read" ON "public"."question_bank";
CREATE POLICY "question_bank_authenticated_read" ON "public"."question_bank"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."subjects" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subjects_read_all" ON "public"."subjects";
DROP POLICY IF EXISTS "subjects_authenticated_read" ON "public"."subjects";
CREATE POLICY "subjects_authenticated_read" ON "public"."subjects"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_read" ON "public"."subscription_plans";
DROP POLICY IF EXISTS "subscription_plans_authenticated_read" ON "public"."subscription_plans";
CREATE POLICY "subscription_plans_authenticated_read" ON "public"."subscription_plans"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."topic_diagrams" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "diagrams_public_read" ON "public"."topic_diagrams";
DROP POLICY IF EXISTS "topic_diagrams_authenticated_read" ON "public"."topic_diagrams";
CREATE POLICY "topic_diagrams_authenticated_read" ON "public"."topic_diagrams"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."tutor_avatars" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "avatars_read" ON "public"."tutor_avatars";
DROP POLICY IF EXISTS "tutor_avatars_authenticated_read" ON "public"."tutor_avatars";
CREATE POLICY "tutor_avatars_authenticated_read" ON "public"."tutor_avatars"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."tutor_personas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "personas_read" ON "public"."tutor_personas";
DROP POLICY IF EXISTS "tutor_personas_authenticated_read" ON "public"."tutor_personas";
CREATE POLICY "tutor_personas_authenticated_read" ON "public"."tutor_personas"
  FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."vernacular_content" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vernacular_public_read" ON "public"."vernacular_content";
DROP POLICY IF EXISTS "vernacular_content_authenticated_read" ON "public"."vernacular_content";
CREATE POLICY "vernacular_content_authenticated_read" ON "public"."vernacular_content"
  FOR SELECT TO "authenticated" USING (true);

-- ---------------------------------------------------------------------------
-- BUCKET (c) OWNER-SCOPED (1 table)
-- Covers the four required RLS patterns: student reads own, parent reads linked
-- child (is_guardian_of -> guardian_student_links status = approved), teacher
-- reads assigned student (is_teacher_of), admin via service_role RLS bypass.
--
-- Deliberately NOT a permissive "TO authenticated USING (true)" policy: the
-- audit reports production already carries an owner-scoped policy on this table
-- that exists nowhere in this repo. Permissive policies OR together, so a
-- true-qual policy here would silently RE-WIDEN production back to
-- every-authenticated-user. An owner-scoped predicate cannot.
--
-- RS-RULE COMPLIANCE (XC-3 / TSB-4 recursion class). Every one of the three
-- disjuncts below delegates to a SECURITY DEFINER helper. NONE inlines a
-- FROM/JOIN over another RLS-enabled table. An earlier revision of this file
-- expressed the student-own disjunct as
--     student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
-- which is exactly the 2026-07-02 TSB-4 defect: that subquery runs SECURITY
-- INVOKER, so it re-enters public.students' OWN RLS and can close a
-- students -> ... -> students cycle ("infinite recursion detected in policy for
-- relation students"), deadlocking reads on BOTH tables. See
-- 20260702080000_fix_students_rls_infinite_recursion.sql and
-- docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5).
--
-- HELPER CHOICE: public.get_my_student_ids() (baseline_from_prod.sql:8989) is
-- SECURITY DEFINER STABLE with SET search_path = public, and its body is
--     SELECT id FROM students WHERE auth_user_id = auth.uid()
-- i.e. byte-for-byte the predicate being replaced, so this is a pure
-- recursion-safety refactor with ZERO semantic change. Deliberately NOT
-- get_my_student_id() (singular): that helper adds `AND is_active = true`,
-- which would silently NARROW access for a deactivated student. Both are on
-- the guard's SECURITY DEFINER helper roster (set H).
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."leaderboard" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leaderboard_public_read" ON "public"."leaderboard";
DROP POLICY IF EXISTS "leaderboard_owner_read" ON "public"."leaderboard";
CREATE POLICY "leaderboard_owner_read" ON "public"."leaderboard"
  FOR SELECT TO "authenticated" USING (
    "student_id" IN (SELECT "public"."get_my_student_ids"())
    OR "public"."is_guardian_of"("student_id")
    OR "public"."is_teacher_of"("student_id")
  );

-- ---------------------------------------------------------------------------
-- BUCKET (d) SERVICE-ROLE-ONLY (19 tables)
-- Policy dropped and NOT replaced. RLS stays enabled, so neither anon nor
-- authenticated can read. service_role bypasses RLS, so every server-side
-- reader (supabaseAdmin, Edge Functions) keeps working unchanged.
-- ROLLBACK for a single table if an unexpected client reader surfaces:
--   CREATE POLICY "<t>_authenticated_read" ON public."<t>"
--     FOR SELECT TO authenticated USING (true);
-- ---------------------------------------------------------------------------

-- proprietary NCERT corpus (~27,778 rows). Readers verified service-role:
-- fetchChapterContent.ts, chapter-explorer.ts, learning-monitors.ts and
-- /api/quiz/ncert-questions all use supabaseAdmin; Edge Functions inject a
-- service-role client into _shared/rag/retrieve.ts (quiz-generator's anon-key
-- client is used ONLY for auth.getUser() token validation, never for data).
-- Zero Flutter reads. This is the highest-value (d) call in this migration --
-- if RAG retrieval regresses after deploy, roll back THIS table first.
ALTER TABLE "public"."rag_content_chunks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rag_chunks_read" ON "public"."rag_content_chunks";

-- RAG sibling; zero client refs
ALTER TABLE "public"."rag_content_documents" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rag_docs_read" ON "public"."rag_content_documents";

-- RAG sibling; zero client refs
ALTER TABLE "public"."rag_content_sources" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rag_sources_read" ON "public"."rag_content_sources";

-- RAG sibling; zero client refs
ALTER TABLE "public"."rag_syllabus_map" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rag_syllabus_map_read" ON "public"."rag_syllabus_map";

-- licensed textbook metadata; zero client refs
ALTER TABLE "public"."textbooks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "textbooks_read_all" ON "public"."textbooks";

-- licensed textbook body text; zero client refs
ALTER TABLE "public"."textbook_chunks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chunks_read_all" ON "public"."textbook_chunks";

-- answer-bearing; zero client refs
ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assessments_public_read" ON "public"."assessments";

-- answer-bearing; zero client refs
ALTER TABLE "public"."assessment_questions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "questions_public_read" ON "public"."assessment_questions";

-- credential-like: a PUBLIC/true SELECT let any unauthenticated caller
-- enumerate every invite code. /join validates codes server-side via
-- /api/schools/join, so no client needs to read this table.
ALTER TABLE "public"."invite_codes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invite_read" ON "public"."invite_codes";

-- cached AI output, may hold other learners content
ALTER TABLE "public"."response_cache" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cache_read_all" ON "public"."response_cache";

-- internal cost telemetry; readers are /api/internal/admin/{command-center,
-- ai-monitor} and issue-detector.ts, all server-side
ALTER TABLE "public"."ai_usage_stats" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usage_read_all" ON "public"."ai_usage_stats";

-- internal telemetry; zero client refs
ALTER TABLE "public"."ai_quality_metrics" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read quality metrics" ON "public"."ai_quality_metrics";

-- internal telemetry; zero client refs
ALTER TABLE "public"."solver_accuracy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accuracy_read" ON "public"."solver_accuracy";

-- commercially sensitive per-model cost data; zero client refs
ALTER TABLE "public"."model_pricing" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "model_pricing_read_all" ON "public"."model_pricing";

-- internal routing config; zero client refs
ALTER TABLE "public"."mol_routing_weights" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mol_routing_weights_read_all" ON "public"."mol_routing_weights";

-- internal AI guardrail config; zero client refs
ALTER TABLE "public"."ai_role_rules" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "airr_read" ON "public"."ai_role_rules";

-- Sole reader is /api/super-admin/readiness-rubric (service role). NOTE the
-- policy is literally named "..._read_authenticated" yet was granted TO PUBLIC:
-- a self-describing instance of the vacuous-guard pattern this migration closes.
ALTER TABLE "public"."readiness_rubric_config" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "readiness_rubric_config_read_authenticated" ON "public"."readiness_rubric_config";

-- internal pilot config; zero client refs
ALTER TABLE "public"."pilot_cohorts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pilot_read" ON "public"."pilot_cohorts";

-- internal versioning metadata; zero client refs
ALTER TABLE "public"."content_versions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads content versions" ON "public"."content_versions";

-- ---------------------------------------------------------------------------
-- DRIFT SWEEP
-- ---------------------------------------------------------------------------
-- The statements above name the policies that the repo migration chain knows
-- about. Production is known to carry policies that exist nowhere in this repo,
-- so a permissive policy may survive under a name this file cannot predict.
-- feature_flags is the proven case: the repo chain defines only
-- feature_flags_read_authenticated (TO authenticated), yet the audit observed
-- feature_flags readable by anon in production -- a policy this repo has never
-- seen. Name-based DROPs alone would silently miss it.
--
-- This catalog-driven sweep closes that gap for the tables in scope, and WARNS
-- (never auto-drops) for any other table, so an operator reviews it by hand.
-- It runs after the explicit statements above, and cannot remove the
-- TO authenticated policies just created (they do not overlap {public,anon}).
--
-- The candidate set is fully materialised into a jsonb array BEFORE any DDL is
-- issued, so the loop never mutates the catalog it is scanning.
DO $$
DECLARE
  r        record;
  v_drift  jsonb;
  v_scope  text[] := ARRAY[
    'achievements','admin_announcements','ai_quality_metrics','ai_role_rules',
    'ai_usage_stats','assessment_questions','assessments','cbse_board_papers',
    'cbse_chapter_weights','cbse_competency_map','cbse_question_config',
    'cbse_syllabus_graph','concept_graph','content_versions','curriculum_topics',
    'gamification_bursts','grade_subject_map','interleave_config','invite_codes',
    'leaderboard','learning_graph','misconception_patterns','model_pricing',
    'mol_routing_weights','narrative_templates','ncert_exercises','ncert_formulas',
    'nipun_competencies','nipun_diagnostic_items','nipun_instructional_tasks',
    'nipun_levels','parent_tips','pilot_cohorts','plan_subject_access',
    'question_bank','rag_content_chunks','rag_content_documents',
    'rag_content_sources','rag_syllabus_map','readiness_rubric_config',
    'response_cache','solver_accuracy','subjects','subscription_plans',
    'textbook_chunks','textbooks','topic_diagrams','tutor_avatars',
    'tutor_personas','vernacular_content','feature_flags'
  ];
  v_swept  int := 0;
  v_resid  int := 0;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           's', schemaname, 't', tablename, 'p', policyname, 'c', cmd)), '[]'::jsonb)
    INTO v_drift
    FROM pg_policies
   WHERE schemaname = 'public'
     AND permissive = 'PERMISSIVE'
     AND cmd IN ('SELECT', 'ALL')
     AND roles && ARRAY['public','anon']::name[]
     AND (qual IS NULL OR btrim(qual) = 'true');

  FOR r IN SELECT * FROM jsonb_to_recordset(v_drift)
                      AS x(s text, t text, p text, c text)
  LOOP
    IF r.t = ANY (v_scope) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.p, r.s, r.t);
      v_swept := v_swept + 1;
      RAISE NOTICE 'drift-swept anon-readable policy %.% / % (cmd=%)', r.s, r.t, r.p, r.c;
    ELSE
      v_resid := v_resid + 1;
      RAISE WARNING 'RESIDUAL anon-readable table outside this migration scope: %.% via policy % (cmd=%) -- review manually',
                    r.s, r.t, r.p, r.c;
    END IF;
  END LOOP;

  RAISE NOTICE 'anon-exposure sweep complete: % drift policy(ies) dropped, % residual outside scope',
               v_swept, v_resid;
END $$;

-- Ensure feature_flags still has an authenticated read path after the sweep.
-- On an environment that already matches the repo this is a no-op re-assertion
-- (the policy is recreated identically); it exists so that an environment where
-- the sweep just dropped a prod-only anon policy is not left unreadable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'feature_flags'
       AND cmd IN ('SELECT', 'ALL')
       AND roles && ARRAY['authenticated']::name[]
  ) THEN
    EXECUTE 'CREATE POLICY "feature_flags_read_authenticated" ON "public"."feature_flags"
               FOR SELECT TO "authenticated" USING (true)';
    RAISE NOTICE 'feature_flags: restored authenticated read policy after drift sweep';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SELF-VERIFICATION: fail loudly if the exposure is not actually closed.
-- This migration must not become another guard that reports success while
-- protecting nothing. If any IN-SCOPE table still carries a permissive
-- PUBLIC/anon true-qual SELECT policy, the migration aborts and rolls back.
--
-- Scoped deliberately to the 51 tables this migration owns, NOT schema-wide:
-- the sweep only WARNS for out-of-scope tables (it must not silently drop
-- policies nobody reviewed), so a schema-wide assertion would abort on a
-- residual the sweep intentionally left alone and block this fix from landing
-- at all. Out-of-scope residuals surface as WARNINGs in the apply log and are
-- listed for manual follow-up. This assertion covers exactly what the sweep
-- guarantees, so it is a real check and not a tautology.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_left  int;
  v_scope text[] := ARRAY[
    'achievements','admin_announcements','ai_quality_metrics','ai_role_rules',
    'ai_usage_stats','assessment_questions','assessments','cbse_board_papers',
    'cbse_chapter_weights','cbse_competency_map','cbse_question_config',
    'cbse_syllabus_graph','concept_graph','content_versions','curriculum_topics',
    'gamification_bursts','grade_subject_map','interleave_config','invite_codes',
    'leaderboard','learning_graph','misconception_patterns','model_pricing',
    'mol_routing_weights','narrative_templates','ncert_exercises','ncert_formulas',
    'nipun_competencies','nipun_diagnostic_items','nipun_instructional_tasks',
    'nipun_levels','parent_tips','pilot_cohorts','plan_subject_access',
    'question_bank','rag_content_chunks','rag_content_documents',
    'rag_content_sources','rag_syllabus_map','readiness_rubric_config',
    'response_cache','solver_accuracy','subjects','subscription_plans',
    'textbook_chunks','textbooks','topic_diagrams','tutor_avatars',
    'tutor_personas','vernacular_content','feature_flags'
  ];
BEGIN
  SELECT count(*) INTO v_left
    FROM pg_policies
   WHERE schemaname = 'public'
     AND permissive = 'PERMISSIVE'
     AND cmd IN ('SELECT', 'ALL')
     AND roles && ARRAY['public','anon']::name[]
     AND (qual IS NULL OR btrim(qual) = 'true')
     AND tablename = ANY (v_scope);

  IF v_left > 0 THEN
    RAISE EXCEPTION
      'anon exposure NOT closed: % permissive PUBLIC/anon true-qual SELECT policy(ies) remain on in-scope tables',
      v_left;
  END IF;

  -- Positive control: question_bank must still be readable by authenticated,
  -- otherwise this migration has broken the quiz instead of securing it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'question_bank'
       AND cmd IN ('SELECT', 'ALL')
       AND roles && ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION
      'question_bank has no authenticated SELECT policy left -- logged-in students could not run a quiz; aborting';
  END IF;

  RAISE NOTICE 'verified: 0 anon-readable in-scope policies; question_bank authenticated read intact';
END $$;
