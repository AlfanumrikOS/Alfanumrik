import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

/**
 * PAY-6 (P11(1) — signature integrity on the client-facing verify gate).
 *
 * `verify/route.ts` re-derives the Razorpay HMAC server-side and rejects with 401
 * (timing-safe compare) when the client-supplied `razorpay_signature` does NOT
 * match — BEFORE recording any payment or calling the activation RPC. That
 * 401-on-bad-signature branch was previously UNPINNED: a future refactor that
 * trusted the client signature could grant a plan without a valid HMAC (P11(3)
 * breach) and no test would fail.
 *
 * This file pins it:
 *   1. NEGATIVE — a genuinely mismatched signature (correct length, derived with a
 *      DIFFERENT secret) → 401 "Invalid payment signature", and the route NEVER
 *      touches the service-role admin client (no payment_history insert, no
 *      activate_subscription_locked RPC → no entitlement granted).
 *   2. POSITIVE CONTROL — the SAME request body with a CORRECTLY-derived signature
 *      passes the HMAC gate (so the 401 above is specifically the signature check,
 *      not an earlier failure): the route proceeds PAST the gate into DB territory.
 *
 * The RBAC gate, getUser, and Supabase clients are mocked at their seams (their own
 * behavior is proven elsewhere). The HMAC math runs REAL via node crypto so the
 * mismatch is genuine.
 */

// ── RBAC seam — ALLOW so control flow reaches the HMAC verification. ──
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
}));

// ── Cookie-auth seam → null user, forcing the Bearer fallback below. ──
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));

// ── Bearer-fallback getUser seam → our logged-in user. ──
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } },
}));

// ── Supabase admin (service-role). The NEGATIVE path must NEVER reach this. We
//    record every from()/rpc() so we can assert zero DB access on reject, and an
//    `rpcNames` list so we can assert activate_subscription_locked is not called. ──
const adminAccess = vi.hoisted(() => ({ called: false, rpcNames: [] as string[] }));
vi.mock('@/lib/supabase-admin', () => {
  function adminFromMock() {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert']) {
      chain[m] = () => chain;
    }
    // payment_history existing-check awaits the chain directly → resolve to [].
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res);
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.single = () => Promise.resolve({ data: null, error: null });
    return chain;
  }
  const adminClient = {
    from: () => {
      adminAccess.called = true;
      return adminFromMock();
    },
    rpc: (name: string) => {
      adminAccess.called = true;
      adminAccess.rpcNames.push(name);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { supabaseAdmin: adminClient, getSupabaseAdmin: () => adminClient };
});

// ── Quiet infra. ──
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn() }));

import { POST as verify } from '@/app/api/payments/verify/route';

const USER = { id: 'auth-user-123', email: 'student@test.example' };
const REAL_SECRET = 'rzp_real_secret_for_test';
const ORDER_ID = 'order_xyz';
const PAYMENT_ID = 'pay_abc123';
const SIG_PAYLOAD = `${ORDER_ID}|${PAYMENT_ID}`; // type:'order' → order_id|payment_id

function hmac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyReq(signature: string): Request {
  return new Request('http://localhost/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({
      razorpay_payment_id: PAYMENT_ID,
      razorpay_signature: signature,
      razorpay_order_id: ORDER_ID,
      plan_code: 'pro',
      billing_cycle: 'monthly',
      type: 'order',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adminAccess.called = false;
  adminAccess.rpcNames = [];
  mockAuthorizeRequest.mockResolvedValue({ authorized: true, errorResponse: undefined });
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
  process.env.RAZORPAY_KEY_SECRET = REAL_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/payments/verify — HMAC signature rejection (PAY-6, P11)', () => {
  it('rejects a mismatched signature (derived with a different secret) with 401 and grants NO access', async () => {
    // Same length as the real signature, but a genuinely different HMAC value.
    const tamperedSig = hmac('attacker_secret_not_the_real_one', SIG_PAYLOAD);
    expect(tamperedSig).not.toBe(hmac(REAL_SECRET, SIG_PAYLOAD));

    const res = await verify(verifyReq(tamperedSig) as never);

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid payment signature');

    // P11(3): no entitlement path was reached — the service-role admin client was
    // never touched, so no payment_history insert and no activation RPC.
    expect(adminAccess.called).toBe(false);
    expect(adminAccess.rpcNames).not.toContain('activate_subscription_locked');
  });

  it('rejects a too-short (wrong-length) signature with 401 before any DB work', async () => {
    const res = await verify(verifyReq('deadbeef') as never);
    expect(res.status).toBe(401);
    expect(adminAccess.called).toBe(false);
    expect(adminAccess.rpcNames).not.toContain('activate_subscription_locked');
  });

  it('positive control: a correctly-derived signature passes the HMAC gate into DB territory', async () => {
    const validSig = hmac(REAL_SECRET, SIG_PAYLOAD);
    const res = await verify(verifyReq(validSig) as never);

    // Not a signature rejection — the gate let it through (student is unresolved in
    // this mock, so the route returns 202 activation_pending; the point is it is NOT
    // 401 and it DID reach the admin client past the HMAC check).
    expect(res.status).not.toBe(401);
    expect(adminAccess.called).toBe(true);
  });
});
