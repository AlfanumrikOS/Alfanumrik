/**
 * GET /api/super-admin/intelligence/revenue
 *
 * MRR/ARR time-series (last 90 days, ascending) from mrr_snapshots, plus the
 * top-15 schools by MRR from the latest school_mrr_daily snapshot.
 *
 * Auth: `authorizeAdmin(request, 'support')` — identical guard to /api/super-admin/analytics
 * and /api/super-admin/stats.
 *
 * Read-only. Degrades to { series: [], top_schools: [] } (HTTP 200) when EIC
 * tables are unapplied or empty.
 *
 * "Latest per school" for top_schools: order school_mrr_daily by
 * snapshot_date.desc and dedup by school_id in JS (PostgREST has no DISTINCT ON).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';
import {
  safeSelect,
  dedupLatest,
  fetchSchoolMeta,
  num,
  int,
  INTELLIGENCE_CACHE_HEADERS,
} from '@alfanumrik/lib/super-admin/intelligence';

export const runtime = 'nodejs';

interface MrrRow {
  snapshot_date: string;
  total_mrr: unknown;
  student_mrr: unknown;
  school_mrr: unknown;
  new_mrr: unknown;
  churn_mrr: unknown;
  arr: unknown;
}

interface SchoolMrrRow {
  school_id: string;
  snapshot_date: string;
  mrr: unknown;
  arr: unknown;
  seats_purchased: unknown;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  // 90-day MRR series, ascending for charting.
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const seriesRows = await safeSelect<MrrRow>(
    'mrr_snapshots',
    `select=snapshot_date,total_mrr,student_mrr,school_mrr,new_mrr,churn_mrr,arr&snapshot_date=gte.${since90}&order=snapshot_date.asc&limit=400`,
  );
  const series = seriesRows.map((r) => ({
    snapshot_date: r.snapshot_date,
    total_mrr: num(r.total_mrr),
    student_mrr: num(r.student_mrr),
    school_mrr: num(r.school_mrr),
    new_mrr: num(r.new_mrr),
    churn_mrr: num(r.churn_mrr),
    arr: num(r.arr),
  }));

  // Latest school_mrr_daily row per school, then top-15 by mrr.
  const schoolMrrRaw = await safeSelect<SchoolMrrRow>(
    'school_mrr_daily',
    'select=school_id,snapshot_date,mrr,arr,seats_purchased&order=snapshot_date.desc&limit=50000',
  );
  const latestSchoolMrr = dedupLatest(schoolMrrRaw, 'school_id');
  const top = [...latestSchoolMrr].sort((a, b) => num(b.mrr) - num(a.mrr)).slice(0, 15);
  const meta = await fetchSchoolMeta(top.map((r) => r.school_id));
  const top_schools = top.map((r) => ({
    school_id: r.school_id,
    school_name: meta.get(r.school_id)?.name ?? null,
    mrr: num(r.mrr),
    arr: num(r.arr),
    seats_purchased: int(r.seats_purchased),
  }));

  return NextResponse.json({ series, top_schools }, { headers: INTELLIGENCE_CACHE_HEADERS });
}
