import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFeatureFlagFullReconciliationPlan,
  buildFeatureFlagReconciliationPlan,
  type FeatureFlagMatrix,
  type LiveFeatureFlagRow,
} from '../../../../scripts/reconcile-feature-flag-matrix';

const SCRIPT_PATH = resolve(process.cwd(), '..', '..', 'scripts', 'reconcile-feature-flag-matrix.ts');

const matrix: FeatureFlagMatrix = {
  flags: [
    {
      name: 'ff_expected_on',
      stagingEnabled: true,
      productionEnabled: true,
    },
    {
      name: 'ff_expected_off',
      stagingEnabled: false,
      productionEnabled: false,
    },
  ],
};

describe('feature flag matrix reconciliation planner', () => {
  it('plans missing inserts, matrix drift updates, and enabled unclassified flag disables', () => {
    const rows: LiveFeatureFlagRow[] = [
      {
        flag_name: 'ff_expected_on',
        is_enabled: true,
        target_environments: ['staging'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_expected_off',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_unclassified_enabled',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_unclassified_inert',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 0,
      },
    ];

    const plan = buildFeatureFlagReconciliationPlan(matrix, rows, 'production');

    expect(plan.actions).toEqual([
      {
        type: 'update_drift',
        flagName: 'ff_expected_off',
        environment: 'production',
        expectedEnabled: false,
        reason: 'live row is enabled but matrix expects disabled',
        patch: {
          flag_name: 'ff_expected_off',
          is_enabled: false,
          target_environments: ['production'],
          rollout_percentage: 0,
        },
      },
      {
        type: 'update_drift',
        flagName: 'ff_expected_on',
        environment: 'production',
        expectedEnabled: true,
        reason: 'live row is disabled or scoped out but matrix expects enabled',
        patch: {
          flag_name: 'ff_expected_on',
          is_enabled: true,
          target_environments: ['production'],
          rollout_percentage: 100,
        },
      },
      {
        type: 'disable_unclassified_live_flag',
        flagName: 'ff_unclassified_enabled',
        environment: 'production',
        reason: 'live flag is enabled for the target environment but is not classified in feature-flag-matrix.json',
        patch: {
          flag_name: 'ff_unclassified_enabled',
          is_enabled: false,
          target_environments: ['production'],
          rollout_percentage: 0,
        },
      },
    ]);
    expect(plan.actionCount).toBe(3);
  });

  it('plans insertion for missing matrix flags', () => {
    const plan = buildFeatureFlagReconciliationPlan(matrix, [], 'staging');

    expect(plan.actions.map((action) => action.type)).toEqual(['insert_missing', 'insert_missing']);
    expect(plan.actions[0]).toMatchObject({
      flagName: 'ff_expected_off',
      expectedEnabled: false,
      patch: { is_enabled: false, rollout_percentage: 0, target_environments: ['staging'] },
    });
    expect(plan.actions[1]).toMatchObject({
      flagName: 'ff_expected_on',
      expectedEnabled: true,
      patch: { is_enabled: true, rollout_percentage: 100, target_environments: ['staging'] },
    });
  });

  it('builds one combined patch per flag for staging and production posture', () => {
    const combinedMatrix: FeatureFlagMatrix = {
      flags: [
        {
          name: 'ff_both_on',
          stagingEnabled: true,
          productionEnabled: true,
        },
        {
          name: 'ff_staging_only',
          stagingEnabled: true,
          productionEnabled: false,
        },
        {
          name: 'ff_production_only',
          stagingEnabled: false,
          productionEnabled: true,
        },
        {
          name: 'ff_both_off',
          stagingEnabled: false,
          productionEnabled: false,
        },
      ],
    };

    const plan = buildFeatureFlagFullReconciliationPlan(combinedMatrix, [
      {
        flag_name: 'ff_unclassified_enabled',
        is_enabled: true,
        target_environments: [],
        rollout_percentage: 100,
      },
    ]);

    expect(plan.actions.map((action) => action.patch)).toEqual([
      {
        flag_name: 'ff_both_off',
        is_enabled: false,
        target_environments: ['staging', 'production'],
        rollout_percentage: 0,
      },
      {
        flag_name: 'ff_both_on',
        is_enabled: true,
        target_environments: ['staging', 'production'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_production_only',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_staging_only',
        is_enabled: true,
        target_environments: ['staging'],
        rollout_percentage: 100,
      },
      {
        flag_name: 'ff_unclassified_enabled',
        is_enabled: false,
        target_environments: ['staging', 'production'],
        rollout_percentage: 0,
      },
    ]);
  });

  it.each([5, 25, 50])(
    'preserves an explicitly declared %i%% rollout in environment and full-posture plans',
    (rolloutPercentage) => {
      const stagedMatrix: FeatureFlagMatrix = {
        flags: [{
          name: 'ff_staged_rollout',
          stagingEnabled: false,
          productionEnabled: true,
          rolloutPercentage,
        }],
      };
      const liveAtOneHundred: LiveFeatureFlagRow[] = [{
        flag_name: 'ff_staged_rollout',
        is_enabled: true,
        target_environments: ['production'],
        rollout_percentage: 100,
      }];

      const environmentPlan = buildFeatureFlagReconciliationPlan(
        stagedMatrix,
        liveAtOneHundred,
        'production',
      );
      const fullPlan = buildFeatureFlagFullReconciliationPlan(
        stagedMatrix,
        liveAtOneHundred,
      );

      expect(environmentPlan.actions).toHaveLength(1);
      expect(environmentPlan.actions[0]).toMatchObject({
        type: 'update_drift',
        reason: `live rollout_percentage is 100 but matrix explicitly expects ${rolloutPercentage}`,
        patch: {
          is_enabled: true,
          target_environments: ['production'],
          rollout_percentage: rolloutPercentage,
        },
      });
      expect(fullPlan.actions).toHaveLength(1);
      expect(fullPlan.actions[0]).toMatchObject({
        type: 'reconcile_full_matrix_posture',
        patch: {
          is_enabled: true,
          target_environments: ['production'],
          rollout_percentage: rolloutPercentage,
        },
      });
    },
  );

  it('preserves both enabled environments during percentage-only reconciliation', () => {
    const stagedMatrix: FeatureFlagMatrix = {
      flags: [{
        name: 'ff_shared_rollout',
        stagingEnabled: true,
        productionEnabled: true,
        rolloutPercentage: 25,
      }],
    };
    const liveRows: LiveFeatureFlagRow[] = [{
      flag_name: 'ff_shared_rollout',
      is_enabled: true,
      target_environments: ['staging', 'production'],
      rollout_percentage: 100,
    }];

    const plan = buildFeatureFlagReconciliationPlan(stagedMatrix, liveRows, 'production');

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      type: 'update_drift',
      patch: {
        is_enabled: true,
        target_environments: ['staging', 'production'],
        rollout_percentage: 25,
      },
    });
  });

  it.each([-1, 101, 25.5])(
    'fails closed before planning an invalid rolloutPercentage %s',
    (rolloutPercentage) => {
      const invalidMatrix: FeatureFlagMatrix = {
        flags: [{
          name: 'ff_invalid_rollout',
          stagingEnabled: false,
          productionEnabled: true,
          rolloutPercentage,
        }],
      };

      expect(() => buildFeatureFlagReconciliationPlan(invalidMatrix, [], 'production'))
        .toThrow(/expected an integer between 0 and 100/);
      expect(() => buildFeatureFlagFullReconciliationPlan(invalidMatrix, []))
        .toThrow(/expected an integer between 0 and 100/);
    },
  );

  it('supports all-environment CLI reconciliation without requiring an upsert constraint', () => {
    const script = readFileSync(SCRIPT_PATH, 'utf8');

    expect(script).toContain("--env value \"${raw}\". Use staging, production, or all.");
    expect(script).toContain("environment === 'all'");
    expect(script).toContain('.update(action.patch)');
    expect(script).toContain('.insert(action.patch)');
    expect(script).not.toContain('.upsert(');
  });
});
