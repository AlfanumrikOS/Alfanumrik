-- Migration: 20260613000001_parent_cheers.sql
-- Purpose: Create the `parent_cheers` table — the parent → child encouragement
--          ("cheer") channel. Part of Wave D ("D-encourage").
--
-- Plan: docs/superpowers/plans/2026-06-06-* (Wave D — parent encourage / cheers).
--
-- A cheer is a small, preset-keyed encouragement a parent sends to a linked
-- child. Messages are NEVER free text — only a `message_key` referencing a
-- curated preset catalogue is stored, keeping the channel safe and bilingual.
-- The companion `notification_id` links each cheer to the in-app notification
-- that surfaces it to the child (notification rows are written server-side via
-- the service role; see the notif_service_insert policy in the baseline).
--
-- ─── RLS design ──────────────────────────────────────────────────────────────
-- Helper functions used (both confirmed present in
-- `00000000000000_baseline_from_prod.sql`):
--   * public.get_my_student_id()  — line 8979; resolves the active student row
--                                   for auth.uid(). Same helper the baseline's
--                                   notif_own policy uses for student reads.
--   * public.get_my_guardian_id() — line 8958; resolves the guardian row for
--                                   auth.uid(). Same helper the baseline's
--                                   gsl_own_select / notif_own policies use.
-- The guardian-select policy additionally constrains visibility to children the
-- guardian is actively linked to via guardian_student_links (status active OR
-- approved — both are valid per the chk_link_status CHECK in the baseline).
--
-- All writes flow through the service role (supabaseAdmin) inside the route, so
-- the only INSERT policy is service-role; there is deliberately NO client or
-- guardian INSERT policy (mirrors notif_service_insert in the baseline).
--
-- Idempotent throughout: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- and every policy is DROP POLICY IF EXISTS + CREATE POLICY so re-apply is a
-- no-op. No DROP TABLE. No destructive operations.

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.parent_cheers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id UUID NOT NULL REFERENCES public.guardians(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  cheer_type TEXT NOT NULL DEFAULT 'generic'
    CHECK (cheer_type IN ('generic', 'streak', 'quiz', 'effort', 'milestone')),
  message_key TEXT,  -- preset key into the curated cheer catalogue; NEVER free text
  notification_id UUID REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. Indexes (idempotent) ─────────────────────────────────────────────────

-- Child timeline: "show me cheers sent to this student, newest first".
CREATE INDEX IF NOT EXISTS idx_parent_cheers_student_created
  ON public.parent_cheers (student_id, created_at DESC);

-- Guardian timeline: "show me cheers this guardian sent, newest first".
CREATE INDEX IF NOT EXISTS idx_parent_cheers_guardian_created
  ON public.parent_cheers (guardian_id, created_at DESC);

-- Rate-limit lookup: count recent cheers from this guardian to this child.
CREATE INDEX IF NOT EXISTS idx_parent_cheers_guardian_student_created
  ON public.parent_cheers (guardian_id, student_id, created_at DESC);

-- ─── 3. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.parent_cheers ENABLE ROW LEVEL SECURITY;

-- (a) Student reads own cheers.
--     Mirrors the baseline notif_own student branch: recipient_id = get_my_student_id().
DROP POLICY IF EXISTS parent_cheers_student_select ON public.parent_cheers;
CREATE POLICY parent_cheers_student_select ON public.parent_cheers
  FOR SELECT
  USING (student_id = public.get_my_student_id());

-- (b) Guardian reads cheers they sent to a child they are actively linked to.
--     get_my_guardian_id() resolves the caller's guardian row; the link check
--     constrains to children the guardian is actively (active/approved) linked to.
DROP POLICY IF EXISTS parent_cheers_guardian_select ON public.parent_cheers;
CREATE POLICY parent_cheers_guardian_select ON public.parent_cheers
  FOR SELECT
  USING (
    guardian_id = public.get_my_guardian_id()
    AND student_id IN (
      SELECT gsl.student_id
        FROM public.guardian_student_links gsl
       WHERE gsl.guardian_id = public.get_my_guardian_id()
         AND gsl.status IN ('active', 'approved')
    )
  );

-- (c) Service-role insert. All cheer writes go through the route via
--     supabaseAdmin (service role). There is intentionally NO client/guardian
--     INSERT policy — mirrors notif_service_insert in the baseline.
DROP POLICY IF EXISTS parent_cheers_service_insert ON public.parent_cheers;
CREATE POLICY parent_cheers_service_insert ON public.parent_cheers
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- (d) Teacher: intentionally NO policy. Cheers are a private parent↔child
--     channel; teachers must NOT see them. This omission is deliberate — do not
--     add a teacher SELECT policy here. (Admin/super-admin read via the service
--     role, which bypasses RLS.)

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT polname, cmd FROM pg_policies WHERE tablename = 'parent_cheers' ORDER BY polname;
--   Expected: parent_cheers_guardian_select (SELECT),
--             parent_cheers_service_insert  (INSERT),
--             parent_cheers_student_select  (SELECT).
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'parent_cheers';  -- expect: t
