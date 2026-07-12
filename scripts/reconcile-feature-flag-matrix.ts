#!/usr/bin/env -S npx tsx
/**
 * RCA-24 feature flag reconciliation planner.
 *
 * Default mode is dry-run. Use --apply only after reviewing the printed plan.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  resolveMatrixRolloutPercentage,
  validateFeatureFlagMatrix,
  type FeatureFlagMatrix,
  type FeatureFlagMatrixEntry,
  type LiveFeatureFlagRow,
  type TargetEnvironment,
} from './verify-feature-flag-matrix';

export type { FeatureFlagMatrix, LiveFeatureFlagRow, TargetEnvironment };

export type FeatureFlagPatch = {
  flag_name: string;
  is_enabled: boolean;
  target_environments: string[];
  rollout_percentage: number;
};

export type FeatureFlagReconciliationAction =
  | {
      type: 'insert_missing';
      flagName: string;
      environment: TargetEnvironment;
      expectedEnabled: boolean;
      patch: FeatureFlagPatch;
    }
  | {
      type: 'update_drift';
      flagName: string;
      environment: TargetEnvironment;
      expectedEnabled: boolean;
      reason: string;
      patch: FeatureFlagPatch;
    }
  | {
      type: 'disable_unclassified_live_flag';
      flagName: string;
      environment: TargetEnvironment;
      reason: string;
      patch: FeatureFlagPatch;
    }
  | {
      type: 'reconcile_full_matrix_posture';
      flagName: string;
      environment: 'all';
      expectedEnabled: boolean;
      reason: string;
      patch: FeatureFlagPatch;
    };

export type FeatureFlagReconciliationPlan = {
  environment: TargetEnvironment | 'all';
  actionCount: number;
  actions: FeatureFlagReconciliationAction[];
};

type ReconciliationEnvironment = TargetEnvironment | 'all';

function expectedEnabled(entry: { productionEnabled: boolean; stagingEnabled: boolean }, environment: TargetEnvironment): boolean {
  return environment === 'production' ? entry.productionEnabled : entry.stagingEnabled;
}

function rowApplies(row: LiveFeatureFlagRow, environment: TargetEnvironment): boolean {
  const targets = row.target_environments ?? [];
  return targets.length === 0 || targets.includes(environment);
}

function rowEnabledFor(row: LiveFeatureFlagRow, environment: TargetEnvironment): boolean {
  return Boolean(row.is_enabled && rowApplies(row, environment) && row.rollout_percentage !== 0);
}

function patchFor(
  entry: Pick<FeatureFlagMatrixEntry, 'name' | 'stagingEnabled' | 'productionEnabled' | 'rolloutPercentage'>,
  environment: TargetEnvironment,
  enabled: boolean,
): FeatureFlagPatch {
  return {
    flag_name: entry.name,
    is_enabled: enabled,
    target_environments: [environment],
    rollout_percentage: enabled ? resolveMatrixRolloutPercentage(entry) : 0,
  };
}

function patchForFullPosture(entry: FeatureFlagMatrixEntry): FeatureFlagPatch {
  const enabledTargets = [
    ...(entry.stagingEnabled ? ['staging'] : []),
    ...(entry.productionEnabled ? ['production'] : []),
  ];
  const isEnabled = enabledTargets.length > 0;
  return {
    flag_name: entry.name,
    is_enabled: isEnabled,
    target_environments: isEnabled ? enabledTargets : ['staging', 'production'],
    rollout_percentage: isEnabled ? resolveMatrixRolloutPercentage(entry) : 0,
  };
}

function patchesEqual(left: FeatureFlagPatch, right: FeatureFlagPatch): boolean {
  return (
    left.flag_name === right.flag_name &&
    left.is_enabled === right.is_enabled &&
    left.rollout_percentage === right.rollout_percentage &&
    left.target_environments.join('\0') === right.target_environments.join('\0')
  );
}

export function buildFeatureFlagReconciliationPlan(
  matrix: FeatureFlagMatrix,
  rows: LiveFeatureFlagRow[],
  environment: TargetEnvironment,
): FeatureFlagReconciliationPlan {
  validateFeatureFlagMatrix(matrix);
  const matrixByName = new Map(matrix.flags.map((entry) => [entry.name, entry]));
  const rowsByName = new Map(rows.map((row) => [row.flag_name, row]));
  const actions: FeatureFlagReconciliationAction[] = [];

  for (const entry of matrix.flags) {
    const expected = expectedEnabled(entry, environment);
    const row = rowsByName.get(entry.name);
    if (!row) {
      actions.push({
        type: 'insert_missing',
        flagName: entry.name,
        environment,
        expectedEnabled: expected,
        patch: patchForFullPosture(entry),
      });
      continue;
    }

    const actual = rowEnabledFor(row, environment);
    const explicitRolloutDrift = expected
      && entry.rolloutPercentage !== undefined
      && row.rollout_percentage !== entry.rolloutPercentage;
    if (actual !== expected || explicitRolloutDrift) {
      // A feature flag is one database row shared by every environment. Every
      // classified repair must therefore write the complete matrix posture:
      // narrowing it to the selected environment would silently drop another
      // intended target, while retaining live targets could broaden rollout to
      // environments the matrix does not approve.
      const patch = patchForFullPosture(entry);
      actions.push({
        type: 'update_drift',
        flagName: entry.name,
        environment,
        expectedEnabled: expected,
        reason: actual !== expected
          ? actual
            ? 'live row is enabled but matrix expects disabled'
            : 'live row is disabled or scoped out but matrix expects enabled'
          : `live rollout_percentage is ${String(row.rollout_percentage)} but matrix explicitly expects ${entry.rolloutPercentage}`,
        patch,
      });
    }
  }

  for (const row of rows) {
    if (!row.flag_name.startsWith('ff_') || matrixByName.has(row.flag_name)) continue;
    if (!rowEnabledFor(row, environment)) continue;
    actions.push({
      type: 'disable_unclassified_live_flag',
      flagName: row.flag_name,
      environment,
      reason: 'live flag is enabled for the target environment but is not classified in feature-flag-matrix.json',
      patch: patchFor({
        name: row.flag_name,
        stagingEnabled: false,
        productionEnabled: false,
      }, environment, false),
    });
  }

  actions.sort((a, b) => a.flagName.localeCompare(b.flagName));
  return { environment, actionCount: actions.length, actions };
}

export function buildFeatureFlagFullReconciliationPlan(
  matrix: FeatureFlagMatrix,
  rows: LiveFeatureFlagRow[],
): FeatureFlagReconciliationPlan {
  validateFeatureFlagMatrix(matrix);
  const matrixByName = new Map(matrix.flags.map((entry) => [entry.name, entry]));
  const rowsByName = new Map(rows.map((row) => [row.flag_name, row]));
  const actions: FeatureFlagReconciliationAction[] = [];

  for (const entry of matrix.flags) {
    const patch = patchForFullPosture(entry);
    const row = rowsByName.get(entry.name);
    const livePatch = row
      ? {
          flag_name: row.flag_name,
          is_enabled: row.is_enabled,
          target_environments: row.target_environments ?? [],
          rollout_percentage: row.rollout_percentage ?? 0,
        }
      : null;
    if (!livePatch || !patchesEqual(livePatch, patch)) {
      actions.push({
        type: 'reconcile_full_matrix_posture',
        flagName: entry.name,
        environment: 'all',
        expectedEnabled: patch.is_enabled,
        reason: livePatch ? 'live row does not match full staging/production matrix posture' : 'matrix flag is missing',
        patch,
      });
    }
  }

  for (const row of rows) {
    if (!row.flag_name.startsWith('ff_') || matrixByName.has(row.flag_name)) continue;
    if (!rowEnabledFor(row, 'staging') && !rowEnabledFor(row, 'production')) continue;
    actions.push({
      type: 'reconcile_full_matrix_posture',
      flagName: row.flag_name,
      environment: 'all',
      expectedEnabled: false,
      reason: 'live flag is enabled but is not classified in feature-flag-matrix.json',
      patch: patchForFullPosture({
        name: row.flag_name,
        stagingEnabled: false,
        productionEnabled: false,
      }),
    });
  }

  actions.sort((a, b) => a.flagName.localeCompare(b.flagName));
  return { environment: 'all', actionCount: actions.length, actions };
}

function parseEnvironment(argv: string[]): ReconciliationEnvironment {
  const raw = argv.find((arg) => arg.startsWith('--env='))?.slice('--env='.length) ?? 'staging';
  if (raw !== 'production' && raw !== 'staging' && raw !== 'all') {
    throw new Error(`Invalid --env value "${raw}". Use staging, production, or all.`);
  }
  return raw;
}

function loadMatrix(): FeatureFlagMatrix {
  const matrix = JSON.parse(
    readFileSync(resolve(process.cwd(), 'scripts', 'feature-flag-matrix.json'), 'utf8'),
  ) as FeatureFlagMatrix;
  validateFeatureFlagMatrix(matrix);
  return matrix;
}

async function fetchLiveRows(): Promise<LiveFeatureFlagRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('feature_flags')
    .select('flag_name, is_enabled, target_environments, rollout_percentage')
    .like('flag_name', 'ff_%')
    .order('flag_name', { ascending: true });
  if (error) throw new Error(`feature_flags read failed: ${error.message}`);
  return (data ?? []) as LiveFeatureFlagRow[];
}

async function applyPlan(plan: FeatureFlagReconciliationPlan): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key);
  for (const action of plan.actions) {
    const { data, error } = await supabase
      .from('feature_flags')
      .update(action.patch)
      .eq('flag_name', action.flagName)
      .select('flag_name');
    if (error) throw new Error(`${action.flagName} reconcile update failed: ${error.message}`);
    if ((data ?? []).length > 0) continue;

    const { error: insertError } = await supabase.from('feature_flags').insert(action.patch);
    if (insertError) throw new Error(`${action.flagName} reconcile insert failed: ${insertError.message}`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const environment = parseEnvironment(argv);
  const apply = argv.includes('--apply');
  const matrix = loadMatrix();
  const rows = await fetchLiveRows();
  const plan =
    environment === 'all'
      ? buildFeatureFlagFullReconciliationPlan(matrix, rows)
      : buildFeatureFlagReconciliationPlan(matrix, rows, environment);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...plan }, null, 2));
  if (apply && plan.actions.length > 0) await applyPlan(plan);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
