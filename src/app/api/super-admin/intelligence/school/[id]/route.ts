/**
 * GET /api/super-admin/intelligence/school/[id]
 *
 * Per-school drilldown: 30-day health history, 30-day churn history, and
 * 30-day MRR history for a single school, plus the school's name/city/state.
 *
 * Auth: `authorizeAdmin(request, 'support')` — identical guard to /api/super-admin/analytics
 * and /api/super-admin/stats.
 *
 * Read-only. Degrades to empty history arrays (HTTP 200) when EIC tables are
 * unapplied or empty. If the id is malformed we 400; if the school is unknown
 * (no schools row), school.name is null but histories still return (empty).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import {
  safeSelect,
  fetchSchoolMeta,
  num,
  numOrNull,
  int,
  strArray,
  isUuid,
  INTELLIGENCE_CACHE_HEADERS,
} from '@/lib/super-admin/intelligence';

export const runtime = 'nodejs';

interface HealthRow {
  score_date: string;
  composite_score: unknown;
  tier: string | null;
  adoption_score: unknown;
  engagement_score: unknown;
  outcomes_score: unknown;
  retention_score: unknown;
  usage_score: unknown;
}

interface ChurnRow {
  score_date: string;
  risk_score: unknown;
  risk_band: string | null;
  reasons: unknown;
}

interface MrrRow {
  snapshot_date: string;
  mrr: unknown;
  arr: unknown;
  seats_purchased: unknown;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid school id' }, { status: 400 });
  }

  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [meta, healthRows, churnRows, mrrRows] = await Promise.all([
    fetchSchoolMeta([id]),
    safeSelect<HealthRow>(
      'school_health_daily',
      `select=score_date,composite_score,tier,adoption_score,engagement_score,outcomes_score,retention_score,usage_score&school_id=eq.${id}&score_date=gte.${since30}&order=score_date.asc&limit=400`,
    ),
    safeSelect<ChurnRow>(
      'school_churn_signals',
      `select=score_date,risk_score,risk_band,reasons&school_id=eq.${id}&score_date=gte.${since30}&order=score_date.asc&limit=400`,
    ),
    safeSelect<MrrRow>(
      'school_mrr_daily',
      `select=snapshot_date,mrr,arr,seats_purchased&school_id=eq.${id}&snapshot_date=gte.${since30}&order=snapshot_date.asc&limit=400`,
    ),
  ]);

  const sm = meta.get(id);

  const health_history = healthRows.map((h) => ({
    score_date: h.score_date,
    composite_score: numOrNull(h.composite_score),
    tier: h.tier,
    adoption_score: numOrNull(h.adoption_score),
    engagement_score: numOrNull(h.engagement_score),
    outcomes_score: numOrNull(h.outcomes_score),
    retention_score: numOrNull(h.retention_score),
    usage_score: numOrNull(h.usage_score),
  }));

  const churn_history = churnRows.map((c) => ({
    score_date: c.score_date,
    risk_score: num(c.risk_score),
    risk_band: c.risk_band,
    reasons: strArray(c.reasons),
  }));

  const mrr_history = mrrRows.map((r) => ({
    snapshot_date: r.snapshot_date,
    mrr: num(r.mrr),
    arr: num(r.arr),
    seats_purchased: int(r.seats_purchased),
  }));

  return NextResponse.json(
    {
      school: {
        id,
        name: sm?.name ?? null,
        city: sm?.city ?? null,
        state: sm?.state ?? null,
      },
      health_history,
      churn_history,
      mrr_history,
    },
    { headers: INTELLIGENCE_CACHE_HEADERS },
  );
}
