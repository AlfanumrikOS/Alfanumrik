-- Migration: legacy_subjects_archive RLS
-- Closes a P8 gap from migration 20260415000001 — the table was created without RLS policies.
-- Students can read their own archive rows (for the optional "what was removed" UX); writes are service-role only.

BEGIN;

ALTER TABLE legacy_subjects_archive ENABLE ROW LEVEL SECURITY;

-- Students may read their own archive entries (admin tooling can use service role)
CREATE POLICY lsa_read_own
  ON legacy_subjects_archive
  FOR SELECT
  USING (student_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy => writes blocked for authenticated; service role bypasses RLS.

COMMIT;
