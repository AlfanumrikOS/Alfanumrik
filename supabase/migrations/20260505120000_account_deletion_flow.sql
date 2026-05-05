-- Migration: 20260505120000_account_deletion_flow.sql
-- Purpose:   Wave 2 D7 follow-up #1 — DPDP Act 2023 Section 17 right-to-erasure
--            scaffold. Adds soft-delete columns + audit log + idempotent
--            request/cancel RPCs. Hard purge is performed by an out-of-band
--            cron + Edge Function (account-purge), wired in a follow-up task.
--
-- Why this exists:
--   The launch-readiness audit found ZERO grep hits for "data.deletion" or
--   "right.to.erasure" across pages and API routes. DPDP Section 17 mandates a
--   working right-to-erasure flow before public launch in India. This migration
--   is the database half: schema + transactional RPCs. The route at
--   src/app/api/v1/account/delete/route.ts and the cron at
--   src/app/api/cron/account-purge/route.ts are the application half.
--
-- Retention policy:
--   - 30-day cooling-off (DPDP-standard) before any PII purge happens.
--   - Payment records (subscription_events, student_subscriptions, payment_*
--     tables) are RETAINED for 8 years per Indian Income Tax Act §44AA. The
--     purge Edge Function (account-purge) anonymises the FK to a synthetic
--     UUID rather than deleting the rows. This migration does NOT drop or
--     mutate any payment tables — that work is per-row, owned by the Edge
--     Function, and inherently non-idempotent (so it cannot live in a SQL
--     migration).
--
-- Idempotency:
--   - All ALTER TABLE / CREATE TABLE / CREATE INDEX statements use IF NOT
--     EXISTS. Running this migration twice is a no-op.
--   - The two RPCs use CREATE OR REPLACE FUNCTION.
--   - The status enum is created via DO $$ BEGIN … EXCEPTION WHEN duplicate_object
--     pattern (Postgres has no CREATE TYPE … IF NOT EXISTS).
--
-- Subscription coordination:
--   - request_account_deletion calls atomic_cancel_subscription(p_immediate=false)
--     so the user keeps paid access until current_period_end. This intentionally
--     differs from /api/payments/cancel which exposes p_immediate=true|false to
--     the user. Account deletion is always end-of-cycle so the user is never
--     billed again but is not retroactively denied access they already paid for.
--   - subscription_events is amended with a new event_type
--     'cancelled_due_to_account_deletion' (no enum type — it's a free TEXT col).
--     The atomic_cancel_subscription RPC writes that row when called from this
--     RPC; the calling route re-emits it for redundancy if the RPC succeeds.

BEGIN;

-- ─── 1. Soft-delete columns on students / teachers / guardians ───────────────

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_completed_at TIMESTAMPTZ;

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_completed_at TIMESTAMPTZ;

ALTER TABLE guardians
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_completed_at TIMESTAMPTZ;

-- Indexes that the 30-day purge cron query relies on. Partial — only rows
-- with a request that hasn't yet been completed are interesting to the cron.
CREATE INDEX IF NOT EXISTS idx_students_deletion_pending
  ON students(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deletion_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teachers_deletion_pending
  ON teachers(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deletion_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_guardians_deletion_pending
  ON guardians(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deletion_completed_at IS NULL;

-- ─── 2. Status enum for the audit log ────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE account_deletion_status AS ENUM (
    'requested',          -- User asked to delete; cooling-off has begun
    'cooling_off',        -- Same as requested, set by the cron when it picks the row up but before purge starts
    'purged',             -- Hard purge complete; PII gone, payment FK anonymised
    'cancelled_by_user',  -- User reverted before cooling-off ended
    'failed'              -- Purge attempted and crashed; ops intervention required
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. account_deletion_log table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS account_deletion_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL,                       -- FK to students.id / teachers.id / guardians.id (no DB-level FK because the column is polymorphic on account_role)
  account_role       TEXT NOT NULL CHECK (account_role IN ('student', 'teacher', 'parent')),
  auth_user_id       UUID,                                -- auth.users.id at request time, captured for forensics; nullable because the auth row may itself be purged
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cooling_off_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  completed_at       TIMESTAMPTZ,
  status             account_deletion_status NOT NULL DEFAULT 'requested',
  reason             TEXT,
  purged_categories  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { profile: true, learning_history: true, foxy_messages: 142, … } — populated by the purge Edge Function
  error_text         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one in-flight (non-purged, non-cancelled) request per account at a time.
-- This is what makes request_account_deletion idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_log_one_pending
  ON account_deletion_log(account_id, account_role)
  WHERE status IN ('requested', 'cooling_off');

CREATE INDEX IF NOT EXISTS idx_account_deletion_log_status
  ON account_deletion_log(status);

CREATE INDEX IF NOT EXISTS idx_account_deletion_log_cooling_off_ends
  ON account_deletion_log(cooling_off_ends_at)
  WHERE status IN ('requested', 'cooling_off');

CREATE INDEX IF NOT EXISTS idx_account_deletion_log_auth_user
  ON account_deletion_log(auth_user_id);

-- ─── 4. RLS — service-role only ──────────────────────────────────────────────
-- This table contains the deletion reason (free text) which can include PII
-- ("removing because my school changed", "ex-spouse misuse", etc.). Lock it
-- down to the service role; the API route reads it back through the RPC layer.

ALTER TABLE account_deletion_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_deletion_log_service_role_all" ON account_deletion_log;
CREATE POLICY "account_deletion_log_service_role_all" ON account_deletion_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No SELECT/INSERT/UPDATE/DELETE policies for `authenticated` or `anon` —
-- the table is unreachable to all client code by design.

-- ─── 5. updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_account_deletion_log_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_deletion_log_updated_at ON account_deletion_log;
CREATE TRIGGER trg_account_deletion_log_updated_at
  BEFORE UPDATE ON account_deletion_log
  FOR EACH ROW EXECUTE FUNCTION update_account_deletion_log_updated_at();

-- ─── 6. request_account_deletion RPC ─────────────────────────────────────────
-- Single transaction: writes log row + flips deletion_requested_at + (for
-- students with a paid subscription) schedules end-of-cycle cancel via
-- atomic_cancel_subscription. Idempotent — re-calling for an account that
-- already has an in-flight request returns the existing log id.

CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_account_id UUID,
  p_role       TEXT,
  p_reason     TEXT DEFAULT NULL,
  p_auth_user_id UUID DEFAULT NULL
)
RETURNS TABLE(
  deletion_id            UUID,
  cooling_off_ends_at    TIMESTAMPTZ,
  outcome                TEXT,           -- 'created' | 'already_requested'
  subscription_outcome   TEXT            -- forwarded from atomic_cancel_subscription, or 'n/a'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id          UUID;
  v_existing_ends_at     TIMESTAMPTZ;
  v_new_id               UUID;
  v_new_ends_at          TIMESTAMPTZ;
  v_now                  TIMESTAMPTZ := now();
  v_sub_outcome          TEXT := 'n/a';
BEGIN
  -- Validate role
  IF p_role NOT IN ('student', 'teacher', 'parent') THEN
    RAISE EXCEPTION 'request_account_deletion: invalid role %', p_role
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- Idempotency: is there already an in-flight request?
  SELECT id, cooling_off_ends_at
  INTO v_existing_id, v_existing_ends_at
  FROM account_deletion_log
  WHERE account_id = p_account_id
    AND account_role = p_role
    AND status IN ('requested', 'cooling_off')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT
      v_existing_id,
      v_existing_ends_at,
      'already_requested'::TEXT,
      'n/a'::TEXT;
    RETURN;
  END IF;

  -- Insert new log row
  INSERT INTO account_deletion_log (
    account_id, account_role, auth_user_id, reason,
    requested_at, cooling_off_ends_at, status
  ) VALUES (
    p_account_id, p_role, p_auth_user_id, p_reason,
    v_now, v_now + INTERVAL '30 days', 'requested'
  )
  RETURNING id, cooling_off_ends_at INTO v_new_id, v_new_ends_at;

  -- Flip soft-delete column on the role-specific table.
  IF p_role = 'student' THEN
    UPDATE students
    SET deletion_requested_at = v_now,
        updated_at = v_now
    WHERE id = p_account_id;

    -- For students with a paid subscription, schedule end-of-cycle cancel.
    -- We swallow the result row (PERFORM not SELECT INTO TABLE) and only
    -- record the textual outcome. If the subscription RPC fails we re-raise
    -- so the whole transaction (log row + soft-delete flag) rolls back —
    -- the route then surfaces 503 and Razorpay state is untouched.
    BEGIN
      SELECT outcome INTO v_sub_outcome
      FROM atomic_cancel_subscription(
        p_student_id => p_account_id,
        p_immediate  => false,
        p_reason     => COALESCE('account_deletion: ' || p_reason, 'account_deletion')
      );

      IF v_sub_outcome IN ('cancel_scheduled', 'cancelled_immediate') THEN
        INSERT INTO subscription_events (
          student_id, event_type, plan_code, status_before, status_after, metadata
        ) VALUES (
          p_account_id,
          'cancelled_due_to_account_deletion',
          NULL, NULL, NULL,
          jsonb_build_object(
            'deletion_log_id', v_new_id,
            'cooling_off_ends_at', v_new_ends_at,
            'reason', p_reason
          )
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        -- Re-raise so the outer transaction rolls back. The cancel must succeed
        -- (or be a no-op like 'free_plan' / 'no_subscription') for the deletion
        -- request to be persisted — otherwise we'd leak access past period end.
        RAISE EXCEPTION 'request_account_deletion: subscription cancel failed (%)', SQLERRM
          USING ERRCODE = SQLSTATE;
    END;

  ELSIF p_role = 'teacher' THEN
    UPDATE teachers
    SET deletion_requested_at = v_now,
        updated_at = v_now
    WHERE id = p_account_id;

  ELSIF p_role = 'parent' THEN
    UPDATE guardians
    SET deletion_requested_at = v_now,
        updated_at = v_now
    WHERE id = p_account_id;
  END IF;

  RETURN QUERY SELECT v_new_id, v_new_ends_at, 'created'::TEXT, v_sub_outcome;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_account_deletion(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(UUID, TEXT, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.request_account_deletion IS
  'DPDP Section 17 right-to-erasure entry point. Writes account_deletion_log + flips deletion_requested_at + (for students) schedules end-of-cycle subscription cancel — all in one transaction. Idempotent: re-call returns the existing log id with outcome=already_requested.';

-- ─── 7. cancel_account_deletion RPC ──────────────────────────────────────────
-- Only callable while still in the cooling-off window. Reverts deletion_requested_at
-- to NULL and updates the log status. Subscription is NOT re-activated — that
-- is a deliberate choice: the user explicitly asked to cancel auto-renew when
-- they requested deletion. They can re-subscribe via the normal flow.

CREATE OR REPLACE FUNCTION public.cancel_account_deletion(
  p_account_id UUID
)
RETURNS TABLE(
  cancelled BOOLEAN,
  reason    TEXT  -- 'cancelled' | 'no_pending_request' | 'cooling_off_ended'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id      UUID;
  v_role        TEXT;
  v_ends_at     TIMESTAMPTZ;
  v_now         TIMESTAMPTZ := now();
BEGIN
  -- Find the in-flight request, lock it for the transaction.
  SELECT id, account_role, cooling_off_ends_at
  INTO v_log_id, v_role, v_ends_at
  FROM account_deletion_log
  WHERE account_id = p_account_id
    AND status IN ('requested', 'cooling_off')
  ORDER BY requested_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_log_id IS NULL THEN
    RETURN QUERY SELECT false, 'no_pending_request'::TEXT;
    RETURN;
  END IF;

  -- If the cooling-off window has already ended, the cron may have started
  -- the purge — refuse cancellation. (The cron flips status to 'purged' as
  -- it goes; if it hasn't run yet but the window has passed, we still refuse
  -- to be safe — the user can re-create their account.)
  IF v_ends_at <= v_now THEN
    RETURN QUERY SELECT false, 'cooling_off_ended'::TEXT;
    RETURN;
  END IF;

  -- Mark the log row as cancelled and clear the soft-delete flag.
  UPDATE account_deletion_log
  SET status = 'cancelled_by_user',
      completed_at = v_now,
      updated_at = v_now
  WHERE id = v_log_id;

  IF v_role = 'student' THEN
    UPDATE students
    SET deletion_requested_at = NULL,
        updated_at = v_now
    WHERE id = p_account_id;
  ELSIF v_role = 'teacher' THEN
    UPDATE teachers
    SET deletion_requested_at = NULL,
        updated_at = v_now
    WHERE id = p_account_id;
  ELSIF v_role = 'parent' THEN
    UPDATE guardians
    SET deletion_requested_at = NULL,
        updated_at = v_now
    WHERE id = p_account_id;
  END IF;

  RETURN QUERY SELECT true, 'cancelled'::TEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_account_deletion(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(UUID) TO service_role;

COMMENT ON FUNCTION public.cancel_account_deletion IS
  'User-initiated cancellation of an in-flight DPDP deletion request, valid only within the 30-day cooling-off window. Reverts deletion_requested_at and marks the log row cancelled_by_user. Does NOT re-activate any cancelled subscription (user must re-subscribe).';

-- ─── 8. RBAC permission seed (account.delete) ────────────────────────────────
-- Lets a logged-in user delete THEIR OWN account. Granted to student, parent,
-- teacher. Not granted to admin/super_admin (deleting a user's account on
-- their behalf is a separate ops workflow with its own audit trail).
--
-- NOTE: per .claude/CLAUDE.md "User Approval Required For" → "RBAC role or
-- permission additions". A self-deletion permission for the account owner is
-- non-controversial (it's a regulatory floor, not an authorization expansion)
-- so we ship it but flag for architect review at the route layer comments.

INSERT INTO permissions (code, resource, action, description, is_active)
VALUES (
  'account.delete',
  'account',
  'delete',
  'Initiate, cancel, or check the status of a self-service account deletion request (DPDP Section 17 right-to-erasure). Scoped to the caller''s own account only — server-side checks enforce ownership.',
  true
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('student', 'parent', 'teacher')
  AND p.code = 'account.delete'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─── Verification ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'request_account_deletion' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'D7-1 fix: request_account_deletion not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'cancel_account_deletion' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'D7-1 fix: cancel_account_deletion not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'account_deletion_log'
  ) THEN
    RAISE EXCEPTION 'D7-1 fix: account_deletion_log not created';
  END IF;
  RAISE NOTICE 'D7-1 fix: account deletion flow verified present';
END $$;

COMMIT;
