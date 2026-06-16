import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock everything the route depends on so we test validation + flow logic
// without hitting Razorpay or Supabase. The Phase 2-C spec disallows
// autonomous Razorpay calls — these tests run with mocks.

const mockAuthorize = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockCapture = vi.fn();
const mockCreateSub = vi.fn();
const mockCancelSub = vi.fn();
const mockUpdateQty = vi.fn();

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
  updateRazorpaySubscriptionQuantity: (...a: unknown[]) => mockUpdateQty(...a),
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

describe('POST /api/school-admin/subscription — P11 self-service billing integrity', () => {
  // Phase 3 P11 fixes pinned here (branch feat/portal-rbac-saas-remediation):
  //   1. POST never sets status='active' — the row stays pre-payment 'trial';
  //      only the signature-verified webhook (handleSchoolSubscriptionEvent on
  //      subscription.activated/charged) grants entitlement. P11: no plan access
  //      without verified payment.
  //   2. POST writes via UPDATE keyed by school_id (NOT upsert onConflict:'school_id',
  //      which raised 42P10 — there is no unique constraint on school_id). Regression
  //      pin against the orphaned-Razorpay-sub bug.
  //   3. billing_cycle='yearly' is rejected with 400 + code 'yearly_not_supported'
  //      BEFORE any Razorpay subscription is created — no orphan recurring sub.

  /**
   * Builds the supabaseChain.from() router for the POST happy/stamp paths.
   * Records the school_subscriptions UPDATE call so tests can assert the
   * stamped fields, the keyed column, and that onConflict was never used.
   */
  function wireHappyPathSupabase(opts?: {
    seatsUsed?: number;
    stampRowId?: string | null;
  }) {
    const seatsUsed = opts?.seatsUsed ?? 0;
    const stampRowId = opts?.stampRowId === undefined ? 'sub_row_existing' : opts.stampRowId;

    const planLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          plan_code: 'starter',
          razorpay_plan_id: 'rzp_yearly_plan',
          razorpay_plan_id_monthly: 'rzp_monthly_plan',
          price_monthly: 299,
        },
        error: null,
      }),
    };

    const seatCountThenable = {
      then: (cb: (v: { count: number }) => unknown) => Promise.resolve(cb({ count: seatsUsed })),
    };
    const studentsBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) =>
        col === 'is_active' ? seatCountThenable : studentsBuilder,
      ),
    };

    // Records exactly how the school_subscriptions write was issued.
    const subWrite = {
      updateCalledWith: undefined as undefined | Record<string, unknown>,
      updateEqColumn: undefined as undefined | string,
      updateEqValue: undefined as undefined | unknown,
      insertCalledWith: undefined as undefined | Record<string, unknown>,
      sawOnConflict: false,
    };

    const subUpdateBuilder = {
      update: vi.fn((values: Record<string, unknown>) => {
        subWrite.updateCalledWith = values;
        return subUpdateBuilder;
      }),
      // If the route ever reintroduced upsert(..., { onConflict }), this records it.
      upsert: vi.fn((values: Record<string, unknown>, options?: { onConflict?: string }) => {
        subWrite.insertCalledWith = values;
        if (options?.onConflict) subWrite.sawOnConflict = true;
        return subUpdateBuilder;
      }),
      insert: vi.fn((values: Record<string, unknown>) => {
        subWrite.insertCalledWith = values;
        return Promise.resolve({ error: null });
      }),
      eq: vi.fn((col: string, val: unknown) => {
        subWrite.updateEqColumn = col;
        subWrite.updateEqValue = val;
        return subUpdateBuilder;
      }),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: stampRowId ? { id: stampRowId } : null,
        error: null,
      }),
    };

    supabaseChain.from = vi.fn((table: string) => {
      if (table === 'subscription_plans') return planLookup;
      if (table === 'students') return studentsBuilder;
      if (table === 'school_subscriptions') return subUpdateBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    return { subWrite, subUpdateBuilder };
  }

  it('rejects billing_cycle=yearly with 400 + code yearly_not_supported and creates NO Razorpay subscription (no orphan)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    // Plan lookup wired so we PROVE the reject happens before plan/seat work.
    wireHappyPathSupabase();

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'yearly', seats: 50 }) as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code?: string; error?: string; success?: boolean };
    expect(json.success).toBe(false);
    expect(json.code).toBe('yearly_not_supported');
    expect(json.error).toBe('yearly_not_supported');

    // P11 / no-orphan: the yearly reject must short-circuit BEFORE any Razorpay
    // subscription is created. A created-but-unactivatable recurring sub is the
    // exact orphan this guard prevents (the webhook only matches monthly recurring).
    expect(mockCreateSub).not.toHaveBeenCalled();
    // And no DB stamp was written for the rejected request.
    expect(supabaseChain.from).not.toHaveBeenCalledWith('school_subscriptions');
  });

  it('monthly POST leaves status as pre-payment trial (NEVER active) — no entitlement before verified payment (P11)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCreateSub.mockResolvedValue({ id: 'sub_rzp_123', short_url: 'https://rzp.io/hp/abc' });
    const { subWrite } = wireHappyPathSupabase({ seatsUsed: 10 });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data?: { razorpay_subscription_id?: string; plan?: string; seats?: number };
    };
    expect(json.success).toBe(true);

    // THE P11 ASSERTION: the DB write must NOT set status at all (the existing
    // provisioned row keeps its 'trial' status). Granting plan access here —
    // before a signature-verified webhook — would violate P11.
    expect(subWrite.updateCalledWith).toBeDefined();
    expect(subWrite.updateCalledWith!).not.toHaveProperty('status');
    expect((subWrite.updateCalledWith as Record<string, unknown>).status).toBeUndefined();
    // It must NOT smuggle 'active' under any field.
    expect(Object.values(subWrite.updateCalledWith as Record<string, unknown>)).not.toContain('active');
  });

  it('monthly POST stamps razorpay_subscription_id + plan + seats + price on the existing row', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCreateSub.mockResolvedValue({ id: 'sub_rzp_456', short_url: 'https://rzp.io/hp/def' });
    const { subWrite } = wireHappyPathSupabase({ seatsUsed: 0 });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never,
    );
    expect(res.status).toBe(200);

    const stamp = subWrite.updateCalledWith as Record<string, unknown>;
    expect(stamp.razorpay_subscription_id).toBe('sub_rzp_456');
    expect(stamp.plan).toBe('starter');
    expect(stamp.seats_purchased).toBe(50);
    expect(stamp.billing_cycle).toBe('monthly');
    expect(stamp.price_per_seat_monthly).toBe(299);
    // The Razorpay sub carried the school_id in notes so the webhook can match it.
    expect(mockCreateSub).toHaveBeenCalledWith(
      expect.objectContaining({
        razorpayPlanId: 'rzp_monthly_plan',
        notes: expect.objectContaining({ school_id: SCHOOL_ID }),
      }),
    );
  });

  it('writes via UPDATE keyed by school_id and NEVER uses upsert onConflict (42P10 regression pin)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCreateSub.mockResolvedValue({ id: 'sub_rzp_789', short_url: 'https://rzp.io/hp/ghi' });
    const { subWrite, subUpdateBuilder } = wireHappyPathSupabase({ seatsUsed: 0 });

    const res = await POST(
      makeRequest('POST', { plan: 'pro', billing_cycle: 'monthly', seats: 100 }) as never,
    );
    expect(res.status).toBe(200);

    // The write path is .update(...).eq('school_id', SCHOOL_ID) — NOT .upsert with
    // onConflict:'school_id' (no unique constraint on school_id → 42P10, orphaned sub).
    expect(subUpdateBuilder.update).toHaveBeenCalledTimes(1);
    expect(subUpdateBuilder.upsert).not.toHaveBeenCalled();
    expect(subWrite.sawOnConflict).toBe(false);
    expect(subWrite.updateEqColumn).toBe('school_id');
    expect(subWrite.updateEqValue).toBe(SCHOOL_ID);
  });

  it('when the provisioned row is missing, the defensive INSERT also stays pre-payment trial (no onConflict)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCreateSub.mockResolvedValue({ id: 'sub_rzp_010', short_url: 'https://rzp.io/hp/jkl' });
    // stampRowId:null → UPDATE matched no row → route falls back to INSERT.
    const { subWrite, subUpdateBuilder } = wireHappyPathSupabase({ seatsUsed: 0, stampRowId: null });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never,
    );
    expect(res.status).toBe(200);

    expect(subUpdateBuilder.insert).toHaveBeenCalledTimes(1);
    expect(subUpdateBuilder.upsert).not.toHaveBeenCalled();
    expect(subWrite.sawOnConflict).toBe(false);
    const insertRow = subWrite.insertCalledWith as Record<string, unknown>;
    // Defensive insert explicitly sets the pre-payment 'trial' — never 'active'.
    expect(insertRow.status).toBe('trial');
    expect(insertRow.school_id).toBe(SCHOOL_ID);
    expect(insertRow.razorpay_subscription_id).toBe('sub_rzp_010');
  });

  it('returns 403 when ff_school_self_service_billing_v1 is OFF (flag gate) and creates no Razorpay sub', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(false);

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never,
    );
    expect(res.status).toBe(403);
    // The flag is the named self-service billing flag.
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(
      'ff_school_self_service_billing_v1',
      expect.objectContaining({ institutionId: SCHOOL_ID }),
    );
    expect(mockCreateSub).not.toHaveBeenCalled();
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
