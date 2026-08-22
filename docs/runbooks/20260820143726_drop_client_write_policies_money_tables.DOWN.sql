-- DOWN migration for: supabase/migrations/20260820143726_drop_client_write_policies_money_tables.sql
-- Recreates the 13 own-row INSERT/UPDATE/DELETE RLS policies that the UP migration dropped
-- from public.payment_history, public.student_subscriptions, public.subscription_events,
-- and public.student_daily_usage.
--
-- ============================================================================
-- WHY THIS FILE IS NOT IN supabase/migrations/
-- ============================================================================
-- `supabase db push` applies EVERY file in `supabase/migrations/` in version order. A
-- down-migration living there would be applied automatically on the next deploy and would
-- silently re-open the exact vulnerability the UP migration closed — a student would regain
-- the ability to fabricate captured payments, self-grant `plan_code = 'unlimited'`, forge or
-- erase the subscription audit ledger, and reset their own AI quota.
--
-- It therefore lives in `docs/runbooks/` and is NEVER auto-applied. Rolling back is a
-- conscious, hand-run act:
--
--     psql "$DATABASE_URL" -f docs/runbooks/20260820143726_drop_client_write_policies_money_tables.DOWN.sql
--
-- Do not move this file into `supabase/migrations/`.
--
-- ============================================================================
-- LIMITS OF THIS ROLLBACK
-- ============================================================================
-- 1. IT RESTORES ACCESS RULES ONLY — NOT DATA. Any row written (or deletion performed) while
--    the UP migration was in effect stays exactly as it is. Recreating these policies does
--    not replay, reverse, or reconcile a single row. If data integrity work is needed, that
--    is a separate, explicit remediation.
-- 2. IT ASSUMES ITS DEPENDENCIES STILL EXIST. Twelve of the thirteen predicates reference
--    `public.students` (unqualified as `students`), and the thirteenth calls
--    `get_my_student_id()`. If either has since been dropped or renamed, these statements
--    will fail — that is intentional: a policy that cannot be evaluated must not be created.
--    `SET LOCAL search_path` below is what makes the unqualified references resolve.
-- 3. IT RESTORES A KNOWN-VULNERABLE STATE. This is a break-glass artifact for the case where
--    the UP migration is found to break a legitimate client write path. Restoring these
--    policies restores all six exploits documented in the UP migration header. Prefer fixing
--    the affected write path to route through the service-role client over running this file.
--
-- ============================================================================
-- SOURCE OF TRUTH
-- ============================================================================
-- Every policy below is reproduced from the verbatim production capture in:
--     docs/audits/2026-08-20-money-table-policies-BEFORE.md
-- (all 21 policies, `pg_get_expr` bodies including indentation and embedded newlines,
-- re-verified against live production `shktyoxqhundlvkiwguu` at 2026-08-20 14:18:19 UTC as
-- MATCHES BASELINE).
--
-- Clause shapes are taken from that capture and must not be "tidied" — a wrong clause is a
-- SILENT failure, not an error:
--   INSERT -> WITH CHECK only        (captured `qual` is NULL)
--   UPDATE -> USING and WITH CHECK   (identical predicate in both)
--   DELETE -> USING only             (captured `with_check` is NULL)
-- All 13 are AS PERMISSIVE. Twelve are TO authenticated; the thirteenth
-- ("Students can insert own payment_history") is TO public and carries a DIFFERENT, shorter
-- predicate — `(student_id = get_my_student_id())` — not the shared two-branch predicate.
--
-- Each CREATE is preceded by DROP POLICY IF EXISTS so this file is idempotent and safe to
-- re-run.
--
-- NOT restored here (they were never dropped, and are still live): the four `*_own_select`
-- policies and the four service_role ALL policies (`payments_service_write`,
-- `subs_service_write`, `sub_events_service_write`, `"Service role manages usage"`).

BEGIN;

SET LOCAL search_path TO public, extensions;

-- ---------------------------------------------------------------------------
-- public.payment_history  (4: three `authenticated` + one `public`)
-- ---------------------------------------------------------------------------

-- INSERT -> WITH CHECK only
DROP POLICY IF EXISTS payment_history_own_insert ON public.payment_history;
CREATE POLICY payment_history_own_insert
  ON public.payment_history
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- UPDATE -> USING and WITH CHECK
DROP POLICY IF EXISTS payment_history_own_update ON public.payment_history;
CREATE POLICY payment_history_own_update
  ON public.payment_history
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  )
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- DELETE -> USING only
DROP POLICY IF EXISTS payment_history_own_delete ON public.payment_history;
CREATE POLICY payment_history_own_delete
  ON public.payment_history
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- INSERT -> WITH CHECK only.  NOTE: TO public (not authenticated), and a DIFFERENT predicate.
DROP POLICY IF EXISTS "Students can insert own payment_history" ON public.payment_history;
CREATE POLICY "Students can insert own payment_history"
  ON public.payment_history
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (
(student_id = get_my_student_id())
  );

-- ---------------------------------------------------------------------------
-- public.student_subscriptions  (3)
-- ---------------------------------------------------------------------------

-- INSERT -> WITH CHECK only
DROP POLICY IF EXISTS student_subscriptions_own_insert ON public.student_subscriptions;
CREATE POLICY student_subscriptions_own_insert
  ON public.student_subscriptions
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- UPDATE -> USING and WITH CHECK
DROP POLICY IF EXISTS student_subscriptions_own_update ON public.student_subscriptions;
CREATE POLICY student_subscriptions_own_update
  ON public.student_subscriptions
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  )
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- DELETE -> USING only
DROP POLICY IF EXISTS student_subscriptions_own_delete ON public.student_subscriptions;
CREATE POLICY student_subscriptions_own_delete
  ON public.student_subscriptions
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- ---------------------------------------------------------------------------
-- public.subscription_events  (3)
-- ---------------------------------------------------------------------------

-- INSERT -> WITH CHECK only
DROP POLICY IF EXISTS subscription_events_own_insert ON public.subscription_events;
CREATE POLICY subscription_events_own_insert
  ON public.subscription_events
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- UPDATE -> USING and WITH CHECK
DROP POLICY IF EXISTS subscription_events_own_update ON public.subscription_events;
CREATE POLICY subscription_events_own_update
  ON public.subscription_events
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  )
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- DELETE -> USING only
DROP POLICY IF EXISTS subscription_events_own_delete ON public.subscription_events;
CREATE POLICY subscription_events_own_delete
  ON public.subscription_events
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- ---------------------------------------------------------------------------
-- public.student_daily_usage  (3)
-- ---------------------------------------------------------------------------

-- INSERT -> WITH CHECK only
DROP POLICY IF EXISTS student_daily_usage_own_insert ON public.student_daily_usage;
CREATE POLICY student_daily_usage_own_insert
  ON public.student_daily_usage
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- UPDATE -> USING and WITH CHECK
DROP POLICY IF EXISTS student_daily_usage_own_update ON public.student_daily_usage;
CREATE POLICY student_daily_usage_own_update
  ON public.student_daily_usage
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  )
  WITH CHECK (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- DELETE -> USING only
DROP POLICY IF EXISTS student_daily_usage_own_delete ON public.student_daily_usage;
CREATE POLICY student_daily_usage_own_delete
  ON public.student_daily_usage
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

COMMIT;
