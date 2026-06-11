-- Migration: 20260616010000_principal_ai_assistant_v1.sql
-- Purpose: Track 2 "Principal AI Assistant" v1 — conversational assistant for
--          school principals over their OWN school's aggregate command-center
--          signals. Creates the two persistence tables (principal_ai_sessions /
--          principal_ai_messages) with service-role-only RLS (P8), the supporting
--          indexes, and the read-only context RPC get_principal_ai_context() that
--          bundles the existing Phase 3B school read-models plus syllabus
--          content-readiness for the principal's school.
--
-- STATUS: DRAFTED FOR CEO REVIEW — NOT APPLIED. No db push / migration up has
--          been run. Design is CEO-approved; this file is the SQL for sign-off
--          before anything touches a database.
--
-- Model: provenance captured per-message via principal_ai_messages.model
--        (REG-67). Schema is model-agnostic; the route stamps the model id.
--
-- Mirrors: 20260529000000_alfabot_v1.sql (alfabot_sessions / alfabot_messages
--          shape, service-role-only RLS, index layout). The composing read-model
--          RPCs are Phase 3B Wave A/D (20260614000000, 20260614000003).
--
-- Retention:
--   principal_ai_sessions / principal_ai_messages — recommend a 90-day TTL via a
--   future daily-cron purge step (table comment carries the hint, same pattern as
--   alfabot). messages purge via ON DELETE CASCADE when the parent session purges.
--
-- ─── Scope / safety contract ─────────────────────────────────────────────────
--   - The two tables are service-role-only (RLS USING(false)/WITH CHECK(false)
--     for anon + authenticated). The Next.js route writes/reads them with the
--     service-role admin client ONLY AFTER authorizeSchoolAdmin() has resolved a
--     SESSION-DERIVED school_id. No client ever touches these tables directly.
--   - The context RPC is SECURITY DEFINER, search_path-pinned, EXECUTE granted to
--     service_role ONLY (REVOKE PUBLIC/anon/authenticated). Read-only: it COMPOSES
--     the existing read-model RPCs + a single scoped SELECT over cbse_syllabus.
--     No INSERT/UPDATE/DELETE, no dynamic SQL, only the typed p_school_id param.
--   - The route MUST pass authorizeSchoolAdmin()'s resolved schoolId as
--     p_school_id — NEVER a client-supplied value.
--
-- DOWN (manual, ops-only — never run automatically):
--   DROP FUNCTION IF EXISTS public.get_principal_ai_context(uuid);
--   DROP TABLE IF EXISTS public.principal_ai_messages;
--   DROP TABLE IF EXISTS public.principal_ai_sessions;

-- =====================================================================
-- 1. Tables
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.principal_ai_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- The principal (auth user) who opened the session. Session-derived, never
  -- client-supplied; the route writes auth.userId from authorizeSchoolAdmin.
  auth_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The caller's school_admins.role captured at session open (provenance for the
  -- 'institution.use_principal_ai' capability that gated entry — v1 = principal).
  school_admin_role TEXT,
  lang              TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','hi')),
  message_count     INT  NOT NULL DEFAULT 0,
  last_message_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.principal_ai_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES public.principal_ai_sessions(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content       TEXT NOT NULL,
  sources       JSONB,
  tokens_used   INT,
  latency_ms    INT,
  degraded_mode BOOLEAN NOT NULL DEFAULT false,
  -- Model provenance (REG-67): which model produced an assistant turn. NULL for
  -- 'user' rows. Schema is model-agnostic; the route stamps the id.
  model         TEXT,
  -- Populated when the assistant declined to answer (out-of-scope / no signal),
  -- so abstentions are auditable distinct from normal answers.
  abstain_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. Table comments (ops audit + future daily-cron purge hint)
-- =====================================================================
COMMENT ON TABLE public.principal_ai_sessions IS
  'Principal AI Assistant v1 — one row per principal chat session, scoped to '
  'school_id. Service-role-only (RLS). Recommend 90-day TTL via daily-cron purge.';
COMMENT ON TABLE public.principal_ai_messages IS
  'Principal AI Assistant v1 — chat turns. model column = REG-67 provenance. '
  'Purged by ON DELETE CASCADE when the parent session is purged.';

-- =====================================================================
-- 3. Indexes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_principal_ai_sessions_school_lastmsg
  ON public.principal_ai_sessions (school_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_principal_ai_messages_session
  ON public.principal_ai_messages (session_id, created_at);

-- =====================================================================
-- 4. RLS — service-role-only on BOTH tables (P8).
--
-- Pattern matrix (P8) for these tables:
--   - Student reads own:        N/A (no student_id; principal-keyed, school-scoped)
--   - Parent reads linked:      N/A
--   - Teacher reads assigned:   N/A
--   - Admin (service role):     bypasses RLS implicitly; the ONLY accessor.
--
-- READ-POLICY DECISION (documented per requirement):
--   We chose SERVICE-ROLE-ONLY for BOTH read and write (anon + authenticated are
--   explicitly denied with USING(false)/WITH CHECK(false)) — the SAME canonical
--   no-anon pattern alfabot_sessions/alfabot_messages use.
--
--   Justification:
--     1. The chat surface is server-mediated. Every read/write goes through a
--        Next.js route that has ALREADY run authorizeSchoolAdmin() (JWT + RBAC
--        'institution.use_principal_ai' + active-school resolution) and then uses
--        the service-role admin client. There is no client-direct Supabase query
--        path to these tables, so a school_id-scoped authenticated SELECT policy
--        would add attack surface (a leaked/lower-priv authenticated JWT could
--        read sibling principals' transcripts at THIS school) without enabling any
--        feature the route does not already serve via service role.
--     2. It exactly mirrors the established alfabot precedent, keeping one mental
--        model for "server-mediated AI chat persistence" across the codebase.
--     3. NO PII beyond what a principal already sees: the stored content is the
--        principal's own questions + aggregate-only answers (see the context RPC,
--        which returns group-level rows only — never per-student names/emails/ids).
--   The route is the tenant boundary; it scopes every query to the
--   authorizeSchoolAdmin-resolved school_id, never a client value.
-- =====================================================================

ALTER TABLE public.principal_ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.principal_ai_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'principal_ai_sessions'
      AND policyname = 'principal_ai_sessions_no_anon'
  ) THEN
    CREATE POLICY principal_ai_sessions_no_anon ON public.principal_ai_sessions
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'principal_ai_messages'
      AND policyname = 'principal_ai_messages_no_anon'
  ) THEN
    CREATE POLICY principal_ai_messages_no_anon ON public.principal_ai_messages
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- =====================================================================
-- 5. Context RPC — get_principal_ai_context(p_school_id)
--
-- Returns ONE jsonb bundle, ALL scoped to p_school_id, composing the existing
-- Phase 3B read-model RPCs plus a syllabus content-readiness rollup:
--   - overview         : get_school_overview            (counts, seats, util, mastery)
--   - classes_at_risk  : get_classes_at_risk (top 5)    (per-class risk)
--   - teacher_engagement: get_teacher_engagement (top 10)
--   - mastery_by_subject: get_school_mastery_rollup('subject')
--   - syllabus_readiness: cbse_syllabus ready/partial/missing counts for the
--                         school's active grades (P5: grades are TEXT).
--
-- SECURITY DEFINER + search_path pinned. EXECUTE granted to service_role ONLY.
-- The composing RPCs each run their OWN active-school_admin scope guard; this RPC
-- runs the SAME guard up front so a direct service-role call still validates the
-- caller is the principal of p_school_id (defense in depth; the route always
-- passes the authorizeSchoolAdmin-resolved school_id).
--
-- INJECTION-SAFETY: no dynamic SQL; the only input is the typed uuid p_school_id.
-- READ-ONLY: composes read-model RPCs + a single scoped SELECT; no source
-- mutation of any kind.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_principal_ai_context(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_overview      jsonb;
  v_at_risk       jsonb;
  v_teachers      jsonb;
  v_mastery_subj  jsonb;
  v_syllabus      jsonb;
BEGIN
  -- School-scope guard: caller must be an ACTIVE admin of THIS school. Same guard
  -- the composed RPCs use; fail fast here so a direct service-role call without a
  -- valid principal context is rejected too.
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- 1. Overview snapshot (aggregate counts only; no PII).
  v_overview := public.get_school_overview(p_school_id);

  -- 2. Top at-risk classes (group-level rows; no per-student ids). Cap at 5.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'class_id',      r.class_id,
             'class_name',    r.class_name,
             'grade',         r.grade,
             'student_count', r.student_count,
             'at_risk_count', r.at_risk_count,
             'avg_mastery',   r.avg_mastery
           )
           ORDER BY r.at_risk_count DESC, r.avg_mastery ASC NULLS LAST
         ), '[]'::jsonb)
    INTO v_at_risk
  FROM public.get_classes_at_risk(p_school_id, 5, 0) r;

  -- 3. Teacher engagement summary (top 10; aggregate per-teacher rows).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'teacher_id',                 t.teacher_id,
             'teacher_name',               t.teacher_name,
             'class_count',                t.class_count,
             'remediation_assigned_count', t.remediation_assigned_count,
             'remediation_resolved_count', t.remediation_resolved_count
           )
           ORDER BY t.remediation_assigned_count DESC, t.teacher_name ASC
         ), '[]'::jsonb)
    INTO v_teachers
  FROM public.get_teacher_engagement(p_school_id, 10, 0) t;

  -- 4. Subject-level mastery rollup (group-level comparatives; no student ids).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'subject',       m.group_key,
             'label',         m.group_label,
             'student_count', m.student_count,
             'avg_mastery',   m.avg_mastery,
             'at_risk_count', m.at_risk_count
           )
           ORDER BY m.at_risk_count DESC, m.avg_mastery ASC NULLS LAST
         ), '[]'::jsonb)
    INTO v_mastery_subj
  FROM public.get_school_mastery_rollup(p_school_id, 'subject') m;

  -- 5. Syllabus content-readiness for the school's ACTIVE grades.
  --    The school's grade set = DISTINCT grade over its active, non-deleted
  --    classes (P5: grade is TEXT, e.g. '7'). We count cbse_syllabus chapters by
  --    rag_status (ready / partial / missing) restricted to in-scope rows for
  --    those grades. board defaults to 'CBSE' (the only board cbse_syllabus
  --    carries today); kept explicit so a future multi-board change is a one-line
  --    edit here, not a silent broadening.
  WITH school_grades AS (
    SELECT DISTINCT c.grade
    FROM public.classes c
    WHERE c.school_id = p_school_id
      AND c.is_active
      AND c.deleted_at IS NULL
      AND c.grade IS NOT NULL
  ),
  syll AS (
    SELECT cs.rag_status
    FROM public.cbse_syllabus cs
    JOIN school_grades sg ON sg.grade = cs.grade
    WHERE cs.board = 'CBSE'
      AND cs.is_in_scope
  )
  SELECT jsonb_build_object(
    'grades',        COALESCE((SELECT jsonb_agg(grade ORDER BY grade) FROM school_grades), '[]'::jsonb),
    'ready_count',   count(*) FILTER (WHERE rag_status = 'ready'),
    'partial_count', count(*) FILTER (WHERE rag_status = 'partial'),
    'missing_count', count(*) FILTER (WHERE rag_status = 'missing'),
    'total_chapters', count(*)
  )
  INTO v_syllabus
  FROM syll;

  RETURN jsonb_build_object(
    'school_id',          p_school_id,
    'overview',           v_overview,
    'classes_at_risk',    v_at_risk,
    'teacher_engagement', v_teachers,
    'mastery_by_subject', v_mastery_subj,
    'syllabus_readiness', COALESCE(v_syllabus, jsonb_build_object(
                            'grades', '[]'::jsonb,
                            'ready_count', 0, 'partial_count', 0,
                            'missing_count', 0, 'total_chapters', 0)),
    'generated_at',       now()
  );
END;
$$;

COMMENT ON FUNCTION public.get_principal_ai_context(uuid) IS
  'Principal AI Assistant v1 context bundle: ONE PII-SAFE jsonb scoped to '
  'p_school_id composing get_school_overview, get_classes_at_risk(top 5), '
  'get_teacher_engagement(top 10), get_school_mastery_rollup(subject), and a '
  'cbse_syllabus ready/partial/missing rollup for the school''s active grades. '
  'AGGREGATES ONLY — group-level rows, no per-student names/emails/ids. '
  'SECURITY DEFINER + active-school_admin scope guard, search_path-pinned, '
  'no dynamic SQL (typed p_school_id only). EXECUTE = service_role ONLY. '
  'Read-only. The route MUST pass the authorizeSchoolAdmin-resolved schoolId, '
  'never a client value.';

-- =====================================================================
-- 6. Grants — service_role ONLY (REVOKE PUBLIC / anon / authenticated).
-- The RPC is invoked by the server route through the service-role admin client
-- after authorizeSchoolAdmin; no authenticated/anon caller may execute it.
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.get_principal_ai_context(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_principal_ai_context(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_principal_ai_context(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_principal_ai_context(uuid) TO service_role;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- As the service role, simulating the principal of <school_uuid> (set auth.uid()
-- to that principal's user id via the route's admin client):
--   SELECT public.get_principal_ai_context('<school_uuid>');   -- PII-safe jsonb bundle
-- A direct call where auth.uid() is not an active admin of the school RAISES 42501.
-- RLS smoke: as an authenticated (non-service) role,
--   SELECT * FROM public.principal_ai_sessions;  -- returns 0 rows (USING false)
--   INSERT INTO public.principal_ai_messages(...);-- denied (WITH CHECK false)
