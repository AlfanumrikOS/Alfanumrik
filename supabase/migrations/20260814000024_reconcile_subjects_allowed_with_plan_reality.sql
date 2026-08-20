-- Migration: 20260814000024_reconcile_subjects_allowed_with_plan_reality.sql
-- Purpose: make subscription_plans.subjects_allowed agree with what the plan
--          layer actually grants after 20260814000018. NO PRICE IS CHANGED.
--
-- ============================================================================
-- ⚠️  THIS MIGRATION CHANGES NO PRICE.  It touches exactly ONE column:
--     subscription_plans.subjects_allowed.  price_monthly, price_yearly,
--     price_display, razorpay_plan_id*, plan_code and is_active are read for
--     the step-4b tamper assertion and are NEVER written.
-- ============================================================================
--
-- THE DEFECT
--   20260814000018 (applied 2026-08-11) removed subject COUNT as a paywall
--   lever: it granted all five keep-set codes to every plan in
--   plan_subject_access (verified: exactly 5 rows per plan) and set
--   subscription_plans.max_subjects = NULL (the "unlimited" sentinel the
--   set_student_subjects RPC and the super-admin console both already
--   understand) on every plan.
--
--   It deliberately left `subjects_allowed` alone — see that file's step-4
--   comment, which reasoned that changing a dead column "would add rollback
--   surface for no effect". That reasoning was right about the risk and wrong
--   about the residue: the column still reads
--
--       free = 2 | starter = 4 | pro = -1 | unlimited = -1
--
--   which encodes the EXACT pre-0018 paywall — a 2-subject cap on free and a
--   4-subject cap on starter — that no longer exists anywhere in enforcement.
--   The row now contradicts its own sibling column (max_subjects = NULL) and
--   contradicts plan_subject_access. That is the defect being closed here.
--
-- WHY -1 AND NOT 2 (or 4, or NULL)
--   `subjects_allowed` is an ENTITLEMENT counter, a sibling of
--   foxy_chats_per_day / quizzes_per_day — it answers "how many subjects does
--   this PLAN entitle you to", not "how many subjects does the CATALOGUE
--   contain". The fact to encode is therefore "this plan imposes no
--   subject-count limit", which is precisely what max_subjects = NULL already
--   says. Three candidate values were considered:
--
--   -1  → CHOSEN. It is this table's OWN established unlimited sentinel: pro
--         and unlimited ALREADY hold -1, and foxy_chats_per_day = -1 is the
--         documented unlimited marker for the same table (see
--         apps/host/src/app/api/foxy/_lib/constants.ts, which maps -1 to
--         999999). Setting -1 changes only the two rows that are wrong (free,
--         starter), makes all four rows agree with each other, and agrees with
--         max_subjects = NULL and with plan_subject_access. No new vocabulary
--         is invented.
--
--   2   → REJECTED, and it is the dangerous option. It re-encodes a CAP of two
--         subjects. Should anything ever start reading this column, 2 would
--         silently reinstate exactly the free-tier limit that 0018 was written
--         to remove — a regression to the pre-0018 state, delivered by the
--         migration that was supposed to fix the drift. It also conflates
--         catalogue size with plan entitlement (catalogue breadth is a global
--         fact owned by `subjects` + grade_subject_map; duplicating it per-plan
--         creates a second copy to drift). And it is not even uniformly true as
--         a catalogue count: per 0018's own analysis a grade 11-12 student sees
--         FOUR unlocked subjects (math, physics, chemistry, biology) while
--         grades 6-10 see two.
--
--   NULL → REJECTED. Ambiguous with "not configured", and the column's baseline
--         DEFAULT is 1, so a future INSERT that omits the column would land a
--         cap of ONE subject rather than "unlimited". -1 is explicit; NULL is
--         not.
--
-- EVERY CONSUMER OF subjects_allowed (grepped 2026-08-11, whole repo, all of
-- packages/lib, apps/host/src, supabase/functions, mobile/, scripts/)
--   There are ZERO runtime readers. The only occurrences are:
--     * apps/host/src/types/database.types.ts (3×) — GENERATED Supabase types,
--       `subjects_allowed: number | null` in Row/Insert/Update. Type-level
--       only; no code destructures or branches on it, so any integer is
--       type-compatible and nothing recompiles differently.
--     * 00000000000000_baseline_from_prod.sql:14170 — the column definition.
--     * 20260814000018 line 210 — the comment explaining it was skipped.
--   No SQL function, RPC, view, API route, Edge Function, React component or
--   Dart model reads it. Every subscription_plans read in the codebase uses an
--   EXPLICIT column list (billing.ts SUBSCRIPTION_PLAN_COLUMNS, payments/
--   {subscribe,verify,status,setup-plans}, parent/billing, cron/
--   pre-debit-notice, school-admin/subscription, super-admin/subjects/
--   plan-access) — there is no `select('*')` anywhere that could surface it
--   into a response by accident. So this migration cannot break a consumer;
--   it removes a false statement from the row.
--
--   The LIVE subject-count enforcement path is max_subjects, NOT this column:
--   set_student_subjects gates on `IF v_max IS NOT NULL AND v_count > v_max`
--   reading subscription_plans.max_subjects (baseline ~line 7029), surfaced as
--   the 422 'max_subjects_exceeded' in api/student/preferences and rendered by
--   packages/ui/src/onboarding/SubjectStep.tsx. That path is untouched here and
--   stays unlimited (max_subjects = NULL) exactly as 0018 left it.
--
-- WHY THIS IS NOT A PRICING CHANGE
--   0018 already made the customer-facing entitlement change (CEO-approved,
--   approval on file) and it is APPLIED. This migration adds no entitlement and
--   removes none; it corrects a stale descriptive integer to match the
--   entitlement that is already live. Nothing a customer can buy, see or be
--   charged changes.
--
-- ROLLBACK
--   The step-1 admin_audit_log row (action
--   'subscription_plans.subjects_allowed.reconciled') carries
--   details->'subjects_allowed_before' as a plan_code → value JSONB object,
--   written BEFORE the update. To roll back, restore each plan's value from it.
--   Same audit-row-keyed discipline as 20260814000007 and 20260814000018.
--
-- Non-destructive: no DROP TABLE, no DROP COLUMN, no schema change. One UPDATE
-- of one column on at most four rows, plus one COMMENT. No student, teacher,
-- subscription, payment or content row is read or written.
--
-- Ordering: apply AFTER 20260814000018 (which establishes the max_subjects =
-- NULL / all-five-grants reality this file reconciles against) and after
-- 20260620000800 (which adds razorpay_plan_id_quarterly, read by the step-4b
-- guard). Timestamped after 20260814000023, the current chain head.
--
-- Idempotency — per statement, see the inline notes below each block.

BEGIN;

-- ─── 0. IN-TRANSACTION PRICE/IDENTITY SNAPSHOT (the tamper control) ─────────
-- Captured BEFORE any mutation and compared against live values in step 4b.
-- This proves THIS TRANSACTION moved no price, no Razorpay id, no plan_code and
-- no is_active flag — without hard-coding a single price literal into this
-- file. Hard-coding them was considered and rejected: it would turn this
-- migration into a landmine that fails on re-run after any future, legitimate,
-- CEO-approved price change. A same-transaction before/after comparison holds
-- regardless of when it runs and what the prices are.
--
-- Idempotent: ON COMMIT DROP, so every run (re-run included) starts clean.
CREATE TEMP TABLE _plan_price_guard ON COMMIT DROP AS
SELECT
  sp.plan_code,
  sp.price_monthly,
  sp.price_yearly,
  sp.price_display,
  sp.razorpay_plan_id,
  sp.razorpay_plan_id_monthly,
  sp.razorpay_plan_id_quarterly,
  sp.is_active
FROM public.subscription_plans sp;

-- ─── 1. PRE-CHANGE SNAPSHOT — the rollback source of truth ──────────────────
-- MUST run before step 2.
--
-- Idempotent: guarded by NOT EXISTS on the action code, so exactly one row ever
-- exists for this migration. The guard is load-bearing, not cosmetic — on a
-- re-run the column is already reconciled, so an unguarded INSERT would write a
-- second "snapshot" showing the POST-change state and destroy the rollback
-- signal by making it ambiguous which row is authoritative. (Same reasoning as
-- 20260814000018 step 1.)
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'subscription_plans.subjects_allowed.reconciled',
  'system',
  NULL,
  jsonb_build_object(
    'subjects_allowed_before',
      COALESCE(
        (SELECT jsonb_object_agg(sp.plan_code, sp.subjects_allowed)
           FROM public.subscription_plans sp),
        '{}'::jsonb
      ),
    'subjects_allowed_after', -1,
    'max_subjects_now',
      COALESCE(
        (SELECT jsonb_object_agg(sp.plan_code, sp.max_subjects)
           FROM public.subscription_plans sp),
        '{}'::jsonb
      ),
    'grants_per_plan_now',
      COALESCE(
        (SELECT jsonb_object_agg(g.plan_code, g.n)
           FROM (SELECT psa.plan_code, count(*) AS n
                   FROM public.plan_subject_access psa
                  GROUP BY psa.plan_code) g),
        '{}'::jsonb
      ),
    'pricing_change', FALSE,
    'reconciles',   '20260814000018_plan_subject_access_restrict',
    'migration',    '20260814000024_reconcile_subjects_allowed_with_plan_reality',
    'applied_at',   now()
  ),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_audit_log l
   WHERE l.action = 'subscription_plans.subjects_allowed.reconciled'
);

-- ─── 2. Reconcile the column with reality ───────────────────────────────────
-- -1 = unlimited, this table's own existing sentinel (pro and unlimited already
-- hold it). After this, all four plans agree with max_subjects = NULL and with
-- the five grants each plan holds in plan_subject_access.
--
-- Idempotent: `WHERE subjects_allowed IS DISTINCT FROM -1` matches zero rows on
-- a re-run. IS DISTINCT FROM (not <>) so a NULL-valued row is also caught —
-- with `<>` a NULL would evaluate to NULL, the row would be skipped, and the
-- step-4a assertion would then abort on a row this statement could have fixed.
UPDATE public.subscription_plans sp
   SET subjects_allowed = -1
 WHERE sp.subjects_allowed IS DISTINCT FROM -1;

-- ─── 3. Document the column so it is not re-read as a live limit ────────────
-- The next person to see `subjects_allowed` should not have to re-derive that
-- it enforces nothing. COMMENT ON is inherently idempotent (it overwrites).
COMMENT ON COLUMN public.subscription_plans.subjects_allowed IS
  'DEPRECATED / non-enforcing. Always -1 (= unlimited) since migration '
  '20260814000024. Subject entitlement is enforced ONLY by '
  'plan_subject_access (which codes a plan unlocks) and by '
  'subscription_plans.max_subjects (how many may be selected; NULL = '
  'unlimited, read by set_student_subjects). No SQL function, API route, '
  'Edge Function or client reads this column - do not reintroduce a read '
  'against it, and do not treat a value here as a cap.';

-- ─── 4. ASSERTIONS — a bad apply rolls back rather than half-applies ────────
-- BEGIN/COMMIT means any RAISE below rolls back steps 1-3 in full: a failed run
-- leaves subscription_plans exactly as it was, including no audit row.
DO $$
DECLARE
  v_bad   TEXT;
  v_drift TEXT;
BEGIN
  -- 4a. Every plan row must now read -1.
  -- What this catches: a BEFORE trigger or future CHECK rejecting -1, a row
  -- inserted concurrently between steps 2 and 4, or a partially-applied UPDATE.
  --
  -- Vacuous-pass note: on a fresh database where subscription_plans has not
  -- been seeded there are no rows, so this passes with nothing to check. That
  -- is correct — there is no plan to leave stranded — and step 2 is likewise a
  -- no-op on such a database.
  SELECT string_agg(
           format('%s=%s', sp.plan_code, COALESCE(sp.subjects_allowed::TEXT, 'NULL')),
           ', ' ORDER BY sp.plan_code
         )
    INTO v_bad
    FROM public.subscription_plans sp
   WHERE sp.subjects_allowed IS DISTINCT FROM -1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'subjects_allowed reconciliation left plan(s) not equal to -1: %',
      v_bad
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Every plan must read -1 (unlimited), matching max_subjects IS NULL and the five plan_subject_access grants each plan holds. Do NOT weaken this assertion to make it pass.';
  END IF;

  -- 4b. TAMPER CONTROL: no price, Razorpay id, plan_code or is_active moved.
  -- FULL OUTER JOIN (not INNER) so an added or deleted plan row is caught too,
  -- not just a modified one. IS DISTINCT FROM throughout so NULL-valued columns
  -- (price_display, every razorpay id) compare correctly instead of yielding
  -- NULL and silently passing.
  SELECT string_agg(DISTINCT COALESCE(g.plan_code, sp.plan_code), ', ')
    INTO v_drift
    FROM _plan_price_guard g
    FULL OUTER JOIN public.subscription_plans sp
      ON sp.plan_code = g.plan_code
   WHERE g.plan_code IS NULL
      OR sp.plan_code IS NULL
      OR sp.price_monthly              IS DISTINCT FROM g.price_monthly
      OR sp.price_yearly               IS DISTINCT FROM g.price_yearly
      OR sp.price_display              IS DISTINCT FROM g.price_display
      OR sp.razorpay_plan_id           IS DISTINCT FROM g.razorpay_plan_id
      OR sp.razorpay_plan_id_monthly   IS DISTINCT FROM g.razorpay_plan_id_monthly
      OR sp.razorpay_plan_id_quarterly IS DISTINCT FROM g.razorpay_plan_id_quarterly
      OR sp.is_active                  IS DISTINCT FROM g.is_active;

  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'P11 GUARD: this migration must not change price/Razorpay/plan identity, but drift was detected on plan(s): %',
      v_drift
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Migration 20260814000024 writes ONLY subscription_plans.subjects_allowed. If this fires, something else in this transaction touched a pricing or gateway column - investigate, do not relax the guard.';
  END IF;
END;
$$;

COMMIT;
