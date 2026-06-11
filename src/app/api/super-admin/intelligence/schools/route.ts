/**
 * GET /api/super-admin/intelligence/schools
 *   ?sort=health|churn & order=asc|desc & limit & offset
 *
 * Per-school health + churn leaderboard. Latest health row per school joined
 * with the latest churn row per school and school name/city/state.
 *
 * Auth: `authorizeAdmin(request, 'support')` — identical guard to /api/super-admin/analytics
 * and /api/super-admin/stats.
 *
 * Read-only. Degrades to { rows: [], total: 0 } (HTTP 200) when EIC tables are
 * unapplied or empty.
 *
 * "Latest per school": PostgREST has no DISTINCT ON — we order rows
 * score_date.desc server-side and dedup by school_id in JS (first = newest).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import {
  safeSelect,
  dedupLatest,
  fetchSchoolMeta,
  num,
  numOrNull,
  int,
  INTELLIGENCE_CACHE_HEADERS,
} from '@/lib/super-admin/intelligence';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface HealthRow {
  school_id: string;
  score_date: string;
  composite_score: unknown;
  tier: string | null;
  dau: unknown;
  mau: unknown;
  active_students: unknown;
  avg_quiz_score: unknown;
}

interface ChurnRow {
  school_id: string;
  score_date: string;
  risk_score: unknown;
  risk_band: string | null;
}

function clampInt(raw: string | null, fallback: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  const sp = request.nextUrl.searchParams;
  const sort = sp.get('sort') === 'churn' ? 'churn' : 'health';
  const order = sp.get('order') === 'asc' ? 'asc' : 'desc';
  const limit = clampInt(sp.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = clampInt(sp.get('offset'), 0, Number.MAX_SAFE_INTEGER);

  // Latest health row per school.
  const healthRaw = await safeSelect<HealthRow>(
    'school_health_daily',
    'select=school_id,score_date,composite_score,tier,dau,mau,active_students,avg_quiz_score&order=score_date.desc&limit=50000',
  );
  const latestHealth = dedupLatest(healthRaw, 'school_id');

  // Latest churn row per school.
  const churnRaw = await safeSelect<ChurnRow>(
    'school_churn_signals',
    'select=school_id,score_date,risk_score,risk_band&order=score_date.desc&limit=50000',
  );
  const latestChurn = dedupLatest(churnRaw, 'school_id');
  const churnById = new Map(latestChurn.map((c) => [c.school_id, c]));

  // Union of school ids seen in either rollup so churn-only schools still show.
  const ids = Array.from(
    new Set([...latestHealth.map((h) => h.school_id), ...latestChurn.map((c) => c.school_id)]),
  );
  const healthById = new Map(latestHealth.map((h) => [h.school_id, h]));
  const meta = await fetchSchoolMeta(ids);

  const combined = ids.map((school_id) => {
    const h = healthById.get(school_id);
    const c = churnById.get(school_id);
    const sm = meta.get(school_id);
    return {
      school_id,
      school_name: sm?.name ?? null,
      city: sm?.city ?? null,
      state: sm?.state ?? null,
      composite_score: h ? numOrNull(h.composite_score) : null,
      tier: h?.tier ?? null,
      dau: h ? int(h.dau) : 0,
      mau: h ? int(h.mau) : 0,
      active_students: h ? int(h.active_students) : 0,
      avg_quiz_score: h ? numOrNull(h.avg_quiz_score) : null,
      risk_score: c ? num(c.risk_score) : null,
      risk_band: c?.risk_band ?? null,
      score_date: h?.score_date ?? c?.score_date ?? null,
    };
  });

  const dir = order === 'asc' ? 1 : -1;
  combined.sort((a, b) => {
    const av = sort === 'churn' ? (a.risk_score ?? -1) : (a.composite_score ?? -1);
    const bv = sort === 'churn' ? (b.risk_score ?? -1) : (b.composite_score ?? -1);
    return (av - bv) * dir;
  });

  const total = combined.length;
  const rows = combined.slice(offset, offset + limit);

  return NextResponse.json({ rows, total }, { headers: INTELLIGENCE_CACHE_HEADERS });
}
