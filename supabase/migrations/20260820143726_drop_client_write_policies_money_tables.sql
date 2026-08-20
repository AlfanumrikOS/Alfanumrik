-- Migration: 20260820143726_drop_client_write_policies_money_tables.sql
-- Purpose: Drop the 13 own-row INSERT/UPDATE/DELETE RLS policies on the four money/quota
--          tables, so that a logged-in student can no longer write to them via PostgREST.
--
-- LEDGER RECONCILIATION: applied to production via `apply_migration` on 2026-08-20, which
-- assigned ledger version 20260820143726 rather than this file's original filename version
-- 20260820140000. This file was renamed to match the ledger rather than the ledger being
-- repaired to match the file — the ledger records what actually happened.
--
-- ============================================================================
-- THE DEFECT
-- ============================================================================
-- A live RLS audit of production project `shktyoxqhundlvkiwguu` (the ONLY environment,
-- 68 live students) found that four money/quota tables carry own-row WRITE policies for the
-- `authenticated` role. PostgREST exposes every table in `public` to any logged-in user
-- holding the anon key plus their own JWT, so these policies are directly exploitable from a
-- browser console. With nothing but their own valid session, a student can do all six of:
--
--   1. INSERT a `payment_history` row with `status = 'captured'` — a payment that never
--      happened, fabricated with no Razorpay order behind it.
--   2. UPDATE an existing pending/failed `payment_history` row to `status = 'captured'` —
--      promoting a declined or abandoned payment into a successful one.
--   3. DELETE `payment_history` rows — erasing the financial record outright, destroying the
--      source of truth for refund disputes, chargeback defence, and revenue reconciliation.
--   4. INSERT/UPDATE `student_subscriptions` to self-grant `plan_code = 'unlimited'` — full
--      paid-tier access for free, with no payment record required at all.
--   5. INSERT/UPDATE/DELETE `subscription_events` — forging or erasing the subscription audit
--      ledger, i.e. the trail that explains how a plan reached its current state.
--   6. UPDATE/DELETE `student_daily_usage` — resetting their own AI quota counters and
--      consuming unmetered Claude API spend.
--
-- Exploits 1-3 are direct revenue-integrity failures (P11). 4 is free paid access.
-- 5 destroys the forensic trail that would let us detect 1-4 after the fact. 6 is uncapped
-- cost of goods. None of these requires anything beyond a normal student login.
--
-- ============================================================================
-- WHY ALL FOUR payment_history WRITE POLICIES GO, NOT JUST THE THREE
-- ============================================================================
-- `payment_history` carries a FOURTH write policy. Its name is quoted (mixed case + spaces)
-- and, critically, its grantee is `public`, NOT `authenticated`:
--
--     "Students can insert own payment_history"  AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (student_id = get_my_student_id())
--
-- In Postgres, `public` is the implicit role that every other role is a member of — it
-- INCLUDES `authenticated`. All 21 policies on these four tables are PERMISSIVE and not one
-- is RESTRICTIVE (see the BEFORE capture), and permissive policies are OR-ed together: a
-- single surviving permissive INSERT policy keeps the door fully open.
--
-- So dropping only the three `authenticated` policies would leave exploit #1 completely
-- intact. `get_my_student_id()` returns the CALLER'S OWN student id, so this WITH CHECK
-- evaluates to true for any logged-in student inserting a row for themselves — which is
-- precisely the fabricated-payment attack, not a defence against it. The quoted-name policy
-- is therefore in the drop set, and its name is double-quoted below so the identifier
-- resolves correctly.
--
-- ============================================================================
-- EVIDENCE THAT NO LEGITIMATE CLIENT WRITE BREAKS
-- ============================================================================
-- Every write to these four tables in the codebase goes through the SERVICE-ROLE client,
-- which bypasses RLS entirely and is therefore completely unaffected by this migration:
--
--   payment_history / student_subscriptions:
--     apps/host/src/app/api/payments/verify/route.ts:376
--     apps/host/src/app/api/payments/webhook/route.ts:692, 925, 1123
--     apps/host/src/app/api/cron/reconcile-payments/route.ts:180
--   subscription_events:
--     apps/host/src/app/api/payments/verify/route.ts:467
--     apps/host/src/app/api/super-admin/payment-ops/reconcile/route.ts:79
--     apps/host/src/app/api/payments/cancel/route.ts:131, 237
--   student_daily_usage:
--     apps/host/src/app/api/foxy/_lib/quota.ts:145
--
-- Every access that uses a CLIENT key (anon key + user JWT — i.e. the exact access path these
-- policies govern) is SELECT-only:
--     packages/lib/src/usage.ts:217, 283
--     mobile/lib/data/repositories/subscription_repository.dart:22
--     mobile/lib/data/repositories/dashboard_repository.dart:96
--
-- That read-only client path is precisely why the four `*_own_select` policies are PRESERVED
-- here. Dropping them would break the student's own billing history and quota views on both
-- web and mobile. Client READ access is legitimate; client WRITE access never was.
--
-- ============================================================================
-- DELIBERATELY NOT TOUCHED
-- ============================================================================
-- PRESERVED (explicitly NOT dropped):
--   * The four own-row SELECT policies — `payment_history_own_select`,
--     `student_subscriptions_own_select`, `subscription_events_own_select`,
--     `student_daily_usage_own_select` — students must keep reading their own billing and
--     quota data (evidence above).
--   * The four service_role ALL policies — `payments_service_write`, `subs_service_write`,
--     `sub_events_service_write`, `"Service role manages usage"` — this is the only
--     legitimate write path, and every server route listed above depends on it.
--
-- TABLE-LEVEL PRIVILEGES ARE NOT TOUCHED, ON PURPOSE. This migration makes no privilege
-- change of any kind. Narrowing what `authenticated` may do at the privilege level is a
-- SEPARATE, riskier change that needs (a) a complete write-path map across every affected
-- table and (b) a matching `ALTER DEFAULT PRIVILEGES` change, without which newly created
-- tables silently drift back to the permissive default. It also has known collateral damage:
-- three SECURITY INVOKER RPCs run with the CALLER'S privileges and would break under a
-- blanket privilege removal —
--     record_learning_event, mark_notification_read, teacher_create_class
-- Policy removal alone closes all six exploits without any of that risk: with no permissive
-- write policy remaining, RLS denies the write regardless of what table-level privilege the
-- role happens to hold. Privilege narrowing is tracked as separate follow-up work.
--
-- Also absent by design: no `ALTER TABLE` (RLS is already enabled — and not forced — on all
-- four tables per the BEFORE capture), no policy creation, and no data migration.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEFORE state — all 21 policies with verbatim `pg_get_expr` bodies, re-verified against live
-- production at 2026-08-20 14:18:19 UTC as MATCHES BASELINE:
--     docs/audits/2026-08-20-money-table-policies-BEFORE.md
--
-- DOWN migration — recreates exactly these 13 policies from that capture:
--     docs/runbooks/20260820143726_drop_client_write_policies_money_tables.DOWN.sql
--
-- The DOWN file is deliberately NOT in `supabase/migrations/`. `supabase db push` applies
-- every file in that directory in version order, so a down-migration parked there would
-- silently re-open this hole on the very next deploy. Rolling back must be a conscious,
-- hand-run act.
--
-- Rollback restores ACCESS RULES ONLY, never data: any row a client wrote while this
-- migration was in effect remains exactly where it is.

BEGIN;

-- ---------------------------------------------------------------------------
-- public.payment_history  (4: three `authenticated` + one `public`)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payment_history_own_insert ON public.payment_history;
DROP POLICY IF EXISTS payment_history_own_update ON public.payment_history;
DROP POLICY IF EXISTS payment_history_own_delete ON public.payment_history;
DROP POLICY IF EXISTS "Students can insert own payment_history" ON public.payment_history;

-- ---------------------------------------------------------------------------
-- public.student_subscriptions  (3)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS student_subscriptions_own_insert ON public.student_subscriptions;
DROP POLICY IF EXISTS student_subscriptions_own_update ON public.student_subscriptions;
DROP POLICY IF EXISTS student_subscriptions_own_delete ON public.student_subscriptions;

-- ---------------------------------------------------------------------------
-- public.subscription_events  (3)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS subscription_events_own_insert ON public.subscription_events;
DROP POLICY IF EXISTS subscription_events_own_update ON public.subscription_events;
DROP POLICY IF EXISTS subscription_events_own_delete ON public.subscription_events;

-- ---------------------------------------------------------------------------
-- public.student_daily_usage  (3)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS student_daily_usage_own_insert ON public.student_daily_usage;
DROP POLICY IF EXISTS student_daily_usage_own_update ON public.student_daily_usage;
DROP POLICY IF EXISTS student_daily_usage_own_delete ON public.student_daily_usage;

COMMIT;
