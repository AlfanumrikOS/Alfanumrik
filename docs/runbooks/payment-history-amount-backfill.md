> ## ⚠️ REQUIRES CEO/FOUNDER SIGN-OFF BEFORE RUNNING
> This runbook touches **live financial records** (`payment_history.amount`).
> Every SQL statement below is diagnostic (read-only) except the two `UPDATE`
> statements at the end, which are provided for review only and are **not**
> to be executed by any agent. A human with production DB credentials must:
> 1. Run the diagnostic queries and eyeball the sample output.
> 2. Get explicit written sign-off from `ceo@alfanumrik.com` (or delegate) on
>    the exact row count to be touched.
> 3. Run the backfill inside a transaction, inspect `RETURNING`, and only
>    then `COMMIT` — or `ROLLBACK` if anything looks off.
>
> No agent has executed, or has the ability to execute, any `UPDATE` against
> a live database as part of producing this runbook. Everything below was
> derived from static code/git-history analysis.

# `payment_history.amount` unit split-brain — backfill investigation & plan

## Background

PR (commit `2c2ffafb`, merged to `main` 2026-07-29 13:02:41 IST /
2026-07-29T07:32:41Z) fixed `apps/host/src/app/api/payments/webhook/route.ts`
so all three of its `payment_history` insert sites store `amount` in **rupees**,
matching `verify/route.ts` and the `create_pending_subscription` RPC used by
`subscribe/route.ts` (both of which have *always* written rupees). Before the
fix, those 3 webhook writers stored **raw Razorpay paisa** (100x too large).
The fix is deliberately going-forward only — see the inline code comments in
the diff, and the pre-existing column comment:

```sql
COMMENT ON COLUMN "public"."payment_history"."amount" IS
  'Amount in INR rupees. Historical records before 2026-03-28 may contain paisa values.';
```

**That comment is incomplete** — see "Corrected bug timeline" below. The bug
was fixed once already, then silently reintroduced by a later rewrite and
stayed broken for ~3.5 months. This runbook supersedes the column comment as
the authoritative timeline; the comment should be updated in a follow-up
migration once the backfill lands (see "Follow-up" at the bottom).

## Corrected bug timeline (from git history, not the stale column comment)

| Window | Start | End | Commit that changed it | Notes |
|---|---|---|---|---|
| Pre-webhook-writes | — | 2026-03-26T11:04:22Z | `6a1dfee9` | Webhook only `console.log`'d payments; no `payment_history` writes at all. |
| **Window A (buggy)** | 2026-03-26T11:04:22Z | 2026-03-28T16:53:43Z | `6a1dfee9` (introduced) → `2cf04ac6` (fixed) | Webhook's first `payment_history` writer stored raw paisa (`amount: payment.amount`). Only the `payment.captured` site existed yet. ~2.5 days live. |
| Fixed (correct) | 2026-03-28T16:53:43Z | 2026-04-04T~11:51Z | `2cf04ac6` | `amount: Math.round((payment.amount \|\| 0) / 100)` on `payment.captured`, `payment.failed`, `subscription.charged`. Correct rupees. Same commit added `chk_payment_amount_positive CHECK (amount > 0)` to `subscription_plans`-adjacent pricing cleanup (see `supabase/migrations/_legacy/timestamped/20260328130000_remove_launch_pricing.sql`) — relevant because it means pre-2026-03-28 `amount = 0` rows could theoretically have been inserted (failed-payment branch with no amount); post-constraint, they cannot. |
| **Window B (buggy — the big one)** | 2026-04-04T11:51:39Z | 2026-07-29T07:32:41Z | `878802f9` (reintroduced — dropped the `/100` on `payment.captured` and `payment.failed`) → `bd74ddf6` (2026-04-15, "atomic monthly-subscribe + canonical webhook (P11)" rewrite, carried the bug forward unfixed and *added* the third writer — the `subscription.activated`/`subscription.charged` branch — already broken from its introduction) → `2c2ffafb` (2026-07-29, fixed for good) | **~3.5 months live**, all 3 current writer sites affected. This is almost certainly the majority of affected rows by volume, since it's the period the business was actively growing. |
| Fixed (going forward) | 2026-07-29T07:32:41Z | now | `2c2ffafb` | Current state. All 3 sites divide by 100. |

Exact commits, for anyone who wants to re-verify:
```
6a1dfee9  2026-03-26T11:04:22Z  Harden payment lifecycle: webhook activates subscriptions, idempotency  [introduces bug]
2cf04ac6  2026-03-28T16:53:43Z  (recurring-subscriptions rewrite)                                       [fixes bug — Window A closes]
878802f9  2026-04-04T11:51:39Z  fix(section-a): payment sync, plan gating, atomic usage, admin secret    [reintroduces bug — Window B opens]
bd74ddf6  2026-04-15T05:42:22Z  fix(payments): atomic monthly-subscribe + canonical webhook (P11)        [big rewrite, bug persists, 3rd writer added already-broken]
2c2ffafb  2026-07-29T07:32:41Z  fix(payments): close plan-escalation and subscription-resurrection holes (P11)  [fixes bug for good — Window B closes]
```

**Caveat on precision**: these are commit *author/committer* timestamps, not
production deploy timestamps. Vercel deploys on merge to `main` with normal
CI/CD lag (typically minutes). Treat window boundaries as accurate to within
roughly an hour, not to the second. This is exactly why the backfill plan
below does **not** rely on time windows as the primary gate — see "Detection
signals" — time windows are used only for the diagnostic breakdown and as a
sanity bound on the heuristic tier, not as the sole selector.

## What's available to build a detection heuristic

`payment_history` schema (from `supabase/migrations/00000000000000_baseline_from_prod.sql`):
```sql
CREATE TABLE IF NOT EXISTS "public"."payment_history" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "student_id" uuid NOT NULL,
    "subscription_id" uuid,
    "amount" integer NOT NULL,
    "currency" text DEFAULT 'INR'::text,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "razorpay_order_id" text,
    "razorpay_payment_id" text,
    "razorpay_signature" text,
    "razorpay_invoice_id" text,
    "payment_method" text,
    "plan_code" text,
    "billing_cycle" text,
    "receipt" text,
    "notes" jsonb DEFAULT '{}'::jsonb,
    "error_description" text,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "chk_payment_amount_positive" CHECK (amount > 0)
);
```

Key facts confirmed by reading the actual writers (not assumed):

1. **`notes->>'source'` is a reliable provenance tag.** All 3 webhook writer
   sites have always tagged `notes: { source: 'webhook', ... }` since the
   very first commit that wrote to this table (`6a1dfee9`) — confirmed via
   `git log --all -p -S"notes: { source: 'webhook'"`, every occurrence across
   history carries the tag, no historical variant lacks it.
   - `verify/route.ts`'s insert (line ~381) sets **no** `notes` at all — the
     column default `'{}'::jsonb` applies, so `notes->>'source' IS NULL` for
     every row verify has ever written. Verify has *always* stored rupees
     (`amount: priceRupees` — sourced from `subscription_plans`, never
     touched paisa).
   - `create_pending_subscription` RPC (used by `subscribe/route.ts` for the
     monthly pending row) tags `notes: {'source': 'subscribe', ...}` — always
     rupees (`p_amount_inr` passed straight through, no conversion, sourced
     from `plan.price_monthly`).
   - **Conclusion: `notes->>'source' = 'webhook'` is a necessary condition
     for a row to possibly be paisa-affected.** Rows from `verify` or
     `subscribe` were never touched by this bug — do not touch them.

2. **`payment_webhook_events.raw_payload` gives ground truth for rows from
   2026-04-25 onward.** That table (migration
   `supabase/migrations/_legacy/timestamped/20260425150000_payment_webhook_events.sql`)
   stores the *entire* raw Razorpay webhook JSON body per event, keyed by
   `(razorpay_account_id, razorpay_event_id)`, from 2026-04-25 forward (it
   didn't exist before that date). Every payment entity in that JSON carries
   its own `amount` in paisa at `raw_payload #> '{payload,payment,entity}'`,
   with `.id` matching `payment_history.razorpay_payment_id`. This lets us
   **re-derive the true amount with certainty, not a heuristic**, for any
   affected row created after 2026-04-25 — which is most of Window B by
   volume (Window B is 2026-04-04 → 2026-07-29; the event-log table covers
   2026-04-25 → 2026-07-29 of that, i.e. the back ~3 of the ~3.5 months).

3. **Plausibility bound from real plan prices**, `packages/lib/src/plans.ts`
   (`PRICING`, current) and `supabase/migrations/20260505155126_fix_pricing_family_school_plan.sql`
   (price history):
   - starter: ₹299/mo, ₹2,399/yr
   - pro: ₹699/mo, ₹5,599/yr
   - unlimited: ₹1,099/mo, ₹8,799/yr (was ₹1,499/mo, ₹11,999/yr before the
     2026-05-05 price cut — `fix_pricing_family_school_plan.sql`)
   - Yearly orders can include GST on top (`packages/lib/src/gst.ts`,
     `create-order` route) when `ff_gst_invoicing_v1` is on, pushing the
     charged amount somewhat above the base price — but nowhere close to
     ₹15,000 even at a generous tax rate on the highest-ever yearly price
     (₹11,999 × ~1.28 ≈ ₹15,359 is the extreme upper bound; realistic GST is
     lower).
   - **No legitimate single `payment_history` row, at any point in this
     product's pricing history, should ever exceed ~₹15,000.** A stored
     `amount` above that is not a real rupee charge.
   - Every real rupee price above is a whole number of rupees, so its paisa
     equivalent (`price × 100`) is always an exact multiple of 100. This
     gives a cheap corroborating check: `amount % 100 = 0`.

## Detection signals

**Signal 1 — Provenance**: `notes->>'source' = 'webhook'`. Necessary but not
sufficient (post-fix webhook rows are fine too).

**Signal 2 — Plausibility**: `amount > 15000 AND amount % 100 = 0`. Nothing
legitimate can produce this; on its own it's already very strong, but restrict
its scope with Signal 1 so we never touch a row from a code path that never
had this bug, even if some future edge case produced a large round-100 amount
there.

**Signal 3 — Ground truth** (where available, 2026-04-25 onward): join to
`payment_webhook_events.raw_payload` by `razorpay_payment_id` and compare
`payment_history.amount` to the raw paisa amount. If they're *exactly* equal,
the row is provably storing paisa, not rupees — this isn't a heuristic.

The backfill plan uses **Signal 3 as the primary correction (exact) wherever
a matching webhook event row exists**, and **Signal 1 + Signal 2 combined as
a heuristic fallback** for the older sliver of rows (2026-03-26–2026-04-25)
that predate the event-log table. Time windows from the "Corrected bug
timeline" table are used only as an extra sanity bound on the heuristic
tier, not as a hard gate (to avoid false negatives from deploy-lag
imprecision) — the magnitude+provenance combination is what actually
determines which rows get touched.

## Step 1 — Diagnostic query (READ-ONLY, run this first)

```sql
-- Read-only. Breaks down payment_history rows by which detection signal(s)
-- fire, so a human can eyeball whether Signal 1 (provenance/timing) and
-- Signal 2 (plausibility/magnitude) roughly agree before trusting either.
WITH flagged AS (
  SELECT
    ph.id,
    ph.amount,
    ph.status,
    ph.plan_code,
    ph.billing_cycle,
    ph.notes ->> 'source' AS source,
    ph.razorpay_payment_id,
    ph.created_at,
    (ph.notes ->> 'source' = 'webhook') AS is_webhook_row,
    (
      (ph.created_at >= '2026-03-26T11:00:00Z' AND ph.created_at < '2026-03-28T17:00:00Z')
      OR
      (ph.created_at >= '2026-04-04T11:00:00Z' AND ph.created_at < '2026-07-29T07:35:00Z')
    ) AS in_buggy_window,
    (ph.amount > 15000 AND ph.amount % 100 = 0) AS looks_like_paisa
  FROM payment_history ph
)
SELECT
  is_webhook_row,
  in_buggy_window,
  looks_like_paisa,
  count(*)                              AS row_count,
  min(created_at)                       AS earliest,
  max(created_at)                       AS latest,
  min(amount)                           AS min_amount,
  max(amount)                           AS max_amount,
  round(avg(amount))                    AS avg_amount
FROM flagged
GROUP BY is_webhook_row, in_buggy_window, looks_like_paisa
ORDER BY is_webhook_row DESC, in_buggy_window DESC, looks_like_paisa DESC;
```

**How to read the output:**
- `(is_webhook_row=t, in_buggy_window=t, looks_like_paisa=t)` — high-confidence
  backfill candidates. Provenance, timing, and magnitude all agree. Expect
  this bucket to dominate the affected-row count.
- `(is_webhook_row=t, in_buggy_window=t, looks_like_paisa=f)` — webhook rows
  from the buggy window that look like plausible rupee amounts. Expected for
  non-payment events that still write a `payment_history` row with a small
  amount (e.g. a genuinely-failed payment recorded with a small amount before
  it was ever charged) — sample and eyeball, don't assume these are broken.
- `(is_webhook_row=t, in_buggy_window=f, looks_like_paisa=t)` — a webhook row
  outside the estimated buggy windows that still looks like paisa. Either the
  timing estimate is off (deploy lag) or something else is wrong. Investigate
  before including in the backfill — Signal 3 below should resolve most of
  these.
- `(is_webhook_row=f, ..., looks_like_paisa=t)` — a non-webhook row (verify or
  subscribe) with an implausibly large amount. This should **not** happen per
  the code analysis above (those paths never touched paisa). If this bucket
  is non-empty, stop and investigate separately — do not fold it into this
  backfill; it may be a different bug entirely (e.g. a GST double-charge, a
  manual DB edit, or a price data-entry error in `subscription_plans`).

## Step 2 — Sample rows for manual eyeball (READ-ONLY)

```sql
SELECT id, student_id, amount, status, plan_code, billing_cycle,
       notes, razorpay_payment_id, created_at
FROM payment_history
WHERE notes ->> 'source' = 'webhook'
  AND amount > 15000
  AND amount % 100 = 0
ORDER BY created_at
LIMIT 50;
```
Confirm by eye: `amount / 100` for each sampled row should land close to one
of the known plan prices (299, 699, 1099, 1499, 2399, 5599, 8799, 11999, or a
GST-inclusive variant of those).

## Step 3 — Ground-truth cross-check via the original Razorpay payload (READ-ONLY)

```sql
-- Only returns rows where we have the original webhook payload to compare
-- against (2026-04-25 onward). For each row, "matches_paisa" = true means
-- payment_history.amount is byte-for-byte the raw paisa figure Razorpay
-- sent — proof positive of the bug, not an inference.
SELECT
  ph.id,
  ph.razorpay_payment_id,
  ph.amount                                                           AS stored_amount,
  (pwe.raw_payload #>> '{payload,payment,entity,amount}')::numeric    AS raw_paisa_from_razorpay,
  round((pwe.raw_payload #>> '{payload,payment,entity,amount}')::numeric / 100) AS derived_correct_rupees,
  (ph.amount = (pwe.raw_payload #>> '{payload,payment,entity,amount}')::numeric) AS matches_paisa,
  ph.created_at
FROM payment_history ph
JOIN payment_webhook_events pwe
  ON (pwe.raw_payload #>> '{payload,payment,entity,id}') = ph.razorpay_payment_id
WHERE ph.notes ->> 'source' = 'webhook'
ORDER BY ph.created_at;
```
Run `SELECT matches_paisa, count(*) FROM (...) t GROUP BY matches_paisa;`
over the same query to get a hard count of exactly how many rows in the
2026-04-25→2026-07-29 range are provably wrong vs. provably fine. This
number, plus the Step 1 heuristic count for the pre-2026-04-25 sliver, is
the number to get signed off before running anything.

## Step 4 — Backfill (DO NOT RUN WITHOUT SIGN-OFF)

Two tiers: exact correction where the original Razorpay payload is available,
heuristic correction only for the older rows that predate the event-log table.

```sql
BEGIN;

-- Pre-flight assertion: replace <EXPECTED_TOTAL> with the row count a human
-- has already verified via Steps 1-3 above. Aborts the whole transaction if
-- the live count has drifted since the diagnostic was run (e.g. new webhook
-- traffic landed in between) rather than silently touching more rows than
-- reviewed.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM payment_history
  WHERE notes ->> 'source' = 'webhook'
    AND amount > 15000
    AND amount % 100 = 0;
  IF v_count <> <EXPECTED_TOTAL> THEN
    RAISE EXCEPTION
      'payment_history backfill pre-flight count mismatch: expected %, found %. Aborting — re-run diagnostics before retrying.',
      <EXPECTED_TOTAL>, v_count;
  END IF;
END $$;

-- Tier 1 — exact correction using the original Razorpay payload
-- (payment_webhook_events exists from 2026-04-25 onward). Only touches rows
-- where the stored amount is byte-for-byte equal to the raw paisa figure
-- Razorpay actually sent — this is not a heuristic.
WITH ground_truth AS (
  SELECT
    ph.id,
    round((pwe.raw_payload #>> '{payload,payment,entity,amount}')::numeric / 100) AS correct_amount
  FROM payment_history ph
  JOIN payment_webhook_events pwe
    ON (pwe.raw_payload #>> '{payload,payment,entity,id}') = ph.razorpay_payment_id
  WHERE ph.notes ->> 'source' = 'webhook'
    AND ph.amount = (pwe.raw_payload #>> '{payload,payment,entity,amount}')::numeric
    AND ph.amount > 15000
)
UPDATE payment_history ph
SET amount = gt.correct_amount
FROM ground_truth gt
WHERE ph.id = gt.id
RETURNING ph.id, ph.razorpay_payment_id, ph.amount AS new_amount, ph.created_at;

-- Tier 2 — heuristic correction for rows with no payment_webhook_events
-- match (i.e. older than 2026-04-25, or the dedupe RPC failed to record
-- that event — see the PAY-5 comment in webhook/route.ts). Gated on
-- provenance + magnitude + the known buggy-window timing as a sanity bound.
WITH heuristic_candidates AS (
  SELECT ph.id
  FROM payment_history ph
  LEFT JOIN payment_webhook_events pwe
    ON (pwe.raw_payload #>> '{payload,payment,entity,id}') = ph.razorpay_payment_id
  WHERE ph.notes ->> 'source' = 'webhook'
    AND ph.amount > 15000
    AND ph.amount % 100 = 0
    AND pwe.id IS NULL   -- Tier 1 already handled anything with ground truth
    AND (
      (ph.created_at >= '2026-03-26T11:00:00Z' AND ph.created_at < '2026-03-28T17:00:00Z')
      OR
      (ph.created_at >= '2026-04-04T11:00:00Z' AND ph.created_at < '2026-07-29T07:35:00Z')
    )
)
UPDATE payment_history ph
SET amount = round(ph.amount / 100.0)
FROM heuristic_candidates hc
WHERE ph.id = hc.id
RETURNING ph.id, ph.razorpay_payment_id, ph.amount AS new_amount, ph.created_at;

-- STOP. Manually review both RETURNING result sets above:
--  - every new_amount should be a plausible plan price (299/699/1099/1499/
--    2399/5599/8799/11999 or a GST-adjusted variant)
--  - row counts should match what was signed off
-- Only then:
-- COMMIT;
-- If anything looks wrong:
-- ROLLBACK;
```

## Rollback plan

1. **Before COMMIT**: just `ROLLBACK`. Nothing is touched until commit.
2. **After COMMIT, if the backfill turns out wrong**: the transaction's
   `RETURNING` output (capture it to a file before committing) contains
   every `(id, old value is not retained — see note below, new_amount)`
   pair touched. To be safe, **run a companion "snapshot" `SELECT`
   capturing `id, amount, updated diagnostic flags` to a temp table or
   exported CSV immediately before Step 4**, e.g.:
   ```sql
   CREATE TABLE payment_history_amount_backfill_20260729_snapshot AS
   SELECT id, amount AS amount_before_backfill, razorpay_payment_id, created_at
   FROM payment_history
   WHERE notes ->> 'source' = 'webhook' AND amount > 15000 AND amount % 100 = 0;
   ```
   This snapshot table is the actual rollback vehicle — restoring is
   `UPDATE payment_history ph SET amount = s.amount_before_backfill FROM payment_history_amount_backfill_20260729_snapshot s WHERE ph.id = s.id;`
   Keep this snapshot table around for at least 90 days after the backfill,
   then drop it.
3. **Independent fallback (no snapshot needed)**: for any individual row,
   the true amount can always be re-derived from Razorpay directly — call
   `GET /v1/payments/{razorpay_payment_id}` via the Razorpay API
   (`packages/lib/src/razorpay.ts` already has an authenticated client) and
   read `.amount` (paisa) from the response, divide by 100. This works for
   every row that has a `razorpay_payment_id`, regardless of whether a
   local snapshot exists, and is authoritative (it's Razorpay's own ledger).
   Razorpay retains payment records indefinitely on their side, so this
   fallback has no expiry.

## Follow-up (after backfill lands and is verified stable)

1. Update the stale column comment to reflect the corrected timeline:
   ```sql
   COMMENT ON COLUMN public.payment_history.amount IS
     'Amount in INR rupees. Backfilled 2026-07-29 for rows written by the
      Razorpay webhook handler during two historical bug windows
      (2026-03-26–2026-03-28 and 2026-04-04–2026-07-29) that stored raw
      paisa instead of rupees — see docs/runbooks/payment-history-amount-backfill.md.';
   ```
   (Ship as a small additive migration, not a hand-edit — per
   `supabase-patterns` conventions.)
2. Drop the `payment_history_amount_backfill_20260729_snapshot` table once
   the backfill has been stable in production reporting/reconciliation for
   at least one full billing cycle (90 days is a reasonable floor given
   yearly plans exist).
3. Consider a regression test (owned by `testing`, reviewed by `backend`)
   that asserts every `payment_history` writer in the codebase stores an
   `amount` within a plausible rupee bound (e.g. `< 15000`) for the known
   plan set — this would have caught both the original bug and its
   reintroduction at CI time instead of 3.5 months into production.
4. Consider whether `ceo@alfanumrik.com` / finance wants the affected
   `payment_history.amount` correction reflected in any downstream revenue
   reporting (super-admin MRR dashboards, GST filings, etc.) that may have
   read the paisa-inflated figures during the affected windows — that is an
   `ops`-owned question, not a backend one, and is out of scope for this
   runbook.

## Sign-off checklist

- [ ] Diagnostic query (Step 1) run against production (read-only), output
      reviewed.
- [ ] Sample rows (Step 2) eyeballed — `amount/100` lands on a real plan price.
- [ ] Ground-truth cross-check (Step 3) run — `matches_paisa` count matches
      expectations.
- [ ] Snapshot table created (see Rollback plan) before running Step 4.
- [ ] `<EXPECTED_TOTAL>` in the Step 4 pre-flight assertion filled in with the
      count confirmed in Steps 1-3.
- [ ] Explicit written approval from `ceo@alfanumrik.com` (or delegate) to run
      the `UPDATE` statements in Step 4.
- [ ] Backfill run inside a transaction; `RETURNING` output reviewed before
      `COMMIT`.
- [ ] Follow-up items above tracked (column comment migration, snapshot
      retention, regression test).
