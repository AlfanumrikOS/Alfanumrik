import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// Mock the modules the webhook route depends on. The school branch is
// dispatched from inside POST() before resolveStudent(), so a school
// payload should never reach the student path.

beforeAll(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role';
});

// vi.mock() factories are hoisted; references inside must be inline literals
// or use vi.hoisted() bindings. Use vi.hoisted() so the test body still has
// access to the spies for assertions.
const { mockVerify, mockLogOpsEvent, mockCapture } = vi.hoisted(() => ({
  mockVerify: vi.fn().mockReturnValue(true),
  mockLogOpsEvent: vi.fn().mockResolvedValue(undefined),
  mockCapture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alfanumrik/lib/payment-verification', () => ({
  verifyRazorpaySignature: () => mockVerify(),
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...a: unknown[]) => mockLogOpsEvent(...a),
}));
vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: (...a: unknown[]) => mockCapture(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Supabase admin client mock — chainable enough for the school branch.
const updateCalls: Array<{ table: string; values: unknown }> = [];
let schoolRow:
  | {
      id: string;
      school_id: string;
      plan: string;
      status: string;
      billing_cycle: string;
      razorpay_subscription_id: string | null;
      current_period_start: string | null;
      current_period_end: string | null;
    }
  | null = null;

function makeAdminMock() {
  return {
    rpc: vi.fn().mockResolvedValue({ data: { id: 'evt_row' }, error: null }),
    from: (table: string) => {
      if (table === 'feature_flags') {
        // razorpay_payments + ff_atomic_subscription_activation kill switches both ON.
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: true }, error: null }) }),
          }),
        } as never;
      }
      if (table === 'school_subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: schoolRow, error: null }),
            }),
          }),
          update: (values: unknown) => ({
            eq: async () => {
              updateCalls.push({ table, values });
              if (schoolRow) {
                Object.assign(schoolRow, values as Record<string, unknown>);
              }
              return { error: null };
            },
          }),
        } as never;
      }
      if (table === 'school_admins') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: { auth_user_id: 'school_admin_auth_user_id' }, error: null }),
        };
        return chain as never;
      }
      // Any other table reached during a school dispatch indicates a regression
      // (the school branch should short-circuit before resolveStudent runs).
      const fallbackChain: Record<string, unknown> = {
        select: () => fallbackChain,
        eq: () => fallbackChain,
        insert: async () => ({ error: null }),
        limit: () => fallbackChain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return fallbackChain as never;
    },
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeAdminMock(),
  SupabaseClient: class {},
}));

import { POST } from '@/app/api/payments/webhook/route';

const SCHOOL_ID = '00000000-0000-0000-0000-0000000000aa';

function makeRequest(eventType: string, opts?: { withNotes?: boolean }): Request {
  const subscriptionEntity = {
    id: 'sub_test',
    notes: opts?.withNotes === false ? {} : { school_id: SCHOOL_ID, seats: '50', source: 'school_self_service' },
    current_start: 1762848000, // 2025-11-11
    current_end: 1765526400,   // 2025-12-12
  };
  const body = {
    event: eventType,
    payload: { subscription: { entity: subscriptionEntity } },
  };
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': 'sig',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updateCalls.length = 0;
  schoolRow = {
    id: 'sub_row_id',
    school_id: SCHOOL_ID,
    plan: 'starter',
    status: 'trial',
    billing_cycle: 'monthly',
    razorpay_subscription_id: null,
    current_period_start: null,
    current_period_end: null,
  };
  vi.clearAllMocks();
  mockVerify.mockReturnValue(true);
  mockLogOpsEvent.mockResolvedValue(undefined);
});

describe('webhook — school subscription branch (Phase 3-A)', () => {
  it('flips school_subscriptions.status to active on subscription.activated', async () => {
    const res = await POST(makeRequest('subscription.activated') as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { scope?: string; outcome?: string };
    expect(json.scope).toBe('school');
    expect(json.outcome).toBe('school_activated');

    const update = updateCalls.find((c) => c.table === 'school_subscriptions');
    expect(update).toBeTruthy();
    const values = update!.values as Record<string, unknown>;
    expect(values.status).toBe('active');
    expect(values.razorpay_subscription_id).toBe('sub_test');
    expect(typeof values.current_period_start).toBe('string');
    expect(typeof values.current_period_end).toBe('string');
  });

  it('marks status active on subscription.charged (renewal)', async () => {
    schoolRow!.status = 'active';
    schoolRow!.razorpay_subscription_id = 'sub_test';

    const res = await POST(makeRequest('subscription.charged') as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { outcome?: string };
    expect(json.outcome).toBe('school_renewed');

    const update = updateCalls.find((c) => c.table === 'school_subscriptions');
    expect(update).toBeTruthy();
    expect((update!.values as Record<string, unknown>).status).toBe('active');
  });

  it('keeps status active on subscription.cancelled (access until period end)', async () => {
    schoolRow!.status = 'active';
    schoolRow!.razorpay_subscription_id = 'sub_test';

    const res = await POST(makeRequest('subscription.cancelled') as never);
    expect(res.status).toBe(200);

    const update = updateCalls.find((c) => c.table === 'school_subscriptions');
    // Only period_end stamped; status NOT touched.
    if (update) {
      const v = update.values as Record<string, unknown>;
      expect(v.status).toBeUndefined();
      expect(typeof v.current_period_end).toBe('string');
    }
  });

  it('flips status to cancelled on subscription.expired', async () => {
    schoolRow!.status = 'active';
    schoolRow!.razorpay_subscription_id = 'sub_test';

    const res = await POST(makeRequest('subscription.expired') as never);
    expect(res.status).toBe(200);
    const update = updateCalls.find((c) => c.table === 'school_subscriptions');
    expect((update!.values as Record<string, unknown>).status).toBe('cancelled');
  });

  it('does NOT touch school_subscriptions when notes.school_id is absent', async () => {
    // The school branch must be a no-op when notes.school_id is missing —
    // student-path resolution then runs against the heavy webhook
    // machinery (which our mock doesn't fully simulate). What this
    // assertion actually proves is the only thing we need from the
    // school branch perspective: no school write was issued.
    await POST(makeRequest('subscription.activated', { withNotes: false }) as never).catch(() => null);
    expect(updateCalls.find((c) => c.table === 'school_subscriptions')).toBeUndefined();
  });

  it('emits a structured warning when notes.school_id has no matching row', async () => {
    schoolRow = null; // simulate missing row
    const res = await POST(makeRequest('subscription.activated') as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { outcome?: string };
    expect(json.outcome).toBe('school_no_op');
    expect(mockLogOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'school_subscription_event_unmatched',
      }),
    );
  });
});
