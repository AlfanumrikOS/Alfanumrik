import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Feature Flag Evaluation Tests
 *
 * Verifies:
 * - Flag enabled/disabled evaluation
 * - Role scoping (target_roles)
 * - Environment scoping (target_environments)
 * - Missing flag defaults to false
 * - 0% rollout evaluates to false
 * - Cache invalidation
 *
 * Source: src/lib/feature-flags.ts
 */

// We need to mock fetch since loadFlags calls Supabase REST API
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set env vars needed by feature-flags.ts
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
vi.stubEnv('NODE_ENV', 'development');

import {
  isFeatureEnabled,
  getEvaluatedFlags,
  invalidateFlagCache,
} from '@/lib/feature-flags';

function mockFlagsResponse(flags: Array<{
  flag_name: string;
  is_enabled: boolean;
  target_roles?: string[] | null;
  target_environments?: string[] | null;
  target_institutions?: string[] | null;
  rollout_percentage?: number | null;
}>) {
  const normalized = flags.map(f => ({
    target_roles: null,
    target_environments: null,
    target_institutions: null,
    rollout_percentage: null,
    ...f,
  }));
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => normalized,
  });
}

describe('Feature Flag Evaluation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFlagCache();
    // Re-stub fetch after restoreAllMocks
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('returns false for a flag that does not exist (missing flag defaults to false)', async () => {
    mockFlagsResponse([]);
    const result = await isFeatureEnabled('nonexistent_flag');
    expect(result).toBe(false);
  });

  it('returns false for a flag that is globally disabled', async () => {
    mockFlagsResponse([
      { flag_name: 'dark_mode', is_enabled: false },
    ]);
    const result = await isFeatureEnabled('dark_mode');
    expect(result).toBe(false);
  });

  it('returns true for a flag that is globally enabled with no scoping', async () => {
    mockFlagsResponse([
      { flag_name: 'new_dashboard', is_enabled: true },
    ]);
    const result = await isFeatureEnabled('new_dashboard');
    expect(result).toBe(true);
  });
});

describe('Feature Flag Role Scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFlagCache();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('returns true when user role matches target_roles', async () => {
    mockFlagsResponse([
      { flag_name: 'teacher_analytics', is_enabled: true, target_roles: ['teacher', 'admin'] },
    ]);
    const result = await isFeatureEnabled('teacher_analytics', { role: 'teacher' });
    expect(result).toBe(true);
  });

  it('returns false when user role does NOT match target_roles', async () => {
    mockFlagsResponse([
      { flag_name: 'teacher_analytics', is_enabled: true, target_roles: ['teacher', 'admin'] },
    ]);
    const result = await isFeatureEnabled('teacher_analytics', { role: 'student' });
    expect(result).toBe(false);
  });

  it('returns false when role is not provided but target_roles is set', async () => {
    mockFlagsResponse([
      { flag_name: 'teacher_analytics', is_enabled: true, target_roles: ['teacher'] },
    ]);
    const result = await isFeatureEnabled('teacher_analytics', {});
    expect(result).toBe(false);
  });

  it('returns true when target_roles is null (applies to all roles)', async () => {
    mockFlagsResponse([
      { flag_name: 'global_banner', is_enabled: true, target_roles: null },
    ]);
    const result = await isFeatureEnabled('global_banner', { role: 'student' });
    expect(result).toBe(true);
  });

  it('returns true when target_roles is empty array (applies to all roles)', async () => {
    mockFlagsResponse([
      { flag_name: 'global_banner', is_enabled: true, target_roles: [] },
    ]);
    const result = await isFeatureEnabled('global_banner', { role: 'student' });
    expect(result).toBe(true);
  });
});

describe('Feature Flag Environment Scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFlagCache();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('returns true when environment matches target_environments', async () => {
    mockFlagsResponse([
      { flag_name: 'debug_panel', is_enabled: true, target_environments: ['development', 'staging'] },
    ]);
    const result = await isFeatureEnabled('debug_panel', { environment: 'development' });
    expect(result).toBe(true);
  });

  it('returns false when environment does NOT match target_environments', async () => {
    mockFlagsResponse([
      { flag_name: 'debug_panel', is_enabled: true, target_environments: ['development', 'staging'] },
    ]);
    const result = await isFeatureEnabled('debug_panel', { environment: 'production' });
    expect(result).toBe(false);
  });

  it('returns true when target_environments is null (applies to all environments)', async () => {
    mockFlagsResponse([
      { flag_name: 'universal_flag', is_enabled: true, target_environments: null },
    ]);
    const result = await isFeatureEnabled('universal_flag', { environment: 'production' });
    expect(result).toBe(true);
  });

  it('returns true when target_environments is empty array', async () => {
    mockFlagsResponse([
      { flag_name: 'universal_flag', is_enabled: true, target_environments: [] },
    ]);
    const result = await isFeatureEnabled('universal_flag', { environment: 'production' });
    expect(result).toBe(true);
  });
});

describe('Feature Flag Rollout Percentage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFlagCache();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('returns false when rollout_percentage is 0', async () => {
    mockFlagsResponse([
      { flag_name: 'new_ui', is_enabled: true, rollout_percentage: 0 },
    ]);
    const result = await isFeatureEnabled('new_ui');
    expect(result).toBe(false);
  });

  it('returns true when rollout_percentage is 100', async () => {
    mockFlagsResponse([
      { flag_name: 'new_ui', is_enabled: true, rollout_percentage: 100 },
    ]);
    const result = await isFeatureEnabled('new_ui');
    expect(result).toBe(true);
  });

  it('returns true when rollout_percentage is null (treated as 100%)', async () => {
    mockFlagsResponse([
      { flag_name: 'new_ui', is_enabled: true, rollout_percentage: null },
    ]);
    const result = await isFeatureEnabled('new_ui');
    expect(result).toBe(true);
  });
});

describe('Feature Flag Combined Scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFlagCache();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('requires both role AND environment to match', async () => {
    mockFlagsResponse([
      {
        flag_name: 'beta_feature',
        is_enabled: true,
        target_roles: ['teacher'],
        target_environments: ['staging'],
      },
    ]);
    // Correct role, correct environment
    const result = await isFeatureEnabled('beta_feature', {
      role: 'teacher',
      environment: 'staging',
    });
    expect(result).toBe(true);
  });

  it('returns false if role matches but environment does not', async () => {
    mockFlagsResponse([
      {
        flag_name: 'beta_feature',
        is_enabled: true,
        target_roles: ['teacher'],
        target_environments: ['staging'],
      },
    ]);
    const result = await isFeatureEnabled('beta_feature', {
      role: 'teacher',
      environment: 'production',
    });
    expect(result).toBe(false);
  });

  it('returns false if environment matches but role does not', async () => {
    mockFlagsResponse([
      {
        flag_name: 'beta_feature',
        is_enabled: true,
        target_roles: ['teacher'],
        target_environments: ['staging'],
      },
    ]);
    const result = await isFeatureEnabled('beta_feature', {
      role: 'student',
      environment: 'staging',
    });
    expect(result).toBe(false);
  });
});

describe('getEvaluatedFlags', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFlagCache();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('returns a record of all flags evaluated for a context', async () => {
    mockFlagsResponse([
      { flag_name: 'feature_a', is_enabled: true },
      { flag_name: 'feature_b', is_enabled: false },
      { flag_name: 'feature_c', is_enabled: true, target_roles: ['teacher'] },
    ]);

    const flags = await getEvaluatedFlags({ role: 'student' });
    expect(flags.feature_a).toBe(true);
    expect(flags.feature_b).toBe(false);
    expect(flags.feature_c).toBe(false); // student not in target_roles
  });
});

describe('Feature Flag Cache Invalidation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFlagCache();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('re-fetches flags after invalidation', async () => {
    // First call: flag disabled
    mockFlagsResponse([
      { flag_name: 'toggle_me', is_enabled: false },
    ]);
    const result1 = await isFeatureEnabled('toggle_me');
    expect(result1).toBe(false);

    // Invalidate cache
    invalidateFlagCache();

    // Second call: flag enabled
    mockFlagsResponse([
      { flag_name: 'toggle_me', is_enabled: true },
    ]);
    const result2 = await isFeatureEnabled('toggle_me');
    expect(result2).toBe(true);

    // fetch should have been called twice (once per loadFlags)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
