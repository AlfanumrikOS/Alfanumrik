import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Webhook school-subscription invoice-amount fallback for QUARTERLY billing.
 *
 * When Razorpay's subscription.activated/charged event carries NO payment
 * entity (so paymentEntity.amount is absent), the webhook computes the invoice
 * amount from the school_subscriptions row:
 *
 *   amountInr = seats × price_per_seat_monthly × cycleMonths × 100   (paisa)
 *
 * where cycleMonths is 12 (yearly), 3 (quarterly), or 1 (monthly). This test
 * pins the QUARTERLY ×3 multiplier — a quarterly invoice must bill three months
 * of seats, not one. A regression to ×1 would under-bill every quarterly school.
 */

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: vi.fn() };
});
import { createClient } from '@supabase/supabase-js';

let globalMockAdmin: any;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: new Proxy({} as any, {
    get(_t, prop) {
      if (!globalMockAdmin) return undefined;
      const v = globalMockAdmin[prop];
      return typeof v === 'function' ? v.bind(globalMockAdmin) : v;
    },
  }),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alfanumrik/lib/posthog/server', () => ({ capture: vi.fn().mockResolvedValue(undefined) }));

// Capture the publishEvent payload (carries the computed invoice amountInr).
const publishEventMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...a: unknown[]) => publishEventMock(...a),
  __resetFlagCacheForTests: () => {},
}));

import { POST } from '@/app/api/payments/webhook/route';
import crypto from 'crypto';

const WEBHOOK_SECRET = 'test_webhook_secret';
const SCHOOL_ID = 'school-quarterly-1';

function signed(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function makeRequest(body: object): Request {
  const raw = JSON.stringify(body);
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(raw) },
    body: raw,
  });
}

/**
 * Build a mock admin whose school_subscriptions row reports the given billing
 * cycle / seats / per-seat price, and a school_admins row so the invoice
 * publish path is reached.
 */
function wireAdmin(opts: { billingCycle: string; seats: number; pricePerSeat: number }) {
  const subRow = {
    id: 'sub-row-1',
    school_id: SCHOOL_ID,
    plan: 'starter',
    status: 'trial',
    billing_cycle: opts.billingCycle,
    razorpay_subscription_id: null,
    current_period_start: null,
    current_period_end: null,
    seats_purchased: opts.seats,
    price_per_seat_monthly: opts.pricePerSeat,
  };

  const admin = {
    rpc: vi.fn(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-q1' }], error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === 'feature_flags') {
        // razorpay_payments + ff_atomic_subscription_activation reads → enabled.
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: true }, error: null }) }) }) };
      }
      if (table === 'school_subscriptions') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: subRow, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'school_admins') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { auth_user_id: 'admin-1' }, error: null }) }) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    }),
  };
  return admin;
}

function buildSchoolActivatedEvent() {
  // subscription.activated WITHOUT a payment entity → amount computed from row.
  return {
    account_id: 'acc_q',
    id: 'evt_school_q_activated',
    event: 'subscription.activated',
    payload: {
      subscription: {
        entity: {
          id: 'sub_rzp_school_q',
          notes: { school_id: SCHOOL_ID, seats: '50' },
          current_start: 1700000000,
          current_end: 1707776000,
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
  publishEventMock.mockResolvedValue({ ok: true });
});

describe('webhook school invoice fallback — quarterly bills ×3 months', () => {
  it('quarterly: amountInr = seats × price × 3 × 100 (no payment entity → row fallback)', async () => {
    const admin = wireAdmin({ billingCycle: 'quarterly', seats: 50, pricePerSeat: 99 });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);
    globalMockAdmin = admin;

    const res = await POST(makeRequest(buildSchoolActivatedEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const payload = (publishEventMock.mock.calls[0][1] as { payload: { amountInr: number } }).payload;
    // 50 seats × ₹99 × 3 months = ₹14,850 = 1,485,000 paisa.
    expect(payload.amountInr).toBe(50 * 99 * 3 * 100);
  });

  it('monthly: amountInr = seats × price × 1 × 100 (the ×3 is quarterly-only)', async () => {
    const admin = wireAdmin({ billingCycle: 'monthly', seats: 50, pricePerSeat: 99 });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);
    globalMockAdmin = admin;

    const res = await POST(makeRequest(buildSchoolActivatedEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const payload = (publishEventMock.mock.calls[0][1] as { payload: { amountInr: number } }).payload;
    expect(payload.amountInr).toBe(50 * 99 * 1 * 100);
  });

  it('yearly: amountInr = seats × price × 12 × 100 (multiplier table sanity)', async () => {
    const admin = wireAdmin({ billingCycle: 'yearly', seats: 50, pricePerSeat: 99 });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);
    globalMockAdmin = admin;

    const res = await POST(makeRequest(buildSchoolActivatedEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const payload = (publishEventMock.mock.calls[0][1] as { payload: { amountInr: number } }).payload;
    expect(payload.amountInr).toBe(50 * 99 * 12 * 100);
  });
});
