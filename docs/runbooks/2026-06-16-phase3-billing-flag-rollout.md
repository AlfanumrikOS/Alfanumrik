# Runbook — Phase 3 School Self-Service Billing Flag Rollout

**Flag:** `ff_school_self_service_billing_v1`
**Audience:** super-admin operator (Pradeep) ramping the school-admin Razorpay self-service flag.
**Risk class:** HIGH — touches P11 (payment integrity). Razorpay subscription create / change / cancel.
**Status:** CEO-approved; P11-certified safe for MONTHLY by architect + backend.
**Enabled by migration:** `20260620000400_phase3_enable_school_saas_flags.sql` (global enable on apply).
**Companion runbooks:** `docs/runbooks/2026-05-07-single-school-flag-rollout.md` (pre-flight checklist), `docs/runbooks/payment-webhook-recovery.md` (if entitlement diverges), `docs/runbooks/2026-05-07-post-rollout-decision-template.md` (ramp decision).

---

## CRITICAL: MONTHLY-ONLY

Self-service billing v1 supports **monthly recurring subscriptions only**. The route
(`src/app/api/school-admin/subscription/route.ts`) hard-rejects `billing_cycle:'yearly'`
with HTTP 400 `yearly_not_supported` BEFORE any Razorpay call. Reason: the school webhook
branch (`handleSchoolSubscriptionEvent`) only matches recurring `subscription.activated` /
`subscription.charged` events; a yearly self-service sub is a one-time Order that would
never activate, stranding the school on `'trial'` with a live Razorpay sub it cannot
reconcile. Annual plans stay sales-assisted until the one-time Order path ships.

Do NOT advertise annual self-service. If a school needs annual, route them to sales.

---

## CRITICAL: this migration enables GLOBALLY — scope to pilot FIRST

The enabling migration sets `is_enabled=true, rollout_percentage=100,
target_institutions=NULL` for all five Phase 3 flags. For the four non-payment flags
(RBAC, teacher/school command center, reports depth) global is fine — they gate
already-built UI/RBAC depth with zero financial blast radius.

**For the billing flag, global-on-deploy is NOT recommended.** Per-tenant scoping IS
supported (`isFeatureEnabled` honours `target_institutions`; the route already evaluates
the flag per-school with `{ institutionId }`). Immediately after the migration deploys,
narrow the billing flag to pilot schools BEFORE any real school transacts:

```sql
-- Pin billing to 1-2 pilot schools (run right after deploy):
UPDATE feature_flags
SET is_enabled         = true,
    rollout_percentage = 100,
    target_institutions = ARRAY['<pilot_school_uuid_1>','<pilot_school_uuid_2>']::uuid[],
    updated_at         = now()
WHERE flag_name = 'ff_school_self_service_billing_v1';
```

Confirm 1 row affected. Then run the negative smoke (a non-pilot school must NOT see the
Change plan / Cancel CTAs). Only widen to GA after the pilot window passes.

---

## Recommended ramp

| Stage | Scope | Gate to advance |
|---|---|---|
| 0. Staging validation | Same flag ON for a staging school equivalent | Full monthly create + seat-change + cancel cycle succeeds on staging; webhook flips `'trial'`→`'active'`; staging Sentry clean; `/api/v1/health` 200 within 6h |
| 1. Pilot (1-2 schools) | `target_institutions = ARRAY[<pilot uuids>]` | 5-day watch list (below) all green; no orphaned Razorpay subs; webhook activation success 100% |
| 2. GA | `target_institutions = NULL, rollout_percentage = 100` | Pilot decision = SHIP (use post-rollout decision template) |

Never skip staging for a payment flag. Never jump straight to GA.

---

## Metrics to watch (per day during pilot)

| Signal | Source | Threshold to flag / act |
|---|---|---|
| **Orphaned Razorpay subscriptions** | Razorpay dashboard subs ↔ `school_subscriptions.razorpay_subscription_id` | ANY Razorpay sub with no matching school row, OR a school stuck on `'trial'` >30 min after a `school_billing_plan_change_completed` event → reconcile via payment-webhook-recovery runbook |
| **Webhook activation success rate** | `payment_webhook_events` (outcome) + Sentry | Any `subscription.activated`/`charged` for a school `notes.school_id` that did NOT flip the row to `'active'`; target = 100% |
| **Phase-2 per-school email rate-cap** | Email/notification logs + Sentry | Watch for a school triggering a burst of billing/seat notifications hitting the per-school email rate cap — a pilot school churning plans can trip it; if hit, throttle is working but note it before GA so GA volume doesn't mass-trip |
| **Duplicate `'trial'`-row race (architect LOW)** | `school_subscriptions` rows per `school_id` | architect-flagged LOW: the POST path stamps the existing provisioned `'trial'` row by `school_id` (no unique constraint on `school_id`), then falls back to INSERT if none found. A concurrent provision + first self-service POST could in theory create two `'trial'` rows. LOW likelihood; if you see >1 row per `school_id`, dedupe manually (keep the one carrying `razorpay_subscription_id`) and note it |
| New Sentry issues from pilot school | Sentry (`tags.school_id`) | Any issue >5 occurrences referencing the billing surface → roll back, investigate |
| PostHog billing funnel | PostHog | `school_billing_viewed` → `school_plan_change_started` → `school_plan_change_completed` fire in order; completed with no matching `activated` within 30 min = stuck sub |
| Backup freshness | Supabase dashboard → Backups | A <24h backup must exist before any payment-flag flip |

---

## Rollback (instant, MTTR < 60s)

```sql
UPDATE feature_flags
SET is_enabled = false, updated_at = now()
WHERE flag_name = 'ff_school_self_service_billing_v1';
```

Confirm 1 row affected. The flag evaluator returns OFF for `is_enabled=false`, so the
mutation handlers immediately go back to 403 and the UI hides the CTAs.

**Rollback caveat (financial):** any Razorpay subscription created during the open window
stays live in Razorpay and the school keeps the plan they bought. Disabling the flag stops
NEW self-service transactions only; it does NOT revoke or refund existing subs. To unwind a
specific sub: cancel it in the Razorpay dashboard + update the `school_subscriptions` row
(see payment-webhook-recovery runbook). This is why pilot scoping (1-2 schools) matters —
it bounds the financial blast radius of a bad window.

---

## What stays OFF

`ff_principal_ai_v1` (Principal AI Assistant) is NOT part of this rollout. Its backing
migration is drafted-not-applied and it needs ai-engineer P12 (AI safety) review before any
enablement. Do not flip it from this runbook.

---

## Log

Record each stage transition and watch-list reading in
`docs/operator-notes/<date>-ff_school_self_service_billing_v1-rollout.md` so the GA decision
(post-rollout decision template) has the pilot evidence to score against.
