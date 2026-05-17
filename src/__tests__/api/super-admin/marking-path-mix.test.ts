/**
 * /api/super-admin/marking-path-mix — unit tests.
 *
 * Pins the contract for `src/app/api/super-admin/marking-path-mix/route.ts`:
 *
 *   - no_token   → env unset; fetch is NEVER called.
 *   - happy 200  → correct shape; percentages sum to 100.
 *   - http_error → 401, 403, 5xx all collapse to the same UI hint.
 *   - timeout    → AbortError surfaces as reason=timeout.
 *   - parse_error → malformed JSON or wrong-shape body.
 *
 * Mocking style follows `src/__tests__/api/super-admin/oracle-health.test.ts`
 * — vi.mock the rbac module and stub fetch per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────

const mockAuthorizeRequest = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Auth helpers ─────────────────────────────────────────────────────

const AUTH_OK = {
  authorized: true as const,
  userId: '11111111-1111-1111-1111-111111111111',
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED_401 = () => ({
  authorized: false as const,
  userId: null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
});

const AUTH_DENIED_403 = () => ({
  authorized: false as const,
  userId: '22222222-2222-2222-2222-222222222222',
  studentId: null,
  roles: ['student'],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  }),
});

function buildRequest(): Request {
  return new Request('http://localhost/api/super-admin/marking-path-mix', {
    method: 'GET',
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

function setPostHogEnv() {
  process.env.POSTHOG_API_KEY = 'phx_test_key';
  process.env.POSTHOG_HOST = 'https://app.posthog.com';
  process.env.POSTHOG_PROJECT_ID = '159341';
}

// ─── Auth gate ────────────────────────────────────────────────────────

describe('GET /api/super-admin/marking-path-mix: auth', () => {
  it('returns 401 when no session (auth denies with 401)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_401());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated but not admin', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_403());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks the super_admin.access permission (not a new perm code)', async () => {
    setPostHogEnv();
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [], columns: ['path', 'n'] }), {
        status: 200,
      }),
    );
    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    await GET(buildRequest() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(
      expect.anything(),
      'super_admin.access',
    );
  });
});

// ─── no_token ─────────────────────────────────────────────────────────

describe('GET /api/super-admin/marking-path-mix: no_token', () => {
  it('returns { ok:false, reason:"no_token", mix:null } when POSTHOG_API_KEY is missing, and does NOT call fetch', async () => {
    delete process.env.POSTHOG_API_KEY;
    process.env.POSTHOG_HOST = 'https://app.posthog.com';
    process.env.POSTHOG_PROJECT_ID = '159341';

    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('no_token');
    expect(body.mix).toBeNull();
    expect(body.window_days).toBe(7);
    expect(typeof body.fetched_at).toBe('string');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns no_token when POSTHOG_HOST is missing', async () => {
    process.env.POSTHOG_API_KEY = 'phx_x';
    delete process.env.POSTHOG_HOST;
    process.env.POSTHOG_PROJECT_ID = '159341';

    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.reason).toBe('no_token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns no_token when POSTHOG_PROJECT_ID is missing', async () => {
    process.env.POSTHOG_API_KEY = 'phx_x';
    process.env.POSTHOG_HOST = 'https://app.posthog.com';
    delete process.env.POSTHOG_PROJECT_ID;

    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.reason).toBe('no_token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── happy path ───────────────────────────────────────────────────────

describe('GET /api/super-admin/marking-path-mix: happy path (200)', () => {
  beforeEach(() => {
    setPostHogEnv();
  });

  it('200 response → correct shape; percentages sum to 100', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          columns: ['path', 'n'],
          results: [
            ['oracle_v2', 800],
            ['oracle_v1_legacy', 150],
            ['client_fallback', 30],
            ['foxy_freetext', 20],
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.window_days).toBe(7);
    expect(typeof body.fetched_at).toBe('string');
    expect(Array.isArray(body.mix)).toBe(true);
    expect(body.mix).toHaveLength(4);

    // Verify per-row shape.
    for (const row of body.mix) {
      expect(typeof row.path).toBe('string');
      expect(typeof row.count).toBe('number');
      expect(typeof row.percent).toBe('number');
    }

    // Percentages sum to exactly 100 (the route patches the largest
    // bucket to absorb the rounding residual).
    const sum = body.mix.reduce((s: number, r: { percent: number }) => s + r.percent, 0);
    expect(sum).toBeCloseTo(100, 5);

    // Largest bucket is oracle_v2.
    const oracleV2 = body.mix.find((r: { path: string }) => r.path === 'oracle_v2');
    expect(oracleV2.count).toBe(800);
    // 800/1000 = 80%
    expect(oracleV2.percent).toBeCloseTo(80, 1);

    // Confirm Cache-Control header is set.
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('sends the HogQL POST with Bearer auth and quiz_graded query', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ columns: ['path', 'n'], results: [] }),
        { status: 200 },
      ),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    await GET(buildRequest() as never);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      'https://app.posthog.com/api/projects/159341/query/',
    );
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer phx_test_key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string) as {
      query: { kind: string; query: string };
    };
    expect(body.query.kind).toBe('HogQLQuery');
    expect(body.query.query).toContain("event = 'quiz_graded'");
    expect(body.query.query).toContain('properties.marking_path');
    expect(body.query.query).toContain('interval 7 day');
  });

  it('returns empty mix array when no events in window (no rows)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ columns: ['path', 'n'], results: [] }),
        { status: 200 },
      ),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.mix).toEqual([]);
  });

  it('skips zero-count rows', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          columns: ['path', 'n'],
          results: [
            ['oracle_v2', 100],
            ['client_fallback', 0],
          ],
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.mix).toHaveLength(1);
    expect(body.mix[0].path).toBe('oracle_v2');
    expect(body.mix[0].percent).toBe(100);
  });

  it('coerces string count values to numbers', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          columns: ['path', 'n'],
          results: [['oracle_v2', '42']],
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.mix[0].count).toBe(42);
    expect(body.mix[0].percent).toBe(100);
  });
});

// ─── http_error ───────────────────────────────────────────────────────

describe('GET /api/super-admin/marking-path-mix: http_error', () => {
  beforeEach(() => {
    setPostHogEnv();
  });

  it('returns reason:"http_error" on 401', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    // Endpoint returns 200 with degraded payload (operator banner pattern).
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('http_error');
    expect(body.mix).toBeNull();
  });

  it('returns reason:"http_error" on 403', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.reason).toBe('http_error');
    expect(body.ok).toBe(false);
  });

  it('returns reason:"http_error" on 5xx', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.reason).toBe('http_error');
  });

  it('returns reason:"http_error" on network-level fetch rejection', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNRESET'),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.reason).toBe('http_error');
  });
});

// ─── timeout ──────────────────────────────────────────────────────────

describe('GET /api/super-admin/marking-path-mix: timeout', () => {
  beforeEach(() => {
    setPostHogEnv();
  });

  it('returns reason:"timeout" when fetch is aborted (AbortError)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => {
      // Simulate what fetch does when its signal aborts: reject with
      // a DOMException-shaped error whose name is 'AbortError'.
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('timeout');
    expect(body.mix).toBeNull();
  });
});

// ─── parse_error ──────────────────────────────────────────────────────

describe('GET /api/super-admin/marking-path-mix: parse_error', () => {
  beforeEach(() => {
    setPostHogEnv();
  });

  it('returns reason:"parse_error" when body is malformed JSON', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not-json{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('parse_error');
  });

  it('returns reason:"parse_error" when body shape lacks results array', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 }),
    );

    const { GET } = await import(
      '@/app/api/super-admin/marking-path-mix/route'
    );
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.reason).toBe('parse_error');
  });
});
