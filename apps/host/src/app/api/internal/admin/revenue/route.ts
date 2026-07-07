import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export const runtime = 'nodejs';

// GET /api/internal/admin/revenue?period=7d|30d|90d
export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;
  const period = sp.get('period') || '30d';

  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const [paymentsRes, plansRes, mrr30Res] = await Promise.all([
      supabase
        .from('payment_history')
        .select('amount,status,created_at,subscription_plan')
        .eq('status', 'captured')
        .gte('created_at', since)
        .order('created_at', { ascending: true }),

      // Current plan distribution
      supabase
        .from('students')
        .select('subscription_plan')
        .eq('is_active', true),

      // MRR: active paid subscriptions across canonical pro/unlimited tiers
      // and their billing-cycle variants. The previous query only counted
      // subscription_plan='premium' (a legacy alias no current write path
      // produces), so premium_count was always 0 on this dashboard.
      supabase
        .from('students')
        .select('subscription_plan', { count: 'exact' })
        .in('subscription_plan', [
          'pro', 'pro_monthly', 'pro_yearly',
          'unlimited', 'unlimited_monthly', 'unlimited_yearly',
          'ultimate_monthly', 'ultimate_yearly',
          'premium', // legacy — captures any un-migrated rows
        ])
        .eq('is_active', true),
    ]);

    // Daily revenue bucketing
    const byDay: Record<string, number> = {};
    for (const r of (paymentsRes.data || [])) {
      const d = (r as Record<string, unknown>).created_at?.toString().slice(0, 10) || '';
      byDay[d] = (byDay[d] || 0) + (Number((r as Record<string, unknown>).amount) || 0);
    }

    const dailyRevenue = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount_paise]) => ({ date, amount_inr: Math.round(amount_paise / 100) }));

    const totalRevenue = Object.values(byDay).reduce((s, v) => s + v, 0) / 100;

    // Plan distribution
    const planDist: Record<string, number> = { free: 0, basic: 0, premium: 0 };
    for (const r of (plansRes.data || [])) {
      const p = (r as Record<string, unknown>).subscription_plan as string || 'free';
      planDist[p] = (planDist[p] || 0) + 1;
    }

    return NextResponse.json({
      period,
      total_revenue_inr: totalRevenue,
      daily_revenue: dailyRevenue,
      plan_distribution: planDist,
      premium_count: mrr30Res.count ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
