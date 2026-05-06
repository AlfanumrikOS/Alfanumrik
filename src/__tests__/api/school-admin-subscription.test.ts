import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock everything the route depends on so we test validation + flow logic
// without hitting Razorpay or Supabase. The Phase 2-C spec disallows
// autonomous Razorpay calls — these tests run with mocks.

const mockAuthorize = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockCapture = vi.fn();
const mockCreateSub = vi.fn();
const mockCancelSub = vi.fn();

const supabaseChain = {
  from: vi.fn(),
};

vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a),
}));
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => mockIsFeatureEnabled(...a),
}));
vi.mock('@/lib/posthog/server', () => ({
  capture: (...a: unknown[]) => mockCapture(...a),
}));
vi.mock('@/lib/razorpay', () => ({
  createRazorpaySubscription: (...a: unknown[]) => mockCreateSub(...a),
  cancelRazorpaySubscription: (...a: unknown[]) => mockCancelSub(...a),
}));
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseChain,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST, PATCH, DELETE } from '@/app/api/school-admin/subscription/route';

const SCHOOL_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000099';

function makeRequest(method: string, body: unknown): Request {
  return new Request('http://localhost/api/school-admin/subscription', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authOK() {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    schoolId: SCHOOL_ID,
    userId: USER_ID,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/school-admin/subscription', () => {
  it('returns 403 when the flag is off', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(false);

    const res = await POST(makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never);
    expect(res.status).toBe(403);
  });

  it('rejects an invalid plan with 400', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);

    const res = await POST(makeRequest('POST', { plan: 'platinum', billing_cycle: 'monthly', seats: 50 }) as never);
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range seats with 400', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);

    const res = await POST(makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 0 }) as never);
    expect(res.status).toBe(400);
  });

  it('refuses to provision fewer seats than active students (seat_cap_violation)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);

    // subscription_plans lookup returns a valid row.
    const planLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          plan_code: 'starter',
          razorpay_plan_id: 'rzp_yearly',
          razorpay_plan_id_monthly: 'rzp_monthly',
          price_monthly: 299,
        },
        error: null,
      }),
    };
    // students count: countActiveSeats awaits a builder that resolves with
    // { count: 60 }. Modeled as a thenable returned from the second .eq().
    const seatCountThenable = {
      then: (cb: (v: { count: number }) => unknown) => Promise.resolve(cb({ count: 60 })),
    };
    const studentsBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) =>
        col === 'is_active' ? seatCountThenable : studentsBuilder,
      ),
    };

    supabaseChain.from = vi.fn((table: string) => {
      if (table === 'subscription_plans') return planLookup;
      if (table === 'students') return studentsBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    const res = await POST(makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe('seat_cap_violation');
    expect(mockCapture).toHaveBeenCalledWith(
      'school_billing_plan_change_failed',
      USER_ID,
      expect.objectContaining({ reason: 'seat_cap_violation', source: 'self_service_post' }),
    );
  });
});

describe('PATCH /api/school-admin/subscription', () => {
  it('returns 403 when the flag is off', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(false);
    const res = await PATCH(makeRequest('PATCH', { plan: 'pro' }) as never);
    expect(res.status).toBe(403);
  });

  it('returns 400 when neither plan nor seats are provided', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    const res = await PATCH(makeRequest('PATCH', {}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when no subscription exists', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    const subFetchChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    supabaseChain.from = vi.fn((table: string) => {
      if (table === 'school_subscriptions') return subFetchChain;
      throw new Error(`unexpected table ${table}`);
    });

    const res = await PATCH(makeRequest('PATCH', { plan: 'pro' }) as never);
    expect(res.status).toBe(404);
    expect(mockCapture).toHaveBeenCalledWith(
      'school_billing_plan_change_failed',
      USER_ID,
      expect.objectContaining({ reason: 'no_existing_subscription' }),
    );
  });
});

describe('DELETE /api/school-admin/subscription', () => {
  it('returns 403 when the flag is off', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(false);
    const res = await DELETE(makeRequest('DELETE', {}) as never);
    expect(res.status).toBe(403);
  });

  it('returns 404 when there is no subscription', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    const subFetchChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    supabaseChain.from = vi.fn((table: string) => {
      if (table === 'school_subscriptions') return subFetchChain;
      throw new Error(`unexpected table ${table}`);
    });
    const res = await DELETE(makeRequest('DELETE', {}) as never);
    expect(res.status).toBe(404);
  });

  it('cancels a never-billed trial without calling Razorpay', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    const subFetchChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'sub_x',
          plan: 'trial',
          billing_cycle: 'monthly',
          seats_purchased: 50,
          razorpay_subscription_id: null,
          status: 'trial',
        },
        error: null,
      }),
    };
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    let callIdx = 0;
    supabaseChain.from = vi.fn(() => {
      callIdx += 1;
      return callIdx === 1 ? subFetchChain : updateChain;
    });

    const res = await DELETE(makeRequest('DELETE', {}) as never);
    expect(res.status).toBe(200);
    expect(mockCancelSub).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(
      'school_subscription_cancelled',
      USER_ID,
      expect.objectContaining({ cancellation_timing: 'end_of_cycle' }),
    );
  });
});
