-- Migration: 20260520000007_competition_sku_substrate.sql
-- Author:    architect
-- Purpose:   PR-7 of the JEE/NEET/Olympiad scaling roadmap. Lands SUBSTRATE for
--            the future "Competition" plan SKU: a disabled feature flag and an
--            RBAC permission catalog row. SHIPS DISABLED — flag OFF, no
--            Razorpay plan created yet. Activation is a separate manual step
--            the CEO triggers (see "Activation runbook" below).
--
-- Predecessors:
--   - 20260520000004 (PR-1) added PYQ columns to question_bank
--   - 20260520000005 (PR-2) added exam_papers catalog
--   - PR-3 importer Edge Function seeds rows (out of scope here)
--
-- Why this matters: PR-1..3 let the DB hold JEE/NEET/Olympiad PYQs but no
--   pricing tier unlocks them — every paid plan today (free/starter/pro/
--   unlimited) treats all questions equally. This migration lands schema-
--   level placeholders so PR-8 (super-admin Plans UI), PR-9 (Razorpay
--   creation runbook), and PR-10 (RBAC wiring) each ship as small diffs.
--
-- Lands now (this PR):
--   1. feature_flags.ff_competitive_exams_v1  — DISABLED, pricing in metadata
--   2. permissions.competition.access         — RBAC catalog row
--   3. NOTE-only entry for subscription_plans — see Section C deviation
--
-- Does NOT land (deferred):
--   - subscription_plans row (existing chk_valid_plan_code pins plan_code to
--     ('free','starter','pro','unlimited'); extending the CHECK is a P11
--     invariant change requiring user approval — see Section C).
--   - Razorpay plan_id (created in Razorpay dashboard, not migrations).
--   - role_permissions wiring (PR-10) + TS PERMISSIONS const update (PR-10).
--
-- Idempotency:
--   - Flag insert:       INSERT ... ON CONFLICT (flag_name) DO NOTHING
--   - Permission insert: INSERT ... ON CONFLICT (code)      DO NOTHING
--   - Verification block is read-only.
--   Re-running on an applied DB is a no-op.
--
-- Activation runbook (CEO-triggered, NOT auto-run):
--   1. Create Razorpay plan IDs (monthly + yearly) via Razorpay dashboard.
--      Pricing: ₹999/mo (99900 paise), ₹7999/yr (799900 paise).
--   2. Land follow-up migration (separate PR) to:
--        ALTER TABLE public.subscription_plans
--          DROP CONSTRAINT chk_valid_plan_code,
--          ADD  CONSTRAINT chk_valid_plan_code
--               CHECK (plan_code IN ('free','starter','pro','unlimited','competition'));
--        INSERT INTO public.subscription_plans (...) VALUES (...) -- competition row
--      DROP-then-ADD preserves additivity (no DROP TABLE/COLUMN).
--   3. Verify super-admin Plans page lists "Competition" SKU.
--   4. Verify PR-3 seed content (JEE/NEET PYQs) is live in question_bank.
--   5. Wire TS PERMISSIONS.COMPETITION_ACCESS in src/lib/rbac.ts + update
--      role_permissions for paying students (PR-10).
--   6. Flip flag staged: staging 100% → prod 10/25/50/100 cadence.
--
-- Kill switch (instant rollback, no migration revert):
--   UPDATE public.feature_flags SET is_enabled=false, updated_at=now()
--    WHERE flag_name='ff_competitive_exams_v1';
--   5-min in-process cache in src/lib/feature-flags.ts picks it up next tick.
--
-- DOWN (manual, do NOT auto-run):
--   DELETE FROM public.feature_flags WHERE flag_name = 'ff_competitive_exams_v1';
--   DELETE FROM public.permissions   WHERE code      = 'competition.access';
--   -- subscription_plans row is NOT seeded here; only delete after the
--   -- activation migration runs:
--   -- DELETE FROM public.subscription_plans WHERE plan_code = 'competition';
--   -- DELETE FROM public.plans WHERE plan_code = 'competition';  -- legacy
--   --   shape comment per task spec; public.plans does NOT exist in this DB.
--
-- Owner: architect. Downstream reviewers per P14: backend (subscription
--   middleware wires the permission later), ops (super-admin Plans page
--   surfaces the SKU later), testing (RBAC + plan-gate E2E once activated).

BEGIN;

-- ============================================================================
-- A. Seed feature flag ff_competitive_exams_v1 (DISABLED on prod + staging)
-- ============================================================================
-- Description and metadata mirror the task spec verbatim. Pricing is recorded
-- in paise (Razorpay convention) inside metadata; the active subscription_plans
-- table stores rupees, so the activation PR must convert (99900 paise → 999
-- rupees) when it seeds the plan row.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  target_roles,
  target_institutions,
  description,
  metadata
)
VALUES (
  'ff_competitive_exams_v1',
  false,                                            -- OFF by default
  0,                                                -- 0% rollout
  ARRAY['production','staging']::text[],            -- applies in both envs once flipped
  ARRAY[]::text[],                                  -- all roles (when enabled)
  ARRAY[]::uuid[],                                  -- all institutions
  'Phase 7 substrate — gates the Competition plan SKU (₹999/mo or ₹7,999/yr), '
  'which unlocks unlimited JEE/NEET/Olympiad question access and mock-test '
  'runner. Default OFF — flip only after Razorpay plan exists, super-admin '
  'Plans page lists the SKU, and PR-3 seed content is verified live. '
  'Kill switch: set is_enabled=false.',
  jsonb_build_object(
    'owner', 'architect+backend+ops',
    'added', '2026-05-19',
    'phase', '7',
    'pricing', jsonb_build_object(
      'monthly', 99900,                             -- ₹999 in paise (Razorpay)
      'yearly',  799900                             -- ₹7,999 in paise (Razorpay)
    ),
    'rollout_strategy', 'manual flag flip after Razorpay plan creation + super-admin Plans page verifies SKU listed',
    'kill_switch', 'set is_enabled=false in feature_flags row'
  )
)
ON CONFLICT (flag_name) DO NOTHING;

-- ============================================================================
-- B. Seed RBAC permission competition.access
-- ============================================================================
-- The `permissions` table is the canonical catalog (UNIQUE on code via
-- permissions_code_key, baseline line 15732). The TS PERMISSIONS map in
-- src/lib/rbac.ts is a typed mirror that PR-10 will update — substrate alone
-- does NOT wire this permission into the role_permissions matrix, so no
-- student/parent/teacher gains access just by this migration running.

INSERT INTO public.permissions (
  code,
  resource,
  action,
  description,
  is_active
)
VALUES (
  'competition.access',
  'competition',
  'access',
  'Access JEE/NEET/Olympiad question banks and mock-test runner (requires active Competition plan)',
  true
)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- C. subscription_plans row — INTENTIONALLY DEFERRED (NOTE only)
-- ============================================================================
-- Task spec asked for an INSERT into a plans table. The live schema
-- (public.subscription_plans, baseline line 14158) has chk_valid_plan_code
-- pinning plan_code to ('free','starter','pro','unlimited'); inserting
-- 'competition' would violate it and abort the migration. The schema also
-- lacks the bilingual/paise columns the spec references (name_hi,
-- description, description_hi, price_monthly_paise, price_yearly_paise,
-- razorpay_plan_id_yearly) — the active table stores price in rupees
-- (integer), exposes only razorpay_plan_id_monthly, and has no Hi-locale
-- columns.
--
-- Per CLAUDE.md P11 (payment integrity), extending the active plan-code
-- CHECK is an invariant change to the paid-plan catalog and requires
-- explicit user approval. This PR is substrate-only and ships DISABLED, so
-- deferring the plan row is the correct safety choice — the flag gates
-- access regardless of whether the plan row exists. The activation
-- migration (CEO-triggered when Razorpay plans are live) will:
--   1. DROP+ADD chk_valid_plan_code to include 'competition'.
--   2. Add bilingual columns if the localized Plans page is shipping.
--   3. INSERT the plan row with rupee prices (999, 7999) + Razorpay IDs.
--   4. Set is_active=true ONLY after super-admin verifies SKU listing.
--
-- TS PERMISSIONS const wiring (PR-10, not this PR):
--   src/lib/rbac.ts — PERMISSIONS map (~line 570):
--     COMPETITION_ACCESS: 'competition.access',
--
-- Suggested activation-migration filename:
--   YYYYMMDDHHMMSS_competition_sku_activate.sql

-- ============================================================================
-- D. Verification block — confirm flag + permission are in safe state
-- ============================================================================
-- Read-only checks. RAISE NOTICE for happy path, RAISE WARNING if flag is
-- accidentally enabled or a row is missing. This block does NOT throw —
-- operators rely on deploy logs to spot issues.

DO $verify$
DECLARE
  v_flag_count       integer;
  v_flag_enabled     boolean;
  v_perm_count       integer;
  v_plan_count       integer;
  v_has_plans_table  boolean;
BEGIN
  -- 1. Feature flag presence + safe state
  SELECT COUNT(*) INTO v_flag_count
    FROM public.feature_flags
   WHERE flag_name = 'ff_competitive_exams_v1';

  SELECT is_enabled INTO v_flag_enabled
    FROM public.feature_flags
   WHERE flag_name = 'ff_competitive_exams_v1';

  RAISE NOTICE '[pr7_competition_substrate] flag rows present = % (expected 1)', v_flag_count;
  RAISE NOTICE '[pr7_competition_substrate] ff_competitive_exams_v1.is_enabled = %', v_flag_enabled;

  IF v_flag_count <> 1 THEN
    RAISE WARNING '[pr7_competition_substrate] expected exactly 1 ff_competitive_exams_v1 row, found %', v_flag_count;
  END IF;

  IF v_flag_enabled IS TRUE THEN
    RAISE WARNING '[pr7_competition_substrate] ff_competitive_exams_v1 is currently is_enabled=true — substrate PR expected OFF; investigate before flipping rollout';
  END IF;

  -- 2. Permission row presence
  SELECT COUNT(*) INTO v_perm_count
    FROM public.permissions
   WHERE code = 'competition.access';

  RAISE NOTICE '[pr7_competition_substrate] permissions.competition.access rows = % (expected 1)', v_perm_count;

  IF v_perm_count <> 1 THEN
    RAISE WARNING '[pr7_competition_substrate] expected exactly 1 competition.access permission row, found %', v_perm_count;
  END IF;

  -- 3. Plan row check — informational only; this PR intentionally does NOT
  --    seed subscription_plans (see Section C). The check exists so the
  --    activation migration's success can be observed in deploy logs.
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'subscription_plans'
  ) INTO v_has_plans_table;

  IF v_has_plans_table THEN
    SELECT COUNT(*) INTO v_plan_count
      FROM public.subscription_plans
     WHERE plan_code = 'competition';
    RAISE NOTICE '[pr7_competition_substrate] subscription_plans.competition rows = % (expected 0 in substrate PR; activation migration seeds this)', v_plan_count;
  ELSE
    RAISE NOTICE '[pr7_competition_substrate] subscription_plans table not found — skip plan row check';
  END IF;

  RAISE NOTICE 'PR-7 substrate COMPLETE — Competition SKU schema in place, flag OFF, plan inactive. Activation requires: 1) Razorpay plan create, 2) ff_competitive_exams_v1 → is_enabled=true, 3) plans.competition.is_active → true.';
END $verify$;

COMMIT;
