/**
 * Contract tests for GET /api/v2/student/leaderboard.
 * Pins: auth 401 + progress.view_own, get_leaderboard RPC reuse, period/scope
 * passthrough + defaults, envelope shape (schemaVersion 1, entries[]), P13 — no
 * email/phone in entries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let _rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
const rpcSpy = vi.fn();
vi.mock('@alfanumrik/lib/supabase-server', () => ({
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

  it('forwards period=all and accepts scope=global', async () => {
    const res = await GET(url({ period: 'all', scope: 'global' }));
    expect(rpcSpy).toHaveBeenCalledWith('get_leaderboard', { p_period: 'all', p_limit: 50 });
    const body = await res.json();
    expect(body.data.period).toBe('all');
    expect(body.data.scope).toBe('global');
  });

  // Contract fix: `get_leaderboard(p_period, p_limit)` has no scope parameter,
  // so `scope=school` used to return GLOBAL rows labelled "school". The route
  // now refuses the param instead of lying about it.
  it('rejects scope=school with 400 SCOPE_UNSUPPORTED (never serves global rows as "school")', async () => {
    const res = await GET(url({ scope: 'school' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('SCOPE_UNSUPPORTED');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  // P13: school/city/avatar_url are permanently null — get_leaderboard does not
  // emit them and peers must not receive a minor's institution or city.
  it('never emits peer school/city/avatar_url even if the RPC row carries them', async () => {
    _rpcResult = {
      data: [
        {
          rank: 1, student_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Asha',
          total_xp: 1450, streak: 7, grade: '9',
          school: 'DPS', school_name: 'DPS', city: 'Delhi', avatar_url: 'https://x/y.png',
        },
      ],
      error: null,
    };
    const body = await (await GET(url())).json();
    expect(body.data.entries[0].school).toBeNull();
    expect(body.data.entries[0].city).toBeNull();
    expect(body.data.entries[0].avatar_url).toBeNull();
    const s = JSON.stringify(body);
    expect(s).not.toContain('DPS');
    expect(s).not.toContain('Delhi');
  });

  // The RPC filters HAVING SUM(xp_earned) > 0, so a zero-XP caller is absent
  // from their own board. `me` must say so rather than looking like a failure.
  it('reports the caller as off-board when absent from the returned rows', async () => {
    const body = await (await GET(url())).json();
    expect(body.data.me.on_board).toBe(false);
    expect(body.data.me.rank).toBeNull();
  });

  it('reports the caller rank when present on the board', async () => {
    _rpcResult = {
      data: [
        { rank: 1, student_id: '11111111-1111-4111-8111-111111111111', name: 'Me', total_xp: 900, streak: 3, grade: '8' },
      ],
      error: null,
    };
    const body = await (await GET(url())).json();
    expect(body.data.me.on_board).toBe(true);
    expect(body.data.me.rank).toBe(1);
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
