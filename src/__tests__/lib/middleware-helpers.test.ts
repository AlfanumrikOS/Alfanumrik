/**
 * middleware-helpers.ts — unit tests.
 *
 * Edge-runtime helpers powering Layer 0.65 of src/proxy.ts (server-side
 * role-gating). We test:
 *   - findRouteRule: prefix matching + exemptExactMatch (parent login page)
 *   - destinationForRole: every role → expected post-login route
 *   - getUserRoleFromCache:
 *       • empty userId → null
 *       • in-memory cache hit (after warm-up)
 *       • Redis hit (env vars set, dynamic Redis import returns cached value)
 *       • PostgREST primary-role fetch (student / teacher / guardian / none)
 *       • PostgREST elevated-role probe (super_admin > admin > institution_admin)
 *       • RPC failure → null (fail-open)
 *   - invalidateUserRoleCache clears local + Redis entries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Upstash Redis (dynamic import is gated on env vars) ─────────
// The SUT imports '@upstash/redis' lazily inside getRedis(). We provide
// a stable mock + record env vars before import.

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();

class MockRedisCtor {
  constructor(_opts: unknown) {}
  get = mockRedisGet;
  set = mockRedisSet;
  del = mockRedisDel;
}

vi.mock('@upstash/redis', () => ({
  Redis: MockRedisCtor,
}));

// ── Reset module state per test ─────────────────────────
// middleware-helpers caches its Redis singleton + in-memory role map
// at module scope. Tests that need a clean slate use vi.resetModules()
// + dynamic import.

beforeEach(() => {
  vi.clearAllMocks();
  // Default: Upstash NOT configured — exercises the in-memory + REST paths.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  // Supabase REST endpoint config the SUT reads via process.env.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-fake';
  // Reset module state so the singleton Redis client + local cache map
  // start fresh per test.
  vi.resetModules();
});

// ─── findRouteRule ──────────────────────────────────────────

describe('findRouteRule', () => {
  it('returns null for routes that are not role-gated', async () => {
    const { findRouteRule } = await import('@/lib/middleware-helpers');
    expect(findRouteRule('/dashboard')).toBeNull();
    expect(findRouteRule('/foxy')).toBeNull();
    expect(findRouteRule('/learn/maths')).toBeNull();
  });

  it('matches /teacher exactly and as prefix', async () => {
    const { findRouteRule } = await import('@/lib/middleware-helpers');
    const rExact = findRouteRule('/teacher');
    const rNested = findRouteRule('/teacher/dashboard');
    expect(rExact?.prefix).toBe('/teacher');
    expect(rNested?.prefix).toBe('/teacher');
    expect(rExact?.allowed).toContain('teacher');
  });

  it('exempts /parent login page from role-gating but enforces nested routes', async () => {
    const { findRouteRule } = await import('@/lib/middleware-helpers');
    expect(findRouteRule('/parent')).toBeNull(); // exemptExactMatch
    const nested = findRouteRule('/parent/children');
    expect(nested?.prefix).toBe('/parent');
    expect(nested?.allowed).toContain('guardian');
  });

  it('gates /super-admin to admin + super_admin only', async () => {
    const { findRouteRule } = await import('@/lib/middleware-helpers');
    const r = findRouteRule('/super-admin/users');
    expect(r?.allowed).toEqual(['admin', 'super_admin']);
  });

  it('gates /school-admin to institution_admin + admin + super_admin', async () => {
    const { findRouteRule } = await import('@/lib/middleware-helpers');
    const r = findRouteRule('/school-admin');
    expect(r?.allowed).toContain('institution_admin');
    expect(r?.allowed).toContain('admin');
    expect(r?.allowed).toContain('super_admin');
  });

  it('does not match on a /parent-similar prefix that differs after the slash', async () => {
    const { findRouteRule } = await import('@/lib/middleware-helpers');
    // /parental should not match /parent because of the trailing-slash check.
    expect(findRouteRule('/parental')).toBeNull();
  });
});

// ─── destinationForRole ─────────────────────────────────────

describe('destinationForRole', () => {
  it('routes each role to its expected portal', async () => {
    const { destinationForRole } = await import('@/lib/middleware-helpers');
    expect(destinationForRole('student')).toBe('/dashboard');
    expect(destinationForRole('teacher')).toBe('/teacher');
    expect(destinationForRole('guardian')).toBe('/parent');
    expect(destinationForRole('institution_admin')).toBe('/school-admin');
    expect(destinationForRole('admin')).toBe('/super-admin');
    expect(destinationForRole('super_admin')).toBe('/super-admin');
  });

  it('routes "none" to /onboarding', async () => {
    const { destinationForRole } = await import('@/lib/middleware-helpers');
    expect(destinationForRole('none')).toBe('/onboarding');
  });
});

// ─── getUserRoleFromCache ───────────────────────────────────

describe('getUserRoleFromCache', () => {
  it('returns null for empty userId without hitting any backend', async () => {
    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('');
    expect(r).toBeNull();
  });

  it('returns "student" via fetchPrimaryRole when REST returns student + no elevated row', async () => {
    // Two fetches happen per cold lookup: get_user_role RPC + user_roles probe.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/rpc/get_user_role')) {
        return new Response(JSON.stringify({ primary_role: 'student' }), { status: 200 });
      }
      if (u.includes('/user_roles?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-student-1');
    expect(r).toBe('student');
    fetchSpy.mockRestore();
  });

  it('promotes elevated super_admin role over the primary role', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/rpc/get_user_role')) {
        return new Response(JSON.stringify({ primary_role: 'student' }), { status: 200 });
      }
      if (u.includes('/user_roles?')) {
        return new Response(
          JSON.stringify([{ role: { name: 'super_admin' } }, { role: { name: 'admin' } }]),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-elevated-1');
    expect(r).toBe('super_admin');
    fetchSpy.mockRestore();
  });

  it('returns "admin" when only admin appears (no super_admin)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/rpc/get_user_role')) {
        return new Response(JSON.stringify({ primary_role: 'teacher' }), { status: 200 });
      }
      return new Response(JSON.stringify([{ role: { name: 'admin' } }]), { status: 200 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-admin-2');
    expect(r).toBe('admin');
    fetchSpy.mockRestore();
  });

  it('returns "institution_admin" when only that elevated role is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/rpc/get_user_role')) {
        return new Response(JSON.stringify({ primary_role: 'teacher' }), { status: 200 });
      }
      return new Response(JSON.stringify([{ role: { name: 'institution_admin' } }]), { status: 200 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-inst-1');
    expect(r).toBe('institution_admin');
    fetchSpy.mockRestore();
  });

  it('returns "none" when get_user_role yields an unknown primary_role and no elevated rows', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/rpc/get_user_role')) {
        return new Response(JSON.stringify({ primary_role: 'mystery' }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-mystery');
    expect(r).toBe('none');
    fetchSpy.mockRestore();
  });

  it('returns null when the get_user_role RPC fails (fail-open)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('{}', { status: 500 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-fail');
    expect(r).toBeNull();
    fetchSpy.mockRestore();
  });

  it('returns null when supabase env vars are missing (fail-open)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-no-env');
    expect(r).toBeNull();
  });

  it('caches the resolved role in-memory: second call hits cache and skips fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/rpc/get_user_role')) {
        return new Response(JSON.stringify({ primary_role: 'teacher' }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r1 = await getUserRoleFromCache('user-cache-1');
    const fetchCallsAfterFirst = fetchSpy.mock.calls.length;
    const r2 = await getUserRoleFromCache('user-cache-1');

    expect(r1).toBe('teacher');
    expect(r2).toBe('teacher');
    // Second call must not hit fetch — cached.
    expect(fetchSpy.mock.calls.length).toBe(fetchCallsAfterFirst);
    fetchSpy.mockRestore();
  });

  it('uses Upstash Redis cache when env vars are configured (skips REST fetch)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';

    mockRedisGet.mockResolvedValue('guardian');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('{}', { status: 200 });
    });

    const { getUserRoleFromCache } = await import('@/lib/middleware-helpers');
    const r = await getUserRoleFromCache('user-redis-hit');
    expect(r).toBe('guardian');
    // Hot path: Redis returned a value, no source-of-truth fetch needed.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('invalidateUserRoleCache', () => {
  it('is a safe no-op for empty userId', async () => {
    const { invalidateUserRoleCache } = await import('@/lib/middleware-helpers');
    await expect(invalidateUserRoleCache('')).resolves.toBeUndefined();
  });

  it('clears the in-memory cache so the next lookup re-fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/rpc/get_user_role')) {
        return new Response(JSON.stringify({ primary_role: 'student' }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const { getUserRoleFromCache, invalidateUserRoleCache } = await import('@/lib/middleware-helpers');

    await getUserRoleFromCache('user-inv-1');
    const callsAfterFirst = fetchSpy.mock.calls.length;

    await invalidateUserRoleCache('user-inv-1');
    await getUserRoleFromCache('user-inv-1');

    // After invalidation, a fresh fetch is required.
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    fetchSpy.mockRestore();
  });

  it('also calls Redis del when configured (best-effort)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';

    const { invalidateUserRoleCache } = await import('@/lib/middleware-helpers');
    await invalidateUserRoleCache('user-inv-redis');
    // Redis singleton initialises on first call inside invalidate; del must
    // have been invoked exactly once with the canonical key.
    expect(mockRedisDel).toHaveBeenCalledWith('mw:role:user-inv-redis');
  });
});
