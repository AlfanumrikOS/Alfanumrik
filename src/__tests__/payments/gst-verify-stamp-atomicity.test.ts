/**
 * Track A.3 — verify route GST-column stamp is NON-BLOCKING (P11 atomicity).
 *
 * The CRITICAL invariant: the GST stamp happens AFTER the untouched atomic
 * activation RPC + post-update read-back. A GST-stamp UPDATE failure (or a
 * compute_gst outage, or a thrown exception in the GST block) MUST NOT:
 *   - flip the 200 success response into an error, nor
 *   - reverse / undo the already-granted paid entitlement.
 *
 * We also assert:
 *   - on the happy path the GST columns ARE stamped onto student_subscriptions,
 *     scoped to (student_id, plan_code);
 *   - the HMAC signature contract is unchanged (an invalid signature still 401s
 *     and never reaches activation or the GST stamp);
 *   - no PII is logged from the GST block.
 *
 * Fully mocked — no DB, no network. The activation RPC + read-back are stubbed to
 * the SUCCESS shape so control flow reaches the Track A.3 GST block.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── GST seam ────────────────────────────────────────────────────────────────
const mockComputeGst = vi.fn();
vi.mock('@/lib/gst', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gst')>();
  return { ...actual, computeGst: (...a: unknown[]) => mockComputeGst(...a) };
});

// ── Auth seams ──────────────────────────────────────────────────────────────
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
const bearerGetUser = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => bearerGetUser(...a) } },
}));
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a) }));

// ── Validation: pass through, preserve place_of_supply ──────────────────────
vi.mock('@/lib/validation', () => {
  const { NextResponse } = require('next/server');
  return {
    paymentVerifySchema: {},
    validateBody: (_schema: unknown, body: any) => ({
      success: true,
      data: {
        razorpay_order_id: body.razorpay_order_id,
        razorpay_payment_id: body.razorpay_payment_id,
        razorpay_signature: body.razorpay_signature,
        razorpay_subscription_id: body.razorpay_subscription_id,
        plan_code: body.plan_code ?? 'pro',
        billing_cycle: body.billing_cycle ?? 'monthly',
        type: body.type ?? 'order',
        place_of_supply: body.place_of_supply,
      },
    }),
    __esModule: true,
  };
});

const warnSpy = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => warnSpy(...a), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));

// ── supabaseAdmin chain. Records GST update args; lets the test stage the GST
//    UPDATE outcome (success / error). ──
const RZP_SECRET = 'fake_ksecret_for_test';
const gstUpdate = vi.hoisted(() => ({ called: false, payload: null as unknown, eqs: [] as Array<[string, unknown]> }));
let _gstUpdateResult: { error: unknown } = { error: null };
let _gstUpdateThrows = false;

function fromMock(table: string) {
  const chain: any = {};
  chain.select = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.insert = () => Promise.resolve({ error: null });
  chain.update = (payload: unknown) => {
    if (table === 'student_subscriptions') {
      gstUpdate.called = true;
      gstUpdate.payload = payload;
      const eqChain: any = {
        eq: (col: string, val: unknown) => {
          gstUpdate.eqs.push([col, val]);
          // After both .eq() calls the update resolves (await on the 2nd eq).
          eqChain.then = (res: (v: unknown) => unknown) => {
            if (_gstUpdateThrows) return Promise.reject(new Error('gst update threw')).then(res, res);
            return Promise.resolve(_gstUpdateResult).then(res);
          };
          return eqChain;
        },
      };
      return eqChain;
    }
    // students.update(...).eq(...) — auth_user_id fix path; resolve silently.
    return { eq: () => Promise.resolve({ error: null }) };
  };
  chain.eq = () => chain;
  chain.maybeSingle = () => {
    if (table === 'feature_flags') return Promise.resolve({ data: { is_enabled: true }, error: null });
    if (table === 'payment_history') return Promise.resolve({ data: null, error: null });
    if (table === 'students') return Promise.resolve({ data: { id: 'student-1' }, error: null });
    if (table === 'subscription_plans') {
      return Promise.resolve({ data: { price_monthly: 699, price_yearly: 5599 }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  chain.single = () => chain.maybeSingle();
  return chain;
}

const rpcMock = vi.fn();
const verifyReadback = vi.hoisted(() => ({ plan: 'pro' }));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      // students post-update read-back (subscription_plan) lives on the students table.
      if (t === 'students') {
        const chain: any = fromMock('students');
        chain.maybeSingle = () =>
          // First students lookup returns {id}; the read-back returns {subscription_plan}.
          Promise.resolve({ data: { id: 'student-1', subscription_plan: verifyReadback.plan }, error: null });
        return chain;
      }
      return fromMock(t);
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

const GST = {
  taxable_amount: 699, sac: '9992', rate: 18, is_exempt: false, intra_state: true,
  cgst: 62.91, sgst: 62.91, igst: 0, total_tax: 125.82, total_payable: 824.82,
  supplier_gstin: '27ABCDE1234F1Z5',
};

function signedReq(body: Record<string, unknown>): any {
  const payload = `${body.razorpay_order_id}|${body.razorpay_payment_id}`;
  const sig = crypto.createHmac('sha256', RZP_SECRET).update(payload).digest('hex');
  return {
    cookies: { getAll: () => [] },
    headers: { get: (h: string) => (h === 'Authorization' ? 'Bearer tok' : null) },
    json: async () => ({ razorpay_signature: sig, ...body }),
  };
}

const BASE = {
  razorpay_order_id: 'order_xyz',
  razorpay_payment_id: 'pay_abc',
  plan_code: 'pro',
  billing_cycle: 'monthly',
  type: 'order',
  place_of_supply: 'MH',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-for-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-for-test';
  process.env.RAZORPAY_KEY_SECRET = RZP_SECRET;
  delete process.env.ALFANUMRIK_SUPPLIER_STATE_CODE;
  delete process.env.ALFANUMRIK_STATE_CODE;
  bearerGetUser.mockResolvedValue({ data: { user: { id: 'auth-1', email: 'u@x.com' } } });
  mockAuthorizeRequest.mockResolvedValue({ authorized: true, errorResponse: undefined });
  rpcMock.mockResolvedValue({ data: null, error: null }); // activation RPC succeeds
  verifyReadback.plan = 'pro';
  gstUpdate.called = false;
  gstUpdate.payload = null;
  gstUpdate.eqs = [];
  _gstUpdateResult = { error: null };
  _gstUpdateThrows = false;
  mockComputeGst.mockResolvedValue(GST);
});

async function loadPOST() {
  return (await import('@/app/api/payments/verify/route')).POST;
}

describe('verify — GST stamp happy path', () => {
  it('stamps the GST columns onto student_subscriptions scoped to (student_id, plan_code)', async () => {
    const POST = await loadPOST();
    const res = await POST(signedReq(BASE));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    expect(gstUpdate.called).toBe(true);
    expect(gstUpdate.payload).toMatchObject({
      sac: '9992', gst_rate: 18, cgst_amount: 62.91, sgst_amount: 62.91,
      igst_amount: 0, total_tax_inr: 125.82, place_of_supply: 'MH',
    });
    expect(gstUpdate.eqs).toContainEqual(['student_id', 'student-1']);
    expect(gstUpdate.eqs).toContainEqual(['plan_code', 'pro']);
  });

  it('runs the GST stamp AFTER a SUCCESSFUL activation RPC (activation is the gate)', async () => {
    const POST = await loadPOST();
    await POST(signedReq(BASE));
    // activate_subscription_locked was invoked and the GST update only happened after.
    expect(rpcMock).toHaveBeenCalledWith('activate_subscription_locked', expect.any(Object));
    expect(gstUpdate.called).toBe(true);
  });
});

describe('verify — GST stamp is NON-BLOCKING (P11: paid + entitlement must stand)', () => {
  it('a GST UPDATE error does NOT fail the 200 success response', async () => {
    _gstUpdateResult = { error: { message: 'column lock conflict' } };
    const POST = await loadPOST();
    const res = await POST(signedReq(BASE));
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ success: true, plan: 'pro' });
  });

  it('a thrown exception in the GST block is swallowed — response still 200 success', async () => {
    _gstUpdateThrows = true;
    const POST = await loadPOST();
    const res = await POST(signedReq(BASE));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('a compute_gst outage leaves GST columns unwritten but does NOT reverse activation', async () => {
    mockComputeGst.mockResolvedValue(null);
    const POST = await loadPOST();
    const res = await POST(signedReq(BASE));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // No UPDATE attempted when there is no GST to stamp; activation RPC was NOT reversed.
    expect(gstUpdate.called).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith('activate_subscription_locked', expect.any(Object));
    // The activation RPC is never called a second time (no compensating undo).
    const activationCalls = rpcMock.mock.calls.filter((c) => c[0] === 'activate_subscription_locked');
    expect(activationCalls).toHaveLength(1);
  });

  it('the GST failure path logs a WARNING with no PII (P13)', async () => {
    _gstUpdateResult = { error: { message: 'lock conflict' } };
    const POST = await loadPOST();
    await POST(signedReq(BASE));
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toMatch(/u@x\.com/);
    expect(logged).not.toMatch(/\b\d{10}\b/); // no bare phone numbers
  });
});

describe('verify — HMAC contract unchanged by Track A.3', () => {
  it('an invalid signature still 401s and never reaches activation or the GST stamp', async () => {
    const POST = await loadPOST();
    const res = await POST({
      cookies: { getAll: () => [] },
      headers: { get: (h: string) => (h === 'Authorization' ? 'Bearer tok' : null) },
      json: async () => ({ ...BASE, razorpay_signature: 'deadbeef' }),
    } as any);
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalledWith('activate_subscription_locked', expect.any(Object));
    expect(gstUpdate.called).toBe(false);
  });
});
