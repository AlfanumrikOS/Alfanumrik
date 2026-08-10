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
          // First caller wins the INSERT; the rest hit ON CONFLICT.
          const isNew = recordWebhookCalls === 1;
          // Since migration 20260814000006 the suppression signal is
          // `already_processed`, not `is_new`. This mock models the DB state the
          // route is contractually promised: record_webhook_event takes
          // pg_advisory_xact_lock('webhook_event:'||account||':'||event_id), so
          // the insert-or-read + already_processed decision is serialised per
          // event id — each losing caller reads the committed post-mark state of
          // the winner's receipt and therefore sees already_processed=true.
          //
          // Honest scope note: if the winner had NOT yet reached a terminal
          // success outcome, already_processed would be false and the losers
          // would legitimately re-attempt (that is the whole point of the fix —
          // see webhook-retry-after-failed-activation.test.ts). Concurrent
          // activation is safe: it is serialised one layer down by
          // pg_advisory_xact_lock('subscription:'||student_id) inside
          // activate_subscription_locked and the ON CONFLICT (student_id) upsert.
          return { data: [{ is_new: isNew, id: `wh-${recordWebhookCalls}`, already_processed: !isNew }], error: null };
        }
        if (name === 'activate_subscription_locked') {
          activateCalls++;
          return { data: null, error: null };
        }
        if (name === 'mark_webhook_event_processed') return { data: null, error: null };
        return { data: null, error: null };
      }),
      from: vi.fn((table: string) => {
        const chain: Record<string, any> = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          order: vi.fn(() => chain),
          insert: vi.fn(async () => ({ data: null, error: null })),
          update: vi.fn(() => chain),
          single: vi.fn(async () => {
            if (table === 'students') {
              return { data: { id: 's1', auth_user_id: 'u1' }, error: null };
            }
            return { data: null, error: null };
          }),
          maybeSingle: vi.fn(async () => {
            if (table === 'students') {
              return { data: { id: 's1', auth_user_id: 'u1' }, error: null };
            }
            if (table === 'feature_flags') {
              return { data: { is_enabled: true }, error: null };
            }
            if (table === 'payment_history') {
              return { data: { id: 'ph_1' }, error: null };
            }
            return { data: null, error: null };
          }),
          then: (resolve: any) => {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
        };
        return chain;
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
