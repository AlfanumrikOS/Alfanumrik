/**
 * Contract tests for GET /api/v2/student/leaderboard.
 * Pins: auth 401 + progress.view_own, get_leaderboard RPC reuse, period/scope
 * passthrough + defaults, envelope shape (schemaVersion 1, entries[]), P13 — no
 * email/phone in entries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let _rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
const rpcSpy = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => {
      rpcSpy(...args);
      return Promise.resolve(_rpcResult);
    },
  }),
}));

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId: 'auth-user-1', studentId: '11111111-1111-4111-8111-111111111111',
    roles: ['student'], permissions: ['progress.view_own'],
  });
}

const url = (params: Record<string, string> = {}) =>
  new Request(`http://localhost/api/v2/student/leaderboard?${new URLSearchParams(params)}`, { method: 'GET' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _rpcResult = {
    data: [
      { rank: 1, student_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Asha', total_xp: 1450, streak: 7, grade: '9' },
    ],
    error: null,
  };
  GET = (await import('@/app/api/v2/student/leaderboard/route')).GET;
});

describe('GET /api/v2/student/leaderboard', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(url())).status).toBe(401);
  });

  it('uses progress.view_own', async () => {
    await GET(url());
    expect(_authorizeImpl).toHaveBeenCalledWith(expect.anything(), 'progress.view_own');
  });

  it('defaults to weekly/global and calls get_leaderboard', async () => {
    const res = await GET(url());
    expect(res.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith('get_leaderboard', { p_period: 'weekly', p_limit: 50 });
    const body = await res.json();
    expect(body.data.period).toBe('weekly');
    expect(body.data.scope).toBe('global');
  });

  it('forwards period=all and scope=school', async () => {
    const res = await GET(url({ period: 'all', scope: 'school' }));
    expect(rpcSpy).toHaveBeenCalledWith('get_leaderboard', { p_period: 'all', p_limit: 50 });
    const body = await res.json();
    expect(body.data.period).toBe('all');
    expect(body.data.scope).toBe('school');
  });

  it('returns ranked entries without PII beyond name/grade (P13)', async () => {
    const res = await GET(url());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.entries[0].rank).toBe(1);
    expect(body.data.entries[0].name).toBe('Asha');
    expect(body.data.entries[0].grade).toBe('9');
    const s = JSON.stringify(body);
    expect(s).not.toContain('email');
    expect(s).not.toContain('phone');
  });

  it('returns 500 on RPC error', async () => {
    _rpcResult = { data: null, error: { message: 'down' } };
    const res = await GET(url());
    expect(res.status).toBe(500);
  });
});
