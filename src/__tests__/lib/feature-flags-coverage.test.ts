/**
 * Coverage closure tests for src/lib/feature-flags.ts.
 *
 * The main test suite at src/__tests__/feature-flags.test.ts covers the
 * happy paths of role + environment scoping, rollout percentage, and
 * cache invalidation. This file closes the named gaps recorded in
 * vitest.config.ts:107-108 — "feature-flags.ts (85% → close gaps at
 * lines 86/119/160-165)" — plus a couple of adjacent branches that
 * fell into the same blind spot:
 *
 *   - loadFlags env-missing path (line 74)
 *   - loadFlags HTTP non-OK with no cache (line 81)
 *   - loadFlags fetch-throws → return cached or [] (line 85-87)
 *   - institution scoping (lines 117-120) — 4 branches, none touched
 *   - getFeatureFlagsSimple() (lines 159-166) — entire function uncovered
 *   - isAtlasEnabled() (lines 364-377) — added 2026-05-11, no tests
 *
 * Discipline: no DB, no Supabase client, no real env. fetch is the only
 * I/O surface and it is mocked. The module-level cache is reset before
 * every test via invalidateFlagCache() (the same pattern used in the
 * main suite).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch BEFORE importing the module under test. The module reads
// process.env at function-call time, not module-load time, so env stubs
// can be set / overridden mid-test.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
vi.stubEnv('NODE_ENV', 'development');

import {
  isFeatureEnabled,
  getFeatureFlagsSimple,
  isAtlasEnabled,
  invalidateFlagCache,
  EDITORIAL_ATLAS_FLAGS,
} from '@/lib/feature-flags';

interface FlagFixture {
  flag_name: string;
  is_enabled: boolean;
  target_roles?: string[] | null;
  target_environments?: string[] | null;
  target_institutions?: string[] | null;
  rollout_percentage?: number | null;
}

function mockFlagsResponse(flags: FlagFixture[]): void {
  const normalized = flags.map((f) => ({
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

function resetMocks(): void {
  vi.restoreAllMocks();
  invalidateFlagCache();
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  // Restore env that vi.restoreAllMocks doesn't touch (stubEnv is separate).
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  vi.stubEnv('NODE_ENV', 'development');
}

describe('loadFlags — env-missing path (line 74)', () => {
  beforeEach(() => resetMocks());

  it('returns false (empty flag list) when NEXT_PUBLIC_SUPABASE_URL is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const result = await isFeatureEnabled('any_flag');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns false when service role key AND anon key are both empty', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const result = await isFeatureEnabled('any_flag');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to anon key when service role key is missing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    mockFlagsResponse([{ flag_name: 'test_flag', is_enabled: true }]);
    const result = await isFeatureEnabled('test_flag');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('loadFlags — HTTP failure paths (lines 81, 85-87)', () => {
  beforeEach(() => resetMocks());

  it('returns false when fetch responds with non-OK and no cache exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    });
    const result = await isFeatureEnabled('any_flag');
    expect(result).toBe(false);
  });

  it('returns stale cached flags when fetch responds non-OK and cache is expired (TTL fast-forwarded)', async () => {
    // First call: populate the cache with a successful load.
    mockFlagsResponse([{ flag_name: 'cached_flag', is_enabled: true }]);
    const first = await isFeatureEnabled('cached_flag');
    expect(first).toBe(true);

    // Fast-forward past the 5-minute cache TTL WITHOUT calling
    // invalidateFlagCache. _flagCache stays populated; the line-69 early
    // return on a hot cache is skipped because Date.now() > _flagCacheExpiry.
    // fetch runs, returns non-OK, and the stale _flagCache value is returned
    // (line 81 — Branch B: cache present + expired).
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'unavailable' }),
    });
    const second = await isFeatureEnabled('cached_flag');
    expect(second).toBe(true);
    vi.useRealTimers();
  });

  it('returns false when fetch throws (network error) and no cache exists', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network unreachable'));
    const result = await isFeatureEnabled('any_flag');
    expect(result).toBe(false);
  });

  it('returns stale cached flags when fetch throws and cache is expired (TTL fast-forwarded)', async () => {
    // Same shape as the non-OK Branch-B test above, exercising the catch
    // block on line 85-87 instead of the non-OK guard on line 81.
    mockFlagsResponse([{ flag_name: 'resilient_flag', is_enabled: true }]);
    const first = await isFeatureEnabled('resilient_flag');
    expect(first).toBe(true);

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    mockFetch.mockRejectedValueOnce(new Error('TLS handshake failed'));
    const second = await isFeatureEnabled('resilient_flag');
    expect(second).toBe(true);
    vi.useRealTimers();
  });
});

describe('institution scoping (lines 117-120)', () => {
  beforeEach(() => resetMocks());

  const SCHOOL_A = '00000000-0000-0000-0000-000000000001';
  const SCHOOL_B = '00000000-0000-0000-0000-000000000002';

  it('returns true when institutionId matches target_institutions', async () => {
    mockFlagsResponse([
      {
        flag_name: 'pilot_school_only',
        is_enabled: true,
        target_institutions: [SCHOOL_A],
      },
    ]);
    const result = await isFeatureEnabled('pilot_school_only', {
      institutionId: SCHOOL_A,
    });
    expect(result).toBe(true);
  });

  it('returns false when institutionId does NOT match target_institutions', async () => {
    mockFlagsResponse([
      {
        flag_name: 'pilot_school_only',
        is_enabled: true,
        target_institutions: [SCHOOL_A],
      },
    ]);
    const result = await isFeatureEnabled('pilot_school_only', {
      institutionId: SCHOOL_B,
    });
    expect(result).toBe(false);
  });

  it('returns false when target_institutions is set but context has no institutionId', async () => {
    mockFlagsResponse([
      {
        flag_name: 'pilot_school_only',
        is_enabled: true,
        target_institutions: [SCHOOL_A],
      },
    ]);
    const result = await isFeatureEnabled('pilot_school_only', {});
    expect(result).toBe(false);
  });

  it('returns true when target_institutions is empty array (applies to all schools)', async () => {
    mockFlagsResponse([
      {
        flag_name: 'all_schools',
        is_enabled: true,
        target_institutions: [],
      },
    ]);
    const result = await isFeatureEnabled('all_schools', {
      institutionId: SCHOOL_A,
    });
    expect(result).toBe(true);
  });

  it('returns true when target_institutions is null (applies to all schools)', async () => {
    mockFlagsResponse([
      {
        flag_name: 'all_schools',
        is_enabled: true,
        target_institutions: null,
      },
    ]);
    const result = await isFeatureEnabled('all_schools', {
      institutionId: SCHOOL_A,
    });
    expect(result).toBe(true);
  });
});

describe('getFeatureFlagsSimple (lines 159-166)', () => {
  beforeEach(() => resetMocks());

  it('returns a record of flag_name → is_enabled with no scoping applied', async () => {
    mockFlagsResponse([
      { flag_name: 'flag_one', is_enabled: true },
      { flag_name: 'flag_two', is_enabled: false },
      // This flag has role scoping that would deny a student — but
      // getFeatureFlagsSimple ignores scoping by contract.
      {
        flag_name: 'teacher_only',
        is_enabled: true,
        target_roles: ['teacher'],
      },
    ]);
    const flags = await getFeatureFlagsSimple();
    expect(flags.flag_one).toBe(true);
    expect(flags.flag_two).toBe(false);
    // Scoping intentionally bypassed — is_enabled is the raw value.
    expect(flags.teacher_only).toBe(true);
  });

  it('returns an empty object when no flags exist in the DB', async () => {
    mockFlagsResponse([]);
    const flags = await getFeatureFlagsSimple();
    expect(flags).toEqual({});
  });

  it('returns an empty object when loadFlags fails entirely (no cache)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('DB down'));
    const flags = await getFeatureFlagsSimple();
    expect(flags).toEqual({});
  });
});

describe('isAtlasEnabled (lines 364-377)', () => {
  // Pure function; no fetch, no cache, no beforeEach needed for state reset.
  // resetMocks() still called for env hygiene across the full file.
  beforeEach(() => resetMocks());

  it('returns false when flags map is null', () => {
    expect(isAtlasEnabled('student', null)).toBe(false);
  });

  it('returns false when flags map is undefined', () => {
    expect(isAtlasEnabled('student', undefined)).toBe(false);
  });

  it('returns true when master flag is enabled (regardless of role flag)', () => {
    const flags = { [EDITORIAL_ATLAS_FLAGS.MASTER]: true };
    expect(isAtlasEnabled('student', flags)).toBe(true);
    expect(isAtlasEnabled('parent', flags)).toBe(true);
    expect(isAtlasEnabled('teacher', flags)).toBe(true);
    expect(isAtlasEnabled('school', flags)).toBe(true);
  });

  it('returns true when only the role-specific flag is enabled', () => {
    const flags = {
      [EDITORIAL_ATLAS_FLAGS.MASTER]: false,
      [EDITORIAL_ATLAS_FLAGS.STUDENT]: true,
    };
    expect(isAtlasEnabled('student', flags)).toBe(true);
    // Other roles do NOT inherit the student flag.
    expect(isAtlasEnabled('parent', flags)).toBe(false);
    expect(isAtlasEnabled('teacher', flags)).toBe(false);
    expect(isAtlasEnabled('school', flags)).toBe(false);
  });

  it('returns false when both master and role-specific flag are absent', () => {
    const flags = {};
    expect(isAtlasEnabled('student', flags)).toBe(false);
    expect(isAtlasEnabled('parent', flags)).toBe(false);
    expect(isAtlasEnabled('teacher', flags)).toBe(false);
    expect(isAtlasEnabled('school', flags)).toBe(false);
  });

  it('returns false when both master and role-specific flag are explicitly false', () => {
    const flags = {
      [EDITORIAL_ATLAS_FLAGS.MASTER]: false,
      [EDITORIAL_ATLAS_FLAGS.STUDENT]: false,
      [EDITORIAL_ATLAS_FLAGS.PARENT]: false,
      [EDITORIAL_ATLAS_FLAGS.TEACHER]: false,
      [EDITORIAL_ATLAS_FLAGS.SCHOOL]: false,
    };
    expect(isAtlasEnabled('student', flags)).toBe(false);
    expect(isAtlasEnabled('parent', flags)).toBe(false);
    expect(isAtlasEnabled('teacher', flags)).toBe(false);
    expect(isAtlasEnabled('school', flags)).toBe(false);
  });

  it('returns true for each role when its specific flag is on (independent of others)', () => {
    expect(
      isAtlasEnabled('parent', { [EDITORIAL_ATLAS_FLAGS.PARENT]: true }),
    ).toBe(true);
    expect(
      isAtlasEnabled('teacher', { [EDITORIAL_ATLAS_FLAGS.TEACHER]: true }),
    ).toBe(true);
    expect(
      isAtlasEnabled('school', { [EDITORIAL_ATLAS_FLAGS.SCHOOL]: true }),
    ).toBe(true);
  });
});
