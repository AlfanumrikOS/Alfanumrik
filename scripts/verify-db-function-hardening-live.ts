#!/usr/bin/env -S npx tsx
/**
 * RCA-18 live DB function hardening verifier.
 *
 * Dependency-free by design: use `--print-sql` to get the read-only catalog
 * query, run it against the target DB, save JSON rows, then pass that file via
 * `--input=<rows.json>`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DbFunctionHardeningManifestEntry {
  functionName: string;
  allowedRoles: string[];
  publicExecute: 'revoked';
  securityDefiner: true;
  searchPathPinned: true;
}

export interface DbFunctionHardeningManifest {
  functions: DbFunctionHardeningManifestEntry[];
}

export interface LiveDbFunctionHardeningRow {
  function_name: string;
  identity_arguments?: string | null;
  security_definer: boolean | null;
  config: string[] | string | null;
  public_can_execute: boolean | null;
  authenticated_can_execute: boolean | null;
  service_role_can_execute: boolean | null;
}

export interface DbFunctionHardeningFailure {
  functionName: string;
  reason: string;
}

export interface DbFunctionHardeningComparison {
  ok: boolean;
  checked: number;
  failures: DbFunctionHardeningFailure[];
}

export function normalizeDbFunctionHardeningRows(input: unknown): LiveDbFunctionHardeningRow[] {
  if (Array.isArray(input)) return input as LiveDbFunctionHardeningRow[];
  if (
    input &&
    typeof input === 'object' &&
    'rows' in input &&
    Array.isArray((input as { rows?: unknown }).rows)
  ) {
    return (input as { rows: LiveDbFunctionHardeningRow[] }).rows;
  }
  throw new Error('Expected JSON array of rows or Supabase CLI JSON object with a rows array');
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function roleColumn(role: string): keyof LiveDbFunctionHardeningRow {
  if (role === 'authenticated') return 'authenticated_can_execute';
  if (role === 'service_role') return 'service_role_can_execute';
  throw new Error(`Unsupported RCA-18 live verifier role: ${role}`);
}

function configEntries(config: LiveDbFunctionHardeningRow['config']): string[] {
  if (Array.isArray(config)) return config;
  if (!config) return [];
  return config
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function searchPathPinnedToPublic(config: LiveDbFunctionHardeningRow['config']): boolean {
  return configEntries(config).some((entry) => /^"?search_path"?\s*=\s*"?public"?(\s*,|$)/i.test(entry));
}

export function compareDbFunctionHardeningRows(
  manifest: DbFunctionHardeningManifest,
  rows: LiveDbFunctionHardeningRow[],
): DbFunctionHardeningComparison {
  const rowsByName = new Map(rows.map((row) => [row.function_name, row]));
  const failures: DbFunctionHardeningFailure[] = [];

  for (const entry of manifest.functions) {
    const row = rowsByName.get(entry.functionName);
    if (!row) {
      failures.push({
        functionName: entry.functionName,
        reason: 'function missing from live catalog query result',
      });
      continue;
    }

    const reasons: string[] = [];
    if (entry.securityDefiner && row.security_definer !== true) {
      reasons.push('SECURITY DEFINER is false');
    }
    if (entry.searchPathPinned && !searchPathPinnedToPublic(row.config)) {
      reasons.push('search_path is not pinned to public');
    }
    if (entry.publicExecute === 'revoked' && row.public_can_execute !== false) {
      reasons.push('PUBLIC can execute');
    }
    for (const role of entry.allowedRoles) {
      const column = roleColumn(role);
      if (row[column] !== true) reasons.push(`${role} cannot execute`);
    }

    if (reasons.length > 0) {
      failures.push({ functionName: entry.functionName, reason: reasons.join('; ') });
    }
  }

  return {
    ok: failures.length === 0,
    checked: manifest.functions.length,
    failures,
  };
}

export function buildDbFunctionHardeningCatalogSql(manifest: DbFunctionHardeningManifest): string {
  const values = manifest.functions
    .map((entry) => `    (${sqlString(entry.functionName)})`)
    .join(',\n');

  return `-- RCA-18 live DB function hardening verifier
-- Read-only catalog query. Export the result as JSON and run:
--   npx tsx scripts/verify-db-function-hardening-live.ts --input=<rows.json>
WITH target_functions(function_name) AS (
  VALUES
${values}
)
SELECT
  t.function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS config,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM target_functions t
LEFT JOIN LATERAL (
  SELECT p.*
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = t.function_name
  ORDER BY p.oid
  LIMIT 1
) p ON true
ORDER BY t.function_name;`;
}

function repoPath(rel: string): string {
  for (const candidate of [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '..', rel),
    resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return resolve(process.cwd(), rel);
}

function readManifest(): DbFunctionHardeningManifest {
  return JSON.parse(readFileSync(repoPath('scripts/db-function-hardening.json'), 'utf8')) as DbFunctionHardeningManifest;
}

function formatComparison(comparison: DbFunctionHardeningComparison): string {
  const lines = ['RCA-18 live DB function hardening', '===================================', ''];
  if (comparison.failures.length === 0) {
    lines.push(`[PASS] ${comparison.checked}/${comparison.checked} functions match manifest posture`);
  } else {
    for (const failure of comparison.failures) {
      lines.push(`[FAIL] ${failure.functionName}: ${failure.reason}`);
    }
    lines.push('', `Summary: ${comparison.checked - comparison.failures.length}/${comparison.checked} functions passed.`);
  }
  return lines.join('\n');
}

function argValue(prefix: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match?.slice(prefix.length + 1);
}

function main(): void {
  const manifest = readManifest();
  if (process.argv.includes('--print-sql')) {
    // eslint-disable-next-line no-console
    console.log(buildDbFunctionHardeningCatalogSql(manifest));
    return;
  }

  const input = argValue('--input');
  if (!input) {
    throw new Error(
      'Missing --input=<rows.json>. Use --print-sql, run the read-only catalog query against the target DB, then pass its JSON result here.',
    );
  }

  const rows = normalizeDbFunctionHardeningRows(JSON.parse(readFileSync(resolve(process.cwd(), input), 'utf8')));
  const comparison = compareDbFunctionHardeningRows(manifest, rows);
  // eslint-disable-next-line no-console
  console.log(formatComparison(comparison));
  process.exit(comparison.ok ? 0 : 1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
