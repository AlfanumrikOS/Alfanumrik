import { describe, it, expect, vi, beforeEach } from 'vitest';

// We import the route under test. Vitest module-mock the supabase client
// at the boundary so we can assert RPC call sequences.
vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return {
    ...actual,
    createClient: vi.fn(),
  };
});

import { createClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/payments/webhook/route';
import crypto from 'crypto';

const WEBHOOK_SECRET = 'test_webhook_secret';

function signed(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function buildEvent(overrides: Partial<{
  event: string; account_id: string; payment_id: string; sub_id: string; notes: Record<string, unknown>;
}> = {}) {
  const event = overrides.event ?? 'payment.captured';
  const account_id = overrides.account_id ?? 'acc_test';
  const notes = overrides.notes ?? { plan_code: 'pro', billing_cycle: 'yearly', user_id: 'u1', student_id: 's1' };
  return {
    account_id,
    id: 'evt_default',
    event,
    payload: {
      payment: { entity: { id: overrides.payment_id ?? 'pay_1', order_id: 'ord_1', amount: 199900, currency: 'INR', notes } },
      subscription: overrides.sub_id ? { entity: { id: overrides.sub_id, notes } } : undefined,
    },
  };
}

function makeRequest(body: object): Request {
  const raw = JSON.stringify(body);
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(raw) },
    body: raw,
  });
}

describe('webhook route — event-level dedupe', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';

    mockAdmin = {
      rpc: vi.fn(),
      from: vi.fn(),
    };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  it('on duplicate event_id, returns 200 with note=dedupe and skips activation', async () => {
    // record_webhook_event RPC reports is_new=false (duplicate).
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: false, id: 'wh-1' }], error: null };
      throw new Error(`unexpected RPC ${name}`);
    });

    const req = makeRequest(buildEvent());
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.note).toBe('dedupe');

    // Critical: activate_subscription / atomic_subscription_activation MUST NOT have been called.
    const callNames = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(callNames).toContain('record_webhook_event');
    expect(callNames).not.toContain('activate_subscription');
    expect(callNames).not.toContain('atomic_subscription_activation');
  });
});
