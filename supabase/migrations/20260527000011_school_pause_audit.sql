-- 20260527000011_school_pause_audit.sql
--
-- Super-admin pause/resume workflow for schools.
--
-- Today, gating tenant access requires a super-admin to manually SQL-edit
-- `schools.is_active` in prod. That's error-prone — fat-fingering the WHERE
-- clause can pause the wrong school. The pause/resume route pair in
-- `/api/super-admin/institutions/[id]/{pause,resume}` adds a guarded
-- workflow (operator must retype the school name) and records *why* and
-- *who* paused.
--
-- This migration adds the three audit columns the route pair writes:
--
--   - `paused_at`                      — when the pause happened
--   - `paused_by_super_admin_id`       — FK to `admin_users.id` (the actor
--                                        table — see src/lib/admin-auth.ts:
--                                        `authorizeAdmin` returns `adminId`
--                                        from this table)
--   - `pause_reason`                   — free-text justification, surfaced
--                                        in the operator dashboard
--
-- Plus a partial index on `is_active` filtered to the small set of paused
-- schools, so the operator dashboard's "currently paused" query is O(paused)
-- rather than O(all schools).
--
-- NOTE: we deliberately do NOT touch `schools.is_active` itself — it already
-- exists and other code paths (auth gates, subscription checks) already
-- read it. Pause/resume just sets it to `false`/`true`. The new columns
-- carry the audit context the boolean alone can't.

BEGIN;

-- 1. Audit columns. IF NOT EXISTS makes this idempotent — safe to re-run.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_by_super_admin_id uuid REFERENCES public.admin_users(id),
  ADD COLUMN IF NOT EXISTS pause_reason text;

COMMENT ON COLUMN public.schools.paused_at IS
  'When the school was last paused by a super-admin (NULL once resumed). Set by /api/super-admin/institutions/[id]/pause.';
COMMENT ON COLUMN public.schools.paused_by_super_admin_id IS
  'admin_users.id of the super-admin who paused this school. NULL once resumed.';
COMMENT ON COLUMN public.schools.pause_reason IS
  'Free-text justification supplied at pause time. Required by the API (>= 10 chars). Cleared on resume.';

-- 2. Partial index on the paused set. Operators want to list "what is
-- currently paused" — that set is small (single-digit %), so a partial
-- index keyed on `is_active = false` is cheap and avoids scanning the full
-- table. Filtering `deleted_at IS NULL` keeps soft-deleted rows out of the
-- operator's view.
CREATE INDEX IF NOT EXISTS idx_schools_paused
  ON public.schools (paused_at DESC)
  WHERE is_active = false AND deleted_at IS NULL;

COMMIT;
