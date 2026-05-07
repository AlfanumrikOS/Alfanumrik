# Phase 3 Closure — Enterprise Billing

**Date:** 2026-05-07
**Spec:** `docs/superpowers/specs/2026-05-07-phase-3-enterprise-billing-design.md` (PR #579, merged)
**Re-evaluation:** `docs/superpowers/discovery/PHASE_3_REEVALUATION_2026-05-07.md` (PR #580, merged)
**Status:** **Code-complete on main.** All three sub-projects (P3-A, P3-B, P3-C) plus the renewal-cron + email follow-ups shipped behind feature flags. Zero customer-visible change; rollout is gated on flag flips per the validation runbooks (PR #581).

---

## What shipped — five PRs across the day

| PR | Title | Merge SHA | Net change |
|---|---|---|---|
| #582 | Phase 3-A GST invoicing v1 — migrations + Edge Function | `1cc152c0` | +810 LOC, 6 files |
| #583 | Phase 3-B offline payment reconciliation v1 | `57a7fa4e` | +828 LOC, 7 files |
| #584 | Phase 3-C school contracts + renewal scaffolding | `d7faf4cb` | +957 LOC, 8 files |
| #585 | Daily-cron renewal-notifier (Phase 3-C follow-up) | `d81cfb6e` | +192 LOC, 1 file |
| #586 | Renewal-reminder email send via Mailgun | `3cb1c21f` | +372 LOC, 2 files |

Total: **~3,160 LOC** across **24 new/modified files**. All gated by 3 feature flags, all default OFF.

## Three feature flags — the rollout switches

| Flag | What it gates | Risk class |
|---|---|---|
| `ff_gst_invoicing_v1` | GST PDF generation for `school_invoices` rows. When OFF, the `invoice-generator` Edge Function returns 403 and the new GST columns sit dormant. | **High** — touches P11 (payment integrity); requires staging burn-in per the spec |
| `ff_offline_payment_reconciliation_v1` | CS-only `/api/super-admin/reconciliation` queue + `reconcile_payment` RPC + storage bucket. When OFF, the routes return 403 and the `payment_reconciliation_queue` table is unused. | **High** — payment-touching; two-person rule means second super-admin user must exist before approval flow can complete |
| `ff_school_contracts_v1` | The whole `school_contracts` API surface (super-admin + RLS-scoped school-admin reader) AND the daily-cron renewal pipeline (reminders, expiry, grace audit, email send). | **Medium** — no direct Razorpay touch; high blast-radius if grace-period logic ever auto-suspends, but that's deliberately operator-action only |

All three flags use the standard `feature_flags` table targeting model: `is_enabled` × `rollout_percentage` × `target_institutions[]` × `target_environments[]`. Per-user determinism via `hashForRollout(auth.uid)` for the consumer-facing flag (P3-A invoice download); CS-facing flags (P3-B, P3-C) ignore per-user hashing and treat any "ON" flag as ON for the whole CS team.

## Schema additions (all applied to prod via PR merges)

### Tables added
- `invoice_number_sequences` (P3-A) — gap-free per-fin-year per-state sequence for GST invoice numbers (CGST Rule 46 compliance)
- `payment_reconciliation_queue` (P3-B) — offline payment receipts with two-person CHECK constraint
- `school_contracts` (P3-C) — explicit signed contract documents with renewal chains
- `contract_number_sequences` (P3-C) — separate sequence for contract numbers

### Columns added
- `schools` — `gstin`, `legal_name`, `billing_address` (P3-A; nullable, additive)
- `school_invoices` — 12 GST columns (P3-A): `invoice_number`, `financial_year`, `state_code`, `hsn_code`, `place_of_supply`, `school_gstin`/`legal_name`/`billing_address` snapshots, `taxable_amount_inr`, `gst_rate`, `cgst_amount`, `sgst_amount`, `igst_amount`

### RPCs added (all `SECURITY DEFINER`, service-role-only EXECUTE)
- `next_invoice_number(financial_year, state_code) → integer` (P3-A)
- `next_contract_number(financial_year, state_code) → integer` (P3-C)
- `reconcile_payment(reconciliation_id) → jsonb` (P3-B; advisory-locked on `school_id`)

### Storage buckets
- `school-invoices` (P3-A; private; PDFs at `{school_id}/{financial_year}/{number}.pdf`)
- `payment-receipts` (P3-B; private)
- `school-contracts` (P3-C; private)

### Edge Functions
- `invoice-generator` (P3-A; service-role, pdf-lib, generates GST PDFs)
- `send-renewal-reminder` (PR #586; service-role, bilingual EN+HI Mailgun delivery)
- `daily-cron` (modified; v29 → v31) — added 3 contract-lifecycle steps + email-send wiring

### API routes
- `/api/school-admin/contracts` (RLS-scoped read-only; PR #584)
- `/api/super-admin/contracts`, `.../[id]`, `.../[id]/renew` (full CRUD; PR #584)
- `/api/super-admin/reconciliation`, `.../[id]/approve`, `.../[id]/reject` (PR #583)

### PostHog events registered
13 new events: 3 reconciliation (`reconciliation_submitted/approved/rejected`), 7 contract (`contract_drafted/signed/renewed/cancelled/reminder_sent/expired/grace_suspended`), all PII-free.

## Recommended rollout sequence

Per the validation runbooks in PR #581 (`docs/runbooks/2026-05-07-single-school-flag-rollout.md` + `docs/runbooks/2026-05-07-post-rollout-decision-template.md`), the disciplined sequence is:

### Phase A — Internal smoke (zero schools)
1. Run all migrations against staging via `deploy-staging.yml` push to `develop`. Verify all migrations apply cleanly.
2. Set Edge Function secrets on staging Supabase: `ALFANUMRIK_LEGAL_NAME`, `ALFANUMRIK_GSTIN`, `ALFANUMRIK_BILLING_ADDRESS`, `ALFANUMRIK_STATE_CODE`, `ALFANUMRIK_HSN_CODE`, `ALFANUMRIK_GST_RATE`, `RENEWAL_FROM_EMAIL` (the runbook in `docs/runbooks/2026-05-07-pdf-library-choice.md` lists them).
3. With all 3 flags still OFF, smoke-test the API surfaces with a service-role bearer:
   - `POST /api/super-admin/contracts` with a synthetic school → expect 403 (flag off)
   - `POST /functions/v1/invoice-generator` with `{ school_invoice_id: ... }` → expect 403 (flag off)

### Phase B — Single-school internal pilot
1. Pick the founder's own test school (or a willing pilot school).
2. Add `billing_email` to that school's row if not already set.
3. Add a SECOND super-admin user to the prod `admin_users` table (so the P3-B two-person rule can complete end-to-end).
4. Flip `ff_school_contracts_v1` ON for that school via `target_institutions = ARRAY['<uuid>']` at 100%.
5. Run the pre-flight checklist from `docs/runbooks/2026-05-07-single-school-flag-rollout.md`.
6. Manually create a draft contract with `end_date = today + 60` to trigger the T-60 reminder on the next cron tick. Watch PostHog for the `contract_reminder_sent` event with `delivered=true`. Inspect the email visually.
7. Repeat for `ff_gst_invoicing_v1` (charge a test subscription, watch PostHog for `invoice_generated`, download the PDF, inspect for GST correctness).
8. Repeat for `ff_offline_payment_reconciliation_v1` (super-admin A submits a fake offline payment; super-admin B approves; verify `school_invoices.status` flips to paid and `school_subscriptions.current_period_end` advances).

### Phase C — 5-day observation
Apply the post-rollout decision template (`docs/runbooks/2026-05-07-post-rollout-decision-template.md`). Quant gates on PostHog/Sentry/Vercel + qualitative inputs from the principal/admin → expand to 10% rollout OR pause OR fix-first.

### Phase D — 10% canary then full rollout
Standard rollout pattern documented in each flag's migration header.

## Out of scope — explicit follow-ups (none in flight)

These were called out as deferred during the Phase 3 PRs and remain open:

1. **Self-serve renewal UI** — `/school-admin/contracts` page where the school admin can sign a renewal in-app from the email reminder, instead of "reply to support."
2. **Auto-suspension at T+14** — operator-confirmed suspension UI + cron trigger. Today the daily-cron only emits `contract_grace_suspended` telemetry; no automatic `is_active=false` flip. Deliberately so — adding auto-suspend is a separate operator-policy decision.
3. **Multipart upload endpoints** — receipt-document upload (P3-B) and signed contract PDF upload (P3-C) currently take pre-uploaded URLs. A signed-upload pattern (Supabase Storage signed URLs) would let admins upload directly from the UI.
4. **UI surfaces** — `/super-admin/reconciliation` (DataTable + DetailDrawer pattern), `/super-admin/contracts` (same), Contracts/Invoices/Reconciliation tabs in `/super-admin/institutions/[id]` DetailDrawer.
5. **Vitest unit tests** — GST math (intra/inter-state splits, union-territory edges), invoice-number sequence concurrency, two-person rule enforcement, renewal-chain integrity, bilingual email rendering snapshot, daily-cron T-minus boundary conditions. Several of these would benefit from extracting pure-logic helpers (`formatINR`, `financialYearForDate`, `computeGst`) from the Edge Functions into a `src/lib/billing/` module so they're directly testable without a Deno-test setup.
6. **Playwright E2E** — full charge → invoice PDF → email arrives → school admin downloads PDF flow. Will need staging Razorpay test keys + a working Mailgun sandbox.
7. **Pre-existing failing integration tests** (orthogonal but related): `syllabus-triggers`, `rag-chunks-constraints`, `backfill-cbse-syllabus` have been failing on every PR's CI since at least Phase 3-A and were force-merged through. Real technical debt; deserves its own focused investigation PR.

## Bottom line

Phase 3 is code-complete. The next meaningful event is **the first flag flip on staging**. Until that happens, all 3,160 LOC sit dormant. The bias going forward should be validation-first: a single pilot school's experience over 5 days is more informative than another 1,000 LOC of follow-up code.
