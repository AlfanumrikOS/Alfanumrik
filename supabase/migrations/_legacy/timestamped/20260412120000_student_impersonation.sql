-- Phase 2: Student Impersonation + Support Enrichment
-- Adds admin_support_notes (append-only note thread per student)
-- and admin_impersonation_sessions (audit trail for Live View).
-- Strictly additive.

CREATE TABLE IF NOT EXISTS admin_support_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  category        text NOT NULL CHECK (category IN (
    'support-call', 'bug-report', 'account-issue', 'observation', 'escalation'
  )),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_support_notes_student_idx
  ON admin_support_notes (student_id, created_at ASC);

ALTER TABLE admin_support_notes ENABLE ROW LEVEL SECURITY;

-- Admin-only table: deny all client access; service role bypasses RLS
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_support_notes' AND policyname = 'admin_support_notes_no_client_access'
  ) THEN
    CREATE POLICY "admin_support_notes_no_client_access"
      ON admin_support_notes FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_impersonation_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  pages_viewed    text[] NOT NULL DEFAULT '{}',
  ip_address      text
);

CREATE INDEX IF NOT EXISTS admin_impersonation_sessions_student_idx
  ON admin_impersonation_sessions (student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS admin_impersonation_sessions_active_idx
  ON admin_impersonation_sessions (admin_id, expires_at)
  WHERE ended_at IS NULL;

ALTER TABLE admin_impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- Admin-only table: deny all client access; service role bypasses RLS
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_impersonation_sessions' AND policyname = 'admin_impersonation_sessions_no_client_access'
  ) THEN
    CREATE POLICY "admin_impersonation_sessions_no_client_access"
      ON admin_impersonation_sessions FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;