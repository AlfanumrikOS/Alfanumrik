import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        eq: () => supabaseSelect(),
      }),
    }),
  },
}));

import { getTenantConfig, getAllTenantConfig, CONFIG_DEFAULTS } from '@/lib/tenant-config';

beforeEach(() => {
  isFeatureEnabled.mockReset();
  supabaseSelect.mockReset();
});

describe('getTenantConfig', () => {
  it('returns the tenant-type default for null schoolId', async () => {
    const v = await getTenantConfig(null, 'corporate', 'ai.personality');
    expect(v).toBe(CONFIG_DEFAULTS['ai.personality'].corporate);
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('returns the default when ff_tenant_config_v2 is OFF', async () => {
    isFeatureEnabled.mockResolvedValueOnce(false);
    const v = await getTenantConfig('school-1', 'school', 'ai.tone');
    expect(v).toBe(CONFIG_DEFAULTS['ai.tone'].school);
    expect(supabaseSelect).not.toHaveBeenCalled();
  });

  it('returns the override when flag ON and value validates', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({
      data: [{ key: 'ai.personality', value: 'playful_buddy', version: 1 }],
      error: null,
    });
    const v = await getTenantConfig('school-1', 'school', 'ai.personality');
    expect(v).toBe('playful_buddy');
  });

  it('falls back to default when override fails zod validation', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({
      data: [{ key: 'ai.personality', value: 'evil_villain', version: 1 }],
      error: null,
    });
    // 'evil_villain' is not in the enum → zod rejects → fallback.
    const v = await getTenantConfig('school-1', 'school', 'ai.personality');
    expect(v).toBe(CONFIG_DEFAULTS['ai.personality'].school);
  });

  it('falls back to fallback for tenant types without a specific default', async () => {
    // theme.dark_mode_default has only `fallback: false`, no per-type entry.
    const v = await getTenantConfig(null, 'corporate', 'theme.dark_mode_default');
    expect(v).toBe(false);
  });

  it('respects per-tenant-type defaults across all four types', async () => {
    expect(await getTenantConfig(null, 'school',     'ai.tone')).toBe('casual');
    expect(await getTenantConfig(null, 'coaching',   'ai.tone')).toBe('neutral');
    expect(await getTenantConfig(null, 'corporate',  'ai.tone')).toBe('formal');
    expect(await getTenantConfig(null, 'government', 'ai.tone')).toBe('formal');
  });
});

describe('getAllTenantConfig', () => {
  it('returns the full default map when flag is OFF', async () => {
    isFeatureEnabled.mockResolvedValueOnce(false);
    const all = await getAllTenantConfig('school-1', 'corporate');
    expect(all['ai.personality']).toBe(CONFIG_DEFAULTS['ai.personality'].corporate);
    expect(all['locale.currency']).toBe('INR');
    expect(all['locale.timezone']).toBe('Asia/Kolkata');
  });

  it('layers overrides on top of defaults; invalid overrides revert to default', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    supabaseSelect.mockResolvedValueOnce({
      data: [
        { key: 'ai.personality', value: 'rigorous_coach', version: 1 },
        { key: 'ai.tone', value: 'whisper', version: 1 }, // invalid → fallback
        { key: 'locale.currency', value: 'USD', version: 1 },
      ],
      error: null,
    });
    const all = await getAllTenantConfig('school-1', 'school');
    expect(all['ai.personality']).toBe('rigorous_coach');
    expect(all['ai.tone']).toBe(CONFIG_DEFAULTS['ai.tone'].school);
    expect(all['locale.currency']).toBe('USD');
    expect(all['locale.timezone']).toBe('Asia/Kolkata'); // untouched default
  });
});
