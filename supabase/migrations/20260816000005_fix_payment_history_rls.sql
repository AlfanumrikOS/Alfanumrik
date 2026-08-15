-- Migration: 20260816000005_fix_payment_history_rls.sql
--
-- Replaces the broken RLS policy created by 20260506000003_restore_rls_with_check_clauses.sql
-- on payment_history. That migration wrote:
--   CREATE POLICY "Students can insert own payment_history" ON public.payment_history
--     FOR INSERT WITH CHECK (student_id = (SELECT auth.uid()))
-- which is unsatisfiable: student_id is a uuid FK to students.id, never auth.users.id.
-- Every INSERT from an authenticated role therefore silently fails.
--
-- All production payment inserts go through supabaseAdmin (service_role), which bypasses
-- RLS. Verified in this session: webhook/route.ts, verify/route.ts, subscribe/route.ts, and
-- create-order/route.ts all use supabaseAdmin. No authenticated write path exists, so this
-- policy is dead weight — not an active outage — but it can silently break the next
-- authenticated insert path that gets added.
--
-- Fix: replace with get_my_student_id(), the SECURITY DEFINER helper already used by the
-- 20260815000002_fix_rls_with_check_student_id_drift.sql migration for 8 other tables.
-- New policy: FOR INSERT WITH CHECK (student_id = get_my_student_id())
--
-- Safety: if any authenticated insert path is added later, it will now be correctly scoped
-- to the caller's own student row. No existing path is affected (all are service_role). The
-- policy is idempotent — CREATE OR REPLACE POLICY can be re-run safely.
--
-- NOTE on payment_history.suppression_delay policy exemption (RCA item 23):
-- No RLS policy exemption for the suppression_delay column exists, and no migration named
-- 20230110000001_payment_history_suppression_delay.sql is on disk. The baseline DDL at
-- supabase/migrations/00000000000000_baseline_from_prod.sql:12602 does not include a
-- suppression_delay column. The webhook route inserts {status, amount, student_id, plan_code,
-- razorpay_payment_id} (see webhook/route.ts lines 698-709, 931-940, 1129-1139) — never
-- suppression_delay. This is a non-issue: the exemption was never implemented, the column
-- does not exist, and no code path writes it. Catalogued as resolved — no action required.

BEGIN;

-- Old broken policy (from 20260506000003) — drop if it exists.
DROP POLICY IF EXISTS "Students can insert own payment_history" ON public.payment_history;

-- New correctly-scoped policy, using the same helper as the other 8 fixed tables.
CREATE POLICY "Students can insert own payment_history"
  ON public.payment_history
  FOR INSERT
  WITH CHECK (student_id = get_my_student_id());

-- Verification queries (run after apply to confirm).
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'payment_history';
-- Expected: one INSERT policy with qual = 'student_id = get_my_student_id()'
-- SELECT * FROM payment_history LIMIT 1;  -- confirm post-apply read access

COMMIT;
