import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC mock ────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(studentId: string) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId,
    roles: ['student'],
    permissions: ['student.profile.write'],
  });
}

function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(JSON.stringify({ error: 'unauth' }), { status: 401 }),
  });
}

// ── Logger silencer ──────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── supabaseAdmin mock ───────────────────────────────────────────────────────
const _rpcImpl = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => _rpcImpl(...args),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _rpcImpl.mockReset();
  const mod = await import('@/app/api/student/shop/purchase/route');
  POST = mod.POST;
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/student/shop/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/student/shop/purchase', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await POST(makeRequest({ itemId: 'streak_freeze' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is invalid', async () => {
    setAuthorized('student-1');
    const res = await POST(new Request('http://localhost/api/student/shop/purchase', { method: 'POST', body: 'not-json' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('request body');
  });

  it('returns 400 when itemId is missing', async () => {
    setAuthorized('student-1');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('itemId is required');
  });

  it('returns 400 when currency is invalid', async () => {
    setAuthorized('student-1');
    const res = await POST(makeRequest({ itemId: 'streak_freeze', currency: 'gems' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('currency must be');
  });

  it('returns 404 when itemId is unknown (not in handler map)', async () => {
    setAuthorized('student-1');
    const res = await POST(makeRequest({ itemId: 'unknown_item_xyz' }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('successfully purchases streak_freeze with coins', async () => {
    setAuthorized('student-1');
    _rpcImpl.mockResolvedValue({ data: 120, error: null });

    const res = await POST(makeRequest({ itemId: 'streak_freeze', currency: 'coins' }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.itemId).toBe('streak_freeze');
    expect(data.data.currency).toBe('coins');
    expect(data.data.cost).toBe(80);
    expect(data.data.newBalance).toBe(120);

    expect(_rpcImpl).toHaveBeenCalledWith('purchase_streak_freeze', {
      p_student_id: 'student-1',
      p_cost: 80,
      p_currency: 'coins',
    });
  });

  it('successfully purchases streak_freeze with xp', async () => {
    setAuthorized('student-1');
    _rpcImpl.mockResolvedValue({ data: 500, error: null });

    const res = await POST(makeRequest({ itemId: 'streak_freeze', currency: 'xp' }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.itemId).toBe('streak_freeze');
    expect(data.data.currency).toBe('xp');
    expect(data.data.cost).toBe(100);
    expect(data.data.newBalance).toBe(500);

    expect(_rpcImpl).toHaveBeenCalledWith('purchase_streak_freeze', {
      p_student_id: 'student-1',
      p_cost: 100,
      p_currency: 'xp',
    });
  });

  it('returns 400 when rpc returns insufficient balance error', async () => {
    setAuthorized('student-1');
    _rpcImpl.mockResolvedValue({
      data: null,
      error: { message: 'Insufficient coin balance' },
    });

    const res = await POST(makeRequest({ itemId: 'streak_freeze', currency: 'coins' }));
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Insufficient coin balance');
  });

  it('returns 500 when rpc fails unexpectedly', async () => {
    setAuthorized('student-1');
    _rpcImpl.mockResolvedValue({
      data: null,
      error: { message: 'Database down' },
    });

    const res = await POST(makeRequest({ itemId: 'streak_freeze', currency: 'coins' }));
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to process purchase');
  });
});
