import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Bulk Actions API Tests
 *
 * Tests that the four bulk action API routes:
 * 1. Reject unauthenticated requests (401)
 * 2. Validate required fields (400)
 * 3. Enforce the 500-student batch limit
 *
 * Regression catalog entries covered:
 * - R50: All bulk actions are audit-logged in both ops_events and admin_audit_log
 * - R51: Bulk actions enforce max 500 student limit per batch
 */

// ═══════════════════════════════════════════════════════════════
// Module validation — ensure route modules export POST handler
// ═══════════════════════════════════════════════════════════════

describe('Bulk Actions Route Exports', () => {
  it('plan-change route exports POST', async () => {
    const mod = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    expect(typeof mod.POST).toBe('function');
  });

  it('suspend-restore route exports POST', async () => {
    const mod = await import('@/app/api/super-admin/bulk-actions/suspend-restore/route');
    expect(typeof mod.POST).toBe('function');
  });

  it('notify route exports POST', async () => {
    const mod = await import('@/app/api/super-admin/bulk-actions/notify/route');
    expect(typeof mod.POST).toBe('function');
  });

  it('resend-invites route exports POST', async () => {
    const mod = await import('@/app/api/super-admin/bulk-actions/resend-invites/route');
    expect(typeof mod.POST).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════
// Auth rejection — unauthed requests return 401
// ═══════════════════════════════════════════════════════════════

// Mock authorizeAdmin to return unauthorized
vi.mock('@/lib/admin-auth', () => {
  const { NextResponse } = require('next/server');
  return {
    authorizeAdmin: vi.fn().mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }),
    logAdminAudit: vi.fn().mockResolvedValue(undefined),
    isValidUUID: (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
    supabaseAdminHeaders: vi.fn().mockReturnValue({}),
    supabaseAdminUrl: vi.fn().mockReturnValue(''),
  };
});

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      update: () => ({ in: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
      insert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
      select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
    }),
    auth: { admin: { generateLink: vi.fn().mockResolvedValue({ data: {}, error: null }) } },
  },
}));

vi.mock('@/lib/ops-events', () => ({
  logOpsEvent: vi.fn().mockResolvedValue(undefined),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Bulk Actions: 401 on unauthenticated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plan-change returns 401 without auth', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({ studentIds: ['id1'], targetPlan: 'pro', action: 'upgrade_plan' });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('suspend-restore returns 401 without auth', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/suspend-restore/route');
    const req = makeRequest({ studentIds: ['id1'], action: 'suspend' });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('notify returns 401 without auth', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/notify/route');
    const req = makeRequest({ studentIds: ['id1'], title: 'Test', body: 'Hello' });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('resend-invites returns 401 without auth', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/resend-invites/route');
    const req = makeRequest({ studentIds: ['id1'] });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// Validation — missing/invalid fields return 400
// ═══════════════════════════════════════════════════════════════

describe('Bulk Actions: Validation (authed)', () => {
  const { NextResponse } = require('next/server');

  beforeEach(async () => {
    vi.clearAllMocks();
    // Switch authorizeAdmin to return authorized for validation tests
    const { authorizeAdmin } = await import('@/lib/admin-auth');
    (authorizeAdmin as any).mockResolvedValue({
      authorized: true,
      adminId: 'test-admin-id',
      adminEmail: 'admin@test.com',
      response: null,
    });
  });

  it('plan-change rejects empty studentIds', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({ studentIds: [], targetPlan: 'pro', action: 'upgrade_plan' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('studentIds');
  });

  it('plan-change rejects invalid targetPlan', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      targetPlan: 'super_deluxe',
      action: 'upgrade_plan',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid targetPlan');
  });

  it('plan-change rejects invalid action', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      targetPlan: 'pro',
      action: 'invalid_action',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid action');
  });

  it('suspend-restore rejects empty studentIds', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/suspend-restore/route');
    const req = makeRequest({ studentIds: [], action: 'suspend' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('suspend-restore rejects invalid action', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/suspend-restore/route');
    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      action: 'ban',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid action');
  });

  it('notify rejects missing title', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/notify/route');
    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      title: '',
      body: 'Hello',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('title');
  });

  it('notify rejects missing body', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/notify/route');
    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      title: 'Test',
      body: '',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('body');
  });

  it('resend-invites rejects empty studentIds', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/resend-invites/route');
    const req = makeRequest({ studentIds: [] });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  // R51: Batch limit enforcement
  it('plan-change enforces max 500 student limit (R51)', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const ids = Array.from({ length: 501 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
    );
    const req = makeRequest({ studentIds: ids, targetPlan: 'pro', action: 'upgrade_plan' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('500');
  });

  it('suspend-restore enforces max 500 student limit (R51)', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/suspend-restore/route');
    const ids = Array.from({ length: 501 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
    );
    const req = makeRequest({ studentIds: ids, action: 'suspend' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('500');
  });

  it('notify enforces max 500 student limit (R51)', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/notify/route');
    const ids = Array.from({ length: 501 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
    );
    const req = makeRequest({ studentIds: ids, title: 'Test', body: 'Hello' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('500');
  });

  it('resend-invites enforces max 500 student limit (R51)', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/resend-invites/route');
    const ids = Array.from({ length: 501 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
    );
    const req = makeRequest({ studentIds: ids });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('500');
  });
});

// ═══════════════════════════════════════════════════════════════
// R50: Audit logging — routes call logOpsEvent + logAdminAudit
// ═══════════════════════════════════════════════════════════════

describe('Bulk Actions: Audit logging (R50)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authorizeAdmin } = await import('@/lib/admin-auth');
    (authorizeAdmin as any).mockResolvedValue({
      authorized: true,
      adminId: 'test-admin-id',
      adminEmail: 'admin@test.com',
      response: null,
    });
  });

  it('plan-change calls logOpsEvent and logAdminAudit on success', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const { logOpsEvent } = await import('@/lib/ops-events');
    const { logAdminAudit } = await import('@/lib/admin-auth');

    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      targetPlan: 'pro',
      action: 'upgrade_plan',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(logOpsEvent).toHaveBeenCalledTimes(1);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
  });

  it('suspend-restore calls logOpsEvent and logAdminAudit on success', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/suspend-restore/route');
    const { logOpsEvent } = await import('@/lib/ops-events');
    const { logAdminAudit } = await import('@/lib/admin-auth');

    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      action: 'suspend',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(logOpsEvent).toHaveBeenCalledTimes(1);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
  });

  it('notify calls logOpsEvent and logAdminAudit on success', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/notify/route');
    const { logOpsEvent } = await import('@/lib/ops-events');
    const { logAdminAudit } = await import('@/lib/admin-auth');

    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      title: 'Test',
      body: 'Hello there',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(logOpsEvent).toHaveBeenCalledTimes(1);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
  });

  it('resend-invites calls logOpsEvent and logAdminAudit on success', async () => {
    const { POST } = await import('@/app/api/super-admin/bulk-actions/resend-invites/route');
    const { logOpsEvent } = await import('@/lib/ops-events');
    const { logAdminAudit } = await import('@/lib/admin-auth');

    // Mock supabaseAdmin.from('students').select to return a student with email
    const { supabaseAdmin } = await import('@/lib/supabase-admin');
    (supabaseAdmin.from as any) = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [{ id: '550e8400-e29b-41d4-a716-446655440000', email: 'test@example.com', auth_user_id: 'auth-1' }],
          error: null,
        }),
      }),
      update: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const req = makeRequest({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(logOpsEvent).toHaveBeenCalledTimes(1);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
  });
});