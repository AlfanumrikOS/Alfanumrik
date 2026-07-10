#!/usr/bin/env -S npx tsx
/**
 * RCA-23 live incident ID verifier.
 *
 * Operator flow:
 *   1. Hit a target route and record the response `X-Request-Id`.
 *   2. Run `--print-sql=<request-id>` against the target DB to export matching
 *      ops_events rows as JSON.
 *   3. Save evidence JSON and run `--input=<evidence.json>`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface IncidentIdObservedEvent {
  source: string;
  request_id: string | null;
  message?: string | null;
}

export interface IncidentIdLiveEvidence {
  sampledRoute: string;
  responseRequestId: string;
  requiredSources?: string[];
  observedEvents: IncidentIdObservedEvent[];
}

export interface IncidentIdLiveComparison {
  ok: boolean;
  requestId: string;
  matchedEvents: number;
  failures: string[];
}

export function compareIncidentIdLiveEvidence(
  evidence: IncidentIdLiveEvidence,
): IncidentIdLiveComparison {
  const requestId = evidence.responseRequestId.trim();
  const failures: string[] = [];

  if (!requestId) {
    failures.push('missing response X-Request-Id');
    return { ok: false, requestId, matchedEvents: 0, failures };
  }

  const matchingEvents = evidence.observedEvents.filter((event) => event.request_id === requestId);
  if (matchingEvents.length === 0) {
    failures.push(`response X-Request-Id ${requestId} was not found in exported observability events`);
  }

  for (const source of evidence.requiredSources ?? []) {
    if (!matchingEvents.some((event) => event.source === source)) {
      failures.push(`missing required observability source for ${requestId}: ${source}`);
    }
  }

  return {
    ok: failures.length === 0,
    requestId,
    matchedEvents: matchingEvents.length,
    failures,
  };
}

export function buildIncidentIdOpsEventsSql(requestId: string): string {
  const escaped = requestId.replace(/'/g, "''");
  return `-- RCA-23 live incident ID observability export
-- Read-only. Export as JSON and run:
--   npx tsx scripts/verify-incident-id-live.ts --input=<evidence.json>
SELECT
  source,
  request_id,
  message,
  occurred_at,
  category,
  severity
FROM ops_events
WHERE request_id = '${escaped}'
ORDER BY occurred_at ASC
LIMIT 50;`;
}

function argValue(prefix: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match?.slice(prefix.length + 1);
}

function formatComparison(comparison: IncidentIdLiveComparison): string {
  const lines = ['RCA-23 live incident ID', '=======================', ''];
  if (comparison.ok) {
    lines.push(`[PASS] ${comparison.requestId} found in ${comparison.matchedEvents} observability event(s)`);
  } else {
    for (const failure of comparison.failures) lines.push(`[FAIL] ${failure}`);
  }
  return lines.join('\n');
}

function main(): void {
  const printSql = argValue('--print-sql');
  if (printSql !== undefined) {
    // eslint-disable-next-line no-console
    console.log(buildIncidentIdOpsEventsSql(printSql));
    return;
  }

  const input = argValue('--input');
  if (!input) {
    throw new Error(
      'Missing --input=<evidence.json>. Sample a route, export matching ops_events rows, then pass the evidence JSON here.',
    );
  }

  const evidence = JSON.parse(readFileSync(resolve(process.cwd(), input), 'utf8')) as IncidentIdLiveEvidence;
  const comparison = compareIncidentIdLiveEvidence(evidence);
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
