/**
 * Money + destructive cron secret/idempotency guards.
 *
 * Three CRON_SECRET-gated routes that either move money or hard-delete data.
 * Each MUST refuse to do any work without a valid CRON_SECRET (constant-time
 * compare), and each MUST be safe to re-run.
 *
 *   1. /api/cron/reconcile-payments (POST)
 *        - rejects without CRON_SECRET (401), no DB scan.
 *        - idempotent: a payment whose student is already on the matching plan
 *          is NOT re-reconciled (no double-credit / no students.update).
 *   2. /api/cron/expired-subscriptions (POST)
 *        - CRON_SECRET required (401 without).
 *        - delegates to the check_expired_subscriptions RPC whose WHERE filters
 *          implement the grace period — a past_due sub inside its grace window
 *          is not halted (we assert the route reports the RPC's own counts and
 *          does not itself cut access).
 *   3. /api/cron/account-purge (GET + POST) — DESTRUCTIVE
 *        - refuses without CRON_SECRET (401) on BOTH verbs, no rows queried,
 *          no Edge Function invoked.
 *        - with a valid secret but nothing due → processes 0 (scope guard).
 *
 * Mirrors the constant-time-secret + supabase-admin mocking style in
 * src/__tests__/api/cron/reverify-domains.test.ts and the quiz-submit route
 * test family.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Logger + ops-events silencers ───────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));

// ── supabaseAdmin / getSupabaseAdmin shared mock ────────────────────────────
// reconcile-payments + expired-subscriptions import getSupabaseAdmin().
// account-purge imports the eager supabaseAdmin singleton.
//
// Tables/chains we model:
//   payment_history:        .select(...).eq('status','captured').order(...).limit(N)   → _capturedPayments
//   students (select):      .select('id, subscription_plan').in('id', ids)             → _studentsByIds
//   students (update):      .update({...}).eq('id', x)                                 → records updateStudentCalls
//   subscription_plans:     .select('id').eq('plan_code', x).limit(1).maybeSingle()    → { id }
//   student_subscriptions:  .upsert({...}, {...})                                      → records upsertCalls
//   account_deletion_log:   .select(...).in('status',...).lte(...).order(...).limit(N) → _purgeDueRows
//   admin.rpc('check_expired_subscriptions')                                           → _expiredRpc

let _capturedPayments: any = { data: [], error: null };
let _studentsByIds: any = { data: [], error: null };
let _planIdRow: any = { data: { id: 'plan-1' }, error: null };
let _purgeDueRows: any = { data: [], error: null };
let _expiredRpc: any = { data: { marked_past_due: 0, halted: 0, checked_at: '2026-06-11T00:00:00Z' }, error: null };

const updateStudentCalls: unknown[] = [];
const upsertCalls: unknown[] = [];
const rpcCalls: unknown[] = [];

function fromMock(table: string) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => {
    if (table === 'students') return Promise.resolve(_studentsByIds);
    if (table === 'account_deletion_log') return chain; // followed by .lte().order().limit()
    return chain;
  };
  chain.gt = () => chain;
  chain.lte = () => chain;
  chain.order = () => chain;
  chain.limit = () => {
    if (table === 'payment_history') return Promise.resolve(_capturedPayments);
    if (table === 'account_deletion_log') return Promise.resolve(_purgeDueRows);
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve(_planIdRow);
  chain.update = (patch: unknown) => {
    updateStudentCalls.push(patch);
    return { eq: () => Promise.resolve({ data: null, error: null }) };
  };
  chain.upsert = (row: unknown) => {
    upsertCalls.push(row);
    return Promise.resolve({ data: null, error: null });
  };
  return chain;
}

const adminClient = {
  from: (t: string) => fromMock(t),
  rpc: (name: string, ...rest: unknown[]) => {
    rpcCalls.push([name, ...rest]);
    return Promise.resolve(_expiredRpc);
  },
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const SECRET = 'cron-secret-value-12345';

function req(url: string, method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateStudentCalls.length = 0;
  upsertCalls.length = 0;
  rpcCalls.length = 0;
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
  _capturedPayments = { data: [], error: null };
  _studentsByIds = { data: [], error: null };
  _planIdRow = { data: { id: 'plan-1' }, error: null };
  _purgeDueRows = { data: [], error: null };
  _expiredRpc = { data: { marked_past_due: 0, halted: 0, checked_at: '2026-06-11T00:00:00Z' }, error: null };
  // Fetch stub so an accidental Edge invocation is observable, not a network call.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

// ── 1. reconcile-payments ────────────────────────────────────────────────────

describe('POST /api/cron/reconcile-payments — CRON_SECRET gate', () => {
  it('returns 401 without a secret and never scans payment_history', async () => {
    const { POST } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await POST(req('/api/cron/reconcile-payments', 'POST'));
    expect(res.status).toBe(401);
    expect(updateStudentCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it('returns 401 with a wrong-length secret (constant-time reject)', async () => {
    const { POST } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await POST(
      req('/api/cron/reconcile-payments', 'POST', { 'x-cron-secret': 'too-short' }),
    );
    expect(res.status).toBe(401);
  });

  it('is idempotent: a payment whose student already matches its plan is NOT re-reconciled', async () => {
    // One captured payment for plan 'pro', and the student is ALREADY on 'pro'.
    _capturedPayments = {
      data: [{
        id: 'pay-1', student_id: 'stu-1', plan_code: 'pro', billing_cycle: 'monthly',
        razorpay_payment_id: 'rzp_pay_1', razorpay_order_id: null, created_at: '2026-06-01T00:00:00Z',
      }],
      error: null,
    };
    _studentsByIds = { data: [{ id: 'stu-1', subscription_plan: 'pro' }], error: null };

    const { POST } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await POST(
      req('/api/cron/reconcile-payments', 'POST', { 'x-cron-secret': SECRET }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total_stuck).toBe(0);
    expect(body.data.reconciled).toBe(0);

    // No double-credit: no students.update and no student_subscriptions.upsert.
    expect(updateStudentCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it('reconciles a genuinely stuck payment via the atomic RPC, NOT two separate writes (PAY-3, P11 atomicity)', async () => {
    _capturedPayments = {
      data: [{
        id: 'pay-2', student_id: 'stu-2', plan_code: 'pro', billing_cycle: 'monthly',
        razorpay_payment_id: 'rzp_pay_2', razorpay_order_id: null, created_at: '2026-06-01T00:00:00Z',
      }],
      error: null,
    };
    _studentsByIds = { data: [{ id: 'stu-2', subscription_plan: 'free' }], error: null };

    const { POST } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await POST(
      req('/api/cron/reconcile-payments', 'POST', { 'x-cron-secret': SECRET }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total_stuck).toBe(1);
    expect(body.data.reconciled).toBe(1);

    // PAY-3 (P11 atomicity): activation goes through the SINGLE-transaction
    // `atomic_subscription_activation_locked` RPC (the same one the webhook fallback
    // uses), with the captured payment's args. The advisory-locked RPC commits both
    // students.subscription_plan and student_subscriptions in one transaction.
    const activationCalls = rpcCalls.filter(
      (c) => Array.isArray(c) && c[0] === 'atomic_subscription_activation_locked',
    );
    expect(activationCalls).toHaveLength(1);
    expect((activationCalls[0] as unknown[])[1]).toMatchObject({
      p_student_id: 'stu-2',
      p_plan_code: 'pro',
      p_billing_cycle: 'monthly',
      p_razorpay_payment_id: 'rzp_pay_2',
      p_razorpay_subscription_id: null,
    });

    // The OLD non-atomic two-write path (students.update + student_subscriptions.upsert
    // performed directly from the cron) MUST be gone — that shape could itself create
    // the split-brain this cron exists to repair if the 2nd write failed.
    expect(updateStudentCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });
});

// ── 2. expired-subscriptions ─────────────────────────────────────────────────

describe('POST /api/cron/expired-subscriptions — CRON_SECRET gate + grace period', () => {
  it('returns 401 without a secret and never calls the RPC', async () => {
    const { POST } = await import('@/app/api/cron/expired-subscriptions/route');
    const res = await POST(req('/api/cron/expired-subscriptions', 'POST'));
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it('delegates lifecycle transitions to the RPC and reports its counts (grace handled in SQL)', async () => {
    // The RPC reports it marked one sub past_due but halted NONE — i.e. a
    // past_due sub still inside its grace window was NOT cut. The route must
    // surface those counts verbatim and not perform any cut of its own.
    _expiredRpc = {
      data: { marked_past_due: 1, halted: 0, checked_at: '2026-06-11T00:00:00Z' },
      error: null,
    };

    const { POST } = await import('@/app/api/cron/expired-subscriptions/route');
    const res = await POST(
      req('/api/cron/expired-subscriptions', 'POST', { 'x-cron-secret': SECRET }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.marked_past_due).toBe(1);
    expect(body.data.halted).toBe(0);

    // Exactly one RPC call, and it is the grace-aware SQL function — the route
    // does not implement its own cutoff (no direct student/subscription writes).
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual(['check_expired_subscriptions']);
    expect(updateStudentCalls).toHaveLength(0);
  });
});

// ── 3. account-purge (DESTRUCTIVE) ──────────────────────────────────────────

describe('account-purge — refuses to run unauthenticated on BOTH verbs', () => {
  it('POST without CRON_SECRET → 401, no rows queried, no Edge Function invoked', async () => {
    const { POST } = await import('@/app/api/cron/account-purge/route');
    const res = await POST(req('/api/cron/account-purge', 'POST'));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('GET without CRON_SECRET → 401, no Edge Function invoked', async () => {
    const { GET } = await import('@/app/api/cron/account-purge/route');
    const res = await GET(req('/api/cron/account-purge', 'GET'));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('GET with a wrong-length secret → 401 (constant-time reject)', async () => {
    const { GET } = await import('@/app/api/cron/account-purge/route');
    const res = await GET(req('/api/cron/account-purge', 'GET', { 'x-cron-secret': 'short' }));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('with a valid secret but nothing due → processes 0, no Edge Function invoked (scope guard)', async () => {
    _purgeDueRows = { data: [], error: null };
    const { POST } = await import('@/app/api/cron/account-purge/route');
    const res = await POST(req('/api/cron/account-purge', 'POST', { 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.processed).toBe(0);
    // No due rows → no destructive Edge invocation.
    expect(fetch).not.toHaveBeenCalled();
  });
});
