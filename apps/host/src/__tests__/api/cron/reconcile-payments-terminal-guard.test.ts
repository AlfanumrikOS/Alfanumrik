import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * C2 (P11) — forensic-audit fix regression.
 *
 * `/api/cron/reconcile-payments` previously had no recency bound and no
 * awareness of a LATER legitimate subscription-lifecycle change, so it could
 * resurrect access for a student who had since CANCELLED — the cron would
 * reactivate the plan every 30 minutes forever, fighting the cancellation
 * cron. The fix (2026-07-29) adds:
 *   1. A recency window (only payments captured in the last 2h are eligible).
 *   2. A terminal-state guard (skip a payment/student pair whose subscription
 *      later reached cancelled/expired/halted/completed AFTER the payment).
 *
 * This file pins the terminal-state guard specifically: a captured payment
 * whose subscription later shows `cancelled` (with `cancelled_at` AFTER the
 * payment's `created_at`) must NOT be reconciled/reactivated.
 *
 * Mocking: getSupabaseAdmin() chainable seam, recording every RPC call so we
 * can assert atomic_subscription_activation is never invoked for a
 * terminal-guarded row.
 */

const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

// Row fixtures — mutated per-test via `fixtures`.
const fixtures = vi.hoisted(() => ({
  paymentHistory: [] as Array<Record<string, unknown>>,
  students: [] as Array<Record<string, unknown>>,
  subscriptions: [] as Array<Record<string, unknown>>,
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function fromMock(table: string) {
    const state: { filters: Array<[string, unknown]> } = { filters: [] };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        state.filters.push([col, val]);
        return chain;
      },
      is: () => chain,
      gte: () => chain,
      in: (col: string, vals: unknown[]) => {
        state.filters.push([col, vals]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      update: (payload: Record<string, unknown>) => {
        updateCalls.push({ table, payload });
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    chain.then = (res: (v: unknown) => unknown) => {
      let rows: Array<Record<string, unknown>> = [];
      if (table === 'payment_history') rows = fixtures.paymentHistory;
      if (table === 'students') rows = fixtures.students;
      if (table === 'student_subscriptions') rows = fixtures.subscriptions;
      return Promise.resolve({ data: rows, error: null }).then(res);
    };
    return chain;
  }

  const adminClient = {
    from: (table: string) => fromMock(table),
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { getSupabaseAdmin: () => adminClient, supabaseAdmin: adminClient };
});

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alfanumrik/lib/cron-job-health', () => ({ recordCronJobHealth: vi.fn().mockResolvedValue(undefined) }));

import { POST as reconcile } from '@/app/api/cron/reconcile-payments/route';

const CRON_SECRET = 'test-cron-secret-value';

function req(): NextRequest {
  return new NextRequest('http://localhost/api/cron/reconcile-payments', {
    method: 'POST',
    headers: { 'x-cron-secret': CRON_SECRET },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  updateCalls.length = 0;
  fixtures.paymentHistory = [];
  fixtures.students = [];
  fixtures.subscriptions = [];
  process.env.CRON_SECRET = CRON_SECRET;
});

describe('POST /api/cron/reconcile-payments — terminal-state guard (C2, P11)', () => {
  it('does NOT reconcile a payment whose subscription later shows cancelled (cancelled_at after payment)', async () => {
    const paymentCreatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const cancelledAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago — AFTER payment

    fixtures.paymentHistory = [{
      id: 'ph-1', student_id: 'stu-1', plan_code: 'pro', billing_cycle: 'monthly',
      razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', created_at: paymentCreatedAt,
    }];
    fixtures.students = [{ id: 'stu-1', subscription_plan: 'free' }]; // looks stuck (mismatch)
    fixtures.subscriptions = [{ student_id: 'stu-1', status: 'cancelled', cancelled_at: cancelledAt, ended_at: null }];

    const res = await reconcile(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total_stuck).toBe(0);
    expect(rpcCalls.find((c) => c.name === 'atomic_subscription_activation_locked')).toBeUndefined();
  });

  it('DOES reconcile a genuinely stuck payment with no terminal subscription state', async () => {
    const paymentCreatedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    fixtures.paymentHistory = [{
      id: 'ph-2', student_id: 'stu-2', plan_code: 'pro', billing_cycle: 'monthly',
      razorpay_payment_id: 'pay_2', razorpay_order_id: 'order_2', created_at: paymentCreatedAt,
    }];
    fixtures.students = [{ id: 'stu-2', subscription_plan: 'free' }];
    fixtures.subscriptions = [{ student_id: 'stu-2', status: 'active', cancelled_at: null, ended_at: null }];

    const res = await reconcile(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total_stuck).toBe(1);
    expect(rpcCalls.find((c) => c.name === 'atomic_subscription_activation_locked')).toBeDefined();
    // reconciled_at stamp must be written on success (best-effort marker).
    expect(updateCalls.some((u) => u.table === 'payment_history' && 'reconciled_at' in u.payload)).toBe(true);
  });

  it('reconciles a payment whose cancellation happened BEFORE the payment (re-subscribed after cancelling)', async () => {
    const cancelledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const paymentCreatedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago — AFTER cancellation

    fixtures.paymentHistory = [{
      id: 'ph-3', student_id: 'stu-3', plan_code: 'pro', billing_cycle: 'monthly',
      razorpay_payment_id: 'pay_3', razorpay_order_id: 'order_3', created_at: paymentCreatedAt,
    }];
    fixtures.students = [{ id: 'stu-3', subscription_plan: 'free' }];
    // Status is still recorded as 'cancelled' in the row (no re-activation write raced in yet),
    // but the cancellation predates the NEW payment — this is a re-subscribe, not a resurrection.
    fixtures.subscriptions = [{ student_id: 'stu-3', status: 'cancelled', cancelled_at: cancelledAt, ended_at: null }];

    const res = await reconcile(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total_stuck).toBe(1);
    expect(rpcCalls.find((c) => c.name === 'atomic_subscription_activation_locked')).toBeDefined();
  });
});
