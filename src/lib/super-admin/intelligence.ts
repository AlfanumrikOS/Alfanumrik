/**
 * Shared helpers for the Education Intelligence Cloud super-admin API
 * (src/app/api/super-admin/intelligence/*).
 *
 * These routes are READ-ONLY (SELECT only) over the five nightly rollup tables
 * drafted in migration 20260616000000_education_intelligence_cloud_v1.sql:
 *   school_health_daily, mrr_snapshots, school_mrr_daily,
 *   school_churn_signals, geographic_metrics.
 *
 * SAFETY CONTRACT
 *   The migration may NOT be applied on every environment yet. Every query in
 *   these routes MUST degrade to an empty/null payload (HTTP 200) when:
 *     (a) the table doesn't exist yet — PostgREST returns 404 with Postgres
 *         code `42P01` (relation does not exist), or a generic non-2xx, or
 *     (b) the table exists but has no rows.
 *   We never surface a 500 for these conditions — the dashboard renders a
 *   "no data yet" state instead. We log a single keys-only warn (no PII, no
 *   row values) so operators can see the table isn't populated.
 *
 *   "Latest per school" — PostgREST has no DISTINCT ON. We order rows
 *   `score_date.desc` (or `snapshot_date.desc`) server-side, then dedup by the
 *   key column in JS keeping the FIRST occurrence (= newest). See dedupLatest().
 *
 * PRIVACY (P13)
 *   The rollup tables are aggregates-only — no PII. We join public.schools for
 *   name/city/state, which super-admin already sees in /institutions. No
 *   student-identifiable data is ever read or logged. Logs are keys-only.
 */

import { supabaseAdminUrl, supabaseAdminHeaders } from '@/lib/admin-auth';
import { logger } from '@/lib/logger';

/**
 * Run a read-only PostgREST SELECT against a rollup table and return parsed
 * rows. Degrades to [] on ANY failure (missing table, network, parse error),
 * logging a single keys-only warn. Never throws.
 */
export async function safeSelect<T>(table: string, params: string): Promise<T[]> {
  try {
    const res = await fetch(supabaseAdminUrl(table, params), {
      method: 'GET',
      headers: supabaseAdminHeaders('count=none'),
    });

    if (!res.ok) {
      // 404 + code 42P01 == relation does not exist (migration not applied).
      // Any other non-2xx is treated the same way: degrade to empty.
      logger.warn('intelligence_query_degraded', {
        table,
        status: res.status,
      });
      return [];
    }

    const data = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    logger.warn('intelligence_query_exception', { table });
    return [];
  }
}

/**
 * Dedup an array of rows ordered newest-first by `keyField`, keeping the first
 * (newest) occurrence per key. PostgREST DISTINCT ON substitute.
 */
export function dedupLatest<T extends object>(
  rows: T[],
  keyField: keyof T,
): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const row of rows) {
    const k = row[keyField];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/** Coerce a possibly-string/null numeric column to a finite number (0 fallback). */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Coerce a numeric column but preserve null (for averages/scores that may be absent). */
export function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Coerce an integer column to a finite int (0 fallback). */
export function int(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Normalize a Postgres text[] / reasons column to a string[]. */
export function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

/** Loose UUID shape check (reject obvious garbage before hitting the DB). */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Cache-Control header matching sibling super-admin operational dashboards
 * (marking-integrity uses s-maxage=60). 60s freshness for a nightly-rollup
 * dashboard is generous.
 */
export const INTELLIGENCE_CACHE_HEADERS = {
  'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
} as const;

/**
 * Fetch schools (id → name/city/state) for a set of ids. Returns a Map.
 * Degrades to an empty map on failure. schools.name/city/state are the only
 * non-aggregate fields these routes read, and super-admin already sees them in
 * /institutions.
 */
export async function fetchSchoolMeta(
  schoolIds: string[],
): Promise<Map<string, { name: string; city: string | null; state: string | null }>> {
  const map = new Map<string, { name: string; city: string | null; state: string | null }>();
  const ids = Array.from(new Set(schoolIds.filter((x) => x && isUuid(x))));
  if (ids.length === 0) return map;

  const inList = `(${ids.join(',')})`;
  const rows = await safeSelect<{ id: string; name: string; city: string | null; state: string | null }>(
    'schools',
    `select=id,name,city,state&id=in.${inList}&limit=10000`,
  );
  for (const r of rows) {
    map.set(r.id, { name: r.name, city: r.city ?? null, state: r.state ?? null });
  }
  return map;
}
