# Alfanumrik Phase 3 — Enterprise Billing Extensions

**Date:** 2026-05-07
**Owner:** Pradeep Sharma (solo)
**Status:** Queued — do NOT start implementation until Phase 2 (P2-A → P2-B → P2-C) has closed.
**Predecessors required:**
- `2026-04-16-b2b-white-label-production-design.md` — multi-tenant foundation (RLS via `app.current_school_id`, school admin tier-3, custom domains)
- `2026-05-06-alfanumrik-upgrade-phase-2-design.md`, sub-project P2-C — school-admin Razorpay self-service subscription behind `ff_school_self_service_billing_v1`
**Working repo:** `C:\Users\Bharangpur Primary\Alfanumrik\` (canonical)

---

## Why this spec exists

P2-C ships the 80% case: a school admin pays by card, gets a Razorpay subscription, manages seats themselves. That covers private schools with corporate cards and small chains.

It does NOT cover the schools that currently can't transact with Alfanumrik at all:

1. Schools that need a **GST-compliant invoice PDF** for accounting (most CBSE schools above a certain size — they file ITC and need our HSN, GSTIN, place-of-supply on a numbered invoice).
2. Schools (especially government-aided and large private chains) that **pay by PO / bank transfer / cheque**, not cards. They need an offline reconciliation flow.
3. Schools that want an **explicit signed contract document** with renewal terms separate from a receipt — for board approval and audit trail.

These are the deal-blockers from the brainstorming session that P2-C does not address. This spec narrows the original "B2B Billing" initiative to those three gaps, sized as three solo sub-projects each behind its own feature flag.

## Caveat — defer before implementing

By the time Phase 2 closes, pilot-school feedback should inform whether all three sub-projects are still the right priorities. Re-read this spec before starting P3-A; if the gap that's actually biting is different (e.g., bulk provisioning, parent-billing splits, multi-currency), throw out the relevant sub-project rather than building it on principle.

## Goal

When Phase 3 closes, all of the following are true:

- Any school subscription event in `school_subscriptions` (created, charged, cancelled) automatically generates a numbered, GST-compliant invoice PDF, downloadable by the school admin and visible in super-admin.
- A super-admin user can record an offline payment (PO / UTR / cheque) against a school invoice; a second super-admin user must approve it before it activates the subscription period.
- A super-admin user can attach a signed contract document to a school, optionally chained across renewals, and the system emits renewal reminders at T-60 / T-30 / T-15 / T-7 / T-1.

That's the entire scope. Anything bigger gets its own spec.

## Non-goals

- Replacing P2-C. P2-C remains the primary billing path; this is additive.
- Bulk multi-CSV provisioning. The existing `super-admin/bulk-upload` flow is sufficient until pilot schools say otherwise — drop-in candidate for a separate spec, not this one.
- Multi-currency or non-INR pricing.
- New plans or pricing tiers (those go through user-approval gates per `.claude/CLAUDE.md`).
- New school-admin RBAC permissions beyond what the April white-label spec already defines.
- Refunds and credit notes (Phase 4 candidate if needed).

## Shared rules (apply to P3-A, P3-B, P3-C)

- **Branch-per-sub-project**, draft PR, never auto-merged. Names: `feat/phase-3a-gst-invoicing`, `feat/phase-3b-offline-reconciliation`, `feat/phase-3c-school-contracts`.
- **Feature flag per sub-project**, default off, 0% rollout. P3-A: `ff_gst_invoicing_v1`. P3-B: `ff_offline_payment_reconciliation_v1`. P3-C: `ff_school_contracts_v1`.
- **No production Razorpay calls during implementation.** Test mode keys only; switch to live is a user action.
- **Verification before completion** — `npm run type-check && npm run lint && npm run test` green; build best-effort.
- **Staging burn-in is mandatory** before any Phase 3 PR is marked ready-to-merge — `deploy-staging.yml` workflow runs the change against the staging Supabase, the staging Razorpay test integration, and the E2E suite. This is non-negotiable because every sub-project touches P11 (payment integrity).
- **Bilingual parity** for any user-visible string (`isHi` pattern).
- **No new SaaS dependencies.** PDF generation uses what's already viable in Deno Edge Functions (spike in P3-A step 1 picks the lib — `pdfmake` and `@react-pdf/renderer` are the leading candidates; if neither works cleanly, fall back to a Node-side helper Edge Function, not a new external service).
- **Telemetry first.** Every new user-visible code path emits at least one PostHog event before the first commit-of-substance.

## Sub-project P3-A — GST Invoice PDF generation

**Branch:** `feat/phase-3a-gst-invoicing`. **Estimated effort:** ~3 days solo. **Flag:** `ff_gst_invoicing_v1`.

**Why first:** smallest piece, unlocks revenue conversations with mid-size CBSE schools immediately, foundation for P3-B (which writes payment events against the same invoice rows).

**Sub-steps in order:**

1. **PDF library spike (~2 hours).** Confirm one of `pdfmake`, `@react-pdf/renderer`, or `pdf-lib` works in a Supabase Edge Function (Deno) and renders a sample GST invoice with line items, tax breakup, GSTIN, and place-of-supply. Document the chosen library and rationale in a runbook under `docs/runbooks/` named with the date the spike runs (e.g., `YYYY-MM-DD-pdf-library-choice.md`). If none work cleanly, ship the PDF generator as a Node-runtime Next.js API route instead and skip the Edge Function — note the bundle-size impact (P10).

2. **Migration: `school_invoices` table** + `invoice_number_sequences` (composite primary key on `(financial_year, state_code)`, with `last_used_number int`). RLS: super-admin sees all; school-admin tier-3 sees their own school's invoices only. RPC `next_invoice_number(financial_year, state_code)` uses `pg_advisory_xact_lock` to atomically increment and return — no gaps tolerated (legal requirement under GST law).

3. **Migration: `ff_gst_invoicing_v1` flag.** Mirror the existing flag-migration pattern.

4. **Edge Function `invoice-generator`** (or Node API equivalent per step 1). Input: `school_invoice_id`. Output: PDF stored in a private Supabase storage bucket `school-invoices` keyed by `{school_id}/{financial_year}/{invoice_number}.pdf`. Returns signed URL with 7-day expiry on demand.

5. **Webhook integration.** Update `src/app/api/payments/webhook/route.ts` (P2-C will already handle `subscription.charged` for school entities by then). Add a side-effect: after the school subscription RPC succeeds, enqueue an invoice generation job. The webhook itself stays atomic; PDF generation is async.

6. **API: `GET /api/school-admin/invoices`** — paginated list scoped to school. **`GET /api/school-admin/invoices/[id]/pdf`** — generates signed URL on demand (PDF lifetime in storage is permanent; URL is short-lived).

7. **API: `GET /api/super-admin/schools/[id]/invoices`** — same data, super-admin scope.

8. **UI in `school-admin/billing/page.tsx`**: add "Invoices" tab listing past invoices with PDF download. UI in `super-admin/institutions/[id]` detail drawer: invoices tab.

9. **Telemetry.** PostHog: `invoice_generated`, `invoice_downloaded` (with `actor_role`).

10. **Tests.** Vitest unit tests for the GST calculation (intra-state CGST+SGST split, inter-state IGST, union-territory edge cases) and the invoice-number sequence generator (concurrent-call safety). Playwright E2E: charge a test subscription, verify invoice row + PDF appear within 30 seconds.

11. **Type-check, lint, vitest, build, staging burn-in. Open draft PR.**

**Done when:** every successful charge in P2-C's flow produces a downloadable GST PDF with no sequence gaps, behind `ff_gst_invoicing_v1`, draft PR open with CI green.

## Sub-project P3-B — Offline payment reconciliation

**Branch:** `feat/phase-3b-offline-reconciliation`. **Estimated effort:** ~5 days solo. **Flag:** `ff_offline_payment_reconciliation_v1`.

**Why second:** depends on P3-A's invoice rows existing. Without it, govt-aided schools can't transact at all.

**Sub-steps in order:**

1. **Migration: `payment_reconciliation_queue` table.** Columns: `id`, `invoice_id` (FK), `expected_amount_inr`, `received_amount_inr`, `payment_method` ENUM(`po`, `bank_transfer`, `cheque`, `upi_offline`), `reference_number` (UTR / cheque number / PO number), `receipt_document_url` (private bucket), `submitted_by_user_id`, `submitted_at`, `approved_by_user_id` (nullable), `approved_at` (nullable), `status` ENUM(`pending`, `approved`, `rejected`, `reconciled`), `notes`. RLS: super-admin only. CHECK constraint: `submitted_by_user_id != approved_by_user_id` enforced at the row level.

2. **Migration: flag.**

3. **RPC `reconcile_payment(reconciliation_id)`** — atomic: marks invoice paid, extends `school_subscriptions.current_period_end` by the appropriate cycle, marks reconciliation row `reconciled`. Mirrors the advisory-lock + idempotency pattern from `activate_subscription`. Refuses to run if status is not `approved` or if the underlying invoice is already paid.

4. **API: `POST /api/super-admin/reconciliation`** — submit a reconciliation row. Multipart for the receipt upload. Validates the invoice exists, is unpaid, amount matches within tolerance (configurable, default ₹1).

5. **API: `PATCH /api/super-admin/reconciliation/[id]/approve`** — second user approves. Calls the RPC; the CHECK constraint ensures the same user can't both submit and approve.

6. **API: `PATCH /api/super-admin/reconciliation/[id]/reject`** — first or second user can reject with a reason. Status becomes `rejected`, no further action.

7. **UI in `super-admin/reconciliation/page.tsx`**: list of pending rows, color-coded by age, with submit and approve actions. Reuse `DataTable` and `DetailDrawer` from existing super-admin pattern.

8. **Audit log entries** for every state transition, via existing `lib/audit.ts`. PII redacted per P13.

9. **Telemetry.** `reconciliation_submitted`, `reconciliation_approved`, `reconciliation_rejected`.

10. **Tests.** Unit tests for the two-person CHECK enforcement and the amount-tolerance logic. Playwright E2E: super-admin user A submits with a sample receipt → user B cannot approve as user A; user A logs out, user B logs in, approves; subscription period extends; invoice marked paid.

11. **Type-check, lint, vitest, build, staging burn-in. Open draft PR.**

**Done when:** offline payments can be recorded and approved end-to-end with two-person enforcement, behind `ff_offline_payment_reconciliation_v1`, draft PR open with CI green.

## Sub-project P3-C — School contracts and renewal automation

**Branch:** `feat/phase-3c-school-contracts`. **Estimated effort:** ~7 days solo. **Flag:** `ff_school_contracts_v1`.

**Why third (and possibly skippable):** revenue impact is real but smaller than P3-A and P3-B. Some schools are happy with invoice + receipt and don't need a separate contract document. **Re-evaluate the need before starting.** If pilot schools haven't asked for it, defer to Phase 4 and ship the freed time elsewhere.

**Sub-steps in order:**

1. **Decision gate:** read pilot CS notes; only start if at least one signed school has explicitly asked for a contract document or a renewal-reminder workflow. If neither, mark this sub-project deferred and update the spec.

2. **Migration: `school_contracts` table.** Columns: `id`, `school_id` (FK), `previous_contract_id` (nullable, self-FK), `contract_number` (sequential per fin-year, separate sequence from invoice numbers), `start_date`, `end_date`, `billing_cycle` ENUM(`monthly`, `quarterly`, `annual`), `seats_purchased`, `value_inr`, `pdf_url` (signed contract upload, private bucket), `signed_at`, `signed_by_school_user_id`, `signed_by_internal_user_id`, `status` ENUM(`draft`, `active`, `expiring`, `expired`, `cancelled`, `renewed`), `notes`. RLS: super-admin sees all; school-admin sees own school. Triggers: any insert with `start_date` overlapping an existing active contract for the same school must fail.

3. **Migration: flag.**

4. **API: `POST /api/super-admin/schools/[id]/contracts`** to create draft. **`PATCH /api/super-admin/contracts/[id]/sign`** to attach signed PDF and mark active. **`POST /api/super-admin/contracts/[id]/renew`** to chain a new contract carrying forward seat count and dates, then transition the previous one to `renewed`.

5. **Edge Function update: `daily-cron` invokes a new helper that scans contracts where `end_date` is at T-60 / T-30 / T-15 / T-7 / T-1.** Sends one reminder email per checkpoint to the school billing contact, CCs internal CS. Idempotent — same checkpoint never sends twice (tracked via a `contract_reminder_log` table or a JSONB array on the contract row, whichever is simpler).

6. **Grace and expiry behavior.** At T-0, status moves to `expired` but service continues for 14 days (grace). At T+14, suspension flag flips on the school (existing `is_active` mechanism), surfaces a "renewal needed" page on next school-admin login. At T+90, no further automated action — leave to manual archive.

7. **UI in `super-admin/institutions/[id]` detail drawer:** Contracts tab listing current and historical contracts with PDF download, sign action, renew action.

8. **Telemetry.** `contract_drafted`, `contract_signed`, `contract_renewed`, `contract_reminder_sent` (with `t_minus`), `contract_expired`, `contract_grace_suspended`.

9. **Tests.** Unit tests for the renewal chain integrity (a renewed contract must point to a `renewed`-status predecessor; grace-period date math). E2E: time-traveled clock fires reminders at the right T-minus checkpoints; expiry transitions service correctly.

10. **Type-check, lint, vitest, build, staging burn-in. Open draft PR.**

**Done when** (or **deferred when** the decision gate at step 1 says no): contracts can be drafted, signed, renewed, and expire predictably with reminders, behind `ff_school_contracts_v1`, draft PR open with CI green.

## Risk register

| Risk | Mitigation |
|---|---|
| GST invoice number gap (legal exposure under CGST Rule 46) | Advisory-locked RPC prevents in-flight gaps; daily reconciliation cron alerts ops if a gap appears; test for sequence-safety under concurrent calls |
| PDF library doesn't work cleanly in Deno Edge Function | Spike step in P3-A explicitly accounts for this; fallback is Node-runtime API route at the cost of bundle size |
| Two-person reconciliation gets gamed by one person with two accounts | CHECK constraint on `user_id != user_id` is the technical guard; policy enforcement (don't share accounts) is operational |
| Contract reminders spam if `daily-cron` runs twice in a day | Idempotency log keyed on `(contract_id, t_minus_checkpoint)` ensures one-shot |
| Phase 2 not closed when this spec is read | Header status says "queued"; do not start. The Phase 2 closure note is the trigger to revisit |
| Pilot schools surface different priorities by the time Phase 3 starts | Caveat at top of spec; decision gate in P3-C; CS-notes review before P3-A start |
| Razorpay test-mode keys missing in staging env | Pre-flight check at the start of each sub-project reads env first, pauses with a user-facing ask if absent |

## What "done" looks like for the whole phase

- [ ] P3-A draft PR open and CI green: GST invoices auto-generate from P2-C charge events.
- [ ] P3-B draft PR open and CI green: offline payments reconcile with two-person rule end-to-end.
- [ ] P3-C either draft PR open and CI green OR deferred-to-Phase-4 with a one-paragraph note explaining why pilot demand wasn't there.
- [ ] Auto-memory updated with Phase 3 outcome and any pivots.

When all of those are true, Phase 3 closes. Phase 4 brainstorm starts from whichever pain (school admin reporting console, teacher onboarding tour, support self-serve, content coverage matrix, pilot health telemetry) is highest after the next round of school feedback.
