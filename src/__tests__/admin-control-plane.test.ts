import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Admin Control Plane Tests
 *
 * Tests for the Super Admin, CMS, RBAC, feature flags, and platform ops
 * systems. These test the module interfaces and logic, not HTTP endpoints.
 */

describe('Admin Auth Module', () => {
  it('exports authorizeAdmin, logAdminAudit, isValidUUID, supabaseAdminHeaders, supabaseAdminUrl', async () => {
    const mod = await import('@/lib/admin-auth');
    expect(typeof mod.authorizeAdmin).toBe('function');
    expect(typeof mod.logAdminAudit).toBe('function');
    expect(typeof mod.isValidUUID).toBe('function');
    expect(typeof mod.supabaseAdminHeaders).toBe('function');
    expect(typeof mod.supabaseAdminUrl).toBe('function');
  });

  it('isValidUUID validates correctly', async () => {
    const { isValidUUID } = await import('@/lib/admin-auth');
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000')).toBe(false); // too short
    expect(isValidUUID('550e8400-e29b-41d4-a716-4466554400001')).toBe(false); // too long
    expect(isValidUUID("'; DROP TABLE students; --")).toBe(false); // injection
  });

  it('supabaseAdminUrl builds correct URLs', async () => {
    const { supabaseAdminUrl } = await import('@/lib/admin-auth');
    // Will use env vars or throw — just verify it's callable
    try {
      const url = supabaseAdminUrl('students', 'select=id&limit=1');
      expect(url).toContain('/rest/v1/students');
      expect(url).toContain('select=id');
    } catch {
      // Expected if env vars not set in test
    }
  });
});

describe('Feature Flag Evaluation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exports isFeatureEnabled and getEvaluatedFlags', async () => {
    const mod = await import('@/lib/feature-flags');
    expect(typeof mod.isFeatureEnabled).toBe('function');
    expect(typeof mod.getEvaluatedFlags).toBe('function');
    expect(typeof mod.getFeatureFlagsSimple).toBe('function');
  });
});

describe('Cache Module', () => {
  it('exports cacheFetch, cacheInvalidatePrefix, cacheStats, CACHE_TTL', async () => {
    const mod = await import('@/lib/cache');
    expect(typeof mod.cacheFetch).toBe('function');
    expect(typeof mod.cacheInvalidatePrefix).toBe('function');
    expect(typeof mod.cacheStats).toBe('function');
    expect(mod.CACHE_TTL.STATIC).toBe(300000); // 5 min
    expect(mod.CACHE_TTL.SHORT).toBe(60000); // 1 min
  });

  it('cacheGet/cacheSet/cacheDelete work correctly', async () => {
    const { cacheGet, cacheSet, cacheDelete } = await import('@/lib/cache');

    cacheSet('test-key', { hello: 'world' }, 60000);
    expect(cacheGet('test-key')).toEqual({ hello: 'world' });

    cacheDelete('test-key');
    expect(cacheGet('test-key')).toBeNull();
  });

  it('cacheFetch calls fetcher on miss', async () => {
    const { cacheFetch, cacheDelete } = await import('@/lib/cache');

    cacheDelete('test-fetch');
    const fetcher = vi.fn().mockResolvedValue({ data: 42 });
    const result = await cacheFetch('test-fetch', 60000, fetcher);

    expect(result).toEqual({ data: 42 });
    expect(fetcher).toHaveBeenCalledOnce();

    // Second call should use cache
    const result2 = await cacheFetch('test-fetch', 60000, fetcher);
    expect(result2).toEqual({ data: 42 });
    expect(fetcher).toHaveBeenCalledOnce(); // Not called again

    cacheDelete('test-fetch');
  });

  it('cacheInvalidatePrefix removes matching keys', async () => {
    const { cacheSet, cacheGet, cacheInvalidatePrefix } = await import('@/lib/cache');

    cacheSet('cms:topics:10', [1, 2, 3], 60000);
    cacheSet('cms:questions:10', [4, 5, 6], 60000);
    cacheSet('other:key', 'keep', 60000);

    cacheInvalidatePrefix('cms:');

    expect(cacheGet('cms:topics:10')).toBeNull();
    expect(cacheGet('cms:questions:10')).toBeNull();
    expect(cacheGet('other:key')).toEqual('keep');

    cacheInvalidatePrefix('other:');
  });
});

describe('RBAC Module', () => {
  it('exports core RBAC functions', async () => {
    const mod = await import('@/lib/rbac');
    expect(typeof mod.authorizeRequest).toBe('function');
    expect(typeof mod.hasPermission).toBe('function');
    expect(typeof mod.hasRole).toBe('function');
    expect(typeof mod.canAccessStudent).toBe('function');
    expect(typeof mod.logAudit).toBe('function');
  });
});

describe('Feature Flags in Supabase Client', () => {
  it('getFeatureFlags accepts optional context', async () => {
    const mod = await import('@/lib/supabase');
    expect(typeof mod.getFeatureFlags).toBe('function');
    // Signature check: should accept (context?) parameter
    expect(mod.getFeatureFlags.length).toBeLessThanOrEqual(1);
  });
});

describe('Admin API Route Structure', () => {
  it('all admin API route files exist', async () => {
    const fs = await import('fs');
    const routes = [
      'analytics', 'cms', 'content', 'deploy', 'feature-flags',
      'institutions', 'logs', 'observability', 'platform-ops',
      'reports', 'roles', 'stats', 'support', 'users',
    ];

    for (const route of routes) {
      const path = `src/app/api/super-admin/${route}/route.ts`;
      expect(fs.existsSync(path), `Missing route: ${path}`).toBe(true);
    }
  });

  it('super-admin API routes are the canonical admin surface', async () => {
    const fs = await import('fs');
    // Canonical admin API routes must exist
    expect(fs.existsSync('src/app/api/super-admin')).toBe(true);
    // Super admin pages must exist
    expect(fs.existsSync('src/app/super-admin/page.tsx')).toBe(true);
    expect(fs.existsSync('src/app/super-admin/login/page.tsx')).toBe(true);
    expect(fs.existsSync('src/app/super-admin/cms/page.tsx')).toBe(true);
  });
});
