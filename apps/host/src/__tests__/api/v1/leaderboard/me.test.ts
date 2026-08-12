/**
 * Tests for GET /api/v1/leaderboard/me — the caller's own leaderboard band.
 *
 * Covers: 401 unauth, 400 invalid period, 200 empty-band when the caller has
 * no student row, 200 percentile payload from the RPC, cache-control private.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ── RBAC mock ─────────────────────────────────────────────────────────────────
let _authImpl: () => Promise<unknown> = async () => ({
  authorized: true,
  userId: AUTH_USER_ID,
  studentId: STUDENT_ID,
  roles: ['student'],
  permissions: ['leaderboard.view'],
});
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: () => _authImpl(),
}));

// ── logger mock ───────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── supabase-admin mock ───────────────────────────────────────────────────────
let _studentLookup: { data: { id: string } | null; error: { message: string } | null } = {
  data: { id: STUDENT_ID },
  error: null,
};
let _rpcResult: { data: unknown; error: { message: string } | null } = {
  data: {
    student_id: STUDENT_ID,
    rank: 42,
    total: 500,
    percentile: 91.6,
    xp: 1250,
    band: 'top_10',
    neighbours: [],
  },
  error: null,
};

/** performance_scores rows for the CALLER (own data — never peers). */
let _perfResult: {
  data: Array<{ overall_score: number }> | null;
  error: { message: string } | null;
} = { data: [{ overall_score: 80 }, { overall_score: 90 }], error: null };

const fakeAdmin = {
  from: (_table: string) => ({
    select: () => ({
      // `.eq()` terminates two different chains here:
      //   students          → .is().limit().maybeSingle()
      //   performance_scores→ awaited directly (hence the `then`)
      eq: () => ({
        is: () => ({
          limit: () => ({
            maybeSingle: async () => _studentLookup,
          }),
        }),
        then: (resolve: (v: unknown) => unknown) => resolve(_perfResult),
      }),
    }),
  }),
  rpc: async (_name: string, _args: unknown) => _rpcResult,
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => fakeAdmin,
  supabaseAdmin: fakeAdmin,
}));

// ── Import route AFTER mocks ─────────────────────────────────────────────────
async function invoke(url: string): Promise<Response> {
  const { GET } = await import('../../../../app/api/v1/leaderboard/me/route');
  const req = new Request(url) as unknown as Parameters<typeof GET>[0];
  return GET(req);
}

beforeEach(() => {
  _authImpl = async () => ({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['leaderboard.view'],
  });
  _studentLookup = { data: { id: STUDENT_ID }, error: null };
  _perfResult = { data: [{ overall_score: 80 }, { overall_score: 90 }], error: null };
  _rpcResult = {
    data: {
      student_id: STUDENT_ID,
      rank: 42,
      total: 500,
      percentile: 91.6,
      xp: 1250,
      band: 'top_10',
      neighbours: [],
    },
    error: null,
  };
});

describe('GET /api/v1/leaderboard/me', () => {
  it('401 when unauthorized', async () => {
    _authImpl = async () => ({
      authorized: false,
      userId: null,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await invoke('http://localhost/api/v1/leaderboard/me');
    expect(res.status).toBe(401);
  });

  it('400 on invalid period', async () => {
    const res = await invoke('http://localhost/api/v1/leaderboard/me?period=hourly');
    expect(res.status).toBe(400);
  });

  it('returns empty band when caller has no student row', async () => {
    _studentLookup = { data: null, error: null };
    const res = await invoke('http://localhost/api/v1/leaderboard/me');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('private');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.rank).toBeNull();
    expect(body.data.percentile).toBeNull();
    expect(body.data.neighbours).toEqual([]);
  });

  it('returns percentile payload with private cache-control', async () => {
    const res = await invoke('http://localhost/api/v1/leaderboard/me?period=weekly');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    const body = await res.json();
    expect(body.data).toMatchObject({
      period: 'weekly',
      rank: 42,
      percentile: 91.6,
      xp: 1250,
      band: 'top_10',
    });
  });

  it('fail-soft empty payload when RPC errors', async () => {
    _rpcResult = { data: null, error: { message: 'RPC missing' } };
    const res = await invoke('http://localhost/api/v1/leaderboard/me');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rank).toBeNull();
  });

  // The caller's OWN Performance Score lives here (private, per-caller), NOT on
  // the public /api/v1/leaderboard board. The page used to compute it for every
  // student from the browser against own-row-only RLS tables, which returned a
  // single row and awarded the caller rank #1.
  it('returns the caller own performance score (mean of overall_score) + level', async () => {
    const res = await invoke('http://localhost/api/v1/leaderboard/me');
    const body = await res.json();
    expect(body.data.performance_score).toBe(85);
    expect(typeof body.data.level_name).toBe('string');
  });

  it('performance score is null (never 0) when the caller has no scored subjects', async () => {
    _perfResult = { data: [], error: null };
    const body = await (await invoke('http://localhost/api/v1/leaderboard/me')).json();
    expect(body.data.performance_score).toBeNull();
    expect(body.data.level_name).toBeNull();
  });

  it('derives band from percentile when RPC omits it', async () => {
    _rpcResult = {
      data: {
        student_id: STUDENT_ID,
        rank: 1,
        total: 100,
        percentile: 99.9,
        xp: 5000,
        band: null,
        neighbours: [],
      },
      error: null,
    };
    const res = await invoke('http://localhost/api/v1/leaderboard/me');
    const body = await res.json();
    expect(body.data.band).toBe('top_1');
  });
});
