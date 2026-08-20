-- DOWN migration for: supabase/migrations/20260820152908_lock_down_coupons_read_and_bound_discount.sql
-- Reverses, in reverse order, all three statements the UP migration applied to public.coupons:
--   1. drops the bounding CHECK `coupons_discount_value_bounds`
--   2. re-activates the FOXY100 coupon
--   3. recreates the `coupons_read` RLS policy exactly as captured from production
--
-- LEDGER RECONCILIATION: `apply_migration` stamped the UP file with its own wall-clock ledger
-- version on 2026-08-20 and the UP file was renamed to match. This file was renamed in
-- lockstep so the pair stays discoverable under one version: 20260820152908.
--
-- ============================================================================
-- WHY THIS FILE IS NOT IN supabase/migrations/
-- ============================================================================
-- `supabase db push` applies EVERY file in `supabase/migrations/` in version order. A
-- down-migration living there would be applied automatically on the next deploy and would
-- silently re-open the exact vulnerability the UP migration closed — the complete coupon
-- catalogue (every `code`, `discount_type`, `discount_value`, `max_uses`, `current_uses`,
-- `valid_plans`, `min_amount`, `expires_at`) would again be readable by any holder of the
-- public anon key, with no login required.
--
-- It therefore lives in `docs/runbooks/` and is NEVER auto-applied. Rolling back is a
-- conscious, hand-run act:
--
--     psql "$DATABASE_URL" -f docs/runbooks/20260820152908_lock_down_coupons_read_and_bound_discount.DOWN.sql
--
-- Do not move this file into `supabase/migrations/`.
--
-- ============================================================================
-- LIMITS OF THIS ROLLBACK
-- ============================================================================
-- 1. IT RESTORES ACCESS RULES AND ONE FLAG — NOT DATA. It recreates the `coupons_read`
--    policy and sets FOXY100's `is_active` back to `true`. It does NOT replay, reverse, or
--    reconcile any row written, updated, or deleted while the UP migration was in effect. A
--    coupon inserted in the interim stays inserted; a redemption recorded in the interim
--    stays recorded. If data integrity work is needed, that is a separate, explicit
--    remediation.
-- 2. IT RESTORES A KNOWN-VULNERABLE STATE. This is a BREAK-GLASS ARTIFACT ONLY, for the case
--    where the UP migration is found to break a legitimate read path. Restoring
--    `coupons_read` re-exposes every active coupon to `anon` — note the role is `public`, so
--    this grants read to anonymous AND authenticated callers alike. Prefer routing whatever
--    broke through the service-role client (which is BYPASSRLS and needs no policy) over
--    running this file.
-- 3. STATEMENT 2 RE-ARMS A COUPON WORTH MORE THAN EVERY PLAN. FOXY100 is flat 10000 with
--    valid_plans {pro,unlimited} — 9.10x the unlimited monthly price (1099), 14.31x pro
--    (699), and above the dearest price anywhere in the catalogue (8799, unlimited yearly).
--    It is also expired (expires_at 2026-04-30). Re-activating it is only safe because
--    statement 1 has already removed the CHECK that would otherwise block the UPDATE — the
--    order below is load-bearing, not cosmetic. If you want the read policy back but NOT the
--    live over-value coupon, run statements 1 and 3 and SKIP statement 2.
-- 4. IT ASSUMES `public.coupons` STILL EXISTS with its `is_active` and `code` columns. If the
--    table or those columns have since been altered, these statements will fail — that is
--    intentional: a policy or update that cannot be evaluated must not be silently skipped.
--
-- ============================================================================
-- SOURCE OF TRUTH
-- ============================================================================
-- The policy below is reproduced from the verbatim production capture taken at
-- 2026-08-20 15:14 UTC, which recorded `coupons_read` as the ONLY policy on the table:
--
--     policyname `coupons_read` | permissive PERMISSIVE | roles `{public}` | cmd SELECT
--     qual `(is_active = true)` | with_check NULL
--
-- Clause shapes are taken from that capture and must not be "tidied" — a wrong clause is a
-- SILENT failure, not an error:
--     SELECT -> USING only   (captured `with_check` is NULL, so no WITH CHECK clause)
--     AS PERMISSIVE          (captured `permissive` = PERMISSIVE, not RESTRICTIVE)
--     TO public              (captured `roles` = {public} — NOT `anon`, NOT `authenticated`)
--
-- The CREATE POLICY is preceded by DROP POLICY IF EXISTS so this file is idempotent and safe
-- to re-run. Statement 1 uses DROP CONSTRAINT IF EXISTS for the same reason.
--
-- NOT touched here: RLS itself stays enabled on the table (the UP migration never disabled
-- it — captured `relrowsecurity = true`, `relforcerowsecurity = false`), and no other table,
-- policy, constraint, privilege, or row is affected by any statement below.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Reverse UP statement 3 — drop the bounding CHECK.
--    MUST run before statement 2: the constraint is enforced on UPDATE of an
--    existing row, so with it in place the FOXY100 re-activation below would be
--    rejected (flat 10000 > 8799).
-- ---------------------------------------------------------------------------
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_value_bounds;

-- ---------------------------------------------------------------------------
-- 2. Reverse UP statement 2 — re-activate FOXY100.
--    Keyed on the UNIQUE business identifier `code`, exactly as the UP was;
--    touches exactly one row, leaving LAUNCH50, FRIEND20 and SCHOOL30 alone.
--    SKIP THIS STATEMENT if you want the read policy back without re-arming an
--    expired coupon worth more than every plan in the catalogue.
-- ---------------------------------------------------------------------------
UPDATE public.coupons SET is_active = true WHERE code = 'FOXY100';

-- ---------------------------------------------------------------------------
-- 3. Reverse UP statement 1 — recreate the captured read policy verbatim.
--    THIS IS THE STATEMENT THAT RE-OPENS THE LEAK: role `public` includes
--    `anon`, and the qual `(is_active = true)` filters nothing while every
--    coupon is active.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS coupons_read ON public.coupons;
CREATE POLICY coupons_read ON public.coupons
  AS PERMISSIVE FOR SELECT TO public
  USING ((is_active = true));

COMMIT;
