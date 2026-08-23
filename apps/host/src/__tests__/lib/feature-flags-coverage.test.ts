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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  readFeatureFlagStrict,
  hashForRollout,
  getFeatureFlagsSimple,
  isAtlasEnabled,
  invalidateFlagCache,
  EDITORIAL_ATLAS_FLAGS,
} from '@alfanumrik/lib/feature-flags';

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

// ─────────────────────────────────────────────────────────────────────────────
// Coverage closure, installment 2 (2026-08-23).
//
// Commit b00b9c872 added `loadFlagsWithStatus`, `evaluateFlagRow` and the
// interlock-grade reader `readFeatureFlagStrict` to feature-flags.ts. Every
// consumer of `readFeatureFlagStrict` on disk (packages/lib/src/quiz/
// resume-gate.ts and the two quiz API suites) injects or vi.mock()s it, so the
// REAL implementation shipped with zero direct execution: lines 210-221 were
// wholly uncovered and the file fell below its 95/85/95/95 floor on the merged
// coverage report.
//
// The blocks below execute the real function against the same mocked-fetch
// discipline used above, and pin the ONE property that justifies its existence:
// it keeps "we know it is off" and "we could not find out" APART, where
// isFeatureEnabled collapses both to `false`.
// ─────────────────────────────────────────────────────────────────────────────

describe('readFeatureFlagStrict — undetermined: flags_unavailable', () => {
  beforeEach(() => resetMocks());

  it('reports flags_unavailable (not "off") when Supabase env is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const strict = await readFeatureFlagStrict('ff_interlock');
    expect(strict).toEqual({ determined: false, reason: 'flags_unavailable' });
    expect(mockFetch).not.toHaveBeenCalled();
    // The whole point: isFeatureEnabled cannot tell this apart from "off".
    expect(await isFeatureEnabled('ff_interlock')).toBe(false);
  });

  it('reports flags_unavailable when both service-role and anon keys are missing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const strict = await readFeatureFlagStrict('ff_interlock');
    expect(strict).toEqual({ determined: false, reason: 'flags_unavailable' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports flags_unavailable when the flag table responds non-OK and no cache exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    });
    const strict = await readFeatureFlagStrict('ff_interlock');
    expect(strict).toEqual({ determined: false, reason: 'flags_unavailable' });
  });

  it('reports flags_unavailable when the fetch throws and no cache exists', async () => {
    mockFetch.mockRejectedValueOnce(new Error('TLS handshake failed'));
    const strict = await readFeatureFlagStrict('ff_interlock');
    expect(strict).toEqual({ determined: false, reason: 'flags_unavailable' });
  });

  it('reports flags_unavailable when the flag table returns a malformed (non-array) body', async () => {
    // Line 92: a non-array payload is coerced to [] so it can never make
    // _flagCache non-iterable — and `ok` goes false so an interlock can tell.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'not an array' }),
    });
    const strict = await readFeatureFlagStrict('ff_interlock');
    expect(strict).toEqual({ determined: false, reason: 'flags_unavailable' });
  });

  it('degrades a malformed body to the flag DEFAULT (off) for isFeatureEnabled, without throwing', async () => {
    // Same malformed payload as above, read through the ramp-grade reader.
    // The `.find()` / `for...of` consumers must not throw on a non-array body.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'unexpected object' }),
    });
    await expect(isFeatureEnabled('ff_interlock')).resolves.toBe(false);
  });

  it('degrades a malformed body to an empty map for getFeatureFlagsSimple', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => 'a bare string, not a flag array',
    });
    await expect(getFeatureFlagsSimple()).resolves.toEqual({});
  });
});

describe('readFeatureFlagStrict — undetermined: flag_not_found', () => {
  beforeEach(() => resetMocks());

  it('distinguishes a MISSING row from a row that is off', async () => {
    mockFlagsResponse([{ flag_name: 'ff_present', is_enabled: false }]);
    // Row exists and is off → DETERMINED.
    await expect(readFeatureFlagStrict('ff_present')).resolves.toEqual({
      determined: true,
      enabled: false,
    });
    // Same (cached) table read, row absent → UNDETERMINED, different reason.
    await expect(readFeatureFlagStrict('ff_never_seeded')).resolves.toEqual({
      determined: false,
      reason: 'flag_not_found',
    });
    // isFeatureEnabled collapses both of those to the same `false`.
    expect(await isFeatureEnabled('ff_present')).toBe(false);
    expect(await isFeatureEnabled('ff_never_seeded')).toBe(false);
    // One network read for all four calls — the 5-minute cache held.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports flag_not_found when the table reads fine but is empty', async () => {
    mockFlagsResponse([]);
    await expect(readFeatureFlagStrict('ff_never_seeded')).resolves.toEqual({
      determined: false,
      reason: 'flag_not_found',
    });
  });

  it('matches on exact flag_name, not on prefix or substring', async () => {
    mockFlagsResponse([{ flag_name: 'ff_resume_gate_v2', is_enabled: true }]);
    await expect(readFeatureFlagStrict('ff_resume_gate')).resolves.toEqual({
      determined: false,
      reason: 'flag_not_found',
    });
  });
});

describe('readFeatureFlagStrict — determined reads and scoping parity', () => {
  beforeEach(() => resetMocks());

  const SCHOOL_A = '00000000-0000-0000-0000-000000000001';

  it('returns determined/enabled=true for a globally enabled, unscoped flag', async () => {
    mockFlagsResponse([{ flag_name: 'ff_on', is_enabled: true }]);
    await expect(readFeatureFlagStrict('ff_on', {})).resolves.toEqual({
      determined: true,
      enabled: true,
    });
  });

  it('defaults the context argument to {} when called with only a flag name', async () => {
    // Exercises the `context: FlagContext = {}` default parameter (line 207):
    // an unscoped enabled flag must read the same with no context supplied.
    mockFlagsResponse([{ flag_name: 'ff_on', is_enabled: true }]);
    await expect(readFeatureFlagStrict('ff_on')).resolves.toEqual({
      determined: true,
      enabled: true,
    });
  });

  it('treats SCOPED OUT as determined-and-disabled, never as undetermined', async () => {
    // This is the property an interlock depends on: a role/institution scope
    // miss is knowledge, not ignorance. If this ever returned `determined:
    // false` a fail-closed caller would refuse for every out-of-scope user.
    mockFlagsResponse([
      {
        flag_name: 'ff_teacher_only',
        is_enabled: true,
        target_roles: ['teacher'],
        target_institutions: [SCHOOL_A],
      },
    ]);
    await expect(
      readFeatureFlagStrict('ff_teacher_only', {
        role: 'student',
        institutionId: SCHOOL_A,
      }),
    ).resolves.toEqual({ determined: true, enabled: false });
  });

  it('agrees with isFeatureEnabled on every scoping axis (shared evaluateFlagRow)', async () => {
    mockFlagsResponse([
      {
        flag_name: 'ff_scoped',
        is_enabled: true,
        target_roles: ['teacher'],
        target_environments: ['development'],
        target_institutions: [SCHOOL_A],
      },
    ]);
    const cases: Array<{
      ctx: { role?: string; environment?: string; institutionId?: string };
      expected: boolean;
    }> = [
      {
        ctx: { role: 'teacher', environment: 'development', institutionId: SCHOOL_A },
        expected: true,
      },
      {
        ctx: { role: 'student', environment: 'development', institutionId: SCHOOL_A },
        expected: false,
      },
      {
        ctx: { role: 'teacher', environment: 'production', institutionId: SCHOOL_A },
        expected: false,
      },
      {
        ctx: { role: 'teacher', environment: 'development', institutionId: 'other-school' },
        expected: false,
      },
    ];
    for (const { ctx, expected } of cases) {
      const strict = await readFeatureFlagStrict('ff_scoped', ctx);
      expect(strict).toEqual({ determined: true, enabled: expected });
      // The two readers share evaluateFlagRow — they must never disagree.
      expect(await isFeatureEnabled('ff_scoped', ctx)).toBe(expected);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('applies deterministic per-user rollout the same way isFeatureEnabled does', async () => {
    const USER = 'user-rollout-parity-fixture';
    const bucket = hashForRollout(USER, 'ff_ramp');
    // Pick a percentage strictly above this user's bucket → included.
    mockFlagsResponse([
      { flag_name: 'ff_ramp', is_enabled: true, rollout_percentage: bucket + 1 },
    ]);
    await expect(
      readFeatureFlagStrict('ff_ramp', { userId: USER }),
    ).resolves.toEqual({ determined: true, enabled: true });
    expect(await isFeatureEnabled('ff_ramp', { userId: USER })).toBe(true);

    // And exactly at the bucket → excluded (strict `<`), but still DETERMINED.
    resetMocks();
    mockFlagsResponse([
      { flag_name: 'ff_ramp', is_enabled: true, rollout_percentage: bucket },
    ]);
    await expect(
      readFeatureFlagStrict('ff_ramp', { userId: USER }),
    ).resolves.toEqual({ determined: true, enabled: false });
  });

  it('treats a 0% rollout as determined-and-disabled even with a userId', async () => {
    mockFlagsResponse([
      { flag_name: 'ff_ramp', is_enabled: true, rollout_percentage: 0 },
    ]);
    await expect(
      readFeatureFlagStrict('ff_ramp', { userId: 'anyone' }),
    ).resolves.toEqual({ determined: true, enabled: false });
  });

  it('serves a STALE cache as a determined read (a warm snapshot is a successful read)', async () => {
    // Documented contract on loadFlagsWithStatus: `ok: true` for a served
    // cache. Refusing to act on a five-minute-old snapshot would take the
    // product down on one slow response, which is not what fail-closed means.
    mockFlagsResponse([{ flag_name: 'ff_cached', is_enabled: true }]);
    await expect(readFeatureFlagStrict('ff_cached')).resolves.toEqual({
      determined: true,
      enabled: true,
    });

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    mockFetch.mockRejectedValueOnce(new Error('flag service unreachable'));
    await expect(readFeatureFlagStrict('ff_cached')).resolves.toEqual({
      determined: true,
      enabled: true,
    });
    vi.useRealTimers();
  });

  it('goes undetermined again after invalidateFlagCache drops the stale snapshot', async () => {
    mockFlagsResponse([{ flag_name: 'ff_cached', is_enabled: true }]);
    await expect(readFeatureFlagStrict('ff_cached')).resolves.toEqual({
      determined: true,
      enabled: true,
    });

    invalidateFlagCache();
    mockFetch.mockRejectedValueOnce(new Error('flag service unreachable'));
    await expect(readFeatureFlagStrict('ff_cached')).resolves.toEqual({
      determined: false,
      reason: 'flags_unavailable',
    });
  });
});

describe('evaluateFlagRow — environment resolution fallback chain', () => {
  // `context.environment || VERCEL_ENV || NODE_ENV || 'production'`. Each rung
  // of that chain decides whether an environment-scoped flag applies, so each
  // is asserted with a matching/non-matching pair rather than inferred.
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Remove an env var ENTIRELY (not set it to the string "undefined").
   * stubEnv first so vitest records the original and unstubAllEnvs restores it.
   */
  function unsetEnv(name: string): void {
    vi.stubEnv(name, 'sentinel-to-register-original');
    delete process.env[name];
  }

  it('falls back to VERCEL_ENV when the context supplies no environment', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'development');
    mockFlagsResponse([
      { flag_name: 'ff_preview_only', is_enabled: true, target_environments: ['preview'] },
      { flag_name: 'ff_dev_only', is_enabled: true, target_environments: ['development'] },
    ]);
    // VERCEL_ENV outranks NODE_ENV, so the preview-scoped flag is on and the
    // development-scoped flag is off — proving VERCEL_ENV was the rung used.
    expect(await isFeatureEnabled('ff_preview_only')).toBe(true);
    expect(await isFeatureEnabled('ff_dev_only')).toBe(false);
  });

  it('prefers an explicit context.environment over VERCEL_ENV', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    mockFlagsResponse([
      { flag_name: 'ff_preview_only', is_enabled: true, target_environments: ['preview'] },
    ]);
    expect(
      await isFeatureEnabled('ff_preview_only', { environment: 'production' }),
    ).toBe(false);
  });

  it('falls back to NODE_ENV when VERCEL_ENV is absent', async () => {
    unsetEnv('VERCEL_ENV');
    vi.stubEnv('NODE_ENV', 'development');
    mockFlagsResponse([
      { flag_name: 'ff_dev_only', is_enabled: true, target_environments: ['development'] },
      { flag_name: 'ff_prod_only', is_enabled: true, target_environments: ['production'] },
    ]);
    expect(await isFeatureEnabled('ff_dev_only')).toBe(true);
    expect(await isFeatureEnabled('ff_prod_only')).toBe(false);
  });

  it('falls back to the production literal when context, VERCEL_ENV and NODE_ENV are all absent', async () => {
    unsetEnv('VERCEL_ENV');
    unsetEnv('NODE_ENV');
    mockFlagsResponse([
      { flag_name: 'ff_prod_only', is_enabled: true, target_environments: ['production'] },
      { flag_name: 'ff_dev_only', is_enabled: true, target_environments: ['development'] },
    ]);
    // The final literal rung: an unidentifiable environment is treated as
    // production, the most conservative choice for an env-scoped ramp.
    expect(await isFeatureEnabled('ff_prod_only')).toBe(true);
    expect(await isFeatureEnabled('ff_dev_only')).toBe(false);
  });

  it('ignores environment scoping entirely when target_environments is empty', async () => {
    unsetEnv('VERCEL_ENV');
    unsetEnv('NODE_ENV');
    mockFlagsResponse([
      { flag_name: 'ff_everywhere', is_enabled: true, target_environments: [] },
    ]);
    expect(await isFeatureEnabled('ff_everywhere')).toBe(true);
  });
});
