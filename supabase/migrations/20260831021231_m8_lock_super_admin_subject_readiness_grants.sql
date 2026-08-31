-- M8 (schema review finding): public.super_admin_subject_readiness already had
-- its real RLS-bypass bug fixed on 2026-05-16 (security_invoker=on, migration
-- 20260516000000) — independently re-verified live, still in effect. What
-- remained was grant hygiene: anon/authenticated still held table-level
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE (the writes were always inert — no
-- INSTEAD OF triggers — but SELECT was live and reachable via PostgREST despite
-- the name implying super-admin-only intent, with zero call sites anywhere in
-- the repo). Closing to service_role-only matches the view's stated purpose;
-- every column it exposes (subject-level readiness counts) was ALSO already
-- independently readable by any authenticated user through the underlying
-- tables' own permissive policies, so this removes redundant surface, not a
-- real new gap.
REVOKE ALL ON public.super_admin_subject_readiness FROM anon, authenticated;
GRANT SELECT ON public.super_admin_subject_readiness TO service_role;
