-- Remove the DPDP Section 17 right-to-erasure subsystem (CEO decision,
-- 2026-08-30: not required by the schools this platform serves; removed
-- permanently rather than left half-wired).
--
-- Verified before writing this migration:
--   - account_deletion_log: 0 rows live.
--   - data_erasure_requests: 0 rows live.
--   - No other table has a foreign key into either table.
--   - No pg_cron job references either table or the account-purge /
--     data-erasure-purger Edge Functions (the purge trigger was a Next.js
--     API cron route, apps/host/src/app/api/cron/account-purge, removed in
--     the same change as this migration).
--   - erasure-guard.ts (packages/lib/src/memory/erasure-guard.ts, removed in
--     the same change) had ZERO callers anywhere in the app — the
--     ff_unified_memory_v1 feature it was built for was seeded OFF and never
--     enabled, so removing it disables nothing that was live.
--
-- This migration removes the DB half; the app-code half (routes, Edge
-- Functions, the erasure-guard module, and their tests) is removed in the
-- same commit. See docs/audit/launch-readiness/dpdp-erasure-removal.md for
-- the full record of what existed and why it was removed.

BEGIN;

-- Drop the RPCs first (some may reference the tables below). Signatures
-- confirmed live via pg_get_function_identity_arguments before writing this.
DROP FUNCTION IF EXISTS public.request_account_deletion(p_account_id uuid, p_role text, p_reason text, p_auth_user_id uuid);
DROP FUNCTION IF EXISTS public.cancel_account_deletion(p_account_id uuid);
DROP FUNCTION IF EXISTS public.execute_data_erasure_purge(p_request_id uuid, p_dry_run boolean, p_operator_event_id uuid);
DROP FUNCTION IF EXISTS public.parent_request_child_erasure(p_student_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.parent_child_erasure_status(p_student_id uuid);
DROP FUNCTION IF EXISTS public.parent_cancel_child_erasure(p_student_id uuid);

-- Drop data_erasure_requests' policies and disable RLS on both tables
-- explicitly (rather than relying only on the table-drop CASCADE below) so
-- the static migration-replay parsers (src/__tests__/rls-no-cross-table-
-- recursion.test.ts and src/__tests__/rls-inventory.test.ts, neither of
-- which simulates CASCADE) see the policies and RLS state removed, not left
-- orphaned against a dropped table.
DROP POLICY IF EXISTS "guardian_sees_own_erasure_requests" ON public.data_erasure_requests;
DROP POLICY IF EXISTS "school_admin_sees_school_erasure_requests" ON public.data_erasure_requests;
ALTER TABLE public.account_deletion_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_erasure_requests DISABLE ROW LEVEL SECURITY;

-- Drop the tables. CASCADE removes their own triggers (which in turn drops
-- update_account_deletion_log_updated_at / set_data_erasure_requests_updated_at
-- / insert_data_erasure_audit_event once nothing else depends on them) and
-- any remaining RLS policies. Verified above that no other table has an FK
-- into either of these two.
DROP TABLE IF EXISTS public.account_deletion_log CASCADE;
DROP TABLE IF EXISTS public.data_erasure_requests CASCADE;

-- The three trigger functions are dropped by the table CASCADEs above if
-- they were only ever attached to these two tables' triggers. Drop
-- explicitly too, defensively, in case any survived as a standalone object.
DROP FUNCTION IF EXISTS public.update_account_deletion_log_updated_at();
DROP FUNCTION IF EXISTS public.set_data_erasure_requests_updated_at();
DROP FUNCTION IF EXISTS public.insert_data_erasure_audit_event();

-- Remove the now-orphaned RBAC permissions (account.delete, memory.erase_own)
-- and any role grants pointing at them. No other code references either
-- permission code (verified via repo grep before writing this migration).
DELETE FROM public.role_permissions
  WHERE permission_id IN (
    SELECT id FROM public.permissions WHERE code IN ('account.delete', 'memory.erase_own')
  );
DELETE FROM public.permissions WHERE code IN ('account.delete', 'memory.erase_own');

COMMIT;
