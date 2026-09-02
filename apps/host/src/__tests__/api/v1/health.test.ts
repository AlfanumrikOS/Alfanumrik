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
import { NextRequest } from 'next/server';

// ── supabaseAdmin mock — DB + auth probes always succeed in this suite. ──
vi.mock('@alfanumrik/lib/supabase-admin', () => {
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
vi.mock('@alfanumrik/lib/cache', () => ({
  cacheStats: () => ({ size: 0, hits: 0, misses: 0 }),
}));

// ── redis mock — controllable per-test ──
let _redisClient: { ping: () => Promise<string>; set: (...args: unknown[]) => Promise<string> } | null = null;
vi.mock('@alfanumrik/lib/redis', () => ({
  getRedis: () => _redisClient,
}));

// ── fetch mock for Edge Function + Razorpay HTTP calls ──
let _fetchResponses: Map<string, () => Promise<Response> | Response> = new Map();
const originalVercelEnv = process.env.VERCEL_ENV;

function setFetchResponse(matcher: string, fn: () => Promise<Response> | Response) {
  _fetchResponses.set(matcher, fn);
}

beforeEach(() => {
  _fetchResponses = new Map();
  _redisClient = null;
  // Default env: simulate fully-configured prod
  process.env.VERCEL_ENV = 'production';
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
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
});

function healthReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/health', { headers });
}

async function callHealth(headers: Record<string, string> = {}) {
  const mod = await import('@/app/api/v1/health/route');
  return mod.GET(healthReq(headers));
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

    it('returns ONLY the total in Server-Timing for an unauthenticated caller (P2-7)', async () => {
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
      expect(timing).not.toMatch(/db;/);
      expect(timing).not.toMatch(/auth;/);
      expect(timing).not.toMatch(/edge;/);
      expect(timing).not.toMatch(/redis;/);
      expect(timing).not.toMatch(/razorpay;/);
    });

    it('returns the full per-dependency Server-Timing breakdown with a valid x-admin-secret (P2-7)', async () => {
      process.env.SUPER_ADMIN_SECRET = 'test-secret-value';
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      setFetchResponse('/functions/v1/grounded-answer', () =>
        new Response('', { status: 200 }),
      );
      setFetchResponse('api.razorpay.com', () =>
        new Response('{}', { status: 404 }),
      );

      const res = await callHealth({ 'x-admin-secret': 'test-secret-value' });
      const timing = res.headers.get('Server-Timing') || '';
      expect(timing).toMatch(/total;/);
      expect(timing).toMatch(/db;/);
      expect(timing).toMatch(/auth;/);
      expect(timing).toMatch(/edge;/);
      expect(timing).toMatch(/redis;/);
      expect(timing).toMatch(/razorpay;/);
      delete process.env.SUPER_ADMIN_SECRET;
    });
  });

  describe('P2-7 — unauthenticated response redacts internals, keeps deploy-critical fields', () => {
    it('omits memory, cache, slo, uptime_seconds, node_version/region, and per-check error/detail text for an unauthenticated caller', async () => {
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      const res = await callHealth();
      const body = await res.json();

      // Deploy-critical / uptime-monitor fields MUST still be present —
      // deploy-production.yml parses body.version.git_sha with no secret.
      expect(typeof body.ok).toBe('boolean');
      expect(typeof body.status).toBe('string');
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.version.git_sha).toBe('string');
      expect(body.version.git_sha.length).toBeGreaterThan(0);
      expect(body.checks.database.status).toBeDefined();
      expect(body.checks.auth.status).toBeDefined();

      // Internal/system-fingerprinting fields must be absent.
      expect(body.memory).toBeUndefined();
      expect(body.cache).toBeUndefined();
      expect(body.slo).toBeUndefined();
      expect(body.uptime_seconds).toBeUndefined();
      expect(body.environment.node_version).toBeUndefined();
      expect(body.environment.region).toBeUndefined();
      expect(body.checks.database.latency_ms).toBeUndefined();
      expect(body.checks.database.error).toBeUndefined();
      expect(body.dependencies.redis.detail).toBeUndefined();
      expect(body.dependencies.redis.latency_ms).toBeUndefined();
    });

    it('includes memory, cache, slo, and per-check detail when a valid x-admin-secret is presented', async () => {
      process.env.SUPER_ADMIN_SECRET = 'test-secret-value';
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      const res = await callHealth({ 'x-admin-secret': 'test-secret-value' });
      const body = await res.json();

      expect(body.memory === null || typeof body.memory === 'object').toBe(true);
      expect(body.cache).toBeDefined();
      expect(body.slo).toBeDefined();
      expect(typeof body.uptime_seconds).toBe('number');
      expect(body.environment.node_version).toBeDefined();
      expect(body.environment.region).toBeDefined();
      expect(typeof body.checks.database.latency_ms).toBe('number');
      delete process.env.SUPER_ADMIN_SECRET;
    });

    it('does NOT leak details when the secret header is wrong', async () => {
      process.env.SUPER_ADMIN_SECRET = 'test-secret-value';
      _redisClient = { ping: async () => 'PONG', set: async () => 'OK' };
      const res = await callHealth({ 'x-admin-secret': 'wrong-value' });
      const body = await res.json();
      expect(body.memory).toBeUndefined();
      expect(body.checks.database.latency_ms).toBeUndefined();
      delete process.env.SUPER_ADMIN_SECRET;
    });
  });
});
