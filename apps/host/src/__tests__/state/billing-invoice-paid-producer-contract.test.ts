/**
 * Pin the producer contract for `billing.invoice_paid`.
 *
 * Phase 4 prep work. Per docs/architecture/EVENT_CATALOG.md v2 §9 + §11,
 * `billing.invoice_paid` is the highest-leverage candidate among the ~10
 * schema-only events: once it has a producer, the Razorpay webhook in
 * src/app/api/payments/webhook/route.ts can stop carrying welcome-email,
 * entitlement, and analytics writes synchronously — those become
 * subscriber concerns instead.
 *
 * This test does NOT wire the webhook. It pins the schema so the future
 * producer PR (which adds a single `publishEvent()` call to the
 * payment.captured branch) has a freeze-frame to validate against. The
 * payload shape in the registry is intentionally minimal — invoiceId,
 * amountInr (paise as integer per Razorpay), planSlug — and we lock
 * that here before the first producer ships and freezes the schema per
 * EVENT_CATALOG.md §5.
 *
 * No DB, no Supabase, no mocks — pure schema parse against the registry's
 * public exports.
 */
import { describe, expect, it } from 'vitest';
import {
  BillingInvoicePaidSchema,
  DomainEventSchema,
} from '@alfanumrik/lib/state/events/registry';

// Deterministic fixtures matching the style in events-registry.test.ts.
// The regex validators on the envelope accept any well-formed UUID + ISO
// timestamp; no cryptographic UUIDs needed for shape tests.
const FIXTURE_UUID_A = '00000000-0000-0000-0000-000000000001';
const FIXTURE_UUID_B = '00000000-0000-0000-0000-000000000002';
const FIXTURE_UUID_C = '00000000-0000-0000-0000-000000000003';
const FIXTURE_UUID_D = '00000000-0000-0000-0000-000000000004';
const FIXTURE_ISO = '2026-05-16T12:00:00.000Z';

const baseEnvelope = {
  eventId: FIXTURE_UUID_A,
  occurredAt: FIXTURE_ISO,
  actorAuthUserId: FIXTURE_UUID_B,
  tenantId: FIXTURE_UUID_C,
  idempotencyKey: 'rzp_payment_pay_FixtureInvoicePaid01',
};

const validPayload = {
  invoiceId: FIXTURE_UUID_D,
  // 499.00 INR expressed as paise. Razorpay always sends integer paise;
  // see docs/architecture/EVENT_CATALOG.md §3 (Billing events) and the
  // payment.amount handling in src/app/api/payments/webhook/route.ts.
  amountInr: 49900,
  planSlug: 'family_monthly',
};

describe('BillingInvoicePaidSchema (payload-only)', () => {
  it('accepts a minimal correct payload + envelope', () => {
    const candidate = {
      ...baseEnvelope,
      kind: 'billing.invoice_paid' as const,
      payload: validPayload,
    };
    const result = BillingInvoicePaidSchema.safeParse(candidate);
    expect(
      result.success,
      result.success
        ? ''
        : `expected schema to accept canonical payload, got: ${JSON.stringify(result.error.issues, null, 2)}`,
    ).toBe(true);
  });

  it('rejects a float amountInr (Razorpay paise are always integer)', () => {
    // Razorpay's API contract: `amount` is always an integer in the
    // smallest currency subunit (paise for INR, cents for USD). Floats
    // like 49900.5 indicate a mis-parsed or fabricated payment — never
    // a real Razorpay webhook. See:
    //   - docs/architecture/EVENT_CATALOG.md §3 (Billing events row)
    //   - registry.ts: amountInr is z.number().int().nonnegative()
    //   - webhook route reads payment.amount as-is (already integer paise)
    const candidate = {
      ...baseEnvelope,
      kind: 'billing.invoice_paid' as const,
      payload: { ...validPayload, amountInr: 49900.5 },
    };
    const result = BillingInvoicePaidSchema.safeParse(candidate);
    expect(
      result.success,
      'schema must reject non-integer amountInr; Razorpay paise are integer-only',
    ).toBe(false);
  });

  it('rejects a negative amountInr', () => {
    // Refunds and reversals are modeled as separate events (not yet in
    // the registry — see EVENT_CATALOG.md §9 E3/E4); a negative amount
    // on `invoice_paid` is always a bug.
    const candidate = {
      ...baseEnvelope,
      kind: 'billing.invoice_paid' as const,
      payload: { ...validPayload, amountInr: -100 },
    };
    const result = BillingInvoicePaidSchema.safeParse(candidate);
    expect(
      result.success,
      'schema must reject negative amountInr; refunds are out of scope for invoice_paid',
    ).toBe(false);
  });

  it('rejects a missing planSlug', () => {
    // planSlug is required because downstream consumers (welcome-email,
    // entitlements writer) branch on it. Without it they would have to
    // re-derive plan from the invoice — defeating the decoupling that
    // motivates moving billing.invoice_paid to live-producer status.
    const { planSlug: _omit, ...payloadWithoutPlan } = validPayload;
    const candidate = {
      ...baseEnvelope,
      kind: 'billing.invoice_paid' as const,
      payload: payloadWithoutPlan,
    };
    const result = BillingInvoicePaidSchema.safeParse(candidate);
    expect(
      result.success,
      'schema must reject missing planSlug; required for downstream entitlement and email consumers',
    ).toBe(false);
  });
});

describe('DomainEventSchema accepts billing.invoice_paid', () => {
  it('accepts a fully-formed billing.invoice_paid event via the discriminated union', () => {
    // This is the path publishEvent() takes — DomainEventSchema.safeParse
    // gates every write to state_events (see src/lib/state/events/publish.ts).
    // If this fails, the future webhook producer cannot publish at all.
    const candidate = {
      ...baseEnvelope,
      kind: 'billing.invoice_paid' as const,
      payload: validPayload,
    };
    const result = DomainEventSchema.safeParse(candidate);
    expect(
      result.success,
      result.success
        ? ''
        : `DomainEventSchema rejected a canonical billing.invoice_paid event: ${JSON.stringify(result.error.issues, null, 2)}`,
    ).toBe(true);
    if (result.success) {
      // Type-level narrowing via the discriminated union: this access
      // must compile without a cast. If the union regresses (e.g. the
      // billing arm is dropped or the payload shape changes silently),
      // this line stops compiling.
      expect(result.data.kind).toBe('billing.invoice_paid');
      if (result.data.kind === 'billing.invoice_paid') {
        expect(result.data.payload.invoiceId).toBe(FIXTURE_UUID_D);
        expect(result.data.payload.amountInr).toBe(49900);
        expect(result.data.payload.planSlug).toBe('family_monthly');
      }
    }
  });

  it('rejects a billing.invoice_paid event with a missing payload field', () => {
    // Discriminated-union parsing must catch payload-level omissions —
    // not just envelope omissions. This is the regression that would
    // make publishEvent() silently accept a half-built event and write
    // an unusable row to state_events.
    const { invoiceId: _omit, ...payloadWithoutInvoiceId } = validPayload;
    const candidate = {
      ...baseEnvelope,
      kind: 'billing.invoice_paid' as const,
      payload: payloadWithoutInvoiceId,
    };
    const result = DomainEventSchema.safeParse(candidate);
    expect(
      result.success,
      'DomainEventSchema must reject billing.invoice_paid events with missing payload fields',
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Producer migration plan — placeholders documenting the wiring that
// will land in the follow-up PR. These are intentionally `it.skip` so
// CI does not run them today (no producer exists yet) but they show up
// in the test report as TODOs, giving the migration PR a ready-made
// failure list to turn green. See EVENT_CATALOG.md §11 (uncertainty
// and gaps): "billing.invoice_paid is the highest-leverage candidate".
// ─────────────────────────────────────────────────────────────────────
describe.skip('producer migration plan', () => {
  it.skip('Razorpay webhook publishes billing.invoice_paid after persisting payment row', () => {
    // The wiring lives in src/app/api/payments/webhook/route.ts inside
    // the `payment.captured` branch (and the `subscription.activated` /
    // `subscription.charged` branches that also carry a payment entity).
    // After the existing payment_history INSERT + activate_subscription
    // RPC succeed, the route calls publishEvent() with the canonical
    // payload. Publish failure must NOT roll back the payment write —
    // the webhook stays 2xx so Razorpay does not retry-storm us; the
    // outbox publishes are best-effort here because state_events is
    // append-only and subscribers will pick up the next captured event.
  });

  it.skip('idempotencyKey derived from razorpay_payment_id so retries dedupe via UNIQUE constraint', () => {
    // The (event_id, idempotency_key) UNIQUE constraint on state_events
    // is what makes publishEvent() retry-safe (see publish.ts step 3:
    // error code 23505 returns { published: true, reason: 'duplicate' }).
    // For billing, the natural idempotency key is the Razorpay payment
    // id (pay_XXXX); Razorpay re-fires payment.captured on its own
    // backoff and we already dedupe at the payment_webhook_events level
    // via record_webhook_event. Pinning idempotencyKey = razorpay_payment_id
    // gives bus-level dedupe a second layer of defense that survives
    // even if payment_webhook_events is bypassed (e.g. manual replay).
  });

  it.skip('handleStudentEvent and handleSchoolEvent both publish under their respective tenantId scopes', () => {
    // The webhook has two activation paths:
    //   1. Student subscription (B2C): tenantId = null — publishes
    //      billing.invoice_paid in the global namespace so consumers
    //      that don't care about tenant scope (PostHog, welcome email)
    //      can read every paid invoice cleanly.
    //   2. School subscription (B2B): tenantId = schools.id — publishes
    //      billing.invoice_paid scoped to the tenant so school-admin
    //      analytics and entitlement projectors stay tenant-isolated
    //      (matches the RLS contract on state_events: service_role
    //      writes, tenant-scoped reads via projectors).
    // The migration PR must cover both branches; this test holds the
    // contract until the wiring lands.
  });
});
