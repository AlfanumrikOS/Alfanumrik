-- Follow-up to 20260831065444: applied live to production to close the CI
-- "Migration Safety: RLS Coverage" gap immediately (before that file's
-- history was rewritten in the same PR to fold these statements in
-- directly, so a fresh environment reaches the identical end state via
-- 20260831065444 alone). Kept here, unmodified from what was actually run,
-- purely for git/ledger parity with supabase_migrations.schema_migrations --
-- idempotent no-op if ever replayed after the now-updated 20260831065444.

ALTER TABLE public._feature_flags_dead_flags_backup_20260831 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "_feature_flags_dead_flags_backup_service_role_all" ON public._feature_flags_dead_flags_backup_20260831;
CREATE POLICY "_feature_flags_dead_flags_backup_service_role_all"
  ON public._feature_flags_dead_flags_backup_20260831
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
