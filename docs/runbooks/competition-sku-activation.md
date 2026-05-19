# Runbook: Competition SKU Activation

**Owner:** ops
**Audience:** ops engineer activating the ₹999/mo or ₹7,999/yr Competition SKU
**Related decisions:** See `docs/specs/2026-05-19-jee-neet-olympiad-research.md` locked decision #8

---

## Pre-flight check

Confirm all four substrate migrations (PR-1, PR-2, PR-3, PR-7) are live on the target environment. Run this sentinel query against the target Supabase project:

```sql
SELECT (SELECT count(*) FROM public.exam_papers) AS papers,
       (SELECT count(*) FROM public.question_bank WHERE source_type IN ('jee_archive','neet_archive','olympiad')) AS pyq_rows,
       (SELECT is_enabled FROM public.feature_flags WHERE flag_name = 'ff_competitive_exams_v1') AS flag_state,
       (SELECT is_active FROM public.plans WHERE plan_code = 'competition') AS plan_active;
```

Expected pre-flip state: `papers >= 5`, `pyq_rows >= 150`, `flag_state = false`, `plan_active = false`. If any value is missing, stop and escalate; the migration chain is incomplete.

## Step 1 — Razorpay plan creation

Log into the Razorpay dashboard (https://dashboard.razorpay.com) with an ops-tier account. Create two subscription plans under Subscriptions → Plans:

- **Monthly:** Name `Alfanumrik Competition Monthly`, billing cycle Monthly, amount ₹999, currency INR. Notes: `plan_code=competition; tier=competition; billing=monthly`.
- **Yearly:** Name `Alfanumrik Competition Annual`, billing cycle Yearly, amount ₹7,999, currency INR. Notes: `plan_code=competition; tier=competition; billing=yearly`.

Copy both generated `plan_id` values (format `plan_XXXXXXXXXXXXX`). Razorpay docs: https://razorpay.com/docs/api/subscriptions/#create-a-plan

## Step 2 — Database update

Run this SQL against the target Supabase project, substituting the actual plan IDs from Step 1:

```sql
UPDATE public.plans
SET razorpay_plan_id_monthly = 'plan_xxx',
    razorpay_plan_id_yearly  = 'plan_yyy'
WHERE plan_code = 'competition';
```

Verify exactly 1 row updated. The plan row remains `is_active = false` at this stage.

## Step 3 — Feature flag flip

Navigate to the super-admin Flags console at `/super-admin/flags` and toggle `ff_competitive_exams_v1` to enabled. The flag has a 5-minute server-side cache TTL — wait ~5 minutes before validating client behavior.

SQL fallback if the console is unreachable:

```sql
UPDATE public.feature_flags SET is_enabled = true WHERE flag_name = 'ff_competitive_exams_v1';
```

## Step 4 — Plan activation

```sql
UPDATE public.plans SET is_active = true WHERE plan_code = 'competition';
```

## Step 5 — Verification

Load `/exams/mock` as a free-tier student account: expect a "Competition tier required" banner blocking mock-test starts. Load the same route as a Competition-tier student: expect all seeded papers visible and startable. Confirm the Razorpay checkout opens with the correct ₹999 or ₹7,999 amount when a free-tier student clicks Upgrade.

## Rollback

Instant kill switch: in super-admin Flags console set `ff_competitive_exams_v1.is_enabled = false`. The 5-minute cache TTL means existing client sessions may still see the SKU for up to 5 minutes. For immediate hard block, also run:

```sql
UPDATE public.plans SET is_active = false WHERE plan_code = 'competition';
```

The `is_active = false` predicate is checked at every plan-tier authorization call with no cache, so the SKU is gated instantly.

## Notifications

Notify CEO (ceo@alfanumrik.com) and the on-call engineer at the moment of Step 3. Confirm Sentry dashboards show no new `payments.*` or `competition.*` error surfaces for 1 hour post-flip before declaring the rollout green. Any spike in payment-webhook errors or RBAC denials on competition routes triggers the rollback path above.
