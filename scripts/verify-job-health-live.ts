#!/usr/bin/env -S npx tsx
/**
 * RCA-17 live job health verifier.
 *
 * Dependency-free gate: export last-success metric rows from the live
 * observability backend as JSON, then compare them with scripts/job-registry.json.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface JobHealthRegistryEntry {
  path: string;
  owner: string;
  lastSuccessMetric: string;
  alertThreshold: string;
}

export interface JobHealthRegistry {
  jobs: JobHealthRegistryEntry[];
}

export interface LiveJobMetricRow {
  metric: string;
  last_success_at: string | null;
}

export interface JobHealthFailure {
  path: string;
  metric: string;
  reason: string;
}

export interface JobHealthComparison {
  ok: boolean;
  checked: number;
  failures: JobHealthFailure[];
}

export function normalizeJobHealthRows(input: unknown): LiveJobMetricRow[] {
  if (Array.isArray(input)) return input as LiveJobMetricRow[];
  if (
    input &&
    typeof input === 'object' &&
    'rows' in input &&
    Array.isArray((input as { rows?: unknown }).rows)
  ) {
    return (input as { rows: LiveJobMetricRow[] }).rows;
  }
  throw new Error('Expected JSON array of rows or Supabase CLI JSON object with a rows array');
}

export function parseAlertThresholdMs(threshold: string): number {
  const match = /^no success for\s+(\d+)([hm])$/i.exec(threshold.trim());
  if (!match) throw new Error(`Unsupported job alert threshold: ${threshold}`);
  const amount = Number(match[1]);
  return match[2].toLowerCase() === 'h' ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
}

function ageLabel(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  return `${(ms / (60 * 1000)).toFixed(1)}m`;
}

export function compareJobHealthRows(
  registry: JobHealthRegistry,
  rows: LiveJobMetricRow[],
  now = new Date(),
): JobHealthComparison {
  const rowsByMetric = new Map(rows.map((row) => [row.metric, row]));
  const failures: JobHealthFailure[] = [];

  for (const job of registry.jobs) {
    const row = rowsByMetric.get(job.lastSuccessMetric);
    if (!row || !row.last_success_at) {
      failures.push({
        path: job.path,
        metric: job.lastSuccessMetric,
        reason: 'missing live last-success metric',
      });
      continue;
    }

    const lastSuccess = new Date(row.last_success_at);
    if (Number.isNaN(lastSuccess.getTime())) {
      failures.push({
        path: job.path,
        metric: job.lastSuccessMetric,
        reason: `invalid last_success_at timestamp: ${row.last_success_at}`,
      });
      continue;
    }

    const ageMs = now.getTime() - lastSuccess.getTime();
    const thresholdMs = parseAlertThresholdMs(job.alertThreshold);
    if (ageMs < 0) {
      failures.push({
        path: job.path,
        metric: job.lastSuccessMetric,
        reason: `last success timestamp is in the future: ${row.last_success_at}`,
      });
      continue;
    }
    if (ageMs > thresholdMs) {
      failures.push({
        path: job.path,
        metric: job.lastSuccessMetric,
        reason: `last success is ${ageLabel(ageMs)} old, exceeding threshold ${job.alertThreshold}`,
      });
    }
  }

  return {
    ok: failures.length === 0,
    checked: registry.jobs.length,
    failures,
  };
}

export function buildJobHealthExportSql(registry: JobHealthRegistry): string {
  const values = registry.jobs
    .map((job) => `    ('${job.lastSuccessMetric.replace(/'/g, "''")}')`)
    .join(',\n');

  return `-- RCA-17 live job health export
-- Read-only. Export as JSON and run:
--   npx tsx scripts/verify-job-health-live.ts --input=<rows.json>
WITH expected_metrics(metric) AS (
  VALUES
${values}
)
SELECT
  e.metric,
  MAX(o.occurred_at) AS last_success_at
FROM expected_metrics e
LEFT JOIN ops_events o
  ON o.category = 'job_health'
 AND o.severity = 'info'
 AND o.context->>'metric' = e.metric
GROUP BY e.metric
ORDER BY e.metric;`;
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

function readRegistry(): JobHealthRegistry {
  return JSON.parse(readFileSync(repoPath('scripts/job-registry.json'), 'utf8')) as JobHealthRegistry;
}

function formatComparison(comparison: JobHealthComparison): string {
  const lines = ['RCA-17 live job health', '======================', ''];
  if (comparison.failures.length === 0) {
    lines.push(`[PASS] ${comparison.checked}/${comparison.checked} jobs are within alert thresholds`);
  } else {
    for (const failure of comparison.failures) {
      lines.push(`[FAIL] ${failure.path} (${failure.metric}): ${failure.reason}`);
    }
    lines.push('', `Summary: ${comparison.checked - comparison.failures.length}/${comparison.checked} jobs passed.`);
  }
  return lines.join('\n');
}

function argValue(prefix: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match?.slice(prefix.length + 1);
}

function main(): void {
  const registry = readRegistry();
  if (process.argv.includes('--print-sql')) {
    // eslint-disable-next-line no-console
    console.log(buildJobHealthExportSql(registry));
    return;
  }

  const input = argValue('--input');
  if (!input) {
    throw new Error(
      'Missing --input=<rows.json>. Use --print-sql, export live last-success rows as JSON, then pass them here.',
    );
  }

  const rows = normalizeJobHealthRows(JSON.parse(readFileSync(resolve(process.cwd(), input), 'utf8')));
  const comparison = compareJobHealthRows(registry, rows);
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
