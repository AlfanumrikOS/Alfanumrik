#!/usr/bin/env node
/**
 * RCA-24 live feature flag matrix verifier.
 *
 * Read-only operator gate:
 *   npx tsx scripts/verify-feature-flag-matrix.ts --env=production
 *   npx tsx scripts/verify-feature-flag-matrix.ts --env=staging
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Compares live public.feature_flags rows against scripts/feature-flag-matrix.json.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export type TargetEnvironment = 'production' | 'staging';

export type FeatureFlagMatrixEntry = {
  name: string;
  stagingEnabled: boolean;
  productionEnabled: boolean;
  rolloutPercentage?: number;
};

export type FeatureFlagMatrix = {
  flags: FeatureFlagMatrixEntry[];
};

export type LiveFeatureFlagRow = {
  flag_name: string;
  is_enabled: boolean;
  target_environments: string[] | null;
  rollout_percentage: number | null;
};

export type FeatureFlagMismatch = {
  name: string;
  expectedEnabled: boolean;
  actualEnabled: boolean;
  expectedRolloutPercentage?: number;
  actualRolloutPercentage?: number | null;
  reason: string;
};

export type FeatureFlagComparisonResult = {
  ok: boolean;
  environment: TargetEnvironment;
  checked: number;
  missing: string[];
  mismatched: FeatureFlagMismatch[];
  unexpected: string[];
};

type FlagsDB = {
  public: {
    Tables: {
      feature_flags: {
        Row: LiveFeatureFlagRow;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};

const MATRIX_PATH = resolve(process.cwd(), 'scripts', 'feature-flag-matrix.json');

function validateFeatureFlagMatrixEntry(entry: FeatureFlagMatrixEntry): void {
  const rolloutPercentage = entry.rolloutPercentage;
  if (rolloutPercentage === undefined) return;

  if (
    typeof rolloutPercentage !== 'number'
    || !Number.isInteger(rolloutPercentage)
    || rolloutPercentage < 0
    || rolloutPercentage > 100
  ) {
    throw new Error(
      `Invalid rolloutPercentage for ${entry.name}: expected an integer between 0 and 100, received ${String(rolloutPercentage)}.`,
    );
  }

  const enabledSomewhere = entry.stagingEnabled || entry.productionEnabled;
  if (enabledSomewhere && rolloutPercentage === 0) {
    throw new Error(
      `Invalid rolloutPercentage for ${entry.name}: an enabled environment requires a value between 1 and 100.`,
    );
  }
  if (!enabledSomewhere && rolloutPercentage !== 0) {
    throw new Error(
      `Invalid rolloutPercentage for ${entry.name}: a flag disabled in every environment must declare 0.`,
    );
  }
}

export function validateFeatureFlagMatrix(matrix: FeatureFlagMatrix): void {
  if (!matrix || !Array.isArray(matrix.flags)) {
    throw new Error('Invalid feature flag matrix: flags must be an array.');
  }
  for (const entry of matrix.flags) validateFeatureFlagMatrixEntry(entry);
}

export function resolveMatrixRolloutPercentage(entry: FeatureFlagMatrixEntry): number {
  validateFeatureFlagMatrixEntry(entry);
  if (entry.rolloutPercentage !== undefined) return entry.rolloutPercentage;
  return entry.stagingEnabled || entry.productionEnabled ? 100 : 0;
}

function expectedEnabled(entry: FeatureFlagMatrixEntry, environment: TargetEnvironment): boolean {
  return environment === 'production' ? entry.productionEnabled : entry.stagingEnabled;
}

function environmentApplies(row: LiveFeatureFlagRow, environment: TargetEnvironment): boolean {
  const targets = row.target_environments ?? [];
  return targets.length === 0 || targets.includes(environment);
}

function actualEnabledFor(row: LiveFeatureFlagRow, environment: TargetEnvironment): {
  enabled: boolean;
  reason: string;
} {
  if (!row.is_enabled) return { enabled: false, reason: 'row is disabled' };
  if (!environmentApplies(row, environment)) {
    return { enabled: false, reason: `row is enabled but does not target ${environment}` };
  }
  if (row.rollout_percentage === 0) {
    return { enabled: false, reason: 'row is enabled but rollout_percentage is 0' };
  }
  return { enabled: true, reason: 'row is enabled for target environment' };
}

export function compareFeatureFlagRows(
  matrix: FeatureFlagMatrix,
  rows: LiveFeatureFlagRow[],
  environment: TargetEnvironment,
): FeatureFlagComparisonResult {
  validateFeatureFlagMatrix(matrix);
  const matrixByName = new Map(matrix.flags.map((entry) => [entry.name, entry]));
  const rowByName = new Map(rows.map((row) => [row.flag_name, row]));
  const missing: string[] = [];
  const mismatched: FeatureFlagMismatch[] = [];

  for (const entry of matrix.flags) {
    const row = rowByName.get(entry.name);
    if (!row) {
      missing.push(entry.name);
      continue;
    }

    const expected = expectedEnabled(entry, environment);
    const actual = actualEnabledFor(row, environment);
    if (actual.enabled !== expected) {
      mismatched.push({
        name: entry.name,
        expectedEnabled: expected,
        actualEnabled: actual.enabled,
        reason: actual.reason,
      });
      continue;
    }

    if (
      expected
      && entry.rolloutPercentage !== undefined
      && row.rollout_percentage !== entry.rolloutPercentage
    ) {
      mismatched.push({
        name: entry.name,
        expectedEnabled: expected,
        actualEnabled: actual.enabled,
        expectedRolloutPercentage: entry.rolloutPercentage,
        actualRolloutPercentage: row.rollout_percentage,
        reason:
          `row rollout_percentage is ${String(row.rollout_percentage)} `
          + `but matrix explicitly expects ${entry.rolloutPercentage}`,
      });
    }
  }

  const unexpected = rows
    .filter((row) => row.flag_name.startsWith('ff_') && !matrixByName.has(row.flag_name))
    .filter((row) => actualEnabledFor(row, environment).enabled)
    .map((row) => row.flag_name)
    .sort();

  missing.sort();
  mismatched.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: missing.length === 0 && mismatched.length === 0 && unexpected.length === 0,
    environment,
    checked: matrix.flags.length,
    missing,
    mismatched,
    unexpected,
  };
}

function loadMatrix(): FeatureFlagMatrix {
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8')) as FeatureFlagMatrix;
  validateFeatureFlagMatrix(matrix);
  return matrix;
}

function parseEnvironment(argv: string[]): TargetEnvironment {
  const raw = argv.find((arg) => arg.startsWith('--env='))?.slice('--env='.length) ?? 'production';
  if (raw !== 'production' && raw !== 'staging') {
    throw new Error(`Invalid --env value "${raw}". Use production or staging.`);
  }
  return raw;
}

async function fetchLiveRows(): Promise<LiveFeatureFlagRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient<FlagsDB>(url, key);
  const { data, error } = await supabase
    .from('feature_flags')
    .select('flag_name, is_enabled, target_environments, rollout_percentage')
    .order('flag_name', { ascending: true });

  if (error) throw new Error(`feature_flags read failed: ${error.message}`);
  return data ?? [];
}

function printResult(result: FeatureFlagComparisonResult): void {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error(
      `Feature flag matrix drift detected for ${result.environment}: ` +
        `${result.missing.length} missing, ` +
        `${result.mismatched.length} mismatched, ` +
        `${result.unexpected.length} unexpected.`,
    );
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const environment = parseEnvironment(argv);
  const matrix = loadMatrix();
  const rows = await fetchLiveRows();
  const result = compareFeatureFlagRows(matrix, rows, environment);
  printResult(result);
  return result.ok ? 0 : 1;
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
