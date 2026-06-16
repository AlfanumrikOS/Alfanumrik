import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Quarterly self-service billing + demo-comp entitlement (P11) for
 * POST /api/school-admin/subscription.
 *
 * Branch: feat/portal-rbac-saas-remediation.
 *
 * What these tests pin (the two security-relevant boundaries):
 *
 *   QUARTERLY (P11 — no split-brain billing, no pre-payment access):
 *     • A quarterly POST stamps billing_cycle='quarterly', selects the
 *       razorpay_plan_id_QUARTERLY id (NEVER the monthly id — a quarterly
 *       request charged on the monthly plan id would charge 1× while the DB
 *       records quarterly = split-brain), uses totalBillingCycles=4, carries
 *       school_id in Razorpay notes, and leaves the row at pre-payment 'trial'
 *       (NEVER 'active' — only the signature-verified webhook activates).
 *     • If the quarterly plan id is NULL (not provisioned), the route 400s with
 *       code 'plan_not_provisioned' and NEVER creates a Razorpay subscription
 *       (no orphan) and NEVER silently falls back to the monthly id.
 *
 *   DEMO COMP (the sanctioned P11 exception — strictly server-gated):
 *     • A DEMO school (schools.is_demo=true, resolved from auth.schoolId, never
 *       from the request body) gets a complimentary status='active' grant with
 *       is_demo=true, razorpay_subscription_id=null, period stamped (+3mo
 *       quarterly / +1mo monthly), ZERO Razorpay calls, response { comp:true },
 *       and a metadata-only audit (no PII).
 *     • Because the comp branch runs ABOVE the quarterly null-guard, a demo
 *       school with an UNPROVISIONED quarterly plan STILL gets the comp grant
 *       (the reorder is intentional and pinned here).
 *     • A NON-DEMO school can NEVER reach the comp branch — isDemoSchool=false
 *       routes to the real Razorpay path; even an isDemoSchool that THROWS fails
 *       closed (→ false → real path). This is the critical "real school can
 *       never get a free grant" boundary.
 */

const mockAuthorize = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockCapture = vi.fn();
const mockCreateSub = vi.fn();
const mockCancelSub = vi.fn();
const mockUpdateQty = vi.fn();
const mockIsDemoSchool = vi.fn();
const mockLogSchoolAudit = vi.fn();

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
vi.mock('@/lib/demo/is-demo-school', () => ({
  isDemoSchool: (...a: unknown[]) => mockIsDemoSchool(...a),
}));
vi.mock('@/lib/audit', () => ({
  logSchoolAudit: (...a: unknown[]) => mockLogSchoolAudit(...a),
}));

import { POST } from '@/app/api/school-admin/subscription/route';

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

/**
 * Wire supabaseChain.from() for the POST path. Records how school_subscriptions
 * was written (update/insert + the values), the quarterly/monthly plan ids the
 * plan row exposes, and the active-seat count.
 */
function wireSupabase(opts?: {
  seatsUsed?: number;
  stampRowId?: string | null;
  quarterlyPlanId?: string | null;
  monthlyPlanId?: string | null;
}) {
  const seatsUsed = opts?.seatsUsed ?? 0;
  const stampRowId = opts?.stampRowId === undefined ? 'sub_row_existing' : opts.stampRowId;
  const quarterlyPlanId = opts?.quarterlyPlanId === undefined ? 'rzp_quarterly_plan' : opts.quarterlyPlanId;
  const monthlyPlanId = opts?.monthlyPlanId === undefined ? 'rzp_monthly_plan' : opts.monthlyPlanId;

  const planLookup = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        plan_code: 'starter',
        razorpay_plan_id: 'rzp_yearly_plan',
        razorpay_plan_id_monthly: monthlyPlanId,
        razorpay_plan_id_quarterly: quarterlyPlanId,
        price_monthly: 99,
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: NOT a demo school. Each test opts into demo explicitly.
  mockIsDemoSchool.mockResolvedValue(false);
});

// ── 2a. Quarterly happy path ────────────────────────────────────────────────
describe('POST quarterly — happy path (P11)', () => {
  it('stamps billing_cycle=quarterly, uses the quarterly plan id, totalBillingCycles=4, stays pre-payment trial, notes carry school_id', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCreateSub.mockResolvedValue({ id: 'sub_rzp_q1', short_url: 'https://rzp.io/hp/q1' });
    const { subWrite } = wireSupabase({ seatsUsed: 10 });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'quarterly', seats: 50 }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data?: { billing_cycle?: string; razorpay_subscription_id?: string };
    };
    expect(json.success).toBe(true);
    expect(json.data?.billing_cycle).toBe('quarterly');

    // Razorpay sub created with the QUARTERLY plan id, totalBillingCycles=4,
    // and school_id in notes (so the webhook can match + activate it).
    expect(mockCreateSub).toHaveBeenCalledTimes(1);
    expect(mockCreateSub).toHaveBeenCalledWith(
      expect.objectContaining({
        razorpayPlanId: 'rzp_quarterly_plan',
        totalBillingCycles: 4,
        notes: expect.objectContaining({ school_id: SCHOOL_ID }),
      }),
    );
    // It must NOT have used the monthly plan id (split-brain billing guard).
    expect(mockCreateSub).not.toHaveBeenCalledWith(
      expect.objectContaining({ razorpayPlanId: 'rzp_monthly_plan' }),
    );

    // DB stamp: billing_cycle quarterly, razorpay sub id stamped, and NO status
    // set (row stays pre-payment 'trial' — P11: no access before verified pay).
    const stamp = subWrite.updateCalledWith as Record<string, unknown>;
    expect(stamp.billing_cycle).toBe('quarterly');
    expect(stamp.razorpay_subscription_id).toBe('sub_rzp_q1');
    expect(stamp.seats_purchased).toBe(50);
    expect(stamp).not.toHaveProperty('status');
    expect(Object.values(stamp)).not.toContain('active');
  });
});

// ── 2b. Quarterly null-guard (P11) ──────────────────────────────────────────
describe('POST quarterly — null-guard when quarterly plan id is missing (P11)', () => {
  it('400 plan_not_provisioned, NEVER creates a Razorpay sub (no orphan), NO monthly fallback', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    // Quarterly id NULL but monthly id PRESENT — proves we never fall back to it.
    wireSupabase({ seatsUsed: 0, quarterlyPlanId: null, monthlyPlanId: 'rzp_monthly_plan' });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'quarterly', seats: 50 }) as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success?: boolean; code?: string; error?: string };
    expect(json.success).toBe(false);
    expect(json.code).toBe('plan_not_provisioned');
    expect(json.error).toBe('plan_not_provisioned');

    // No orphan: the null-guard short-circuits BEFORE Razorpay coordination.
    expect(mockCreateSub).not.toHaveBeenCalled();
    // No monthly fallback: the monthly plan id was present but must NOT be used.
    expect(mockCreateSub).not.toHaveBeenCalledWith(
      expect.objectContaining({ razorpayPlanId: 'rzp_monthly_plan' }),
    );
  });
});

// ── 2c. Demo comp (the key P11-exception boundary) ──────────────────────────
describe('POST demo comp — sanctioned P11 exception (server-gated)', () => {
  it('quarterly demo: status=active, is_demo=true, no rzp sub id, period +3mo, ZERO Razorpay calls, comp:true, metadata-only audit', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockIsDemoSchool.mockResolvedValue(true);
    const { subWrite } = wireSupabase({ seatsUsed: 0 });

    const before = new Date();
    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'quarterly', seats: 50 }) as never,
    );
    const after = new Date();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      comp?: boolean;
      data?: {
        status?: string;
        is_demo?: boolean;
        razorpay_subscription_id?: string | null;
        current_period_end?: string;
        billing_cycle?: string;
      };
    };
    expect(json.success).toBe(true);
    expect(json.comp).toBe(true);
    expect(json.data?.status).toBe('active');
    expect(json.data?.is_demo).toBe(true);
    expect(json.data?.razorpay_subscription_id).toBeNull();
    expect(json.data?.billing_cycle).toBe('quarterly');

    // ZERO Razorpay coordination on the comp path.
    expect(mockCreateSub).not.toHaveBeenCalled();

    // DB comp row: active + is_demo + null rzp sub id, period end ~ +3 months.
    const stamp = subWrite.updateCalledWith as Record<string, unknown>;
    expect(stamp.status).toBe('active');
    expect(stamp.is_demo).toBe(true);
    expect(stamp.razorpay_subscription_id).toBeNull();

    const periodEnd = new Date(json.data!.current_period_end as string);
    const expectedLow = new Date(before); expectedLow.setMonth(expectedLow.getMonth() + 3);
    const expectedHigh = new Date(after); expectedHigh.setMonth(expectedHigh.getMonth() + 3);
    // +3 months from "now" — allow the test-execution window.
    expect(periodEnd.getTime()).toBeGreaterThanOrEqual(expectedLow.getTime() - 1000);
    expect(periodEnd.getTime()).toBeLessThanOrEqual(expectedHigh.getTime() + 1000);

    // Audit: action subscription.comp_granted, metadata-only (no PII keys).
    expect(mockLogSchoolAudit).toHaveBeenCalledTimes(1);
    const auditArg = mockLogSchoolAudit.mock.calls[0][0] as {
      action: string;
      metadata?: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('subscription.comp_granted');
    const auditBlob = JSON.stringify(auditArg).toLowerCase();
    expect(auditBlob).not.toMatch(/email|phone|"name"|first_name|last_name/);
    expect(auditArg.metadata).toEqual(
      expect.objectContaining({ is_demo: true, billing_cycle: 'quarterly', razorpay_subscription_id: null }),
    );
  });

  it('monthly demo: comp row stamps period +1mo (not +3mo)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockIsDemoSchool.mockResolvedValue(true);
    wireSupabase({ seatsUsed: 0 });

    const before = new Date();
    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never,
    );
    const after = new Date();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { comp?: boolean; data?: { current_period_end?: string } };
    expect(json.comp).toBe(true);

    const periodEnd = new Date(json.data!.current_period_end as string);
    const lo = new Date(before); lo.setMonth(lo.getMonth() + 1);
    const hi = new Date(after); hi.setMonth(hi.getMonth() + 1);
    expect(periodEnd.getTime()).toBeGreaterThanOrEqual(lo.getTime() - 1000);
    expect(periodEnd.getTime()).toBeLessThanOrEqual(hi.getTime() + 1000);
    expect(mockCreateSub).not.toHaveBeenCalled();
  });
});

// ── 2d. Demo + UNPROVISIONED quarterly plan → comp still succeeds ────────────
describe('POST demo comp — runs ABOVE the quarterly null-guard (reorder pin)', () => {
  it('demo school with an unprovisioned quarterly plan STILL gets the comp grant (NOT plan_not_provisioned)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockIsDemoSchool.mockResolvedValue(true);
    // Quarterly plan id is NULL — a real school would 400 here. The comp branch
    // must run first and never reach the null-guard.
    const { subWrite } = wireSupabase({ seatsUsed: 0, quarterlyPlanId: null });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'quarterly', seats: 50 }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { comp?: boolean; success?: boolean; code?: string };
    expect(json.success).toBe(true);
    expect(json.comp).toBe(true);
    // Crucially NOT the null-guard error.
    expect(json.code).not.toBe('plan_not_provisioned');

    expect(mockCreateSub).not.toHaveBeenCalled();
    const stamp = subWrite.updateCalledWith as Record<string, unknown>;
    expect(stamp.status).toBe('active');
    expect(stamp.is_demo).toBe(true);
  });
});

// ── 2e. Real (non-demo) school + unprovisioned quarterly → still guarded ─────
describe('POST real (non-demo) school — quarterly null-guard still enforced', () => {
  it('non-demo school with an unprovisioned quarterly plan → 400 plan_not_provisioned (real path stays guarded)', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockIsDemoSchool.mockResolvedValue(false); // real school
    wireSupabase({ seatsUsed: 0, quarterlyPlanId: null });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'quarterly', seats: 50 }) as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code?: string; comp?: boolean };
    expect(json.code).toBe('plan_not_provisioned');
    // Never comped — a real school must not get a free grant.
    expect(json.comp).toBeUndefined();
    expect(mockCreateSub).not.toHaveBeenCalled();
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
  });
});

// ── 2f. CRITICAL boundary: non-demo can NEVER reach the comp branch ─────────
describe('POST critical boundary — a NON-DEMO school can NEVER comp', () => {
  it('isDemoSchool=false → takes the real Razorpay path, NO comp, NO comp audit', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockIsDemoSchool.mockResolvedValue(false);
    mockCreateSub.mockResolvedValue({ id: 'sub_rzp_real', short_url: 'https://rzp.io/hp/real' });
    const { subWrite } = wireSupabase({ seatsUsed: 0 });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { comp?: boolean; data?: { razorpay_subscription_id?: string } };
    // Real path: a real Razorpay sub was created; response is NOT a comp.
    expect(json.comp).toBeUndefined();
    expect(json.data?.razorpay_subscription_id).toBe('sub_rzp_real');
    expect(mockCreateSub).toHaveBeenCalledTimes(1);

    // No comp grant: the DB write stays pre-payment trial (no status) and no
    // comp audit fired.
    const stamp = subWrite.updateCalledWith as Record<string, unknown>;
    expect(stamp).not.toHaveProperty('status');
    expect(stamp.is_demo).toBeUndefined();
    expect(mockLogSchoolAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.comp_granted' }),
    );
  });

  it('isDemoSchool fail-closed (resolves false on its internal error) → real Razorpay path, NO comp', async () => {
    authOK();
    mockIsFeatureEnabled.mockResolvedValue(true);
    // isDemoSchool swallows its own errors and returns false (proven directly in
    // is-demo-school.test.ts). The route therefore sees `false` and takes the
    // real, payment-gated path. We model the predicate's fail-closed OUTPUT here.
    mockIsDemoSchool.mockResolvedValue(false);
    mockCreateSub.mockResolvedValue({ id: 'sub_rzp_failclosed', short_url: 'https://rzp.io/hp/fc' });
    wireSupabase({ seatsUsed: 0 });

    const res = await POST(
      makeRequest('POST', { plan: 'starter', billing_cycle: 'monthly', seats: 50 }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { comp?: boolean; data?: { razorpay_subscription_id?: string } };
    // Real path: NOT a comp; a real Razorpay sub was created.
    expect(json.comp).toBeUndefined();
    expect(json.data?.razorpay_subscription_id).toBe('sub_rzp_failclosed');
    expect(mockCreateSub).toHaveBeenCalledTimes(1);
    // No comp grant under the fail-closed path.
    expect(mockLogSchoolAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.comp_granted' }),
    );
  });
});
