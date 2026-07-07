/**
 * GET /api/super-admin/intelligence/geography?level=state|city
 *
 * Geographic distribution rollup from geographic_metrics for the latest
 * snapshot_date at the requested geo_level.
 *
 * Auth: `authorizeAdmin(request, 'support')` — identical guard to /api/super-admin/analytics
 * and /api/super-admin/stats.
 *
 * Read-only. Degrades to { level, rows: [] } (HTTP 200) when EIC tables are
 * unapplied or empty.
 *
 * "Latest snapshot": fetch the newest snapshot_date for the level (1 row,
 * snapshot_date.desc), then return all rows on that date. Avoids DISTINCT ON.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';
import {
  safeSelect,
  num,
  numOrNull,
  int,
  INTELLIGENCE_CACHE_HEADERS,
} from '@alfanumrik/lib/super-admin/intelligence';

export const runtime = 'nodejs';

interface GeoRow {
  snapshot_date: string;
  geo_level: string;
  geo_key: string;
  school_count: unknown;
  student_count: unknown;
  active_students: unknown;
  avg_health_score: unknown;
  total_mrr: unknown;
  churn_rate: unknown;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  const level = request.nextUrl.searchParams.get('level') === 'city' ? 'city' : 'state';

  // Find the latest snapshot_date for this level.
  const latest = await safeSelect<{ snapshot_date: string }>(
    'geographic_metrics',
    `select=snapshot_date&geo_level=eq.${level}&order=snapshot_date.desc&limit=1`,
  );
  if (latest.length === 0) {
    return NextResponse.json({ level, rows: [] }, { headers: INTELLIGENCE_CACHE_HEADERS });
  }
  const snapshotDate = latest[0].snapshot_date;

  // All rows for that level on the latest snapshot date.
  const geoRows = await safeSelect<GeoRow>(
    'geographic_metrics',
    `select=snapshot_date,geo_level,geo_key,school_count,student_count,active_students,avg_health_score,total_mrr,churn_rate&geo_level=eq.${level}&snapshot_date=eq.${snapshotDate}&order=student_count.desc&limit=10000`,
  );
  const rows = geoRows.map((r) => ({
    geo_key: r.geo_key,
    school_count: int(r.school_count),
    student_count: int(r.student_count),
    active_students: int(r.active_students),
    avg_health_score: numOrNull(r.avg_health_score),
    total_mrr: num(r.total_mrr),
    churn_rate: numOrNull(r.churn_rate),
  }));

  return NextResponse.json({ level, rows }, { headers: INTELLIGENCE_CACHE_HEADERS });
}
