import { describe, it, expect, beforeEach } from 'vitest';
import { isProjectorRunnerEnabled, __resetFlagCacheForTests } from '@/lib/state/runtime/flag';
import { makeServiceSupabase } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();

beforeEach(async () => {
  // Remove any test flag, then reset module cache.
  await sb.from('feature_flags').delete().eq('flag_name', 'ff_projector_runner_v1');
  __resetFlagCacheForTests();
});

describe('ff_projector_runner_v1 flag', () => {
  it('returns false when flag is missing', async () => {
    expect(await isProjectorRunnerEnabled(sb)).toBe(false);
  });
  it('returns true when flag is enabled', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: true,
      rollout_percentage: 100, target_environments: [],
    });
    expect(await isProjectorRunnerEnabled(sb)).toBe(true);
  });
  it('returns false when flag is disabled', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: false,
      rollout_percentage: 0, target_environments: [],
    });
    expect(await isProjectorRunnerEnabled(sb)).toBe(false);
  });
});
