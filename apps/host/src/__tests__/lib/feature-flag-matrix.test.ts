import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface FeatureFlagMatrixEntry {
  name: string;
  defaultEnabled: boolean;
  stagingEnabled: boolean;
  productionEnabled: boolean;
  owner: string;
  rationale: string;
  source: string;
  enablementEvidence?: string;
}

describe('feature flag environment matrix (RCA-24)', () => {
  it('declares default, staging, and production intent for every registered flag', () => {
    expect(existsSync(repoPath('scripts/feature-flag-matrix.json'))).toBe(true);
    expect(existsSync(repoPath('scripts/feature-flag-matrix.overrides.json'))).toBe(true);

    const matrix = JSON.parse(
      readFileSync(repoPath('scripts/feature-flag-matrix.json'), 'utf8'),
    ) as { flags: FeatureFlagMatrixEntry[] };

    const defaultNames = Object.keys(FLAG_DEFAULTS).sort();
    const matrixNames = matrix.flags.map((entry) => entry.name).sort();
    const matrixNameSet = new Set(matrixNames);

    for (const name of defaultNames) {
      expect(matrixNameSet.has(name), `${name} missing from generated matrix`).toBe(true);
    }

    const defaults = FLAG_DEFAULTS as Readonly<Record<string, boolean>>;
    for (const entry of matrix.flags) {
      if (Object.hasOwn(defaults, entry.name)) {
        expect(entry.defaultEnabled).toBe(defaults[entry.name]);
      }
      expect(typeof entry.stagingEnabled).toBe('boolean');
      expect(typeof entry.productionEnabled).toBe('boolean');
      expect(entry.owner).toMatch(/\S/);
      expect(entry.rationale).toMatch(/\S/);
      expect(entry.source).toMatch(/^(packages\/lib\/src\/flags\/registries\/.+\.ts|scripts\/feature-flag-matrix\.overrides\.json)$/);

      if (entry.productionEnabled) {
        expect(
          entry.enablementEvidence,
          `${entry.name} is intended ON in production and needs evidence`,
        ).toMatch(/\S/);
      }
    }
  });

  it('fails closed instead of dropping an invalid rolloutPercentage override', () => {
    const generatorUrl = pathToFileURL(repoPath('scripts/gen-feature-flag-matrix.mjs')).href;
    const baseOverride = {
      name: 'ff_invalid_rollout',
      defaultEnabled: false,
      stagingEnabled: false,
      productionEnabled: true,
      owner: 'platform-ops',
      rationale: 'Regression fixture.',
      enablementEvidence: 'Regression fixture.',
    };
    const evaluation = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { mergeFeatureFlagMatrixOverrides } from ${JSON.stringify(generatorUrl)};
      const baseOverride = ${JSON.stringify(baseOverride)};
      for (const rolloutPercentage of ${JSON.stringify(['25', -1, 101, 25.5, null])}) {
        let failedClosed = false;
        try {
          mergeFeatureFlagMatrixOverrides([], { flags: [{ ...baseOverride, rolloutPercentage }] });
        } catch (error) {
          if (!String(error?.message).includes('expected an integer between 0 and 100')) throw error;
          failedClosed = true;
        }
        if (!failedClosed) throw new Error('invalid rolloutPercentage was silently accepted');
      }
      const valid = mergeFeatureFlagMatrixOverrides([], {
        flags: [{ ...baseOverride, rolloutPercentage: 25 }],
      });
      process.stdout.write(JSON.stringify(valid[0]));
    `], { encoding: 'utf8' });

    expect(evaluation.stderr).toBe('');
    expect(evaluation.status).toBe(0);
    expect(JSON.parse(evaluation.stdout)).toMatchObject({ rolloutPercentage: 25 });
  });
});
