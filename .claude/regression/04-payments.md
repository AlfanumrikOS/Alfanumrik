## Portal RBAC/SaaS remediation Phase 3 — school self-service billing P11 integrity + get_admin_school_id institution_admin RLS widening (2026-06-16) — REG-152..REG-153

Source: Phase 3 of `feat/portal-rbac-saas-remediation`. Two changes, both
defense-of-an-invariant:

- **School self-service billing P11 fixes** — `POST /api/school-admin/subscription`
  (the school-admin buy-a-plan path, gated by `ff_school_self_service_billing_v1`).
  Three P11-load-bearing corrections:
  1. POST no longer sets `status='active'`. The provisioned `school_subscriptions`
     row keeps its pre-payment `'trial'` status; entitlement is granted ONLY by the
     signature-verified webhook (`handleSchoolSubscriptionEvent` →
     `subscription.activated`/`.charged`). This is the core P11 rule: never grant
     plan access without verified payment.
  2. POST writes via `UPDATE ... .eq('school_id', schoolId)` — NOT
     `upsert(..., { onConflict: 'school_id' })`. There is no unique constraint on
     `school_id` (only the `id` pkey), so the old upsert path raised Postgres 42P10
     and failed 100% of the time, orphaning the just-created Razorpay subscription.
  3. `billing_cycle='yearly'` is rejected with `400 { code:'yearly_not_supported' }`
     BEFORE any Razorpay subscription is created. Self-service v1 only supports
     monthly recurring; a yearly recurring sub would never be activated by the
     webhook (its school branch matches recurring activated/charged only), so it
     would orphan. Annual plans stay sales-assisted until the one-time-Order path
     ships.
- **get_admin_school_id() RLS widening** — migration `20260620000300` widens the
  single-value helper from teachers-only to `COALESCE(teachers-lookup,
  school_admins-lookup)` so pure institution_admins (a `school_admins` row, NO
  `teachers` row) resolve to a non-null school and regain read access to the
  school-admin read surface; the 4 named SELECT policies (school_announcements,
  school_exams, school_questions, class_enrollments) are recreated to
  `OLD_PREDICATE OR is_school_admin_of(school_id)` for multi-school admins.
  ADDITIVE/WIDENING-ONLY: the teacher arm resolves FIRST (byte-identical to the
  baseline) so teacher access is preserved, and the OR-arm only ADMITS rows.

Two traps make these worth pinning:
- **The POST is a P11 cliff edge twice over.** If a future edit re-adds
  `status:'active'` to the stamp fields, a school would get full plan access the
  instant it clicks buy — before Razorpay ever charges it (P11 violation). If a
  future edit reverts to `upsert({onConflict:'school_id'})`, every POST 42P10s and
  orphans a live Razorpay sub. And if the yearly guard is dropped, a yearly POST
  silently creates an unactivatable recurring sub.
- **The RLS widening must stay widening-only.** RPC bodies are routinely copied
  forward via `CREATE OR REPLACE`; a copy that drops the `school_admins` fallback
  re-breaks every institution_admin's reads, and a policy recreate that drops the
  `OR is_school_admin_of(...)` arm silently re-narrows access. The static canary
  also guards against the migration ever turning destructive (DROP TABLE/COLUMN,
  data UPDATE, RLS-posture toggle, or shadowing `is_school_admin_of`).

Files under test:
- `src/__tests__/api/school-admin-subscription.test.ts` — the 7 new
  `POST ... P11 self-service billing integrity` cases (yearly-reject + no-orphan,
  monthly-stays-trial, stamp fields, update-by-school_id/no-onConflict, defensive
  insert stays trial, flag-OFF 403). The webhook-only-activation half of the P11
  contract is already pinned in `src/__tests__/api/school-webhook-events.test.ts`
  (subscription.activated → status active; subscription.charged → renewed) — that
  is the only path that flips the POST-stamped `'trial'` row to `'active'`.
- `src/__tests__/contract/get-admin-school-id-rls-widening.test.ts` — the static
  migration canary (function-widening shape, teacher-first COALESCE ordering, the
  4 policy recreates with the OR membership arm, additive-only safety contract).

> **ID note:** REG-151 is the previous entry (parent calendar + school broadcast,
> 2026-06-16). REG-152..REG-153 are the next free ids (the task brief referenced
> "after REG-151").

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-152 | `school_self_service_billing_p11_pre_payment_trial_and_webhook_only_activation` | **THE SCHOOL-BILLING P11 CONTRACT.** **(1) Yearly reject + no orphan:** `billing_cycle='yearly'` → `400 {success:false, error:'yearly_not_supported', code:'yearly_not_supported'}`, and `createRazorpaySubscription` is NEVER called AND no `school_subscriptions` write is issued — the reject short-circuits before any Razorpay sub exists (no orphan recurring sub the webhook can't activate). **(2) Monthly stays pre-payment trial (P11):** a valid monthly POST returns 200 but the `school_subscriptions` write carries NO `status` key at all (the provisioned row keeps its `'trial'` status) and no field equals `'active'` — entitlement is NOT granted before a signature-verified payment. **(3) Stamp fields:** the same write sets `razorpay_subscription_id` (= the created sub id), `plan`, `seats_purchased`, `billing_cycle='monthly'`, `price_per_seat_monthly`; the Razorpay sub is created with `notes.school_id = schoolId` (so the webhook can match the row). **(4) No-onConflict (42P10 regression pin):** the DB write is `.update(...).eq('school_id', schoolId)` — `update` called once, `upsert` NEVER called, no `onConflict` ever passed, keyed by `school_id`. **(5) Defensive insert path:** when the UPDATE matches no provisioned row, the route falls back to `.insert(...)` with an EXPLICIT `status:'trial'` (never `'active'`) and `school_id`/`razorpay_subscription_id` — still no `upsert`/`onConflict`. **(6) Flag gate:** `ff_school_self_service_billing_v1` OFF → `403`, `isFeatureEnabled` consulted with `{institutionId: schoolId}`, and no Razorpay sub created. **(7) Webhook-only activation (companion file):** only `subscription.activated`/`.charged` (signature-verified webhook) flips the POST-stamped `'trial'` row to `status:'active'` — asserted in `school-webhook-events.test.ts`. | `src/__tests__/api/school-admin-subscription.test.ts` (7 new P11 cases; webhook-activation companion in `src/__tests__/api/school-webhook-events.test.ts`) | U (unit; real `POST` handler with school-admin-auth/feature-flags/razorpay/posthog/supabase-admin mocked; a recording in-memory `school_subscriptions` builder captures the update vs upsert shape, the eq column, and the stamped fields) |
| REG-153 | `get_admin_school_id_institution_admin_rls_widening_additive_only` | **STATIC MIGRATION CANARY (20260620000300).** **(1) Function widening:** the migration `CREATE OR REPLACE`s `public.get_admin_school_id()`, keeps the teacher arm (`SELECT school_id FROM teachers WHERE auth_user_id = auth.uid()`), and ADDS the `school_admins` fallback arm (`SELECT school_id FROM school_admins ... is_active = true`). **(2) Teacher-first ordering (access preserved):** both arms live inside a single `COALESCE(...)`, the `FROM teachers` arm appears BEFORE the `FROM school_admins` arm, so any user with a `teachers.school_id` resolves to the identical pre-migration value (the fallback only ever fills a previously-NULL result). **(3) Baseline posture kept:** the redefined function stays `STABLE` + `SET search_path = public`. **(4) The 4 named policies widen:** each of `announcements_school_admin_select` / `school_exams_school_admin_select` / `school_questions_school_admin_select` / `class_enrollments_school_admin_select` is recreated idempotently (`DROP POLICY IF EXISTS` + `CREATE POLICY ... FOR SELECT`); the 3 flat policies keep `"school_id" = get_admin_school_id()` AND add `OR is_school_admin_of("school_id")`; class_enrollments keeps its nested `classes.school_id = get_admin_school_id()` AND adds `OR is_school_admin_of(classes.school_id)`; ≥4 `is_school_admin_of(...)` references total (OR only ADMITS rows → widening, never narrowing). **(5) Additive-only safety:** NO `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE FROM`/data `UPDATE`; the ONLY DROPs are `DROP POLICY IF EXISTS` (each paired with a recreate); NO `CREATE TABLE`, NO `ENABLE/DISABLE ROW LEVEL SECURITY` (RLS posture unchanged); does NOT redefine `is_school_admin_of` (reuses the baseline helper); does NOT touch `feature_flags`; wrapped in one `BEGIN`/`COMMIT`. | `src/__tests__/contract/get-admin-school-id-rls-widening.test.ts` (18) | U (static source-level; reads the migration SQL from disk with comments stripped — runs in the normal lane under `contract/`, not the excluded `migrations/` lane) |

### Invariants covered by this section

- P11 Payment integrity — REG-152 (school self-service billing: POST grants NO
  entitlement before a signature-verified payment — the row stays `'trial'`, only
  the verified webhook activates it; yearly is rejected before any Razorpay sub is
  created so no orphan; the write is keyed by `school_id` via UPDATE, never the
  42P10-prone `onConflict` upsert).
- P8 RLS boundary — REG-153 (`get_admin_school_id()` widening + the 4 named
  policies are additive: teacher access is preserved byte-for-byte, the OR-arm only
  admits rows for institution_admins; the migration introduces no new table, makes
  no RLS-posture change, and the only DROPs are paired DROP POLICY IF EXISTS —
  cross-tenant denial stays intact because `is_school_admin_of(B)` is false for an
  admin of school A).
- P9 RBAC enforcement — REG-152 (`ff_school_self_service_billing_v1` gates the
  self-service POST; flag OFF → 403 with no Razorpay sub), REG-153 (the widening
  restores the school-admin read surface to institution_admins WITHOUT loosening
  the role-scoped policy predicates — every read still goes through
  `get_admin_school_id()`/`is_school_admin_of()`).

### Catalog total

Pre-REG-152: 119 entries (through the parent calendar + school broadcast contract,
REG-151). Portal-remediation Phase 3 adds REG-152..REG-153: the school
self-service billing P11 contract (pre-payment trial + webhook-only activation +
yearly-reject-no-orphan + update-by-school_id/no-onConflict + flag gate) and the
get_admin_school_id institution_admin RLS widening (additive-only function +
4-policy canary, teacher access preserved). 25 tests across 2 files (7 new POST
P11 cases + 18 static RLS-canary cases; the webhook-activation companion already
existed). **Total catalog: 121 entries (target: 35 — TARGET EXCEEDED).**

---

## Portal RBAC/SaaS remediation Phase 4 — pricing single-source-of-truth: marketing per-seat price must map to a real billable tier (2026-06-16) — REG-154

Source: Phase 4 of `feat/portal-rbac-saas-remediation`. A new pricing
single-source-of-truth module (`src/lib/pricing.ts`) centralizes every price the
platform quotes or bills:

- **B2B per-seat school tiers** — `SCHOOL_SEAT_TIER_INR`
  (basic 99 / standard 199 / premium 399 / enterprise 599; default = standard 199)
  is now the SYSTEM OF RECORD for the invoice-route fallback price.
  `POST /api/super-admin/invoices` was repointed from its own hardcoded
  `SEAT_PRICES` map at `schoolSeatPriceForTier()` from the SoT — the literals are
  byte-identical, so billing is unchanged; the centralization removes the second
  copy that could drift.
- **Marketing per-seat headline** — `SCHOOL_PER_SEAT_MARKETING_INR` (the value the
  /schools marketing page quotes) is DERIVED from the lowest published billable
  tier (`SCHOOL_SEAT_TIER_INR.basic` = 99), NOT an independent literal. This is the
  REG-65-family hardening: a public "from ₹X/student/month" claim can never quote a
  number the system does not actually bill (the legacy hardcoded ₹75 mapped to NO
  tier — a brand/legal drift risk).

The trap this pins: a future edit could (a) change a tier value in the SoT while
the invoice route silently keeps billing a different (re-hardcoded) number, or
(b) repoint `SCHOOL_PER_SEAT_MARKETING_INR` at a vanity number (e.g. ₹75) that no
tier charges. Both are pricing changes requiring CEO approval; the guard turns
either into a PR-CI failure rather than a silent landing-page-vs-invoice mismatch.

Files under test:
- `src/__tests__/pricing-drift-guard.test.ts` — pins each tier literal to the
  billed amount, asserts `schoolSeatPriceForTier()` resolves identically (incl.
  case-insensitive + standard-default fallback), and asserts the marketing number
  equals the basic tier / is a member of the billable set / formats to "₹99" /
  is NOT the legacy ₹75.

> **ID note:** REG-153 is the previous entry (get_admin_school_id RLS widening,
> 2026-06-16). REG-154 is the next free id (the task brief referenced "after
> REG-153").

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-154 | `pricing_sot_marketing_maps_to_billable_tier` | **THE PRICING SINGLE-SOURCE-OF-TRUTH GUARD (P11-adjacent / REG-65 family).** **(1) Tier literals = billed amounts:** `SCHOOL_SEAT_TIER_INR` pins basic=99 / standard=199 / premium=399 / enterprise=599 — the exact per-seat amounts `POST /api/super-admin/invoices` bills via `schoolSeatPriceForTier()`; the tier set is exactly those 4 keys (no silent add/remove). **(2) Resolver parity:** `schoolSeatPriceForTier(tier)` returns the billed amount for every tier, is case-insensitive (matches invoice-route `.toLowerCase()` normalisation), and falls back to the standard tier (199) for unknown/null/undefined/empty; `SCHOOL_SEAT_DEFAULT_INR` === standard === the billed default. **(3) Marketing maps to a real billed price (REG-65 hardening):** `SCHOOL_PER_SEAT_MARKETING_INR` === `SCHOOL_SEAT_TIER_INR.basic` (99), is a MEMBER of the billable tier set, formats to the label "₹99", and is explicitly NOT the legacy hardcoded ₹75 (which maps to no tier) — so the public "from ₹X/student/month" claim cannot drift away from a number the system actually charges. | `src/__tests__/pricing-drift-guard.test.ts` (17) | U (pure source-level; imports the SoT constants/helper directly, no mocks) |

### Invariants covered by this section

- P11 Payment integrity (adjacent) — REG-154 (the B2B per-seat billing fallback
  amounts live in exactly one place; the invoice route bills off the SoT helper, so
  a tier change cannot leave the route silently charging a stale number).
- REG-65 family / landing-page pricing-verbatim drift — REG-154 (the marketing
  headline per-seat price is derived from a real billable tier and asserted to be a
  member of the billed set; a vanity number with no matching tier — the legacy ₹75
  case — fails CI).

### Catalog total

Pre-REG-154: 121 entries (through the get_admin_school_id RLS widening, REG-153).
Portal-remediation Phase 4 adds REG-154: the pricing single-source-of-truth /
marketing-maps-to-billable-tier guard (17 tests, 1 file). **Total catalog: 122
entries (target: 35 — TARGET EXCEEDED).**

**Total: 122 entries.**

## Quarterly school billing + demo-comp entitlement (P11) (2026-06-16) — REG-160..REG-161

Source: `feat/portal-rbac-saas-remediation` — per-school QUARTERLY billing on
`POST /api/school-admin/subscription` plus a sales/onboarding DEMO-COMP
entitlement (the one sanctioned exception to P11's "never grant plan access
without verified payment"). Both touch the payment-integrity invariant, so both
get a regression pin.

- **Quarterly billing (P11 — no split-brain, no pre-payment access).** A
  `billing_cycle:'quarterly'` POST selects the `razorpay_plan_id_quarterly`
  plan id (NEVER the monthly id — a quarterly request charged on the monthly
  plan would charge 1× while the DB records quarterly = split-brain billing),
  uses `totalBillingCycles=4`, carries `school_id` in Razorpay notes, and leaves
  the row at pre-payment `'trial'` (the signature-verified webhook is the only
  thing that flips it to `'active'`). When the quarterly plan id is NULL the
  route 400s with code `plan_not_provisioned`, creating NO Razorpay subscription
  (no orphan) and with NO silent monthly fallback. The webhook's school
  invoice-amount fallback multiplies seats × per-seat price × **3** for
  quarterly (×1 monthly, ×12 yearly) — a regression to ×1 would under-bill every
  quarterly school by two-thirds. `createRazorpayPlan` gained an optional
  `opts:{period,interval}` 3rd arg (quarterly = `{interval:3}` on a monthly
  period); the 2-arg call shape is unchanged (backward compatible).
- **Demo-comp server-gated boundary (the P11 exception).** A DEMO school
  (`schools.is_demo=true`, resolved ONLY from the server-side `auth.schoolId` via
  `isDemoSchool()`, never a request-body field) gets a complimentary
  `status='active'` grant with `is_demo=true`, `razorpay_subscription_id=null`,
  period stamped (+3mo quarterly / +1mo monthly), ZERO Razorpay calls,
  `{comp:true}`, and a metadata-only `subscription.comp_granted` audit (no PII).
  The comp branch runs ABOVE the quarterly null-guard, so a demo school with an
  unprovisioned quarterly plan STILL comps (intentional reorder, pinned). The
  load-bearing security boundary: a NON-DEMO school can NEVER reach the comp
  branch — `isDemoSchool` returns false → real Razorpay path; and `isDemoSchool`
  FAILS CLOSED (any error / missing row / null flag / thrown client → false), so
  a Supabase blip can never accidentally hand out a free grant.

> **ID note:** REG-159 is the previous entry (reports/parents response envelope,
> 2026-06-16). REG-160..REG-161 are the next free ids.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-160 | `school_admin_quarterly_billing_p11_no_split_brain` | **THE QUARTERLY BILLING P11 GUARD (no split-brain, no pre-payment access, no orphan).** **(1) Plan-id by cycle:** a quarterly POST creates the Razorpay sub with `razorpayPlanId='rzp_quarterly_plan'` and `totalBillingCycles=4`, and NEVER with the monthly plan id (a quarterly request charged on the monthly plan = split-brain). **(2) Pre-payment trial (P11):** the DB stamp sets `billing_cycle='quarterly'` + `razorpay_subscription_id` but sets NO `status` (row keeps pre-payment `'trial'`); no field smuggles `'active'` — only the signature-verified webhook activates. **(3) notes carry school_id** so the webhook can match + activate. **(4) Null-guard (P11, no orphan):** quarterly plan id NULL → 400 code `plan_not_provisioned`, `createRazorpaySubscription` NEVER called, and NO fallback to the (present) monthly id. **(5) Real-path guard intact:** a non-demo school with an unprovisioned quarterly plan still 400s `plan_not_provisioned` (no comp). **(6) Webhook invoice fallback ×3:** with no payment entity the school invoice amount = seats × price_per_seat_monthly × 3 × 100 paisa for quarterly (monthly ×1, yearly ×12) — captured off the `publishEvent` payload; a mutation to ×1 fails the test. **(7) createRazorpayPlan back-compat:** the 2-arg call posts `period='monthly'`, `interval=1`; `{interval:3}` posts `interval=3` (rupees→paisa ×100 at the boundary). **(8) Setup-plans provisions both cadences:** a fully-provisioned (monthly+quarterly) plan reports `monthly:already_exists; quarterly:already_exists` (no recreation); a bare plan creates both. | `src/__tests__/api/school-admin-subscription-quarterly-comp.test.ts` (quarterly happy-path + null-guard + real-path guard), `src/__tests__/payments/webhook-school-quarterly-invoice.test.ts` (3), `src/__tests__/lib/razorpay-create-plan.test.ts` (3), `src/__tests__/api/payments/status-and-setup-plans.test.ts` (repaired: both-cadence idempotency), `src/__tests__/pricing-drift-guard.test.ts` (quarterly derived-figure block) | U (unit; real POST/webhook handlers with school-admin-auth + table-aware in-memory admin mocks; fetch-stubbed createRazorpayPlan; publishEvent mock captures the computed invoice amount) |
| REG-161 | `school_admin_demo_comp_server_gated_boundary` | **THE DEMO-COMP SERVER-GATED BOUNDARY (the P11 sanctioned exception — a real school can NEVER comp).** **(1) Comp grant shape:** a demo school's POST → response `{success:true, comp:true}` with `status:'active'`, `is_demo:true`, `razorpay_subscription_id:null`; the DB row stamps the same; ZERO Razorpay calls. **(2) Period by cycle:** comp `current_period_end` is ~+3 months for quarterly, ~+1 month for monthly. **(3) Metadata-only audit (P13):** exactly one `subscription.comp_granted` audit with `metadata:{is_demo:true, billing_cycle, razorpay_subscription_id:null,…}` and NO PII (no email/phone/name keys anywhere in the audit blob). **(4) Reorder pin:** a demo school with an UNPROVISIONED quarterly plan STILL comps (the comp branch runs above the null-guard) — response is NOT `plan_not_provisioned`. **(5) THE CRITICAL BOUNDARY — non-demo can NEVER comp:** `isDemoSchool=false` → real Razorpay path (a real sub id is returned), response carries NO `comp`, the row stays pre-payment trial, and NO `subscription.comp_granted` audit fires. **(6) Fail-closed:** `isDemoSchool` is proven (directly) to return false — never throw — on is_demo=false / null / missing row / query error / thrown client / rejected maybeSingle / empty school id (no DB touch for empty id); the route therefore defaults to the payment-gated path on any predicate failure. **(7) Predicate input:** `isDemoSchool` resolves is_demo via `eq('id', schoolId)` from the server-resolved id only. | `src/__tests__/api/school-admin-subscription-quarterly-comp.test.ts` (demo comp quarterly/monthly + reorder pin + non-demo-never-comp + fail-closed), `src/__tests__/lib/is-demo-school.test.ts` (10) | U (unit; real POST handler with isDemoSchool + logSchoolAudit mocked at the boundary; direct is-demo-school predicate test with a table-aware admin mock) |

### Invariants covered by this section

- P11 Payment integrity — REG-160 (quarterly: plan-id-by-cycle with no
  monthly fallback, pre-payment `'trial'` until the signature-verified webhook
  activates, null-guard creates no orphan Razorpay sub, ×3 invoice multiplier);
  REG-161 (the demo-comp exception is the ONLY way to reach `status='active'`
  without a verified payment, and it is reachable ONLY by a server-resolved
  `is_demo=true` school — a real school can never comp, even on a Supabase blip,
  because `isDemoSchool` fails closed).
- P13 Data privacy — REG-161 (the `subscription.comp_granted` audit is
  metadata-only: no email/phone/name in the audit blob).

### Catalog total

Pre-REG-160: 127 entries (through the reports/parents response-envelope contract,
REG-159). Quarterly school billing + demo-comp adds REG-160..REG-161: the
quarterly-billing P11 guard (plan-id-by-cycle, pre-payment trial, null-guard /
no-orphan, ×3 invoice fallback, createRazorpayPlan back-compat, both-cadence
setup-plans idempotency) and the demo-comp server-gated boundary (comp grant
shape + metadata-only audit + the load-bearing "non-demo can never comp" +
fail-closed predicate). 2 entries across 6 test files (4 new: the
quarterly+comp route test, the webhook quarterly-invoice test, the
createRazorpayPlan back-compat test, the is-demo-school predicate test; 2
extended/repaired: pricing-drift-guard quarterly block + status-and-setup-plans
both-cadence idempotency, repaired to the new behavior not weakened). **Total
catalog: 129 entries (target: 35 — TARGET EXCEEDED).**

**Total: 129 entries.**

## Engineering-Audit Cycle 2 — Payments & Subscriptions (P11) — 2026-06-29

Source: engineering-audit program, Cycle 2 (Payments & Subscriptions). P11
forbids granting plan access without a server-verified payment, and P9 requires
RBAC enforcement before any side effect. This cycle gave both guarantees
executable, handler-level coverage on the two live web payment entry points:
the verify route (HMAC re-derivation gate before any plan grant) and the
subscribe route (RBAC gate before any Razorpay object is minted or service-role
DB is touched).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-178 | `verify_route_hmac_reject` | The `/api/payments/verify` route re-derives the Razorpay HMAC server-side and treats it as the sole authority for granting a plan. A client-supplied `razorpay_signature` that does NOT match the server-derived HMAC — whether the wrong shared secret was used or the signature is the wrong length — yields HTTP 401 and performs NO `payment_history` insert and NO `activate_subscription_locked` (plan-grant) RPC call (no plan access without a valid signature — P11 rules 1+3). A correctly-derived signature passes the gate and proceeds to the grant path. | `src/__tests__/api/payments/verify-hmac-reject.test.ts` | E |
| REG-179 | `subscribe_rbac_gate_pre_razorpay` | The live web checkout entry `/api/payments/subscribe` calls `authorizeRequest('payments.subscribe')` as its first gate. On deny it returns the verbatim 403/401 from `authorizeRequest` and short-circuits BEFORE any Razorpay order/subscription object is minted and BEFORE any service-role DB write — the deny path performs zero Razorpay SDK calls and zero privileged DB I/O (P9 RBAC enforcement guarding the P11 payment funnel). | `src/__tests__/api/payments-subscribe-rbac.test.ts` | E |

### Invariants covered by this section

- P11 (payment integrity — never grant plan access without a server-verified
  signature; the verify route is the gate that re-derives the HMAC and is the
  sole authority for the `activate_subscription_locked` plan grant)
- P9 (RBAC enforcement — `/api/payments/subscribe` runs `authorizeRequest`
  before any Razorpay object is minted or service-role DB is touched; deny
  short-circuits with the verbatim status)

### Catalog total

Pre-REG-178: 144 entries (through Engineering-Audit Cycle 1's REG-177
`send-auth-email`-always-200). Engineering-Audit Cycle 2 adds REG-178
(verify-route HMAC reject — no plan grant without a valid server-derived
signature) and REG-179 (subscribe-route RBAC gate before any Razorpay/service-
role side effect).
**Total catalog: 146 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — PAY-2: Consumer Pricing Source-of-Truth (P11-adjacent) — 2026-06-29

Source: remediation program, item PAY-2 (consumer pricing source-of-truth).
Consumer plan prices live in FOUR places that must agree: web `src/lib/plans.ts`
(`PRICING`, rupees), the server paisa constant `src/lib/pricing.ts`
(`CONSUMER_PRICING_PAISA`, which the Razorpay create-order route now imports
instead of inlining its own literals), mobile `mobile/lib/data/models/subscription.dart`
(rupees), and the live DB `subscription_plans` table (paisa, seeded by migration
`20260505155126`). PAY-2 collapses the create-order path onto the shared paisa
constant so the three CODE mirrors are provably consistent, and pins the ONE
known code↔DB divergence (`unlimited`) as a visible CI fact pending CEO
reconciliation (PAY-2 open question #1). No price is changed by PAY-2 itself —
this is a source-of-truth consolidation, not a pricing change (pricing changes
require user approval).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-195 | `consumer_pricing_code_sot_parity` | P11-adjacent (billing-trust): the consumer pricing CODE mirrors are mutually consistent — web `src/lib/plans.ts` `PRICING` ×100 === `src/lib/pricing.ts` `CONSUMER_PRICING_PAISA` (the constant the Razorpay create-order route now imports) === mobile `mobile/lib/data/models/subscription.dart` ×100, for every plan+period; assertion is non-vacuous (>=3 plans matched on each side). Extends REG-191/XC-6 (mobile↔web parity) to the server paisa constant → a four-way code-mirror lock so any future code drift in any of the three files fails CI. | `src/__tests__/payments/consumer-pricing-sot-drift.test.ts` | E |
| REG-196 | `consumer_pricing_db_divergence_pin` | P11-adjacent: pins the KNOWN live DB↔code `unlimited` divergence — DB `subscription_plans.unlimited` (₹1099/8799, migration `20260505155126`, web-checkout path) DIFFERS from the code mirror (₹1499/11999, mobile/create-order path). Documents the exact known state as a visible CI fact (NOT a parity assertion), so the divergence is undeniable in the test suite; designed to go RED the moment the CEO reconciles DB↔code (PAY-2 open question #1), at which point it is tightened into a DB===code parity assertion. | `src/__tests__/payments/consumer-pricing-sot-drift.test.ts` | E |

### Invariants covered by this section

- P11 (payment integrity, billing-trust adjacent) — REG-195 locks the three
  consumer-pricing CODE mirrors (web rupees, server paisa constant now imported
  by create-order, mobile rupees) into a four-way parity so a checkout never
  charges a price that disagrees across the codebase; REG-196 makes the single
  known code↔DB `unlimited` divergence a visible, fail-on-reconcile CI fact
  rather than a silent drift, pending the CEO's source-of-truth decision (PAY-2
  open question #1).

### Catalog total

Pre-PAY-2: 161 entries (through Remediation SLC-1's REG-194 single-XP-writer
de-dup). Remediation PAY-2 adds REG-195 (four-way consumer-pricing code-mirror
parity lock) and REG-196 (known DB↔code `unlimited` divergence pin, RED-on-reconcile).
**Total catalog: 163 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — PAY-2: Unlimited Price Convergence (P11) — 2026-06-30

The `unlimited` consumer plan price was converged across ALL sources to the
DB-canonical ₹1099/₹8799. The DB row (`subscription_plans.unlimited`, migration
`20260505155126`) was ALREADY ₹1099/₹8799; the code sources were converged DOWN
to match it: web charge + display (`src/lib/plans.ts::PRICING.unlimited` =
1099/8799), the derived server paisa constant read by `/api/payments/create-order`
(`src/lib/pricing.ts::CONSUMER_PRICING_PAISA.unlimited` = 109900/879900), and the
mobile charge + display (`mobile/lib/data/models/subscription.dart` = 1099/8799).

This CLOSES the prior live divergence where mobile/web code charged ₹1499 while
the DB (web checkout) charged ₹1099 — the SAME plan billed two prices by platform,
and the gateway captured ₹1499 while verify recorded the DB's ₹1099 (gateway↔ledger
mismatch). The convergence is customer-FAVORABLE: the unlimited charge was lowered,
never raised. P11 signature-verification and atomic-write logic are UNTOUCHED — only
the pricing CONSTANTS moved. The SOT pin (`consumer-pricing-sot-drift.test.ts`
Part B) was flipped from a DB↔code DIVERGENCE pin (`not.toBe`) to a DB===code
PARITY pin: this is a legitimate convergence update, NOT a weakened assertion — the
old ₹1499/₹11999 value no longer exists in any source, so the prior divergence pin
would now be asserting a falsehood.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-207 | `pay2_unlimited_price_converged_to_db_canonical` | P11: the `unlimited` plan price is converged across ALL sources to the DB-canonical ₹1099/₹8799 (web `plans.ts`, derived paisa `CONSUMER_PRICING_PAISA` read by create-order, mobile `subscription.dart`, and DB `subscription_plans`) — closing the prior live divergence where mobile charged ₹1499 (code) vs web ₹1099 (DB) and the gateway-vs-ledger mismatch (mobile captured ₹1499 but verify recorded ₹1099); the SOT pin now asserts DB===code parity (not divergence); customer-favorable (charge lowered, never raised); P11 signature/atomicity logic untouched | `src/__tests__/payments/consumer-pricing-sot-drift.test.ts` | U | P11 |

### Invariants covered by this section

- P11 (payment integrity) — REG-207 pins single-price convergence: web charge,
  mobile charge, mobile display, web display, and the DB row are all ₹1099/₹8799.
  The focused pin `src/__tests__/payments/pay2-unlimited-price-converged.test.ts`
  asserts `PRICING.unlimited === {1099,8799}`, `CONSUMER_PRICING_PAISA.unlimited
  === {109900,879900}` (rupees ×100, no rounding drift), and that the code price
  EQUALS the DB-canonical migration value — so a future drift in EITHER direction
  (code creeping back to ₹1499, paisa desyncing, or the DB migration moving)
  re-breaks the pin. starter (299/2399) and pro (699/5599) are pinned UNCHANGED as
  a guard that ONLY unlimited moved. The SOT `consumer-pricing-sot-drift.test.ts`
  Part B was flipped divergence→parity in lock-step; signature-verify + atomic
  subscription-write paths are not touched by this change.

### Catalog total

PAY-2 adds REG-207 (unlimited price convergence to DB-canonical ₹1099/₹8799 —
DB↔code SOT pin flipped from divergence to parity; focused convergence pin guards
all four sources + starter/pro-unchanged).
**Total catalog: 174 entries (target: 35 — TARGET EXCEEDED).**

---

## Engineering-Audit — RBI pre-debit notice audit-evidence + fail-closed posture (Phase 2) — 2026-07-15

Source: Phase 2 of the Mailgun→Resend migration follow-up. The regulated RBI
pre-debit notice (`send-pre-debit-notice`) is delivered through the shared
Resend relay. Two guarantees ride on the `subscription_events` audit row it
writes: (1) a notice that cannot be delivered MUST fail closed (recorded as
`pre_debit_notice_failed` → HTTP 500 → the cron skips/retries the auto-charge
rather than silently debiting the customer), and (2) a delivered notice MUST
persist the Resend message id so an audit row can be correlated to a specific
Resend delivery during a Razorpay/RBI dispute (under Resend the business
idempotency key no longer rides a searchable provider field, so the returned
message id is the only correlation handle). Phase 2 renamed the audit key
`attempts`→`relay_dispatches` and added `provider_message_id` + `provider_status`.

### Notes on ID assignment

REG-251 is the next free id: the REG-248..REG-250 block landed with the sibling
onboarding/RBAC/white-label PR (#1287), making REG-250 the catalog's max id, so
this pre-debit entry appends as REG-251 immediately after it. This project appends
rather than backfilling intentional gaps (REG-170 also remains a documented skip).
REG-251 is confirmed absent before use. (This entry was authored as REG-241 on the
email-onboarding branch and renumbered to REG-251 on merge to avoid a collision
with the origin/main Foxy REG-241..247 block.)

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-251 | `pre_debit_notice_audit_evidence_fail_closed` | The RBI pre-debit notice is fail-closed on relay failure (recorded `pre_debit_notice_failed`, never silently charged) AND the audit row carries `provider_message_id` so an audit row can be correlated to a specific Resend delivery during a Razorpay/RBI dispute. **Success path** (via the REAL `sendEmail()` relay seam with a stub `EmailTransport` injected through `setDefaultEmailTransport()`, socket-free): the injected transport's returned id flows through the real relay to `EmailSendResult.id`, and the audit metadata carries `provider_message_id` = that Resend id (non-null), a success `provider_status` (the delivery id, never a failure default), `relay_dispatches: 1`, and the `pre_debit_notice_sent` outcome. Also pins the defensive `?? 'delivered'` / `?? null` fallbacks (success without an id → `provider_message_id: null`, `provider_status: 'delivered'`, still `sent`). **Fail-closed paths**: (a) a transport returning `{ success:false, code }` → `provider_message_id: null`, `provider_status` = the PII-free failure code, `relay_dispatches: 1`, `eventType='pre_debit_notice_failed'` (NOT `sent`); (b) relay-not-configured (`RESEND_API_KEY` absent — short-circuits before `sendEmail`) → `provider_message_id: null`, `provider_status: 'relay_not_configured'`, `relay_dispatches: 0`, `eventType='pre_debit_notice_failed'`. **Drift canary**: a `Deno.readTextFileSync` of `../index.ts` asserts the exact audit-metadata mapping expressions still exist verbatim (`provider_message_id: sendResult.provider_id ?? null`, `relay_dispatches: sendResult.attempts`, the `provider_status` ternary, the `eventType` fail-closed selector, and the three `sendEmailWithRetry` result branches) — so dropping `provider_message_id`, renaming `relay_dispatches` back to `attempts`, or flipping the fail-closed `eventType` turns the pin red. Approach note: the full handler is not invoked (it imports `@supabase/supabase-js` from esm.sh and makes a real `subscription_events` SELECT in its pre-flight path, and the audit-metadata mapping is inline in the `Deno.serve()` closure with no exported unit) — the load-bearing id→`provider_message_id` fact rides REAL relay code; the unexportable 6-line inline mapping is mirrored AND source-pinned. Runs fully offline (`--allow-read --allow-env`; no socket). | `supabase/functions/send-pre-debit-notice/__tests__/audit-evidence.test.ts` (5 Deno tests: 2 success + 2 fail-closed + 1 source-drift canary) | E | P11, P13 |

### Invariants covered by this section

- P11 (payment integrity) — the RBI pre-debit notice fails closed: a relay
  failure or an unconfigured relay is recorded as `pre_debit_notice_failed`
  (→ HTTP 500), so the cron never treats an undelivered notice as sent and the
  customer is never silently auto-debited without the mandated ≥24h notice.
- P13 (data privacy) — the persisted correlation handle is a Resend message id
  (not PII, safe to store/log); on failure `provider_status` carries only a
  PII-free machine code, never the raw provider error body.

### Catalog total

Pre-REG-251: 217 entries (through REG-250, self-serve school onboarding slug; the
REG-248..REG-250 block landed with the sibling onboarding/RBAC/white-label PR
#1287, and the REG-177 refresh above is count-neutral).
Adds REG-251 (RBI pre-debit notice audit-evidence: `provider_message_id`
dispute-reconcilable correlation + fail-closed `pre_debit_notice_failed` posture
on relay failure / relay-not-configured, with a source-drift canary on the
audit-metadata mapping). **Total catalog: 218 entries (target: 35 — TARGET
EXCEEDED).**

---

## REG-260 — Landing V3 default + V2 rollback hatch (`?v=2`) + FAQ Unlimited-price correction (₹1,499→₹1,099) + REG-65 ₹699 verbatim survives the V3 FAQ rewrite + prices-from-SoT on /welcome and /pricing (2026-07-16)

*(renumbered from REG-257→259→260 on successive merges — both ids taken by main)*

Pins the landing-v3 makeover (CEO-approved design,
design-previews/welcome-ultra.html + marketing-page-ultra.html): `/welcome`
renders `WelcomeV3` by DEFAULT with `WelcomeV2` preserved as the `?v=2`
rollback hatch (version switch is the query param in
`apps/host/src/app/welcome/page.tsx` — code, not a feature flag), and
`/pricing` rebuilt on the same V3 system (`PricingV3`, replacing the legacy
`PricingCards.tsx`).

Pins: (1) **Routing** — no query / unknown `?v` (incl. the long-deleted
`?v=1`) → V3; `?v=2` → V2 (rollback path until the V2 cleanup PR); the page
is an async server component (Next 16 `searchParams` Promise).
(2) **Price-bug fix** — the V3 welcome FAQ's Unlimited price reads ₹1,099
(= `PRICING.unlimited.monthly`); the retired **₹1,499** literal is ABSENT
from the rendered page AND from every JSON-LD payload (that is what Google
indexes). (3) **REG-65 continuity** — the literal "₹699" survives the V3 FAQ
rewrite VERBATIM on both /welcome and /pricing, with a lock-step assertion
`formatINR(PRICING.pro.monthly) === '₹699'` so a SoT price change surfaces
as a deliberate copy decision instead of silent drift. (4) **Prices-from-SoT
(P11-adjacent)** — every rupee figure on the V3 plan cards derives from
`PRICING`/`formatINR`/`yearlyPerMonth` (`@alfanumrik/lib/plans`) and the
schools band renders `SCHOOL_PER_SEAT_MARKETING_LABEL`
(`@alfanumrik/lib/pricing`); the enforcing tests import the same constants
(zero price literals in card assertions). (5) **SEO shape** — FAQPage
JSON-LD `mainEntity.length === 10` (English-only, `**` stripped) and the
WebApplication Review JSON-LD carries EXACTLY 2 five-star reviews with the
same `@id` as JsonLd.tsx; single `<h1>` per page; `#hero-cta` → `/login`.
(6) **P7** — the language toggle flips visible copy to Hindi, persists under
the version-agnostic `alf-welcome-lang` key (survives V2 ⇄ V3 flips), and
mirrors `lang="hi"` to `<html>`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-260 | `landing_v3_default_v2_hatch_faq_price_fix_prices_from_sot` | (1) `/welcome` default → WelcomeV3; `?v=2` → WelcomeV2; unknown `?v` falls through to V3; async server component. (2) "₹1,499" absent from V3 welcome DOM + all JSON-LD; corrected "₹1,099" present and equal to `formatINR(PRICING.unlimited.monthly)`. (3) "₹699" verbatim in the plans FAQ on /welcome AND the annual-billing FAQ on /pricing, lock-stepped to `formatINR(PRICING.pro.monthly)`. (4) 4 plan cards on /pricing with monthly = `PRICING.<plan>.monthly`, yearly toggle → `PRICING.<plan>.yearly` + `≈ yearlyPerMonth()/mo`; Pro (and only Pro) featured; schools band renders `SCHOOL_PER_SEAT_MARKETING_LABEL`. (5) FAQPage JSON-LD mainEntity.length === 10 (bold stripped); Review JSON-LD exactly 2 reviews; single h1; `#hero-cta` → /login. (6) EN→HI toggle flips copy, persists `alf-welcome-lang=hi`, sets `<html lang="hi">`. | `apps/host/src/__tests__/landing-v3/WelcomeV3.test.tsx` (9 tests), `apps/host/src/__tests__/landing-v3/PricingV3.test.tsx` (10 tests), `apps/host/src/__tests__/welcome-v2-routing.test.ts` (6 tests) | E | P7, P11-adjacent (pricing copy), REG-65 continuity, SEO shape |

### E2E coverage

- `e2e/welcome-landing.spec.ts` — re-pinned to the V3 default (hero H1
  "Every chapter…", `#hero-cta`, 4 teaser plan cards + Pro badge, FinalCtaV3
  ink band replacing the retired StickyMobileCTA wiring test, EN⇆HI Devanagari
  toggle + `<html lang>`).
- `e2e/welcome-v2.spec.ts` — V2 scenarios repointed at the `/welcome?v=2`
  rollback hatch; `?v=1` spec rewritten as "falls through to V3 default";
  flag-driven-routing section retired (routing is code, not `ff_welcome_v2`).
  Delete this spec in the same PR that removes the V2 component.
- `e2e/smoke.spec.ts` pricing block + `e2e/landing-seo.spec.ts` (FAQ 10 /
  Review 2 / canonical / hreflang) pass against V3 unchanged.

### Invariants covered by this section

- P7 (bilingual UI) — toggle flips copy on both V3 pages; preference persists
  across the V2 ⇄ V3 rollback boundary via the shared `alf-welcome-lang` key.
- P11-adjacent (pricing copy integrity, REG-65 family) — public rupee figures
  on both marketing pages derive from the plans/pricing SoT; the two pinned
  verbatim literals ("₹699" FAQ copy, `SCHOOL_PER_SEAT_MARKETING_LABEL`) are
  lock-stepped to the SoT so drift fails the suite.
- Brand/legal risk closure — the hallucination-class ₹1,499 Unlimited price
  (wrong vs `PRICING.unlimited.monthly` = ₹1,099) is pinned ABSENT, including
  inside JSON-LD structured data.
- Rollback readiness — `?v=2` hatch behaviour is test-enforced, so the V3
  launch remains instantly reversible without a deploy.

### Catalog total

Pre-REG-259: 225 entries (through REG-258, Foxy math-format house style
Wave B). Adds REG-259 (PWA stale-service-worker retirement — no-fetch
tombstone + bounded client cleanup promoted to the catalog, sw_legacy_cleanup
emit-gate + counts-only P13 telemetry, and manifest/viewport mobile view
integrity pins) and REG-260 (landing V3 default + `?v=2` rollback hatch + FAQ
Unlimited-price correction ₹1,499→₹1,099 + REG-65 ₹699 verbatim survival +
prices-from-SoT on /welcome and /pricing).
**Total catalog: 227 entries (target: 35 — TARGET EXCEEDED).**

---

