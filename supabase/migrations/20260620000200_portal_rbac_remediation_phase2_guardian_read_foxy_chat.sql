-- Migration: 20260620000200_portal_rbac_remediation_phase2_guardian_read_foxy_chat.sql
-- Purpose: PHASE 2 of the CEO-approved portal RBAC/SaaS remediation. Build the
--          DB-layer data boundary so an APPROVED guardian (parent) can READ — and
--          only read — their OWN linked child's Foxy AI-tutor chat transcript.
--
-- ─── CEO approval posture (P13 data-privacy decision) ────────────────────────
--   Exposing a child's Foxy chat transcript to their linked parent is a P13
--   data-privacy widening. The CEO has APPROVED this specific change for Phase 2
--   of feat/portal-rbac-saas-remediation. This migration grants guardians a
--   strictly-scoped, READ-ONLY view of their approved children's chat — nothing
--   more. No other role is widened; no write path is opened.
--
-- ─── Where the chat lives (chat-transcript contract — confirmed vs baseline) ──
--   The message TEXT lives in `public.foxy_chat_messages`:
--       id          uuid  PK
--       session_id  uuid  NOT NULL  FK -> foxy_sessions(id) ON DELETE CASCADE
--       student_id  uuid  NOT NULL  FK -> students(id)      ON DELETE RESTRICT
--       role        text  CHECK ('user' | 'assistant')   -- 'user'=child, 'assistant'=Foxy
--       content     text  NOT NULL                        -- the message text
--       sources     jsonb                                 -- RAG citation data
--       tokens_used integer
--       created_at  timestamptz NOT NULL DEFAULT now()
--   Indexes already present: idx_foxy_chat_messages_student_id(student_id),
--                            idx_foxy_chat_messages_session_id(session_id, created_at).
--
--   `foxy_chat_messages` carries `student_id` DIRECTLY (denormalised), so the
--   guardian boundary is enforced on that column with no join required. The
--   session container `public.foxy_sessions` ALSO carries `student_id` directly
--   (id, student_id, subject, grade, chapter, mode, created_at, last_active_at,
--   concepts_discussed, last_cme_action, cognitive_context_loaded). We add the
--   guardian SELECT policy to foxy_sessions too, so a parent can read the session
--   envelope (subject/mode/timestamps) that frames the transcript.
--
--   BACKEND CONTRACT (hand-off): to render a child's transcript, read
--     foxy_chat_messages WHERE student_id = <child id> ORDER BY created_at
--   optionally grouped by session_id, and read foxy_sessions WHERE
--   student_id = <child id> for the session metadata. The app-layer gate is
--   canAccessStudent(authUserId, childStudentId) in src/lib/rbac.ts, which
--   already returns true for an approved/active guardian of the child. This RLS
--   policy is the defense-in-depth DB boundary beneath that app gate.
--
-- ─── Boundary helper (mirrors existing parent SELECT policies exactly) ────────
--   We use the canonical helper public.is_guardian_of(p_student_id uuid) -> bool,
--   identical to the existing cross-role read policies in the baseline:
--     cm_readonly_others  ON concept_mastery
--     tm_readonly_others  ON topic_mastery
--     slp_readonly_others ON student_learning_profiles
--     src_readonly_others ON spaced_repetition_cards
--     ssp_readonly_others ON student_simulation_progress
--   is_guardian_of() resolves the caller via auth.uid() -> guardians ->
--   guardian_student_links and returns true ONLY when a link exists with
--   status IN ('active','approved'). This is the SAME approved-guardian boundary
--   used everywhere else, so parent-child visibility stays consistent. It is
--   SECURITY DEFINER (justified in the baseline) because the calling parent
--   cannot read guardian_student_links/guardians directly under RLS.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. No DROP / DELETE / UPDATE / TRUNCATE. No destructive op.
--   - READ-ONLY for guardians. Both new policies are FOR SELECT. No INSERT /
--     UPDATE / DELETE path is opened for guardians on either table.
--   - NO OTHER ROLE WIDENED. Only a guardian-scoped SELECT is added.
--   - STRICTLY SCOPED (P13). is_guardian_of(student_id) is true ONLY for the
--     caller's own approved/active children, so a parent can NEVER read another
--     student's chat. No leakage.
--   - IDEMPOTENT / re-runnable. Each policy is created inside a guarded
--     DO-block that first DROPs the policy by exact name IF it exists, then
--     CREATEs it. The DROP targets ONLY the new policy names introduced here —
--     it never touches the existing student / service-role / write policies.
--     Safe to replay on PROD, main-staging, CI live-DB, and fresh DBs.
--   - RLS ALREADY ENABLED on both tables in the baseline
--     (foxy_chat_messages: line 21066; foxy_sessions: line 21091). We assert it
--     idempotently anyway (ENABLE ROW LEVEL SECURITY is a no-op if already on)
--     so the file is self-sufficient on a fresh DB if ordering ever shifts.
--
-- ─── Existing policies we are careful NOT to break ───────────────────────────
--   RLS policies are PERMISSIVE (OR-combined), so an added FOR SELECT policy can
--   only WIDEN read access — it cannot restrict any existing reader. Preserved:
--     foxy_chat_messages:
--       "Students see own foxy messages"   (FOR SELECT, get_my_student_id())
--       "Students write own foxy messages" (FOR INSERT)
--       "foxy_chat_messages_service_role"  (service_role, USING/CHECK true)
--     foxy_sessions:
--       "Students see own foxy sessions"        (FOR SELECT)
--       "Students can insert own foxy sessions" (FOR INSERT)
--       "Students can update own foxy sessions" (FOR UPDATE)
--       "Students write own foxy sessions"      (FOR ALL — note: no FOR clause)
--       "foxy_sessions_service_role"            (service_role, USING/CHECK true)
--   None of the above is dropped or altered. The new policies use fresh,
--   non-colliding names so the guarded DROP/CREATE cannot remove them.
--
-- Owner: architect. Phase 2 of feat/portal-rbac-saas-remediation.

BEGIN;

-- =============================================================================
-- 0. Assert RLS is enabled on both target tables (idempotent no-op if already on)
-- =============================================================================
ALTER TABLE "public"."foxy_chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."foxy_sessions"      ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 1. GUARDIAN READ — foxy_chat_messages (the transcript text itself)
-- =============================================================================
-- Approved/active guardian of the child may SELECT that child's message rows.
-- Scope is enforced on the denormalised student_id column via is_guardian_of().
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'foxy_chat_messages'
      AND policyname = 'foxy_chat_messages_guardian_select'
  ) THEN
    DROP POLICY "foxy_chat_messages_guardian_select" ON "public"."foxy_chat_messages";
  END IF;

  CREATE POLICY "foxy_chat_messages_guardian_select"
    ON "public"."foxy_chat_messages"
    FOR SELECT
    TO "authenticated"
    USING ( "public"."is_guardian_of"("student_id") );
END
$$;

-- =============================================================================
-- 2. GUARDIAN READ — foxy_sessions (the session envelope around the transcript)
-- =============================================================================
-- Lets the parent read subject/mode/timestamps that frame the child's chat.
-- Same approved-guardian boundary, enforced on foxy_sessions.student_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'foxy_sessions'
      AND policyname = 'foxy_sessions_guardian_select'
  ) THEN
    DROP POLICY "foxy_sessions_guardian_select" ON "public"."foxy_sessions";
  END IF;

  CREATE POLICY "foxy_sessions_guardian_select"
    ON "public"."foxy_sessions"
    FOR SELECT
    TO "authenticated"
    USING ( "public"."is_guardian_of"("student_id") );
END
$$;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. Both guardian SELECT policies exist and are SELECT-only (cmd = 'r'):
--    SELECT tablename, policyname, cmd, roles
--      FROM pg_policies
--     WHERE schemaname = 'public'
--       AND policyname IN ('foxy_chat_messages_guardian_select',
--                          'foxy_sessions_guardian_select')
--     ORDER BY tablename;
--      -- expect cmd = 'r' (SELECT) for both; roles = {authenticated}
--
-- 2. No guardian write policy was introduced (guardians have SELECT only):
--    SELECT tablename, policyname, cmd
--      FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename IN ('foxy_chat_messages','foxy_sessions')
--     ORDER BY tablename, policyname;
--      -- expect: the only *_guardian_* rows are the two SELECT policies above.
--
-- 3. Scope (run as an approved guardian session): SELECT on foxy_chat_messages
--    returns only rows whose student_id is one of get_my_guardian_student_ids();
--    a guardian NOT linked (or pending) to a student sees zero of that student's
--    rows. is_guardian_of() returns false for status NOT IN ('active','approved').
