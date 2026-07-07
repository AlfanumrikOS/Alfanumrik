/**
 * GET /api/super-admin/intelligence/overview
 *
 * Education Intelligence Cloud — top-level dashboard rollup. Combines the
 * latest MRR snapshot, per-school health tier distribution, and churn-risk band
 * distribution + top-10 at-risk schools.
 *
 * Auth: `authorizeAdmin(request, 'support')` — identical guard to /api/super-admin/analytics
 * and /api/super-admin/stats. No new RBAC permission introduced.
 *
 * Read-only (SELECT only). Degrades to empty/null shapes (HTTP 200) when the
 * EIC rollup tables are unapplied or empty — see src/lib/super-admin/intelligence.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';
import {
  safeSelect,
  dedupLatest,
  fetchSchoolMeta,
  num,
  numOrNull,
  int,
  strArray,
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

interface HealthRow {
  school_id: string;
  score_date: string;
  composite_score: unknown;
  tier: string | null;
}

interface ChurnRow {
  school_id: string;
  score_date: string;
  risk_score: unknown;
  risk_band: string | null;
  days_to_renewal: unknown;
  reasons: unknown;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  // 1. Latest platform-wide MRR snapshot (one row/day; newest first).
  const mrrRows = await safeSelect<MrrRow>(
    'mrr_snapshots',
    'select=snapshot_date,total_mrr,student_mrr,school_mrr,new_mrr,churn_mrr,arr&order=snapshot_date.desc&limit=1',
  );
  const m = mrrRows[0];
  const mrr = m
    ? {
        total: num(m.total_mrr),
        arr: num(m.arr),
        student: num(m.student_mrr),
        school: num(m.school_mrr),
        new: num(m.new_mrr),
        churn: num(m.churn_mrr),
        snapshot_date: m.snapshot_date,
      }
    : null;

  // 2. Health tier distribution — latest row per school.
  //    PostgREST has no DISTINCT ON: fetch ordered newest-first, dedup in JS.
  const healthRowsRaw = await safeSelect<HealthRow>(
    'school_health_daily',
    'select=school_id,score_date,composite_score,tier&order=score_date.desc&limit=50000',
  );
  const latestHealth = dedupLatest(healthRowsRaw, 'school_id');
  const tier_counts = { elite: 0, healthy: 0, needs_attention: 0, critical: 0 };
  let compositeSum = 0;
  let compositeN = 0;
  for (const h of latestHealth) {
    if (h.tier && h.tier in tier_counts) {
      tier_counts[h.tier as keyof typeof tier_counts]++;
    }
    const c = numOrNull(h.composite_score);
    if (c != null) {
      compositeSum += c;
      compositeN += 1;
    }
  }
  const health = {
    tier_counts,
    schools_scored: latestHealth.length,
    avg_composite: compositeN > 0 ? Math.round((compositeSum / compositeN) * 100) / 100 : 0,
  };

  // 3. Churn band distribution + top-10 at-risk — latest row per school.
  const churnRowsRaw = await safeSelect<ChurnRow>(
    'school_churn_signals',
    'select=school_id,score_date,risk_score,risk_band,days_to_renewal,reasons&order=score_date.desc&limit=50000',
  );
  const latestChurn = dedupLatest(churnRowsRaw, 'school_id');
  const band_counts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const c of latestChurn) {
    if (c.risk_band && c.risk_band in band_counts) {
      band_counts[c.risk_band as keyof typeof band_counts]++;
    }
  }
  const topRisksSorted = [...latestChurn]
    .sort((a, b) => num(b.risk_score) - num(a.risk_score))
    .slice(0, 10);
  const meta = await fetchSchoolMeta(topRisksSorted.map((r) => r.school_id));
  const top_risks = topRisksSorted.map((r) => ({
    school_id: r.school_id,
    school_name: meta.get(r.school_id)?.name ?? null,
    risk_score: num(r.risk_score),
    risk_band: r.risk_band,
    days_to_renewal: r.days_to_renewal == null ? null : int(r.days_to_renewal),
    reasons: strArray(r.reasons),
  }));

  return NextResponse.json(
    {
      mrr,
      health,
      churn: { band_counts, top_risks },
      generated_at: new Date().toISOString(),
    },
    { headers: INTELLIGENCE_CACHE_HEADERS },
  );
}
