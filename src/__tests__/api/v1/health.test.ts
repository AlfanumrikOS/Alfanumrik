/**
 * GET /api/v1/health — dependency probe tests (Audit F21).
 *
 * Verifies:
 *   - All deps OK → ok=true, status=healthy
 *   - Redis missing config → skipped, ok stays true (graceful)
 *   - Razorpay 5xx → razorpay marked degraded, ok=false, unhealthy_components includes 'razorpay'
 *   - Edge Function timeout → edge_functions degraded, ok=false
 *   - Razorpay credentials absent → skipped (not failed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── supabaseAdmin mock — DB + auth probes always succeed in this suite. ──
vi.mock('@/lib/supabase-admin', () => {
  return {
    supabaseAdmin: {
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve({ data: [{ id: 'topic-1' }], error: null }),
        }),
      }),
      auth: {
        admin: {
          listUsers: () => Promise.resolve({ data: { users: [] }, error: null }),
        },
      },
    },
  };
});

// ── cache stats — fixed ──
vi.mock('@/lib/cache', () => ({
  cacheStats: () => ({ size: 0, hits: 0, misses: 0 }),
}));

// ── redis mock — controllable per-test ──
let _redisClient: { ping: () => Promise<string>; set: (...args: unknown[]) => Promise<string> } | null = null;
vi.mock('@/lib/redis', () => ({
  getRedis: () => _redisClient,
}));

// ── fetch mock for Edge Function + Razorpay HTTP calls ──
let _fetchResponses: Map<string, () => Promise<Response> | Response> = new Map();
function setFetchResponse(matcher: string, fn: () => Promise<Response> | Response) {
  _fetchResponses.set(matcher, fn);
}

beforeEach(() => {
  _fetchResponses = new Map();
  _redisClient = null;
  // Default env: simulate fully-configured prod
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-test';
  process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';

  // Default fetch: 200 for any URL
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    for (const [match, fn] of _fetchResponses) {
      if (url.includes(match)) {
        return Promise.resolve(fn());
      }
    }
    // Default — generic OK
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.resetModules();
});

async function callHealth() {
  const mod = await import('@/app/api/v1/health/route');
  return mod.GET();
}

describe('GET /api/v1/health — dependency probes', () => {
  describe('all dependencies OK', () => {
    it('returns ok=true and status=healthy when every probe succeeds', async () => {
      _redisClient = {
        ping: async () => 'PONG',
        set: async () => 'OK',
      };
      // Edge function answers OPTIONS with 200
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 200 }),
      );
      // Razorpay returns 404 for our probe id (means: API reachable, id not found)
      setFetchResponse('api.razorpay.com', () =>
        new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR' } }), { status: 404 }),
      );

      const res = await callHealth();
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.status).toBe('healthy');
      expect(body.dependencies.edge_functions.status).toBe('ok');
      expect(body.dependencies.redis.status).toBe('ok');
      expect(body.dependencies.razorpay.status).toBe('ok');
      expect(body.unhealthy_components).toBeUndefined();
    });
  });

  describe('Redis missing configuration', () => {
    it('marks redis as skipped (not failed) and keeps ok=true', async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('{}', { status: 200 }),
      );
      setFetchResponse('api.razorpay.com', () =>
        new Response('{}', { status: 404 }),
      );

      const res = await callHealth();
      const body = await res.json();

      expect(body.dependencies.redis.status).toBe('skipped');
      expect(body.ok).toBe(true);
      expect(body.status).toBe('healthy');
    });
  });

  describe('Razorpay credentials absent', () => {
    it('marks razorpay as skipped (not failed) and keeps ok=true', async () => {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 200 }),
      );

      const res = await callHealth();
      const body = await res.json();

      expect(body.dependencies.razorpay.status).toBe('skipped');
      expect(body.ok).toBe(true);
    });
  });

  describe('Razorpay 5xx outage', () => {
    it('marks razorpay as degraded and ok=false', async () => {
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 200 }),
      );
      setFetchResponse('api.razorpay.com', () =>
        new Response(JSON.stringify({ error: 'gateway_timeout' }), { status: 503 }),
      );

      const res = await callHealth();
      const body = await res.json();

      expect(body.dependencies.razorpay.status).toBe('degraded');
      expect(body.ok).toBe(false);
      expect(body.status).toBe('degraded');
      expect(body.unhealthy_components).toContain('razorpay');
    });

    it('marks razorpay as failed when credentials are rejected (401)', async () => {
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 200 }),
      );
      setFetchResponse('api.razorpay.com', () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      );

      const res = await callHealth();
      const body = await res.json();

      expect(body.dependencies.razorpay.status).toBe('failed');
      expect(body.ok).toBe(false);
      expect(body.unhealthy_components).toContain('razorpay');
    });
  });

  describe('Edge Function timeout / network failure', () => {
    it('marks edge_functions as degraded when fetch throws', async () => {
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      setFetchResponse('/functions/v1/grounded-answer', () => {
        throw new Error('AbortError: timed out');
      });
      setFetchResponse('api.razorpay.com', () =>
        new Response('{}', { status: 404 }),
      );

      const res = await callHealth();
      const body = await res.json();

      expect(body.dependencies.edge_functions.status).toBe('degraded');
      expect(body.ok).toBe(false);
      expect(body.status).toBe('degraded');
      expect(body.unhealthy_components).toContain('edge_functions');
    });

    it('marks edge_functions as degraded on 5xx response', async () => {
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 503 }),
      );
      setFetchResponse('api.razorpay.com', () =>
        new Response('{}', { status: 404 }),
      );

      const res = await callHealth();
      const body = await res.json();

      expect(body.dependencies.edge_functions.status).toBe('degraded');
      expect(body.unhealthy_components).toContain('edge_functions');
    });
  });

  describe('response shape contract', () => {
    it('always returns HTTP 200 (so load balancers don\'t evict)', async () => {
      // Force everything to fail
      _redisClient = {
        ping: async () => { throw new Error('redis down'); },
        set: async () => { throw new Error('redis down'); },
      };
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 503 }),
      );
      setFetchResponse('api.razorpay.com', () =>
        new Response('', { status: 500 }),
      );

      const res = await callHealth();
      // HTTP status must remain 200 even when degraded.
      expect(res.status).toBe(200);
    });

    it('returns Server-Timing header with all probe latencies', async () => {
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 200 }),
      );
      setFetchResponse('api.razorpay.com', () =>
        new Response('{}', { status: 404 }),
      );

      const res = await callHealth();
      const timing = res.headers.get('Server-Timing') || '';
      expect(timing).toMatch(/total;/);
      expect(timing).toMatch(/db;/);
      expect(timing).toMatch(/auth;/);
      expect(timing).toMatch(/edge;/);
      expect(timing).toMatch(/redis;/);
      expect(timing).toMatch(/razorpay;/);
    });
  });
});
