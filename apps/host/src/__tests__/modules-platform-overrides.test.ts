/**
 * Platform module override resolution tests.
 *
 * Pins the post-migration-20260507120000 resolution order in
 * src/lib/modules/registry.ts isModuleEnabled / enabledModulesFor:
 *
 *   1. ff_tenant_module_registry_v1 OFF → true (regardless of platform override)
 *   2. platform_module_overrides.is_force_disabled = true → false
 *      (overrides tenant_modules row + tenant-type default)
 *   3. tenant_modules row → use is_enabled
 *   4. registry default for tenant type
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Cache + flag mocks ──────────────────────────────────────────────
vi.mock('@alfanumrik/lib/cache', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  cacheDelete: vi.fn(),
  cacheInvalidatePrefix: vi.fn(),
  cacheFetch: vi.fn(async (_k: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  CACHE_TTL: { STATIC: 5 * 60 * 1000 },
}));

const isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabled(...args),
}));

// ── Supabase mock — separate result per table ───────────────────────
const tableResults: Record<string, unknown> = {};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const result = () => tableResults[table] ?? { data: [], error: null };
      // .select() can be awaited directly (loadPlatformOverrides) OR chained
      // with .eq(...) (loadTenantModules). Return a thenable + chain.
      return {
        select: () => Object.assign(
          Promise.resolve(result()),
          { eq: () => Promise.resolve(result()) },
        ),
      };
    },
  },
}));

import { isModuleEnabled, enabledModulesFor } from '@alfanumrik/lib/modules/registry';

beforeEach(() => {
  isFeatureEnabled.mockReset();
  for (const k of Object.keys(tableResults)) delete tableResults[k];
});

describe('isModuleEnabled — flag OFF short-circuit (regression guard)', () => {
  it('returns true when flag OFF, even with a force-disable override row', async () => {
    isFeatureEnabled.mockResolvedValueOnce(false);
    tableResults.platform_module_overrides = {
      data: [{ module_key: 'lms', is_force_disabled: true }],
      error: null,
    };
    expect(await isModuleEnabled('school-1', 'school', 'lms')).toBe(true);
  });
});

describe('isModuleEnabled — platform force-disable wins', () => {
  it('returns false when platform override force-disables, despite tenant_modules saying true', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    tableResults.platform_module_overrides = {
      data: [{ module_key: 'live_classes', is_force_disabled: true }],
      error: null,
    };
    tableResults.tenant_modules = {
      data: [{ module_key: 'live_classes', is_enabled: true, config: {} }],
      error: null,
    };
    expect(await isModuleEnabled('school-1', 'coaching', 'live_classes')).toBe(false);
  });

  it('returns false when platform override force-disables, despite registry default being true', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    tableResults.platform_module_overrides = {
      data: [{ module_key: 'lms', is_force_disabled: true }],
      error: null,
    };
    tableResults.tenant_modules = { data: [], error: null };
    // school + lms default is true; platform override says no.
    expect(await isModuleEnabled('school-1', 'school', 'lms')).toBe(false);
  });

  it('platform override row with is_force_disabled=false has NO effect (only true blocks)', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    tableResults.platform_module_overrides = {
      data: [{ module_key: 'crm', is_force_disabled: false }],
      error: null,
    };
    tableResults.tenant_modules = {
      data: [{ module_key: 'crm', is_enabled: true, config: {} }],
      error: null,
    };
    // tenant override says true → returns true (platform row doesn't unblock,
    // it just doesn't block).
    expect(await isModuleEnabled('school-1', 'school', 'crm')).toBe(true);
  });
});

describe('isModuleEnabled — falls through when no platform override', () => {
  it('uses tenant override when no platform row', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    tableResults.platform_module_overrides = { data: [], error: null };
    tableResults.tenant_modules = {
      data: [{ module_key: 'ai_tutor', is_enabled: false, config: {} }],
      error: null,
    };
    expect(await isModuleEnabled('school-1', 'school', 'ai_tutor')).toBe(false);
  });

  it('uses registry default when no platform row + no tenant row', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    tableResults.platform_module_overrides = { data: [], error: null };
    tableResults.tenant_modules = { data: [], error: null };
    // school + crm default is false
    expect(await isModuleEnabled('school-1', 'school', 'crm')).toBe(false);
    isFeatureEnabled.mockResolvedValueOnce(true);
    tableResults.platform_module_overrides = { data: [], error: null };
    tableResults.tenant_modules = { data: [], error: null };
    // coaching + crm default is true
    expect(await isModuleEnabled('school-1', 'coaching', 'crm')).toBe(true);
  });
});

describe('enabledModulesFor — applies platform overrides across all modules', () => {
  it('force-disabled modules show up false even with tenant overrides flipping them on', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    tableResults.platform_module_overrides = {
      data: [
        { module_key: 'live_classes', is_force_disabled: true },
        { module_key: 'crm', is_force_disabled: true },
      ],
      error: null,
    };
    tableResults.tenant_modules = {
      data: [
        { module_key: 'live_classes', is_enabled: true, config: {} },
        { module_key: 'crm', is_enabled: true, config: {} },
        { module_key: 'lms', is_enabled: true, config: {} },
      ],
      error: null,
    };
    const map = await enabledModulesFor('school-1', 'school');
    expect(map.live_classes).toBe(false);
    expect(map.crm).toBe(false);
    expect(map.lms).toBe(true); // unaffected
  });
});
