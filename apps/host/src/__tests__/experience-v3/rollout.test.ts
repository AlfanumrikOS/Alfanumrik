import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashForRollout, invalidateFlagCache, isFeatureEnabled } from '@alfanumrik/lib/feature-flags';

const flag = 'ff_ui_v3_student';

function mockRows(rows: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
  invalidateFlagCache();
}

afterEach(() => {
  invalidateFlagCache();
  vi.unstubAllGlobals();
});

describe('Experience V3 sticky rollout', () => {
  it('keeps an enabled flag at 0% disabled for every user', async () => {
    mockRows([{ flag_name: flag, is_enabled: true, target_roles: ['student'], target_environments: null, target_institutions: null, rollout_percentage: 0 }]);
    await expect(isFeatureEnabled(flag, { role: 'student', userId: 'learner-1' })).resolves.toBe(false);
  });

  it('uses a deterministic user cohort at 5%', async () => {
    mockRows([{ flag_name: flag, is_enabled: true, target_roles: ['student'], target_environments: null, target_institutions: null, rollout_percentage: 5 }]);
    const included = Array.from({ length: 500 }, (_, index) => `learner-${index}`).find((id) => hashForRollout(id, flag) < 5);
    const excluded = Array.from({ length: 500 }, (_, index) => `learner-${index}`).find((id) => hashForRollout(id, flag) >= 5);
    expect(included).toBeTruthy();
    expect(excluded).toBeTruthy();
    await expect(isFeatureEnabled(flag, { role: 'student', userId: included! })).resolves.toBe(true);
    await expect(isFeatureEnabled(flag, { role: 'student', userId: excluded! })).resolves.toBe(false);
  });

  it('fails closed for a malformed feature flag response', async () => {
    mockRows({ unexpected: true });
    await expect(isFeatureEnabled(flag, { role: 'student', userId: 'learner-1' })).resolves.toBe(false);
  });
});
