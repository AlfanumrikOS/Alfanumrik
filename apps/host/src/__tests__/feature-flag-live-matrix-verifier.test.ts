import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareFeatureFlagRows,
  type FeatureFlagMatrix,
  type LiveFeatureFlagRow,
} from '../../../../scripts/verify-feature-flag-matrix';

const SCRIPT_REL = 'scripts/verify-feature-flag-matrix.ts';
const MATRIX_REL = 'scripts/feature-flag-matrix.json';

function repoPath(rel: string): string {
  for (const candidate of [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '..', rel),
    resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return resolve(process.cwd(), '..', '..', rel);
}

const matrix: FeatureFlagMatrix = {
  flags: [
    {
      name: 'ff_live_on',
      stagingEnabled: true,
      productionEnabled: true,
    },
    {
      name: 'ff_live_off',
      stagingEnabled: false,
      productionEnabled: false,
    },
  ],
};

describe('RCA-24 live feature flag matrix verifier', () => {
  it('compares live feature_flags rows against the intended environment matrix', () => {
    const rows: LiveFeatureFlagRow[] = [
      {
        flag_name: 'ff_live_on',
        is_enabled: true,
        target_environments: ['production', 'staging'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_live_off',
        is_enabled: false,
        target_environments: ['production', 'staging'],
        rollout_percentage: 100,
      },
    ];

    const result = compareFeatureFlagRows(matrix, rows, 'production');

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.missing).toEqual([]);
    expect(result.mismatched).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  it('fails on missing flags, enabled-state drift, rollout-zero drift, and unexpected live flags', () => {
    const rows: LiveFeatureFlagRow[] = [
      {
        flag_name: 'ff_live_on',
        is_enabled: true,
        target_environments: ['staging'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_live_extra',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 100,
      },
    ];

    const result = compareFeatureFlagRows(matrix, rows, 'production');

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['ff_live_off']);
    expect(result.unexpected).toEqual(['ff_live_extra']);
    expect(result.mismatched).toEqual([
      {
        name: 'ff_live_on',
        expectedEnabled: true,
        actualEnabled: false,
        reason: 'row is enabled but does not target production',
      },
    ]);
  });

  it('treats enabled rows with zero rollout as disabled in the target environment', () => {
    const rows: LiveFeatureFlagRow[] = [
      {
        flag_name: 'ff_live_on',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 0,
      },
      {
        flag_name: 'ff_live_off',
        is_enabled: false,
        target_environments: ['production'],
        rollout_percentage: 100,
      },
    ];

    const result = compareFeatureFlagRows(matrix, rows, 'production');

    expect(result.ok).toBe(false);
    expect(result.mismatched).toEqual([
      {
        name: 'ff_live_on',
        expectedEnabled: true,
        actualEnabled: false,
        reason: 'row is enabled but rollout_percentage is 0',
      },
    ]);
  });

  it('does not fail on unclassified flags that are inert in the target environment', () => {
    const rows: LiveFeatureFlagRow[] = [
      {
        flag_name: 'ff_live_on',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_live_off',
        is_enabled: false,
        target_environments: ['production'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_legacy_disabled',
        is_enabled: false,
        target_environments: ['production'],
        rollout_percentage: 0,
      },
      {
        flag_name: 'ff_legacy_zero_rollout',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 0,
      },
      {
        flag_name: 'ff_legacy_other_env',
        is_enabled: true,
        target_environments: ['staging'],
        rollout_percentage: 100,
      },
    ];

    const result = compareFeatureFlagRows(matrix, rows, 'production');

    expect(result.ok).toBe(true);
    expect(result.unexpected).toEqual([]);
  });

  it('keeps the CLI verifier read-only and linked to the RCA-24 matrix artifact', () => {
    const script = readFileSync(repoPath(SCRIPT_REL), 'utf8');
    expect(existsSync(repoPath(MATRIX_REL))).toBe(true);

    expect(script).toContain('RCA-24');
    expect(script).toContain('feature-flag-matrix.json');
    expect(script).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(script).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(script).toContain("from('feature_flags')");
    expect(script).toContain('flag_name, is_enabled, target_environments, rollout_percentage');

    for (const forbidden of ['.insert(', '.upsert(', '.update(', '.delete(', '.rpc(']) {
      expect(script, `verifier must be read-only; found ${forbidden}`).not.toContain(forbidden);
    }
  });
});
