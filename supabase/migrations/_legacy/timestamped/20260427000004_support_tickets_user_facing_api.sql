-- Migration: 20260427000004_support_tickets_user_facing_api
-- Purpose: Enable end-user-facing support ticket creation (Audit F22).
--
-- The `support_tickets` table existed already (migration 20260322070714)
-- but is missing:
--   - `priority` column (low|normal|high)
--   - RLS policies for users to insert/select their own tickets
--
-- This migration is fully additive and idempotent — safe to apply on top
-- of any existing state.

-- ── 1. Add priority column ────────────────────────────────────────────
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high'));

-- Index for super-admin filtering by priority
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority
  ON public.support_tickets (priority);

-- ── 2. Ensure RLS is on ───────────────────────────────────────────────
-- RLS may already be enabled by the original migration; ENABLE is idempotent.
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- ── 3. End-user policies ──────────────────────────────────────────────
-- A logged-in student can create a ticket for themselves and read
-- only their own tickets. Service role still bypasses RLS for admin
-- ops and the super-admin viewer.

-- Drop policies first so re-applying the migration replaces them cleanly.
DROP POLICY IF EXISTS support_tickets_self_insert  ON public.support_tickets;
DROP POLICY IF EXISTS support_tickets_self_select  ON public.support_tickets;

-- INSERT: a user can create a ticket only when student_id resolves to
-- a `students` row owned by them. We allow guest tickets (student_id IS
-- NULL) only via the service-role path — RLS blocks anonymous inserts.
CREATE POLICY support_tickets_self_insert
  ON public.support_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id IS NOT NULL
    AND student_id IN (
      SELECT id FROM public.students WHERE auth_user_id = auth.uid()
    )
  );

-- SELECT: a user can read tickets they own.
CREATE POLICY support_tickets_self_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students WHERE auth_user_id = auth.uid()
    )
  );

-- NOTE: UPDATE/DELETE are intentionally NOT granted to end users.
-- Tickets are append-only from the user's side; admins use the
-- service-role super-admin route to mutate.

COMMENT ON POLICY support_tickets_self_insert ON public.support_tickets IS
  'F22 — authenticated users may create tickets for themselves only.';
COMMENT ON POLICY support_tickets_self_select ON public.support_tickets IS
  'F22 — authenticated users may read only their own tickets.';
