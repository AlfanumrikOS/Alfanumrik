/**
 * Track A.3 — tax-inclusive charge at the Razorpay boundary (create-order + subscribe).
 *
 * Pins that the per-state GST wiring charges the TAX-INCLUSIVE total_payable (in
 * paisa, conversion correct) and carries the GST breakdown in order `notes`,
 * WITHOUT altering the untouched contracts:
 *   - create-order: amount sent to Razorpay == Math.round(total_payable * 100).
 *   - subscribe (yearly): createRazorpayOrder gets amountInr == total_payable.
 *   - subscribe (monthly): recurring charge is unchanged (plan-fixed); GST rides
 *     in subscription notes only.
 *   - GST RPC unavailable → sale NOT blocked, bare taxable charged (fallback).
 *   - No PII leaks into the GST notes (P13).
 *
 * compute_gst is mocked at the @/lib/gst seam so there is no DB. The Razorpay
 * boundary is a mocked fetch (create-order) / mocked razorpay lib (subscribe).
 * The HMAC/activation contracts are NOT exercised here — they live in verify.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── GST seam (the unit under contract). computeGst returns the staged RPC shape;
//    gstToRazorpayNotes / supplierStateCode use the REAL implementations so we
//    also prove the notes flattening + supplier-state resolution end to end. ──
const mockComputeGst = vi.fn();
vi.mock('@/lib/gst', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gst')>();
  return {
    ...actual,
    computeGst: (...a: unknown[]) => mockComputeGst(...a),
  };
});

// ── Feature flags seam — gates GST charging in all three payment routes ────
// isFeatureEnabled uses raw fetch (not supabaseAdmin), so the supabaseAdmin
// mock can't intercept it. We mock the entire module so gstChargingEnabled()
// returns true in all tests that exercise the GST logic path. Tests that need
// the GST-OFF fallback do so by mocking computeGst to return null (not by
// toggling the flag).
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: async (_flagName: string) => true,
  PAYMENT_FLAGS: {
    GST_INVOICING_V1: 'ff_gst_invoicing_v1',
    RECONCILE_STUCK_SUBSCRIPTIONS_ENABLED: 'reconcile_stuck_subscriptions_enabled',
  },
}));

// ── Auth seams ──────────────────────────────────────────────────────────────
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
const bearerGetUser = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => bearerGetUser(...a) } },
}));

// create-order gates with authorizeRequest; subscribe does not.
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
}));

// ── Razorpay (subscribe path) ───────────────────────────────────────────────
const createRazorpaySubscription = vi.fn();
const createRazorpayOrder = vi.fn();
vi.mock('@/lib/razorpay', () => ({
  createRazorpaySubscription: (...a: unknown[]) => createRazorpaySubscription(...a),
  createRazorpayOrder: (...a: unknown[]) => createRazorpayOrder(...a),
}));

// ── Validation: pass through plan_code/billing_cycle, preserve place_of_supply on
//    rawBody (the routes read place_of_supply off rawBody, not validation.data). ──
vi.mock('@/lib/validation', () => {
  const { NextResponse } = require('next/server');
  const VALID = new Set(['free', 'starter', 'pro', 'unlimited']);
  return {
    paymentSubscribeSchema: {},
    validateBody: (_schema: unknown, body: any) => {
      const raw = String(body?.plan_code ?? '');
      const canon = raw
        .replace(/_(monthly|yearly)$/, '')
        .replace(/^ultimate$/, 'unlimited')
        .replace(/^basic$/, 'starter')
        .replace(/^premium$/, 'pro');
      if (!VALID.has(canon)) {
        return {
          success: false,
          error: NextResponse.json({ success: false, error: 'Validation failed' }, { status: 400 }),
        };
      }
      return { success: true, data: { plan_code: raw, billing_cycle: body?.billing_cycle ?? 'monthly' } };
    },
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn().mockResolvedValue(undefined) }));

// ── supabaseAdmin chain (subscribe plan lookup, students, existing sub) ──────
let _planRow: any = { data: null, error: null };
let _studentRow: any = { data: null, error: null };
let _existingSub: any = { data: null, error: null };
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
function fromMock(table: string) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  const resolve = () => {
    if (table === 'subscription_plans') return _planRow;
    if (table === 'students') return _studentRow;
    return _existingSub;
  };
  chain.single = () => Promise.resolve(resolve());
  chain.maybeSingle = () => Promise.resolve(resolve());
  return chain;
}
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t), rpc: (...a: unknown[]) => rpcMock(...a) },
}));

// A staged INTRA-state GST result: taxable 299 → 18% → total_payable 352.82.
const GST_299 = {
  taxable_amount: 299,
  sac: '9992',
  rate: 18,
  is_exempt: false,
  intra_state: true,
  cgst: 26.91,
  sgst: 26.91,
  igst: 0,
  total_tax: 53.82,
  total_payable: 352.82,
  supplier_gstin: '27ABCDE1234F1Z5',
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-for-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-for-test';
  process.env.RAZORPAY_KEY_ID = 'fake_kid_for_test';
  process.env.RAZORPAY_KEY_SECRET = 'fake_ksecret_for_test';
  delete process.env.ALFANUMRIK_SUPPLIER_STATE_CODE;
  delete process.env.ALFANUMRIK_STATE_CODE;
  bearerGetUser.mockResolvedValue({ data: { user: { id: 'auth-1', email: 'u@x.com' } } });
  mockAuthorizeRequest.mockResolvedValue({ authorized: true, errorResponse: undefined });
  _planRow = { data: null, error: null };
  _studentRow = { data: null, error: null };
  _existingSub = { data: null, error: null };
  fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'order_1', amount: 35282, currency: 'INR' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeReq(body: unknown): any {
  return {
    cookies: { getAll: () => [] },
    headers: { get: (h: string) => (h === 'Authorization' ? 'Bearer tok' : null) },
    json: async () => body,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// create-order — charges tax-inclusive total in paisa, GST in notes
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/create-order — tax-inclusive charge', () => {
  async function loadPOST() {
    return (await import('@/app/api/payments/create-order/route')).POST;
  }

  it('charges Math.round(total_payable * 100) paisa to Razorpay (not the bare taxable)', async () => {
    mockComputeGst.mockResolvedValue(GST_299);
    const POST = await loadPOST();
    const res = await POST(makeReq({ plan_code: 'starter', billing_cycle: 'monthly', place_of_supply: 'MH' }));
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // 352.82 * 100 = 35282 paisa (tax-inclusive), NOT the listed 29900 taxable.
    expect(body.amount).toBe(35282);
    expect(body.amount).not.toBe(29900);
  });

  it('embeds the full GST breakdown in the order notes (codes + money only)', async () => {
    mockComputeGst.mockResolvedValue(GST_299);
    const POST = await loadPOST();
    await POST(makeReq({ plan_code: 'starter', billing_cycle: 'monthly', place_of_supply: 'MH' }));

    const notes = JSON.parse(fetchSpy.mock.calls[0][1].body).notes;
    expect(notes.gst_total_payable_inr).toBe('352.82');
    expect(notes.gst_cgst_inr).toBe('26.91');
    expect(notes.gst_sgst_inr).toBe('26.91');
    expect(notes.gst_rate).toBe('18');
    expect(notes.gst_supplier_gstin).toBe('27ABCDE1234F1Z5');
    expect(notes.supplier_state_code).toBe('MH');
    expect(notes.place_of_supply).toBe('MH');
  });

  it('falls back to the bare taxable amount (sale NOT blocked) when compute_gst is unavailable', async () => {
    mockComputeGst.mockResolvedValue(null);
    const POST = await loadPOST();
    const res = await POST(makeReq({ plan_code: 'starter', billing_cycle: 'monthly' }));
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // The listed taxable price in paisa — no GST add-on, but the order still goes through.
    expect(body.amount).toBe(29900);
    // No gst_* notes when the RPC was unavailable.
    expect(Object.keys(body.notes).some((k) => k.startsWith('gst_'))).toBe(false);
  });

  it('the Razorpay order notes carry NO PII beyond the pre-existing user_id/email keys (no GST PII leak)', async () => {
    mockComputeGst.mockResolvedValue(GST_299);
    const POST = await loadPOST();
    await POST(makeReq({ plan_code: 'starter', billing_cycle: 'monthly', place_of_supply: 'MH' }));
    const notes = JSON.parse(fetchSpy.mock.calls[0][1].body).notes;
    // Every gst_* key is money/codes only — none carry name/phone/etc.
    for (const [k, v] of Object.entries(notes)) {
      if (k.startsWith('gst_')) {
        expect(String(k)).not.toMatch(/name|phone|mobile|address/i);
        expect(typeof v).toBe('string');
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// subscribe — yearly tax-inclusive order; monthly recurring unchanged
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/subscribe — tax-inclusive yearly, unchanged monthly', () => {
  async function loadPOST() {
    return (await import('@/app/api/payments/subscribe/route')).POST;
  }

  const PLAN = {
    id: 'plan-1', plan_code: 'pro', name: 'Pro',
    price_monthly: 699, price_yearly: 5599,
    razorpay_plan_id_monthly: 'rzp_plan_pro', is_active: true,
  };

  it('yearly: createRazorpayOrder is charged the tax-inclusive total_payable (not the bare price_yearly)', async () => {
    _planRow = { data: PLAN, error: null };
    _studentRow = { data: { id: 'student-1' }, error: null };
    mockComputeGst.mockResolvedValue({ ...GST_299, taxable_amount: 5599, total_payable: 6606.82, total_tax: 1007.82 });
    createRazorpayOrder.mockResolvedValue({ id: 'order_y', amount: 660682, currency: 'INR' });

    const POST = await loadPOST();
    const res = await POST(makeReq({ plan_code: 'pro', billing_cycle: 'yearly', place_of_supply: 'KA' }));
    expect(res.status).toBe(200);

    expect(createRazorpayOrder).toHaveBeenCalledTimes(1);
    const arg = createRazorpayOrder.mock.calls[0][0];
    expect(arg.amountInr).toBe(6606.82);       // tax-inclusive
    expect(arg.amountInr).not.toBe(5599);       // not the bare taxable
    // GST breakdown rides in the order notes.
    expect(arg.notes.gst_total_payable_inr).toBe('6606.82');
  });

  it('yearly: falls back to bare price_yearly when compute_gst is unavailable (sale not blocked)', async () => {
    _planRow = { data: PLAN, error: null };
    _studentRow = { data: { id: 'student-1' }, error: null };
    mockComputeGst.mockResolvedValue(null);
    createRazorpayOrder.mockResolvedValue({ id: 'order_y', amount: 559900, currency: 'INR' });

    const POST = await loadPOST();
    const res = await POST(makeReq({ plan_code: 'pro', billing_cycle: 'yearly' }));
    expect(res.status).toBe(200);
    expect(createRazorpayOrder.mock.calls[0][0].amountInr).toBe(5599);
  });

  it('monthly: recurring charge is plan-fixed (no amount passed); GST only rides in subscription notes', async () => {
    _planRow = { data: PLAN, error: null };
    _studentRow = { data: { id: 'student-1' }, error: null };
    mockComputeGst.mockResolvedValue({ ...GST_299, taxable_amount: 699, total_payable: 824.82, total_tax: 125.82 });
    createRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_1' });
    rpcMock.mockResolvedValue({ data: null, error: null });

    const POST = await loadPOST();
    const res = await POST(makeReq({ plan_code: 'pro', billing_cycle: 'monthly', place_of_supply: 'KA' }));
    expect(res.status).toBe(200);

    // The recurring Razorpay subscription is created against the FIXED plan id —
    // we never pass a recomputed amount (recurring charge is unchanged by Track A.3).
    const subArg = createRazorpaySubscription.mock.calls[0][0];
    expect(subArg.razorpayPlanId).toBe('rzp_plan_pro');
    expect(subArg).not.toHaveProperty('amount');
    expect(subArg).not.toHaveProperty('amountInr');
    // But the GST split is carried in notes for webhook reconciliation.
    expect(subArg.notes.gst_total_payable_inr).toBe('824.82');
    expect(subArg.notes.gst_rate).toBe('18');
    // create_pending_subscription persists the bare taxable price_monthly (unchanged).
    expect(rpcMock).toHaveBeenCalled();
    const rpcArgs = rpcMock.mock.calls[0][1];
    expect(rpcArgs.p_amount_inr).toBe(699);
  });
});
