-- Phase D.3 — DPDP §15 right-to-erasure for parent-initiated child-data deletion.
--
-- Two-stage design — NEVER an immediate delete from the API.
--
-- Stage 1 (request):
--   A guardian clicks "Delete my child's data" on the parent surface. The route
--   creates a `pending` row with `purge_at = now() + 7 days`. We email a
--   confirmation, log to audit_logs, and emit `parent.child_erasure_requested`
--   on the state-events bus. The 7-day window gives the guardian time to
--   cancel; cancellation flips `status='cancelled'` and emits
--   `parent.child_erasure_cancelled`.
--
-- Stage 2 (purge):
--   A pg_cron job hits `data-erasure-purger` every 6h. The function picks
--   rows where `status='pending' AND purge_at <= now()`, marks `purging`,
--   runs the cascade DELETE per docs/runbooks/per-school-backup-restore.md §7,
--   marks `completed`, and emits `parent.child_erasure_completed`. On any
--   failure: `failed` + error_message + ops alert. ≤30 days SLA per the
--   runbook is met by the 7-day grace + 6h cron cadence.
--
-- Idempotency:
--   - The (guardian_id, student_id) pair is NOT made UNIQUE — a guardian can
--     re-request after a cancellation, and a second guardian may also request.
--     The route checks "pending row exists?" before insert; the cron skips
--     non-`pending` rows. Both layers are idempotent.
--
-- RLS:
--   - guardian sees their own rows.
--   - school_admin sees their school's rows (for ops visibility).
--   - service-role bypass (route writes, cron purges).
--   - Deny-by-default for anon.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_erasure_status') THEN
    CREATE TYPE public.data_erasure_status AS ENUM (
      'pending',     -- inside the 7-day grace window; guardian can cancel.
      'cancelled',   -- guardian cancelled before purge_at.
      'purging',     -- cron picked the row and started the cascade.
      'completed',   -- cascade finished; data erased.
      'failed'       -- cascade aborted; ops must inspect error_message.
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.data_erasure_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who asked. Soft FK — we don't ON DELETE CASCADE because if the guardian
  -- row is itself purged, we still want the audit trail of this request.
  guardian_id     uuid NOT NULL,
  -- Whose data. Likewise soft FK; the cron DELETEs the student row last so
  -- a completed row may reference an already-deleted student.
  student_id      uuid NOT NULL,
  -- Tenant scope. NULLABLE because B2C children have no school. school_admin
  -- RLS only matches when school_id is non-null.
  school_id       uuid NULL REFERENCES public.schools(id) ON DELETE SET NULL,
  status          public.data_erasure_status NOT NULL DEFAULT 'pending',
  -- Guardian-supplied reason. Bounded so a malicious caller can't write
  -- megabyte-sized strings into the audit trail.
  reason          text NULL CHECK (reason IS NULL OR length(reason) <= 2000),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  -- The earliest moment the cron may purge this row.
  purge_at        timestamptz NOT NULL,
  -- Stamped when the cron transitions out of `pending` or `purging`. NULL
  -- while pending/purging.
  processed_at    timestamptz NULL,
  -- Cron error message on `failed`. Truncated to 2000 chars by the writer.
  error_message   text NULL CHECK (error_message IS NULL OR length(error_message) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.data_erasure_requests IS
  'Phase D.3 (DPDP §15): two-stage parent-initiated child-data erasure with 7-day grace + cron cascade.';
COMMENT ON COLUMN public.data_erasure_requests.purge_at IS
  'now() + 7 days at insert; cron picks rows where status=pending AND purge_at<=now().';

-- The cron query is the hottest read path: filter by status, order by purge_at.
-- A covering composite index keeps that scan cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_status_purge_at
  ON public.data_erasure_requests (status, purge_at);

-- Per-guardian queries (status banner, "do I have a pending erasure?").
CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_guardian_id
  ON public.data_erasure_requests (guardian_id);

CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_student_id
  ON public.data_erasure_requests (student_id);

-- Trigger to keep updated_at fresh on any row mutation.
CREATE OR REPLACE FUNCTION public.set_data_erasure_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_data_erasure_requests_updated_at
  ON public.data_erasure_requests;

CREATE TRIGGER trg_data_erasure_requests_updated_at
  BEFORE UPDATE ON public.data_erasure_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_data_erasure_requests_updated_at();

-- RLS: deny-by-default. Three explicit allow policies.
ALTER TABLE public.data_erasure_requests ENABLE ROW LEVEL SECURITY;

-- Service-role bypass is automatic for the postgres role; no explicit policy
-- needed (Supabase service_role uses the bypass-RLS flag).

DROP POLICY IF EXISTS "guardian_sees_own_erasure_requests"
  ON public.data_erasure_requests;
CREATE POLICY "guardian_sees_own_erasure_requests"
  ON public.data_erasure_requests
  FOR SELECT
  TO authenticated
  USING (
    guardian_id IN (
      SELECT id FROM public.guardians
      WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "school_admin_sees_school_erasure_requests"
  ON public.data_erasure_requests;
CREATE POLICY "school_admin_sees_school_erasure_requests"
  ON public.data_erasure_requests
  FOR SELECT
  TO authenticated
  USING (
    school_id IS NOT NULL
    AND school_id IN (
      SELECT sa.school_id
      FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid()
        AND sa.is_active = true
    )
  );

COMMIT;
