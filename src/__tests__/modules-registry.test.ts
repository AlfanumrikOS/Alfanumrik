import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cache + feature flag + supabase admin BEFORE importing the registry.
vi.mock('@/lib/cache', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  cacheDelete: vi.fn(),
  cacheInvalidatePrefix: vi.fn(),
  cacheFetch: vi.fn(async (_k: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  CACHE_TTL: { STATIC: 5 * 60 * 1000 },
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabled(...args),
}));

const supabaseSelect = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: (_col: string, _val: string) => supabaseSelect(),
      }),
    }),
  },
}));

import {
  MODULE_KEYS,
  MODULE_REGISTRY,
  getModuleMeta,
  defaultsForTenantType,
  isModuleEnabled,
  enabledModulesFor,
} from '@/lib/modules/registry';

beforeEach(() => {
  isFeatureEnabled.mockReset();
  supabaseSelect.mockReset();
});

describe('MODULE_KEYS / MODULE_REGISTRY consistency', () => {
  it('every key in MODULE_KEYS has a matching registry entry', () => {
    for (const key of MODULE_KEYS) {
      expect(MODULE_REGISTRY.find(m => m.key === key)).toBeDefined();
    }
  });

  it('registry has no duplicate keys', () => {
    const keys = MODULE_REGISTRY.map(m => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('getModuleMeta', () => {
  it('returns metadata for a known key', () => {
    expect(getModuleMeta('lms')?.routePrefix).toBe('/learn');
  });

  it('returns null for unknown key', () => {
    expect(getModuleMeta('quantum_physics')).toBeNull();
  });
});

describe('defaultsForTenantType', () => {
  it('school enables LMS and analytics, disables CRM', () => {
    const d = defaultsForTenantType('school');
    expect(d.lms).toBe(true);
    expect(d.analytics).toBe(true);
    expect(d.crm).toBe(false);
  });

  it('coaching enables CRM and live classes', () => {
    const d = defaultsForTenantType('coaching');
    expect(d.crm).toBe(true);
    expect(d.live_classes).toBe(true);
  });

  it('government keeps lms + analytics but no AI tutor by default', () => {
    const d = defaultsForTenantType('government');
    expect(d.lms).toBe(true);
    expect(d.analytics).toBe(true);
    expect(d.ai_tutor).toBe(false);
  });
});

describe('isModuleEnabled', () => {
  it('returns true unconditionally when schoolId is null (B2C)', async () => {
    expect(await isModuleEnabled(null, 'school', 'lms')).toBe(true);
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('returns true when ff_tenant_module_registry_v1 is OFF (preserves current behaviour)', async () => {
    isFeatureEnabled.mockResolvedValueOnce(false);
    expect(await isModuleEnabled('school-1', 'school', 'crm')).toBe(true);
    expect(supabaseSelect).not.toHaveBeenCalled();
  });

  it('uses tenant_modules override when flag is ON and row exists', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({
      data: [{ module_key: 'ai_tutor', is_enabled: false, config: {} }],
      error: null,
    });
    expect(await isModuleEnabled('school-1', 'school', 'ai_tutor')).toBe(false);
  });

  it('falls back to registry default when flag ON but no row exists', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({ data: [], error: null });
    // school + crm default is false
    expect(await isModuleEnabled('school-1', 'school', 'crm')).toBe(false);
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({ data: [], error: null });
    // coaching + crm default is true
    expect(await isModuleEnabled('school-1', 'coaching', 'crm')).toBe(true);
  });

  it('fail-open: DB error returns to default rather than locking the tenant out', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    // school + lms default is true
    expect(await isModuleEnabled('school-1', 'school', 'lms')).toBe(true);
  });
});

describe('enabledModulesFor', () => {
  it('returns every module enabled when flag is OFF', async () => {
    isFeatureEnabled.mockResolvedValueOnce(false);
    const map = await enabledModulesFor('school-1', 'school');
    for (const k of MODULE_KEYS) expect(map[k]).toBe(true);
  });

  it('merges overrides on top of tenant-type defaults', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({
      data: [
        { module_key: 'crm', is_enabled: true, config: {} },     // override default false→true
        { module_key: 'analytics', is_enabled: false, config: {} }, // override default true→false
      ],
      error: null,
    });
    const map = await enabledModulesFor('school-1', 'school');
    expect(map.crm).toBe(true);
    expect(map.analytics).toBe(false);
    expect(map.lms).toBe(true); // unaffected default
  });
});
