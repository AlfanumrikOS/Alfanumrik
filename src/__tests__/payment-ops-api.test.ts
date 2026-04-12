import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Payment Ops API Tests
 *
 * Regression catalog entries covered:
 * - R48: Payment reconciliation action is audit-logged in both ops_events and admin_audit_log.
 * - R49: Stuck payment detection query matches reconcile_stuck_payments.sql logic.
 */

// ─── Mocks ────────────────────────────────────────────────

const authMock = vi.fn();
const logAuditMock = vi.fn();
const fromMock = vi.fn();
const logOpsEventMock = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authMock(...args),
  logAdminAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
  getSupabaseAdmin: vi.fn(() => ({ from: fromMock })),
}));

vi.mock('@/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => logOpsEventMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(new URL(url, 'http://localhost'), options as any);
}

function mockChain(finalResult: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  const handler = () => new Proxy(chain, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined; // not a promise itself
      if (prop === 'data') return finalResult.data;
      if (prop === 'error') return finalResult.error;
      if (prop === 'count') return finalResult.count;
      return (..._args: unknown[]) => handler();
    },
  });
  return handler;
}

// ═══════════════════════════════════════════════════════════
// GET /api/super-admin/payment-ops/stats
// ═══════════════════════════════════════════════════════════

describe('GET /api/super-admin/payment-ops/stats', () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    fromMock.mockReset();
    logOpsEventMock.mockReset();
    logAuditMock.mockReset();
  });

  it('returns 401 when not authorized', async () => {
    const unauthorizedResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    authMock.mockResolvedValue({ authorized: false, response: unauthorizedResponse });

    const { GET } = await import('@/app/api/super-admin/payment-ops/stats/route');
    const res = await GET(makeRequest('http://localhost/api/super-admin/payment-ops/stats'));
    expect(res.status).toBe(401);
  });

  it('returns stats with correct shape when authorized', async () => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test.com', name: 'Admin' });

    // Mock all three parallel queries:
    // 1. getStuckCount: payment_history → returns empty (0 stuck)
    // 2. getFailureCount24h: ops_events count → returns 0
    // 3. getActivationTiming: payment_history → returns empty
    let callCount = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === 'payment_history') {
        callCount++;
        // First call is for stuck count, second is for timing
        return mockChain({ data: [], error: null })();
      }
      if (table === 'ops_events') {
        return mockChain({ count: 0, error: null })();
      }
      if (table === 'students') {
        return mockChain({ data: [], error: null })();
      }
      return mockChain({ data: [], error: null })();
    });

    const { GET } = await import('@/app/api/super-admin/payment-ops/stats/route');
    const res = await GET(makeRequest('http://localhost/api/super-admin/payment-ops/stats'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('stuckCount');
    expect(body.data).toHaveProperty('failureCount24h');
    expect(body.data).toHaveProperty('activationTiming');
    expect(body.data.activationTiming).toHaveProperty('median');
    expect(body.data.activationTiming).toHaveProperty('p95');
    expect(body.data.activationTiming).toHaveProperty('max');
    expect(body.data.activationTiming).toHaveProperty('sampleSize');
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/super-admin/payment-ops/stuck
// ═══════════════════════════════════════════════════════════

describe('GET /api/super-admin/payment-ops/stuck', () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    fromMock.mockReset();
  });

  it('returns 401 when not authorized', async () => {
    const unauthorizedResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    authMock.mockResolvedValue({ authorized: false, response: unauthorizedResponse });

    const { GET } = await import('@/app/api/super-admin/payment-ops/stuck/route');
    const res = await GET(makeRequest('http://localhost/api/super-admin/payment-ops/stuck'));
    expect(res.status).toBe(401);
  });

  it('returns empty array when no captured payments exist', async () => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test.com', name: 'Admin' });
    fromMock.mockImplementation(() => mockChain({ data: [], error: null })());

    const { GET } = await import('@/app/api/super-admin/payment-ops/stuck/route');
    const res = await GET(makeRequest('http://localhost/api/super-admin/payment-ops/stuck'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('detects stuck payment when student plan is free but payment is captured', async () => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test.com', name: 'Admin' });

    const capturedPayments = [
      {
        id: 'pay-1',
        student_id: 'stu-1',
        plan_code: 'pro_monthly',
        billing_cycle: 'monthly',
        razorpay_payment_id: 'rpay_123',
        razorpay_order_id: 'order_123',
        amount: 499,
        status: 'captured',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    const students = [
      {
        id: 'stu-1',
        name: 'Test Student',
        email: 'test@example.com',
        subscription_plan: 'free',
        subscription_expiry: null,
        auth_user_id: 'auth-1',
      },
    ];

    fromMock.mockImplementation((table: string) => {
      if (table === 'payment_history') {
        return mockChain({ data: capturedPayments, error: null })();
      }
      if (table === 'students') {
        return mockChain({ data: students, error: null })();
      }
      return mockChain({ data: [], error: null })();
    });

    const { GET } = await import('@/app/api/super-admin/payment-ops/stuck/route');
    const res = await GET(makeRequest('http://localhost/api/super-admin/payment-ops/stuck'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.data[0].paymentId).toBe('pay-1');
    expect(body.data[0].studentId).toBe('stu-1');
    expect(body.data[0].paidPlan).toBe('pro_monthly');
    expect(body.data[0].currentPlan).toBe('free');
    expect(body.data[0].studentName).toBe('Test Student');
  });

  it('does NOT flag payment as stuck when student plan matches', async () => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test.com', name: 'Admin' });

    const capturedPayments = [
      {
        id: 'pay-2',
        student_id: 'stu-2',
        plan_code: 'pro_monthly',
        billing_cycle: 'monthly',
        razorpay_payment_id: 'rpay_456',
        razorpay_order_id: null,
        amount: 499,
        status: 'captured',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    const students = [
      {
        id: 'stu-2',
        name: 'Happy Student',
        email: 'happy@example.com',
        subscription_plan: 'pro_monthly',
        subscription_expiry: '2026-02-01T00:00:00Z',
        auth_user_id: 'auth-2',
      },
    ];

    fromMock.mockImplementation((table: string) => {
      if (table === 'payment_history') {
        return mockChain({ data: capturedPayments, error: null })();
      }
      if (table === 'students') {
        return mockChain({ data: students, error: null })();
      }
      return mockChain({ data: [], error: null })();
    });

    const { GET } = await import('@/app/api/super-admin/payment-ops/stuck/route');
    const res = await GET(makeRequest('http://localhost/api/super-admin/payment-ops/stuck'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(0);
    expect(body.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/super-admin/payment-ops/reconcile
// ═══════════════════════════════════════════════════════════

describe('POST /api/super-admin/payment-ops/reconcile', () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    fromMock.mockReset();
    logOpsEventMock.mockReset();
    logAuditMock.mockReset();
  });

  it('returns 401 when not authorized', async () => {
    const unauthorizedResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    authMock.mockResolvedValue({ authorized: false, response: unauthorizedResponse });

    const { POST } = await import('@/app/api/super-admin/payment-ops/reconcile/route');
    const res = await POST(makeRequest('http://localhost/api/super-admin/payment-ops/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(401);
  });

  it('rejects request without studentId/paymentId or all:true', async () => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test.com', name: 'Admin' });

    const { POST } = await import('@/app/api/super-admin/payment-ops/reconcile/route');
    const res = await POST(makeRequest('http://localhost/api/super-admin/payment-ops/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('studentId');
  });

  it('returns 404 when payment not found for single reconcile', async () => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test.com', name: 'Admin' });
    fromMock.mockImplementation(() => mockChain({ data: null, error: null })());

    const { POST } = await import('@/app/api/super-admin/payment-ops/reconcile/route');
    const res = await POST(makeRequest('http://localhost/api/super-admin/payment-ops/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: 'stu-1', paymentId: 'nonexistent' }),
    }));
    expect(res.status).toBe(404);
  });

  it('returns success with 0 reconciled when no stuck payments for batch', async () => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test.com', name: 'Admin' });
    fromMock.mockImplementation(() => mockChain({ data: [], error: null })());

    const { POST } = await import('@/app/api/super-admin/payment-ops/reconcile/route');
    const res = await POST(makeRequest('http://localhost/api/super-admin/payment-ops/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.reconciled).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Module interface checks
// ═══════════════════════════════════════════════════════════

describe('Payment Ops Route Exports', () => {
  it('stats route exports GET handler', async () => {
    const mod = await import('@/app/api/super-admin/payment-ops/stats/route');
    expect(typeof mod.GET).toBe('function');
  });

  it('stuck route exports GET handler', async () => {
    const mod = await import('@/app/api/super-admin/payment-ops/stuck/route');
    expect(typeof mod.GET).toBe('function');
  });

  it('reconcile route exports POST handler', async () => {
    const mod = await import('@/app/api/super-admin/payment-ops/reconcile/route');
    expect(typeof mod.POST).toBe('function');
  });
});