#!/usr/bin/env -S npx tsx
/**
 * RCA-04/RCA-22/RCA-25 mobile legacy traffic verifier.
 *
 * Dependency-free gate: export mobile request telemetry as JSON, then verify
 * that release traffic is no longer hitting legacy quiz submit or old payment
 * surfaces before revoking compatibility paths.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface LegacyApiInventoryEntry {
  id: string;
  surface: 'rpc' | 'api_route' | 'client_direct_rpc';
  name: string;
  owner: string;
  risk: string;
  status: 'active_compat' | 'cutover_pending' | 'deprecated' | 'blocked';
  deprecationCondition: string;
  plannedAction: string;
  evidence: string[];
}

export interface LegacyApiInventory {
  entries: LegacyApiInventoryEntry[];
}

export interface MobileLegacyTrafficRow {
  path?: string | null;
  rpc?: string | null;
  client?: string | null;
  method?: string | null;
  request_count?: number | null;
  count?: number | null;
  last_seen_at?: string | null;
}

export interface MobileLegacyTrafficFailure {
  category: 'quiz' | 'payment';
  client: string;
  surface: string;
  observedPath: string;
  requestCount: number;
  lastSeenAt: string | null;
  canonicalReplacement: string;
  reason: string;
}

export interface MobileLegacyTrafficComparison {
  ok: boolean;
  checkedRows: number;
  failures: MobileLegacyTrafficFailure[];
}

interface SupabaseCliRowsWrapper {
  rows?: unknown;
}

interface LegacyTrafficSurface {
  category: 'quiz' | 'payment';
  surface: string;
  canonicalReplacement: string;
  reason: string;
  matches(row: MobileLegacyTrafficRow): boolean;
}

const LEGACY_PAYMENT_PATHS = [
  '/api/payments/subscribe',
  '/api/payments/status',
  '/api/payments/setup-plans',
  '/api/payments/cancel',
];

function requestCount(row: MobileLegacyTrafficRow): number {
  return Number(row.request_count ?? row.count ?? 0);
}

function observedPath(row: MobileLegacyTrafficRow): string {
  return row.path ?? (row.rpc ? `/rest/v1/rpc/${row.rpc}` : '(unknown)');
}

function normalizeClient(row: MobileLegacyTrafficRow): string {
  return row.client?.trim() || 'unknown';
}

function legacyQuizSurfaces(inventory: LegacyApiInventory): LegacyTrafficSurface[] {
  return inventory.entries
    .filter((entry) => entry.status === 'active_compat' || entry.status === 'cutover_pending')
    .filter((entry) => entry.name.includes('submit_quiz_results'))
    .map((entry) => ({
      category: 'quiz' as const,
      surface: entry.name,
      canonicalReplacement: '/api/v2/quiz/submit',
      reason: 'legacy quiz submit traffic is still present',
      matches(row: MobileLegacyTrafficRow): boolean {
        const path = row.path ?? '';
        return row.rpc === entry.name || path.endsWith(`/rpc/${entry.name}`) || path.includes(entry.name);
      },
    }));
}

function legacyPaymentSurfaces(): LegacyTrafficSurface[] {
  return LEGACY_PAYMENT_PATHS.map((path) => ({
    category: 'payment' as const,
    surface: path,
    canonicalReplacement: '/api/payments/create-order + /api/payments/verify',
    reason: 'legacy payment traffic is still present',
    matches(row: MobileLegacyTrafficRow): boolean {
      const rowPath = row.path ?? '';
      return rowPath === path || rowPath.startsWith(`${path}/`);
    },
  }));
}

function buildLegacySurfaces(inventory: LegacyApiInventory): LegacyTrafficSurface[] {
  return [...legacyQuizSurfaces(inventory), ...legacyPaymentSurfaces()];
}

export function compareMobileLegacyTrafficRows(
  inventory: LegacyApiInventory,
  rows: MobileLegacyTrafficRow[],
): MobileLegacyTrafficComparison {
  const surfaces = buildLegacySurfaces(inventory);
  const failures: MobileLegacyTrafficFailure[] = [];

  for (const row of rows) {
    const count = requestCount(row);
    if (count <= 0) continue;

    for (const surface of surfaces) {
      if (!surface.matches(row)) continue;
      failures.push({
        category: surface.category,
        client: normalizeClient(row),
        surface: surface.surface,
        observedPath: observedPath(row),
        requestCount: count,
        lastSeenAt: row.last_seen_at ?? null,
        canonicalReplacement: surface.canonicalReplacement,
        reason: surface.reason,
      });
    }
  }

  return {
    ok: failures.length === 0,
    checkedRows: rows.length,
    failures,
  };
}

export function normalizeMobileLegacyTrafficRows(input: unknown): MobileLegacyTrafficRow[] {
  if (Array.isArray(input)) return input as MobileLegacyTrafficRow[];
  const maybeWrapped = input as SupabaseCliRowsWrapper;
  if (maybeWrapped && Array.isArray(maybeWrapped.rows)) {
    return maybeWrapped.rows as MobileLegacyTrafficRow[];
  }
  throw new Error('Expected a JSON array of telemetry rows or a Supabase CLI { rows: [...] } wrapper.');
}

export function buildMobileLegacyTrafficSql(inventory: LegacyApiInventory): string {
  const quizValues = legacyQuizSurfaces(inventory)
    .map((surface) => `    ('quiz', '${surface.surface.replace(/'/g, "''")}')`);
  const paymentValues = legacyPaymentSurfaces()
    .map((surface) => `    ('payment', '${surface.surface.replace(/'/g, "''")}')`);
  const values = [...quizValues, ...paymentValues].join(',\n');

  return `-- RCA-04/RCA-22/RCA-25 mobile legacy traffic export
-- Read-only. Export as JSON and run:
--   npx tsx scripts/verify-mobile-legacy-traffic-live.ts --input=<rows.json>
WITH legacy_surfaces(category, surface) AS (
  VALUES
${values}
)
SELECT
  l.path,
  l.rpc,
  l.client,
  COUNT(*)::int AS request_count,
  MAX(l.occurred_at) AS last_seen_at
FROM api_request_logs l
JOIN legacy_surfaces s
  ON l.path = s.surface
  OR l.path LIKE s.surface || '/%'
  OR l.path = '/rest/v1/rpc/' || s.surface
  OR l.rpc = s.surface
WHERE l.occurred_at >= NOW() - INTERVAL '14 days'
  AND LOWER(COALESCE(l.client, '')) IN ('android', 'ios', 'mobile')
GROUP BY l.path, l.rpc, l.client
ORDER BY last_seen_at DESC;`;
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

function readInventory(): LegacyApiInventory {
  return JSON.parse(readFileSync(repoPath('scripts/legacy-api-inventory.json'), 'utf8')) as LegacyApiInventory;
}

function formatComparison(comparison: MobileLegacyTrafficComparison): string {
  const lines = ['RCA-04/RCA-22/RCA-25 mobile legacy traffic', '==============================================', ''];
  if (comparison.failures.length === 0) {
    lines.push(`[PASS] ${comparison.checkedRows} telemetry rows checked; no legacy mobile quiz/payment traffic found.`);
  } else {
    for (const failure of comparison.failures) {
      lines.push(
        `[FAIL] ${failure.client} ${failure.observedPath}: ${failure.requestCount} requests for ${failure.surface}; use ${failure.canonicalReplacement}`,
      );
    }
    lines.push('', `Summary: ${comparison.failures.length} legacy traffic finding(s).`);
  }
  return lines.join('\n');
}

function argValue(prefix: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match?.slice(prefix.length + 1);
}

function main(): void {
  const inventory = readInventory();
  if (process.argv.includes('--print-sql')) {
    // eslint-disable-next-line no-console
    console.log(buildMobileLegacyTrafficSql(inventory));
    return;
  }

  const input = argValue('--input');
  if (!input) {
    throw new Error(
      'Missing --input=<rows.json>. Use --print-sql, export live mobile traffic rows as JSON, then pass them here.',
    );
  }

  const rows = normalizeMobileLegacyTrafficRows(JSON.parse(readFileSync(resolve(process.cwd(), input), 'utf8')));
  const comparison = compareMobileLegacyTrafficRows(inventory, rows);
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
