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

describe('webhook route — atomic downgrade', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    mockAdmin = { rpc: vi.fn(), from: vi.fn() };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  it('subscription.cancelled calls atomic_downgrade_subscription RPC, not raw UPDATEs', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-2' }], error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      if (name === 'atomic_downgrade_subscription') return { data: [{ outcome: 'downgraded' }], error: null };
      throw new Error(`unexpected RPC ${name}`);
    });
    // Student resolution path: notes_student_id branch hits students table.
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
      }
      throw new Error(`unexpected from(${table})`);
    });

    const evt = buildEvent({
      event: 'subscription.cancelled',
      sub_id: 'sub_xyz',
      notes: { student_id: 's1', plan_code: 'pro', user_id: 'u1' },
    });

    const req = makeRequest(evt);
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const callNames = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(callNames).toContain('atomic_downgrade_subscription');
    // Critical: route MUST NOT call admin.from('student_subscriptions').update — that's the old path.
    const fromCalls = mockAdmin.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(fromCalls).not.toContain('student_subscriptions');
  });
});

describe('webhook route — subscription.pending', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    mockAdmin = { rpc: vi.fn(), from: vi.fn() };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  it('subscription.pending calls mark_subscription_past_due RPC', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-3' }], error: null };
      if (name === 'mark_subscription_past_due') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
      }
      throw new Error(`unexpected from(${table})`);
    });

    const event = {
      account_id: 'acc_1',
      id: 'evt_pending',
      event: 'subscription.pending',
      payload: { subscription: { entity: { id: 'sub_xyz', notes: { student_id: 's1', plan_code: 'pro', user_id: 'u1' } } } },
    };

    const req = makeRequest(event);
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('mark_subscription_past_due');
  });
});

describe('webhook route — signature verification', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: vi.fn(), from: vi.fn() });
  });

  it('rejects request with invalid signature without touching DB', async () => {
    const body = JSON.stringify(buildEvent());
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
      body,
    });
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe('Invalid signature');
  });

  it('rejects when signature header is missing', async () => {
    const body = JSON.stringify(buildEvent());
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(400);
  });
});

describe('webhook route — RPC fallback ladder', () => {
  let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    mockAdmin = { rpc: vi.fn(), from: vi.fn() };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  });

  function studentResolver() {
    return (table: string) => {
      if (table === 'students') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' }, error: null }) }) }) };
      }
      if (table === 'payment_history') {
        return {
          select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          insert: async () => ({ error: null }),
        };
      }
      if (table === 'feature_flags') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: true }, error: null }) }) }) };
      }
      throw new Error(`unexpected from(${table})`);
    };
  }

  it('primary RPC success: only activate_subscription_locked called', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation(studentResolver());

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('activate_subscription_locked');
    expect(calls).not.toContain('atomic_subscription_activation_locked');
  });

  it('primary fails, atomic fallback succeeds → 200', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: { message: 'primary fail' } };
      if (name === 'atomic_subscription_activation_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation(studentResolver());

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('activate_subscription_locked');
    expect(calls).toContain('atomic_subscription_activation_locked');
  });

  it('both primary and atomic fail → 503 (Razorpay retries)', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: { message: 'primary fail' } };
      if (name === 'atomic_subscription_activation_locked') return { data: null, error: { message: 'atomic fail' } };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation(studentResolver());

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(503);
  });

  it('kill switch disabled + primary fails → 503 without atomic call', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-1' }], error: null };
      if (name === 'activate_subscription_locked') return { data: null, error: { message: 'primary fail' } };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      throw new Error(`unexpected ${name}`);
    });
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'feature_flags') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: false }, error: null }) }) }) };
      }
      return studentResolver()(table);
    });

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(503);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).not.toContain('atomic_subscription_activation_locked');
  });
});
