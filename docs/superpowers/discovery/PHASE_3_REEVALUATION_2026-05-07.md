# Phase 3 Re-evaluation — 2026-05-07

**Predecessor:** `docs/superpowers/discovery/PHASE_2_CLOSURE.md` (Phase 2 closed in code).
**Spec under re-evaluation:** `docs/superpowers/specs/2026-05-07-phase-3-enterprise-billing-design.md` (queued; pending PR merge from branch `docs/queue-phase-3-billing-spec`).
**Trigger:** the spec's own caveat says "re-read before starting P3-A; pilot-school feedback may reorder." Phase 2 closure brought new evidence about what already exists in canonical.

---

## Method

1. Glob/grep canonical for tables and routes named in the Phase 3 spec.
2. Supabase MCP `execute_sql` against the prod project (`shktyoxqhundlvkiwguu`) to confirm the live schema for `school_invoices`, `school_subscriptions`, `school_contracts`, `payment_reconciliation_queue`, `invoice_number_sequences`.

## Findings

### `school_invoices` table — EXISTS, partial
Columns confirmed in prod (information_schema probe, 2026-05-07):

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| school_id | uuid | NO |
| period_start | date | NO |
| period_end | date | NO |
| seats_used | integer | NO |
| amount_inr | numeric | NO |
| status | text | NO |
| pdf_url | text | YES |
| razorpay_invoice_id | text | YES |
| created_at | timestamptz | NO |
| updated_at | timestamptz | NO |

**Missing for GST compliance** (relative to the Phase 3 P3-A spec):
- `invoice_number` (sequential per fin-year per state, no gaps — legal requirement under CGST Rule 46)
- `hsn_code`
- `place_of_supply` (state code)
- `gstin` (school's, plus our own header info on PDF)
- `gst_rate`, `cgst_amount`, `sgst_amount`, `igst_amount`
- `financial_year` (for sequence partitioning)

**Routes already shipped:**
- `src/app/api/super-admin/invoices/route.ts` — list with school/status filters, pagination, school-name join.
- `src/app/api/school-admin/invoices/route.ts` — scoped to authed school via `authorizeSchoolAdmin(req, 'institution.manage')`.

**`pdf_url` is nullable** — strongly suggests PDFs are not currently being generated for new invoices, just space reserved.

### `school_subscriptions` table — EXISTS, complete for P2-C
Columns: `id, school_id, plan, billing_cycle, seats_purchased, price_per_seat_monthly, status, razorpay_subscription_id, current_period_start, current_period_end, created_at, updated_at`. Matches what P2-C's `/api/school-admin/subscription/route.ts` reads/writes.

### `school_contracts` table — DOES NOT EXIST
Confirmed absent via information_schema. P3-C spec scope unchanged.

### `payment_reconciliation_queue` table — DOES NOT EXIST
Confirmed absent. P3-B spec scope unchanged.

### `invoice_number_sequences` table — DOES NOT EXIST
Required for P3-A's gap-free sequencing under GST law.

## Recommended spec adjustments

When the Phase 3 spec PR is merged and a follow-up edit pass happens:

### P3-A — re-scope from "create" to "extend"

The spec currently says:
> Migration: `school_invoices` table + `invoice_number_sequences` (composite primary key…)

This is wrong for `school_invoices`. The migration should **`ALTER TABLE`** to add the GST columns above, NOT `CREATE TABLE`. Specifically:

- Add columns: `invoice_number text`, `financial_year text`, `state_code text`, `hsn_code text`, `place_of_supply text`, `gstin text`, `gst_rate numeric`, `cgst_amount numeric`, `sgst_amount numeric`, `igst_amount numeric`. All nullable initially so existing rows aren't broken.
- New table `invoice_number_sequences (financial_year, state_code, last_used_number)` is still needed.
- Backfill: for any existing `school_invoices` rows, run a one-time backfill that generates retroactive invoice numbers in chronological order. Without backfill, existing invoices have no `invoice_number` and the GST compliance argument doesn't hold for past records — but legally, retroactive numbering is permitted as long as it's sequential and documented.
- The `pdf_url` column already exists; the Edge Function just writes to it.

### P3-A — webhook integration may already partly exist

The spec's step 5 says "Update `src/app/api/payments/webhook/route.ts` (P2-C will already handle `subscription.charged` for school entities by then)." Closure note found `webhook/route.ts:215` already handles `school_activated` and `school_renewed`. The Phase 3 step is reduced to: when a school subscription event creates a `school_invoices` row (which it already does, with `pdf_url=null`), enqueue an invoice-generator job that fills in the GST fields, generates the PDF, and sets `pdf_url`. Smaller change than the spec implied.

### P3-B — unchanged
`payment_reconciliation_queue` doesn't exist; full spec scope still applies.

### P3-C — unchanged in scope, decision gate intact
`school_contracts` doesn't exist. The spec's own decision gate (skip if pilot schools haven't asked for explicit contract documents) still applies.

## Net impact on Phase 3 effort

| Sub-project | Original spec estimate | Revised estimate after re-eval |
|---|---|---|
| P3-A — GST invoice PDFs | ~3 days | ~2 days (less migration work; just ALTER + new sequence table + Edge Function) |
| P3-B — Offline reconciliation | ~5 days | ~5 days (unchanged) |
| P3-C — Contracts + renewal | ~7 days | ~7 days (unchanged; decision gate may skip) |

Total revised: **9–14 solo days**, depending on whether P3-C runs.

## Open questions for the next session

1. **Backfill policy for retroactive invoice numbers** — does the user want every past `school_invoices` row numbered retroactively when P3-A migrations land, or are past invoices treated as pre-GST-compliance and grandfathered with `invoice_number = NULL`? Affects P3-A's migration shape.
2. **What does `pdf_url` currently get populated with, if anything?** If there's an existing PDF generator (somewhere in Edge Functions or a Razorpay-hosted invoice URL), P3-A may further compress.
3. **Staging environment topology** — only one Supabase project visible to the MCP. Either staging is a separate project the MCP can't see, or it's a database branch / schema. Either way, P3-A migrations need a known staging target before flipping the flag in prod.

## Recommendation

Phase 3 spec stays **queued**. When ready to start:

1. Open the Phase 3 spec PR (`docs/queue-phase-3-billing-spec`) and merge it.
2. Apply the spec edits described above ("re-scope from create to extend") on a fresh branch off main.
3. Then proceed with P3-A as the smallest sub-project.

Do NOT start P3-A until the spec edits land — otherwise the migration will collide with existing schema.
