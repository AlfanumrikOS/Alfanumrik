import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: vi.fn() };
});

import { createClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/payments/webhook/route';

const WEBHOOK_SECRET = 'test_concurrent_secret';

function signed(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function makeReq(eventBody: object): Request {
  const raw = JSON.stringify(eventBody);
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(raw) },
    body: raw,
  });
}

describe('webhook concurrent fire — exactly one activation', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
  });

  it('5 parallel webhook deliveries of the SAME event_id → exactly one activate call', async () => {
    let recordWebhookCalls = 0;
    let activateCalls = 0;

    const mockAdmin = {
      rpc: vi.fn(async (name: string) => {
        if (name === 'record_webhook_event') {
          recordWebhookCalls++;
          // First caller wins; rest get is_new=false.
          const isNew = recordWebhookCalls === 1;
          return { data: [{ is_new: isNew, id: `wh-${recordWebhookCalls}` }], error: null };
        }
        if (name === 'activate_subscription_locked') {
          activateCalls++;
          return { data: null, error: null };
        }
        if (name === 'mark_webhook_event_processed') return { data: null, error: null };
        return { data: null, error: null };
      }),
      from: vi.fn((table: string) => {
        if (table === 'students') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
        }
        if (table === 'payment_history') {
          return {
            select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
            insert: async () => ({ error: null }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);

    const event = {
      account_id: 'acc_1',
      id: 'evt_same_id_for_all',
      event: 'payment.captured',
      payload: { payment: { entity: {
        id: 'pay_1', order_id: 'ord_1', amount: 100, currency: 'INR',
        notes: { student_id: 's1', user_id: 'u1', plan_code: 'pro', billing_cycle: 'yearly' },
      } } },
    };

    const responses = await Promise.all(Array.from({ length: 5 }, () => POST(makeReq(event) as unknown as import('next/server').NextRequest)));

    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(recordWebhookCalls).toBe(5);
    // Only the first call's is_new=true reached the activation branch.
    expect(activateCalls).toBe(1);
  });
});
